const path = require('path');
const fs = require('fs');
const { loadConfig, getEnabledSkills } = require('../config/load');

const SKILLS_DIR = path.join(__dirname);

/**
 * Discover skill modules from src/skills: each subdirectory with index.js
 * exporting execute() is a skill. Skill id = folder name.
 * @returns {Record<string, { execute: Function }>} map of skillId -> module
 */
function discoverSkillModules() {
  const map = {};
  if (!fs.existsSync(SKILLS_DIR)) return map;
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const indexPath = path.join(SKILLS_DIR, ent.name, 'index.js');
    if (!fs.existsSync(indexPath)) continue;
    try {
      const mod = require(path.join(SKILLS_DIR, ent.name));
      if (mod && typeof mod.execute === 'function') {
        map[ent.name] = mod;
      }
    } catch (err) {
      console.warn(`[skills] Skipping ${ent.name}: ${err.message}`);
    }
  }
  return map;
}

const skillModules = discoverSkillModules();

/**
 * Skill registry: loads enabled skills from config and routes execute(skillId, action, params).
 * Skills are auto-discovered from src/skills/<id>/index.js (must export execute).
 * Contract: execute(skillId, action, params, skillConfig) => Promise<{ success, message?, data? }>
 */
class SkillRegistry {
  constructor(config) {
    this.config = config || loadConfig();
    this.skills = new Map();
    const enabled = getEnabledSkills(this.config);
    for (const skill of enabled) {
      const mod = skillModules[skill.id];
      if (mod && typeof mod.execute === 'function') {
        this.skills.set(skill.id, { module: mod, skill });
      } else if (!mod) {
        console.warn(`[skills] No module for skill "${skill.id}" (add src/skills/${skill.id}/index.js or disable in config)`);
      }
    }
  }

  /**
   * Execute an action for a skill.
   * @param {string} skillId
   * @param {string} action
   * @param {object} params - Key-value params from OpenAI
   * @returns {Promise<{ success: boolean, message?: string, data?: any }>}
   */
  async execute(skillId, action, params = {}) {
    const entry = this.skills.get(skillId);
    if (!entry) {
      return { success: false, message: `Unknown skill: ${skillId}` };
    }
    const { module: mod, skill } = entry;
    const actionDef = skill.actions.find((a) => a.id === action);
    if (!actionDef) {
      return { success: false, message: `Unknown action for ${skillId}: ${action}` };
    }
    try {
      return await mod.execute(skillId, action, params, skill.config);
    } catch (err) {
      return {
        success: false,
        message: err.message || String(err),
      };
    }
  }

  hasSkill(skillId) {
    return this.skills.has(skillId);
  }

  getSkillConfig(skillId) {
    const entry = this.skills.get(skillId);
    return entry ? entry.skill.config : null;
  }
}

/** Available skill ids that have a discovered module (for docs/tooling). */
function getDiscoveredSkillIds() {
  return Object.keys(skillModules);
}

module.exports = { SkillRegistry, discoverSkillModules, getDiscoveredSkillIds };
