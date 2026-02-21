/**
 * Config validation utility for skills.json.
 * Checks for missing/invalid fields at startup.
 * 
 * Usage:
 *   const { validateConfig } = require('./validate');
 *   const issues = validateConfig(config);
 *   if (issues.length) console.warn('Config issues:', issues);
 * 
 * Run standalone: node src/config/validate.js
 */

const VALID_LLM_PROVIDERS = ['openai', 'ollama', 'keyword'];

/**
 * Validate a loaded config object and return an array of issue strings.
 * Empty array = all good.
 * @param {object} config - Result of loadConfig()
 * @returns {string[]} issues
 */
function validateConfig(config) {
  const issues = [];

  if (!config) {
    issues.push('Config is null or undefined');
    return issues;
  }

  // LLM section
  if (config.llm) {
    if (config.llm.provider && !VALID_LLM_PROVIDERS.includes(config.llm.provider)) {
      issues.push(`llm.provider "${config.llm.provider}" is not valid. Use: ${VALID_LLM_PROVIDERS.join(', ')}`);
    }
    if (config.llm.provider === 'openai' && !config.llm.model) {
      issues.push('llm.provider is "openai" but llm.model is not set');
    }
    if (config.llm.provider === 'ollama' && !config.llm.baseUrl) {
      issues.push('llm.provider is "ollama" but llm.baseUrl is not set (default: http://localhost:11434)');
    }
  }

  // OpenAI section
  if (config.llm?.provider === 'openai') {
    if (!process.env.OPENAI_API_KEY && !config.openai?.apiKey) {
      issues.push('OPENAI_API_KEY env var is not set and openai.apiKey is not in config');
    }
  }

  // Skills section
  if (!config.skills || !Array.isArray(config.skills)) {
    issues.push('skills array is missing or not an array');
  } else {
    if (config.skills.length === 0) {
      issues.push('No enabled skills found — bot will not be able to do anything');
    }
    const seenIds = new Set();
    for (let i = 0; i < config.skills.length; i++) {
      const skill = config.skills[i];
      const prefix = `skills[${i}]`;

      if (!skill.id) {
        issues.push(`${prefix}: missing "id"`);
      } else if (seenIds.has(skill.id)) {
        issues.push(`${prefix}: duplicate skill id "${skill.id}"`);
      } else {
        seenIds.add(skill.id);
      }

      if (!skill.name) {
        issues.push(`${prefix}: missing "name" (using id "${skill.id}" as fallback)`);
      }

      if (!skill.actions || !Array.isArray(skill.actions)) {
        issues.push(`${prefix} (${skill.id}): missing "actions" array`);
      } else {
        if (skill.actions.length === 0) {
          issues.push(`${prefix} (${skill.id}): has 0 actions — skill will do nothing`);
        }
        const seenActions = new Set();
        for (let j = 0; j < skill.actions.length; j++) {
          const action = skill.actions[j];
          const aPrefix = `${prefix}.actions[${j}]`;

          if (!action.id) {
            issues.push(`${aPrefix}: missing "id"`);
          } else if (seenActions.has(action.id)) {
            issues.push(`${aPrefix}: duplicate action id "${action.id}"`);
          } else {
            seenActions.add(action.id);
          }

          if (!action.description) {
            issues.push(`${aPrefix} (${action.id}): missing "description" — LLM won't know what this action does`);
          }

          if (action.parameters && !Array.isArray(action.parameters)) {
            issues.push(`${aPrefix} (${action.id}): "parameters" should be an array of strings`);
          }
        }
      }

      // Tally-specific checks
      if (skill.id === 'tally' && skill.config) {
        if (!skill.config.port) {
          issues.push(`${prefix} (tally): missing config.port (default: 9000)`);
        }
      }
    }
  }

  // WhatsApp section
  if (config.whatsapp) {
    if (config.whatsapp.onlySelfChat && !config.whatsapp.onlyFromMe) {
      issues.push('whatsapp.onlySelfChat is true but onlyFromMe is false — this may cause unexpected behavior');
    }
  }

  // Translation section
  if (config.translation?.enabled) {
    if (!config.translation.apiKey && !process.env.SARVAM_API_KEY) {
      issues.push('translation.enabled is true but no API key found (set translation.apiKey or SARVAM_API_KEY env var)');
    }
  }

  // Resolver section
  if (config.resolver?.enabled) {
    if (!config.resolver.confidenceThreshold) {
      issues.push('resolver.enabled is true but confidenceThreshold is not set (default: 0.7)');
    }
  }

  return issues;
}

/**
 * Print validation results to console with colors.
 * @param {string[]} issues
 */
function printValidation(issues) {
  if (issues.length === 0) {
    console.log('✅ Config validation passed — no issues found.');
    return;
  }
  console.log(`⚠️  Config validation found ${issues.length} issue(s):\n`);
  for (const issue of issues) {
    console.log(`  ⚠ ${issue}`);
  }
  console.log('');
}

// Run standalone
if (require.main === module) {
  const { loadConfig } = require('./load');
  try {
    const config = loadConfig();
    const issues = validateConfig(config);
    printValidation(issues);
    process.exit(issues.length > 0 ? 1 : 0);
  } catch (err) {
    console.error('❌ Failed to load config:', err.message);
    process.exit(1);
  }
}

module.exports = { validateConfig, printValidation };
