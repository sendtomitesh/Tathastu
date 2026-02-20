'use strict';

const path = require('path');
const { normalize } = require('./normalizer');
const { PatternStore } = require('./pattern-store');
const { findBestMatch } = require('./fuzzy-matcher');
const { isContextDependent } = require('./context-detector');
const { isCorrectionTrigger } = require('./feedback-handler');
const { Metrics } = require('./metrics');

/**
 * Validate and clamp confidence threshold to [0.0, 1.0].
 * Returns default 0.7 if invalid.
 * @param {*} value
 * @param {function} onLog
 * @returns {number}
 */
function validateThreshold(value, onLog) {
  if (value === undefined || value === null) return 0.7;
  const num = Number(value);
  if (isNaN(num) || num < 0.0 || num > 1.0) {
    onLog('[resolver] Confidence threshold ' + value + ' out of range [0.0, 1.0], using default 0.7');
    return 0.7;
  }
  return num;
}

/**
 * Build context-dependent RegExp patterns from config strings.
 * @param {string[]} [patterns]
 * @returns {RegExp[]|null} null means use defaults
 */
function buildContextPatterns(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return null;
  return patterns.map(p => new RegExp(p, 'i'));
}

/**
 * Create a resolver instance.
 * @param {object} config - Bot configuration from loadConfig()
 * @param {function} [onLog] - Logging callback
 * @param {object} [deps] - Dependency injection for testing
 * @param {function} [deps.parseIntent] - Override for OpenAI parseIntent
 * @returns {{ resolveIntent, getMetrics, exportPatterns, importPatterns }}
 */
