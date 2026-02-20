'use strict';

const fc = require('fast-check');
const assert = require('assert');
const { jaccardSimilarity, findBestMatch } = require('../fuzzy-matcher');
const { tokenize } = require('../normalizer');

let pass = 0, fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

// Arbitrary for generating non-empty token sets
const tokenSetArb = fc.array(
  fc.stringMatching(/^[a-z]{1,8}$/),
  { minLength: 1, maxLength: 8 }
).map(arr => new Set(arr));

// Arbitrary for generating a valid intent
const intentArb = fc.record({
  skillId: fc.oneof(fc.constant('tally'), fc.constant('crm'), fc.constant('util')),
  action: fc.stringMatching(/^[a-z_]{3,20}$/),
  params: fc.constant({}),
  suggestedReply: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 }))
});

// Arbitrary for normalized query keys (lowercase words separated by spaces)
const queryKeyArb = fc.array(
  fc.stringMatching(/^[a-z]{1,8}$/),
  { minLength: 1, maxLength: 4 }
).map(words => words.join(' '));

console.log('\n=== FuzzyMatcher Property Tests ===\n');

// Feature: local-intent-resolver, Property 12: Jaccard similarity bounds
// **Validates: Requirements 3.2**
test('Property 12: Jaccard similarity is always in [0.0, 1.0]', () => {
  fc.assert(
    fc.property(tokenSetArb, tokenSetArb, (setA, setB) => {
      const score = jaccardSimilarity(setA, setB);
      assert.ok(score >= 0.0 && score <= 1.0,
        `Score ${score} out of bounds for sets of size ${setA.size}, ${setB.size}`);
    }),
    { numRuns: 100 }
  );
});

test('Property 12: identical non-empty sets produce similarity 1.0', () => {
  fc.assert(
    fc.property(tokenSetArb, (setA) => {
      fc.pre(setA.size > 0);
      const score = jaccardSimilarity(setA, new Set(setA));
      assert.strictEqual(score, 1.0,
        `Expected 1.0 for identical sets, got ${score}`);
    }),
    { numRuns: 100 }
  );
});

