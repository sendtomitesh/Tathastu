'use strict';

/**
 * Default context-dependent trigger patterns.
 * Messages matching these bypass local resolution and go straight to Tier 3 (OpenAI).
 */
const DEFAULT_PATTERNS = [
  /^\d{1,2}$/,           // single/double digit numbers
  /^more$/i,
  /^next$/i,
  /^next page$/i,
  /^page \d+$/i,
  /^aur$/i,              // Hindi: "more"
  /^aur dikhao$/i,       // Hindi: "show more"
  /^aage$/i,             // Hindi: "next"
  /^vadhu$/i,            // Gujarati: "more"
  /^aagal$/i,            // Gujarati: "next"
  /^his$/i,
  /^her$/i,
  /^their$/i,
  /^same$/i,
  /^yes$/i,
  /^haan$/i,             // Hindi: "yes"
  /^ha$/i                // Gujarati: "yes"
];

/**
 * Check if a message requires conversation context and should bypass local resolution.
 * @param {string} text - Raw user message
 * @param {RegExp[]} [patterns] - Optional custom patterns (defaults to DEFAULT_PATTERNS)
 * @returns {boolean}
 */
function isContextDependent(text, patterns) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  const pats = patterns || DEFAULT_PATTERNS;
  return pats.some(p => p.test(trimmed));
}

module.exports = { isContextDependent, DEFAULT_PATTERNS };