function createResolver(config, onLog, deps) {
  onLog = onLog || (() => {});
  const resolverConfig = (config && config.resolver) || {};

  const threshold = validateThreshold(resolverConfig.confidenceThreshold, onLog);
  const storePath = resolverConfig.patternStorePath
    ? path.resolve(process.cwd(), resolverConfig.patternStorePath)
    : path.resolve(process.cwd(), 'data', 'intent-patterns.json');
  const openAIFallbackEnabled = resolverConfig.openAIFallbackEnabled !== false;
  const correctionTriggers = resolverConfig.correctionTriggers || undefined;
  const contextPatterns = buildContextPatterns(resolverConfig.contextPatterns);

  // Load pattern store
  const store = new PatternStore(storePath);
  store.load();

  const metrics = new Metrics();

  // Track last resolved key for correction feedback
  let lastResolvedKey = null;

  // Load parseIntent from OpenAI module (or use injected mock)
  let parseIntent;
  if (deps && deps.parseIntent) {
    parseIntent = deps.parseIntent;
  } else {
    parseIntent = require('../openai/parse').parseIntent;
  }

  /**
   * Resolve a user message through the 3-tier pipeline.
   * @param {string} userMessage - Raw user message text
   * @param {object} cfg - Bot configuration (passed through to OpenAI)
   * @param {string} apiKey - OpenAI API key
   * @param {Array<{role: string, content: string}>} history - Conversation history
   * @returns {Promise<object>} ResolutionResult
   */
  async function resolveIntent(userMessage, cfg, apiKey, history) {
    if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
      return {
        skillId: null,
        action: 'unknown',
        params: {},
        suggestedReply: null,
        _tier: 3,
        _confidence: 0
      };
    }

    // Step 1: Check correction trigger
    if (isCorrectionTrigger(userMessage, correctionTriggers)) {
      metrics.recordCorrection();
      if (lastResolvedKey) {
        const removed = store.remove(lastResolvedKey);
        if (removed) {
          store.flush();
          onLog('[resolver] Correction: removed entry for "' + lastResolvedKey + '"');
        }
        lastResolvedKey = null;
      }
      return {
        skillId: null,
        action: 'correction',
        params: {},
        suggestedReply: 'Got it, I\'ll forget that last response. Please try again.',
        _tier: 1,
        _confidence: 1.0
      };
    }

    // Step 2: Check context-dependent → route to OpenAI or return unknown
    if (isContextDependent(userMessage, contextPatterns)) {
      if (openAIFallbackEnabled) {
        try {
          const result = await parseIntent(userMessage, cfg, apiKey, history || []);
          metrics.record(3);
          const truncated = userMessage.length > 50 ? userMessage.slice(0, 50) + '...' : userMessage;
          onLog('[resolver] "' + truncated + '" → Tier 3 (context-dependent), confidence=1.0');
          lastResolvedKey = null; // context messages don't get stored
          return {
            skillId: result.skillId,
            action: result.action,
            params: result.params || {},
            suggestedReply: result.suggestedReply || null,
            _tier: 3,
            _confidence: 1.0
          };
        } catch (err) {
          throw err; // Propagate OpenAI errors to orchestrator
        }
      } else {
        return {
          skillId: null,
          action: 'unknown',
          params: {},
          suggestedReply: 'This query requires conversation context that is not available locally. Please rephrase your question.',
          _tier: 3,
          _confidence: 0
        };
      }
    }

    // Step 3: Normalize message
    const normalizedMsg = normalize(userMessage);

    if (!normalizedMsg) {
      return {
        skillId: null,
        action: 'unknown',
        params: {},
        suggestedReply: null,
        _tier: 3,
        _confidence: 0
      };
    }

    // Step 4: Tier 1 — exact pattern match
    const tier1Entry = store.get(normalizedMsg);
    if (tier1Entry) {
      store.recordHit(normalizedMsg);
      metrics.record(1);
      lastResolvedKey = normalizedMsg;
      const truncated = userMessage.length > 50 ? userMessage.slice(0, 50) + '...' : userMessage;
      onLog('[resolver] "' + truncated + '" → Tier 1 (exact match), confidence=1.0');
      return {
        skillId: tier1Entry.intent.skillId,
        action: tier1Entry.intent.action,
        params: tier1Entry.intent.params || {},
        suggestedReply: tier1Entry.intent.suggestedReply || null,
        _tier: 1,
        _confidence: 1.0
      };
    }

    // Step 5: Tier 2 — fuzzy match
    const allEntries = store.getAll();
    const fuzzyResult = findBestMatch(normalizedMsg, allEntries, threshold);
    if (fuzzyResult) {
      store.recordHit(fuzzyResult.key);
      metrics.record(2);
      lastResolvedKey = fuzzyResult.key;
      const truncated = userMessage.length > 50 ? userMessage.slice(0, 50) + '...' : userMessage;
      onLog('[resolver] "' + truncated + '" → Tier 2 (fuzzy match), confidence=' + fuzzyResult.confidence.toFixed(2));
      return {
        skillId: fuzzyResult.entry.intent.skillId,
        action: fuzzyResult.entry.intent.action,
        params: fuzzyResult.entry.intent.params || {},
        suggestedReply: fuzzyResult.entry.intent.suggestedReply || null,
        _tier: 2,
        _confidence: fuzzyResult.confidence
      };
    }

    // Step 6: Tier 3 — OpenAI fallback
    if (openAIFallbackEnabled) {
      try {
        const result = await parseIntent(userMessage, cfg, apiKey, history || []);
        metrics.record(3);
        const truncated = userMessage.length > 50 ? userMessage.slice(0, 50) + '...' : userMessage;
        onLog('[resolver] "' + truncated + '" → Tier 3 (OpenAI fallback), confidence=1.0');

        // Store learning entry if valid intent — but skip entries with dynamic params
        // (party names, dates, invoice numbers) since those should be re-extracted each time
        if (result.skillId != null && result.action !== 'unknown') {
          const hasDynamicParams = result.params && (
            result.params.party_name || result.params.date_from || result.params.date_to ||
            result.params.invoice_number || result.params.company_name
          );
          if (!hasDynamicParams) {
            store.put(normalizedMsg, {
              skillId: result.skillId,
              action: result.action,
              params: result.params || {},
              suggestedReply: result.suggestedReply || null
            });
          }
          lastResolvedKey = normalizedMsg;
        } else {
          lastResolvedKey = null;
        }

        return {
          skillId: result.skillId,
          action: result.action,
          params: result.params || {},
          suggestedReply: result.suggestedReply || null,
          _tier: 3,
          _confidence: 1.0
        };
      } catch (err) {
        throw err; // Propagate OpenAI errors
      }
    }

    // OpenAI fallback disabled — return unknown
    lastResolvedKey = null;
    return {
      skillId: null,
      action: 'unknown',
      params: {},
      suggestedReply: 'I could not understand your query locally. Please try rephrasing.',
      _tier: 3,
      _confidence: 0
    };
  }

  function getMetrics() {
    return metrics.toJSON(store.size());
  }

  function exportPatterns() {
    return store.exportJSON();
  }

  function importPatterns(jsonString) {
    store.importJSON(jsonString);
  }

  return { resolveIntent, getMetrics, exportPatterns, importPatterns };
}

module.exports = { createResolver, validateThreshold };
