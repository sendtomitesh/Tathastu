'use strict';

const fs = require('fs');
const path = require('path');

// Punctuation characters to remove (per design doc)
const PUNCTUATION_RE = /[.,?!;:"'()\[\]{}]/g;
const MULTI_SPACE_RE = /\s{2,}/g;

let transliterationMap = null;

/**
 * Parse config/knowledge.md to build a transliteration map.
 * Extracts Hindi/Gujarati tokens and common abbreviations → English keywords.
 * @param {string} [filePath] - Override path for testing
 * @returns {Map<string, string>}
 */
function buildTransliterationMap(filePath) {
  const map = new Map();
  const knowledgePath = filePath || path.join(process.cwd(), 'config', 'knowledge.md');

  let content;
  try {
    content = fs.readFileSync(knowledgePath, 'utf-8');
  } catch (err) {
    // If knowledge.md is missing, return empty map
    return map;
  }

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match lines like: - "khata" / "खाता" = ledger (get_ledger)
    // or: - "TB" = Trial Balance (get_trial_balance)
    if (!trimmed.startsWith('-') || !trimmed.includes('=')) continue;

    // Split on '=' to get left (tokens) and right (english keyword)
    const eqIndex = trimmed.indexOf('=');
    const leftPart = trimmed.substring(trimmed.indexOf('"'), eqIndex).trim();
    const rightPart = trimmed.substring(eqIndex + 1).trim();

    // Extract the first English keyword from the right side
    // e.g., "ledger (get_ledger)" → "ledger"
    // e.g., "outstanding/balance (get_party_balance or get_outstanding)" → "outstanding"
    // e.g., "Trial Balance (get_trial_balance)" → "trial balance"
    const keyword = rightPart
      .replace(/\(.*?\)/g, '')  // remove parenthetical action names
      .split('/')[0]            // take first if multiple separated by /
      .trim()
      .toLowerCase();

    if (!keyword) continue;

    // Extract all quoted tokens from the left side
    const tokenMatches = leftPart.match(/"([^"]+)"/g);
    if (!tokenMatches) continue;

    for (const quoted of tokenMatches) {
      const token = quoted.replace(/"/g, '').trim().toLowerCase();
      if (token && token !== keyword) {
        map.set(token, keyword);
      }
    }
  }

  return map;
}

/**
 * Get the transliteration map, building it on first call.
 * @param {string} [filePath] - Override path for testing
 * @returns {Map<string, string>}
 */
function getTransliterationMap(filePath) {
  if (filePath) return buildTransliterationMap(filePath);
  if (!transliterationMap) {
    transliterationMap = buildTransliterationMap();
  }
  return transliterationMap;
}

/**
 * Normalize a user query for matching.
 * Steps: lowercase, trim, remove punctuation, transliterate, collapse whitespace.
 * @param {string} text - Raw user input
 * @returns {string} - Normalized text
 */
function normalize(text) {
  if (typeof text !== 'string') return '';

  let result = text.toLowerCase().trim();

  // Remove punctuation
  result = result.replace(PUNCTUATION_RE, '');

  // Transliterate known Hindi/Gujarati tokens → English keywords
  const map = getTransliterationMap();
  if (map.size > 0) {
    // Try multi-word phrases first (longest match), then single words
    const words = result.split(/\s+/).filter(Boolean);
    const translated = [];
    let i = 0;
    while (i < words.length) {
      let matched = false;
      // Try decreasing phrase lengths (max 4 words)
      const maxLen = Math.min(4, words.length - i);
      for (let len = maxLen; len > 1; len--) {
        const phrase = words.slice(i, i + len).join(' ');
        if (map.has(phrase)) {
          translated.push(map.get(phrase));
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        translated.push(map.get(words[i]) || words[i]);
        i++;
      }
    }
    result = translated.join(' ');
  }

  // Collapse multiple whitespace to single space
  result = result.replace(MULTI_SPACE_RE, ' ').trim();

  return result;
}

/**
 * Tokenize a normalized string into a set of unique tokens.
 * @param {string} normalizedText
 * @returns {Set<string>}
 */
function tokenize(normalizedText) {
  if (!normalizedText || typeof normalizedText !== 'string') return new Set();
  const tokens = normalizedText.split(/\s+/).filter(Boolean);
  return new Set(tokens);
}

// Allow resetting the cached map (useful for testing)
function _resetMap() {
  transliterationMap = null;
}

module.exports = { normalize, tokenize, getTransliterationMap, _resetMap };
