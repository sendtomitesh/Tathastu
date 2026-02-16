const path = require('path');
const fs = require('fs');

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'skills.json');

/**
 * Load and validate config. Returns { openai, whatsapp, skills }.
 * skills = only enabled skills with id, name, config, actions.
 * @param {string} [configPath] - Override path (default: config/skills.json)
 * @returns {object}
 */
function loadConfig(configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH) {
  const resolved = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config not found: ${resolved}`);
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const openai = raw.openai || { model: 'gpt-4o-mini' };
  // llm: { provider: 'openai'|'ollama'|'keyword', model?, baseUrl? }. If missing, default from openai.
  const llm = raw.llm || { provider: 'openai', model: openai.model };
  const whatsapp = raw.whatsapp || { onlyFromMe: true };
  const skills = (raw.skills || [])
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.id,
      name: s.name || s.id,
      config: s.config || {},
      actions: (s.actions || []).map((a) => ({
        id: a.id,
        description: a.description || '',
        parameters: a.parameters || [],
      })),
    }));

  const tenants = Array.isArray(raw.tenants) ? raw.tenants : [];
  // translation: { enabled, provider: 'sarvam', apiKey?, baseUrl?, defaultTarget: 'en-IN', translateReplies? }
  // apiKey can come from config or env var SARVAM_API_KEY
  const translationRaw = raw.translation || {};
  const translation = {
    enabled: translationRaw.enabled === true,
    provider: translationRaw.provider || 'sarvam',
    apiKey: translationRaw.apiKey || process.env.SARVAM_API_KEY || null,
    baseUrl: translationRaw.baseUrl || null,
    model: translationRaw.model || 'mayura:v1',
    translateReplies: translationRaw.translateReplies === true,
  };
  return { openai, llm, whatsapp, skills, tenants, translation };
}

/**
 * Get enabled skills for OpenAI prompt and registry.
 * @param {object} config - Result of loadConfig()
 * @returns {Array<{ id, name, config, actions }>}
 */
function getEnabledSkills(config) {
  return config.skills;
}

/**
 * Build a flat list of (skillId, actionId, description, parameters) for prompt building.
 * @param {object} config
 * @returns {Array<{ skillId, actionId, description, parameters }>}
 */
function getActionsForPrompt(config) {
  const out = [];
  for (const skill of config.skills) {
    for (const action of skill.actions) {
      out.push({
        skillId: skill.id,
        actionId: action.id,
        description: action.description,
        parameters: action.parameters,
      });
    }
  }
  return out;
}

module.exports = {
  loadConfig,
  getEnabledSkills,
  getActionsForPrompt,
};
