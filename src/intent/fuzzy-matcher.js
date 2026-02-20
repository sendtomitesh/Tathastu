'use strict';

const { tokenize } = require('./normalizer');

/**
 * Compute Jaccard similarity between two token sets.
 * |A ∩ B| / |A ∪ B|
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number} Value between 0.0 and 1.0
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0.0;

  return intersection / union;
}

/**
 * Find the best matching entry from the pattern store.
 * @param {string} normalizedQuery - The normalized user query
 * @param {Array<{key: string, entry: object}>} entries - All pattern store entries
 * @param {number} threshold - Minimum confidence threshold
 * @returns {{ key: string, entry: object, confidence: number } | null}
 */
function findBestMatch(normalizedQuery, entries, threshold) {
  if (!entries || entries.length === 0) return null;

  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.size === 0) return null;

  let bestKey = null;
  let bestEntry = null;
  let bestScore = 0;

  for (const { key, entry } of entries) {
    const entryTokens = tokenize(key);
    const score = jaccardSimilarity(queryTokens, entryTokens);

    if (score < threshold) continue;

    if (
      score > bestScore ||
      (score === bestScore && bestEntry && entry.hitCount > bestEntry.hitCount)
    ) {
      bestScore = score;
      bestEntry = entry;
      bestKey = key;
    }
  }

  if (!bestEntry) return null;

  return { key: bestKey, entry: bestEntry, confidence: bestScore };
}

module.exports = { jaccardSimilarity, findBestMatch };