test('Property 12: disjoint sets produce similarity 0.0', () => {
  fc.assert(
    fc.property(
      fc.array(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 5 }),
      (words) => {
        // Create two disjoint sets by appending different suffixes
        const setA = new Set(words.map(w => w + '1'));
        const setB = new Set(words.map(w => w + '2'));
        const score = jaccardSimilarity(setA, setB);
        assert.strictEqual(score, 0.0,
          `Expected 0.0 for disjoint sets, got ${score}`);
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: local-intent-resolver, Property 5: Fuzzy match best-selection
// **Validates: Requirements 3.2, 3.3, 3.4**
test('Property 5: findBestMatch returns entry with highest similarity', () => {
  fc.assert(
    fc.property(
      queryKeyArb,
      fc.array(fc.tuple(queryKeyArb, intentArb, fc.integer({ min: 1, max: 100 })), { minLength: 1, maxLength: 10 }),
      (query, rawEntries) => {
        const threshold = 0.0001; // very low threshold so we get matches
        const entries = rawEntries.map(([key, intent, hitCount]) => ({
          key,
          entry: { intent, hitCount, createdAt: '2025-01-01T00:00:00Z', lastUsedAt: '2025-01-01T00:00:00Z' }
        }));

        const result = findBestMatch(query, entries, threshold);

        if (result === null) {
          // All entries had 0 similarity — verify that's true
          const queryTokens = tokenize(query);
          for (const { key } of entries) {
            const entryTokens = tokenize(key);
            const sim = jaccardSimilarity(queryTokens, entryTokens);
            assert.ok(sim < threshold,
              `findBestMatch returned null but entry "${key}" has similarity ${sim} >= ${threshold}`);
          }
        } else {
          // Verify the returned entry has the highest similarity
          const queryTokens = tokenize(query);
          for (const { key, entry } of entries) {
            const entryTokens = tokenize(key);
            const sim = jaccardSimilarity(queryTokens, entryTokens);
            if (sim > result.confidence) {
              assert.fail(`Entry "${key}" has similarity ${sim} > returned confidence ${result.confidence}`);
            }
            // Tiebreaker: if same similarity, returned entry should have >= hitCount
            if (sim === result.confidence && entry.hitCount > result.entry.hitCount) {
              assert.fail(`Entry "${key}" has same similarity ${sim} but higher hitCount ${entry.hitCount} > ${result.entry.hitCount}`);
            }
          }
        }
      }
    ),
    { numRuns: 100 }
  );
});

test('Property 5: hitCount tiebreaker — equal similarity selects higher hitCount', () => {
  fc.assert(
    fc.property(
      queryKeyArb,
      intentArb,
      intentArb,
      fc.integer({ min: 1, max: 50 }),
      fc.integer({ min: 51, max: 100 }),
      (query, intentLow, intentHigh, lowHits, highHits) => {
        // Both entries use the same key as the query so they have identical similarity (1.0)
        const entries = [
          { key: query, entry: { intent: intentLow, hitCount: lowHits, createdAt: '2025-01-01T00:00:00Z', lastUsedAt: '2025-01-01T00:00:00Z' } },
          { key: query, entry: { intent: intentHigh, hitCount: highHits, createdAt: '2025-01-01T00:00:00Z', lastUsedAt: '2025-01-01T00:00:00Z' } }
        ];

        const result = findBestMatch(query, entries, 0.5);
        assert.ok(result !== null, 'Expected a match');
        assert.strictEqual(result.entry.hitCount, highHits,
          `Expected hitCount ${highHits} (tiebreaker), got ${result.entry.hitCount}`);
      }
    ),
    { numRuns: 100 }
  );
});

// === Unit Tests ===

console.log('\n=== FuzzyMatcher Unit Tests ===\n');

// Helper to build a pattern store entry
function makeEntry(intent, hitCount) {
  return {
    intent,
    hitCount: hitCount || 1,
    createdAt: '2025-01-01T00:00:00Z',
    lastUsedAt: '2025-01-01T00:00:00Z'
  };
}

const tallyLedgerIntent = { skillId: 'tally', action: 'get_ledger', params: { party_name: 'meril' }, suggestedReply: null };
const tallyBalanceIntent = { skillId: 'tally', action: 'get_balance', params: { party_name: 'meril' }, suggestedReply: null };

// Requirement 3.2: similar queries should match via fuzzy
test('findBestMatch returns match for similar query "ledger meril" vs "ledger for meril"', () => {
  const entries = [
    { key: 'ledger meril', entry: makeEntry(tallyLedgerIntent, 5) }
  ];
  const result = findBestMatch('ledger for meril', entries, 0.5);
  assert.ok(result !== null, 'Expected a fuzzy match');
  assert.strictEqual(result.entry.intent.action, 'get_ledger');
  assert.ok(result.confidence >= 0.5, `Confidence ${result.confidence} should be >= 0.5`);
});

// Requirement 3.4: completely unrelated queries should return null
test('findBestMatch returns null for completely unrelated query', () => {
  const entries = [
    { key: 'ledger meril', entry: makeEntry(tallyLedgerIntent, 5) },
    { key: 'balance meril', entry: makeEntry(tallyBalanceIntent, 3) }
  ];
  const result = findBestMatch('weather forecast tomorrow', entries, 0.5);
  assert.strictEqual(result, null, 'Expected null for unrelated query');
});

test('findBestMatch returns null for empty entries list', () => {
  const result = findBestMatch('ledger meril', [], 0.5);
  assert.strictEqual(result, null, 'Expected null for empty entries');
});

test('findBestMatch returns null for empty query', () => {
  const entries = [
    { key: 'ledger meril', entry: makeEntry(tallyLedgerIntent, 5) }
  ];
  const result = findBestMatch('', entries, 0.5);
  assert.strictEqual(result, null, 'Expected null for empty query');
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
