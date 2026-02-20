'use strict';

/**
 * Default correction trigger words.
 */
const DEFAULT_TRIGGERS = ['wrong', 'galat', 'ખોટું', 'ghalat'];

/**
 * Check if a message is a correction trigger.
 * @param {string} text - Raw user message
 * @param {string[]} [triggers] - Optional custom triggers (defaults to DEFAULT_TRIGGERS)
 * @returns {boolean}
 */
function isCorrectionTrigger(text, triggers) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return false;
  const trigs = triggers || DEFAULT_TRIGGERS;
  return trigs.some(t => t.toLowerCase() === trimmed);
}

module.exports = { isCorrectionTrigger, DEFAULT_TRIGGERS };
