'use strict';

const fc = require('fast-check');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createResolver, validateThreshold } = require('../resolver');
const { normalize } = require('../normalizer');
const { PatternStore } = require('../pattern-store');

let pass = 0, fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    fail++;
    console.log('  \u2717 ' + name + ': ' + e.message);
  }
}

function tmpStorePath() {
  return path.join(os.tmpdir(), 'test-resolver-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
}

function cleanup(p) {
  try { fs.unlinkSync(p); } catch (e) { /* ignore */ }
}

/** Arbitrary: valid intent */
const intentArb = fc.record({
  skillId: fc.constantFrom('tally', 'crm', 'inventory'),
  action: fc.constantFrom('get_ledger', 'get_balance', 'get_sales', 'list_items'),
  params: fc.constant({}),
  suggestedReply: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null })
});

/** Arbitrary: safe message (not context-dependent, not correction trigger) */
const safeMessageArb = fc.array(
  fc.constantFrom('show','get','ledger','balance','report','sales','purchase','meril','party','stock','invoice','cash','bank','profit','loss','expense','list','items','create','voucher'),
  { minLength: 1, maxLength: 4 }
).map(words => words.join(' '));

async function main() {
  console.log('\n=== Resolver Property Tests ===\n');

  // Feature: local-intent-resolver, Property 1: Pipeline ordering
  // Test A: Tier 1 hit stops pipeline
  try {
    await fc.assert(
      fc.asyncProperty(safeMessageArb, intentArb, async (msg, intent) => {
        const storePath = tmpStorePath();
        let openAICalled = false;
        const mockParseIntent = async () => { openAICalled = true; return intent; };

        const normalized = normalize(msg);
        if (!normalized) return;

        // Pre-seed store
        const store = new PatternStore(storePath);
        store.put(normalized, intent);
        store.flush();

        const resolver = createResolver(
          { resolver: { patternStorePath: storePath, openAIFallbackEnabled: true, confidenceThreshold: 0.7 } },
          () => {},
          { parseIntent: mockParseIntent }
        );

        const result = await resolver.resolveIntent(msg, {}, 'key', []);
        assert.strictEqual(result._tier, 1, 'Should resolve at Tier 1');
        assert.strictEqual(result._confidence, 1.0);
        assert.strictEqual(openAICalled, false, 'OpenAI should NOT be called');
        cleanup(storePath);
      }),
      { numRuns: 100 }
    );
    pass++; console.log('  \u2713 Property 1: Tier 1 hit stops pipeline — no OpenAI call');
  } catch (e) {
    fail++; console.log('  \u2717 Property 1: Tier 1 hit stops pipeline: ' + e.message);
  }

  // Test B: Tier 1+2 miss → OpenAI called
  try {
    await fc.assert(
      fc.asyncProperty(safeMessageArb, intentArb, async (msg, intent) => {
        const storePath = tmpStorePath();
        let openAICalled = false;
        const mockParseIntent = async () => { openAICalled = true; return intent; };

        const resolver = createResolver(
          { resolver: { patternStorePath: storePath, openAIFallbackEnabled: true, confidenceThreshold: 0.7 } },
          () => {},
          { parseIntent: mockParseIntent }
        );

        const result = await resolver.resolveIntent(msg, {}, 'key', []);
        assert.strictEqual(result._tier, 3, 'Should fall through to Tier 3');
        assert.strictEqual(openAICalled, true, 'OpenAI should be called');
        cleanup(storePath);
      }),
      { numRuns: 100 }
    );
    pass++; console.log('  \u2713 Property 1: Tier 1+2 miss falls through to Tier 3');
  } catch (e) {
    fail++; console.log('  \u2717 Property 1: Tier 1+2 miss falls through to Tier 3: ' + e.message);
  }

  // Feature: local-intent-resolver, Property 2: Result structure completeness
  try {
    await fc.assert(
      fc.asyncProperty(safeMessageArb, intentArb, async (msg, intent) => {
        const storePath = tmpStorePath();
        const mockParseIntent = async () => intent;

        const resolver = createResolver(
          { resolver: { patternStorePath: storePath, openAIFallbackEnabled: true, confidenceThreshold: 0.7 } },
          () => {},
          { parseIntent: mockParseIntent }
        );

        const result = await resolver.resolveIntent(msg, {}, 'key', []);

        assert.ok(result.hasOwnProperty('skillId'), 'missing skillId');
        assert.ok(result.hasOwnProperty('action'), 'missing action');
        assert.ok(result.hasOwnProperty('params'), 'missing params');
        assert.ok(result.hasOwnProperty('suggestedReply'), 'missing suggestedReply');
        assert.ok(result.hasOwnProperty('_tier'), 'missing _tier');
        assert.ok(result.hasOwnProperty('_confidence'), 'missing _confidence');
        assert.ok([1, 2, 3].includes(result._tier), '_tier must be 1, 2, or 3');
        assert.ok(typeof result._confidence === 'number', '_confidence must be number');
        assert.ok(result._confidence >= 0.0 && result._confidence <= 1.0, '_confidence in [0,1]');
        assert.ok(typeof result.params === 'object' && result.params !== null, 'params must be object');
        assert.ok(typeof result.action === 'string', 'action must be string');

        cleanup(storePath);
      }),
      { numRuns: 100 }
    );
    pass++; console.log('  \u2713 Property 2: Result structure completeness');
  } catch (e) {
    fail++; console.log('  \u2717 Property 2: Result structure completeness: ' + e.message);
  }

  // Feature: local-intent-resolver, Property 6: Learning entry storage correctness
  try {
    await fc.assert(
      fc.asyncProperty(
        safeMessageArb,
        fc.record({
          skillId: fc.option(fc.constantFrom('tally', 'crm'), { nil: null }),
          action: fc.constantFrom('get_ledger', 'unknown', 'get_balance'),
          params: fc.constant({}),
          suggestedReply: fc.constant(null)
        }),
        async (msg, intent) => {
          const storePath = tmpStorePath();
          const mockParseIntent = async () => intent;

          const resolver = createResolver(
            { resolver: { patternStorePath: storePath, openAIFallbackEnabled: true, confidenceThreshold: 0.7 } },
            () => {},
            { parseIntent: mockParseIntent }
          );

          await resolver.resolveIntent(msg, {}, 'key', []);

          // Use exportPatterns to check in-memory state (avoids debounce timing)
          const exported = JSON.parse(resolver.exportPatterns());
          const normalized = normalize(msg);
          const isValid = intent.skillId != null && intent.action !== 'unknown';
          const entry = normalized ? exported.entries[normalized] || null : null;

          if (isValid && normalized) {
            assert.ok(entry !== null, 'Valid intent should be stored');
            assert.strictEqual(entry.hitCount, 1, 'New entry hitCount should be 1');
          } else {
            assert.strictEqual(entry, null, 'Invalid intent should NOT be stored');
          }

          cleanup(storePath);
        }
      ),
      { numRuns: 100 }
    );
    pass++; console.log('  \u2713 Property 6: Learning entry stored iff valid OpenAI result');
  } catch (e) {
    fail++; console.log('  \u2717 Property 6: Learning entry stored iff valid OpenAI result: ' + e.message);
  }

  // Feature: local-intent-resolver, Property 11: Context-dependent bypass
  try {
    const contextMessages = ['5', '12', 'more', 'next', 'next page', 'aur', 'aur dikhao', 'aage', 'vadhu', 'yes', 'haan', 'ha', 'his', 'her', 'their', 'same'];

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...contextMessages),
        intentArb,
        async (msg, intent) => {
          const storePath = tmpStorePath();
          let openAICalled = false;
          const mockParseIntent = async () => { openAICalled = true; return intent; };

          // Pre-seed store with exact match (should be bypassed)
          const normalized = normalize(msg);
          if (normalized) {
            const store = new PatternStore(storePath);
            store.put(normalized, { skillId: 'other', action: 'other_action', params: {}, suggestedReply: null });
            store.flush();
          }

          const resolver = createResolver(
            { resolver: { patternStorePath: storePath, openAIFallbackEnabled: true, confidenceThreshold: 0.7 } },
            () => {},
            { parseIntent: mockParseIntent }
          );

          const result = await resolver.resolveIntent(msg, {}, 'key', []);
          assert.strictEqual(result._tier, 3, 'Context message should go to Tier 3');
          assert.strictEqual(openAICalled, true, 'OpenAI should be called');
          cleanup(storePath);
        }
      ),
      { numRuns: 100 }
    );
    pass++; console.log('  \u2713 Property 11: Context-dependent bypass to Tier 3');
  } catch (e) {
    fail++; console.log('  \u2717 Property 11: Context-dependent bypass to Tier 3: ' + e.message);
  }

  // Feature: local-intent-resolver, Property 13: Confidence threshold validation
  try {
    fc.assert(
      fc.property(fc.double({ min: 0.0, max: 1.0, noNaN: true }), (value) => {
        const result = validateThreshold(value, () => {});
        assert.strictEqual(result, value, 'Valid threshold should be accepted');
      }),
      { numRuns: 100 }
    );

    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -1000, max: -0.001, noNaN: true }),
          fc.double({ min: 1.001, max: 1000, noNaN: true }),
          fc.constant(NaN),
          fc.constant('abc')
        ),
        (value) => {
          const result = validateThreshold(value, () => {});
          assert.strictEqual(result, 0.7, 'Invalid threshold should fall back to 0.7');
        }
      ),
      { numRuns: 100 }
    );

    // null/undefined → default
    assert.strictEqual(validateThreshold(null, () => {}), 0.7);
    assert.strictEqual(validateThreshold(undefined, () => {}), 0.7);

    pass++; console.log('  \u2713 Property 13: Confidence threshold validation');
  } catch (e) {
    fail++; console.log('  \u2717 Property 13: Confidence threshold validation: ' + e.message);
  }

  // Feature: local-intent-resolver, Property 14: Correction trigger removes entry
  try {
    await fc.assert(
      fc.asyncProperty(
        safeMessageArb,
        intentArb,
        fc.constantFrom('wrong', 'galat', 'ghalat'),
        async (msg, intent, correctionWord) => {
          const storePath = tmpStorePath();
          const mockParseIntent = async () => intent;

          const resolver = createResolver(
            { resolver: { patternStorePath: storePath, openAIFallbackEnabled: true, confidenceThreshold: 0.7 } },
            () => {},
            { parseIntent: mockParseIntent }
          );

          // Resolve a message first (Tier 3 → stores learning entry)
          await resolver.resolveIntent(msg, {}, 'key', []);

          const normalized = normalize(msg);
          const isValid = intent.skillId != null && intent.action !== 'unknown';

          if (isValid && normalized) {
            // Verify entry exists via in-memory export
            let exported = JSON.parse(resolver.exportPatterns());
            const beforeSize = Object.keys(exported.entries).length;
            assert.ok(exported.entries[normalized], 'Entry should exist before correction');

            // Send correction
            await resolver.resolveIntent(correctionWord, {}, 'key', []);

            // Verify entry removed via in-memory export
            exported = JSON.parse(resolver.exportPatterns());
            assert.ok(!exported.entries[normalized], 'Entry should be removed after correction');
            assert.strictEqual(Object.keys(exported.entries).length, beforeSize - 1, 'Store size should decrease by 1');
          }

          cleanup(storePath);
        }
      ),
      { numRuns: 100 }
    );
    pass++; console.log('  \u2713 Property 14: Correction trigger removes last resolved entry');
  } catch (e) {
    fail++; console.log('  \u2717 Property 14: Correction trigger removes last resolved entry: ' + e.message);
  }

  // Feature: local-intent-resolver, Property 15: OpenAI fallback disabled prevents API calls
  try {
    await fc.assert(
      fc.asyncProperty(safeMessageArb, async (msg) => {
        const storePath = tmpStorePath();
        let openAICalled = false;
        const mockParseIntent = async () => {
          openAICalled = true;
          return { skillId: 'tally', action: 'get_ledger', params: {}, suggestedReply: null };
        };

        const resolver = createResolver(
          { resolver: { patternStorePath: storePath, openAIFallbackEnabled: false, confidenceThreshold: 0.7 } },
          () => {},
          { parseIntent: mockParseIntent }
        );

        const result = await resolver.resolveIntent(msg, {}, 'key', []);
        assert.strictEqual(openAICalled, false, 'OpenAI should NOT be called');
        assert.strictEqual(result.action, 'unknown', 'Should return unknown');
        assert.strictEqual(result.skillId, null, 'Should return null skillId');

        // No entries stored
        const checkStore = new PatternStore(storePath);
        checkStore.load();
        assert.strictEqual(checkStore.size(), 0, 'No entries should be stored');

        cleanup(storePath);
      }),
      { numRuns: 100 }
    );
    pass++; console.log('  \u2713 Property 15: OpenAI fallback disabled — no API calls');
  } catch (e) {
    fail++; console.log('  \u2717 Property 15: OpenAI fallback disabled — no API calls: ' + e.message);
  }

  console.log('\nResults: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
