'use strict';

const fc = require('fast-check');
const assert = require('assert');
const { Metrics } = require('../metrics');

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

console.log('\n=== Metrics Property Tests ===\n');

// Feature: local-intent-resolver, Property 10: Metrics counter invariant
test('Property 10: total === tier1Hits + tier2Hits + tier3Hits after random sequence of records', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(1, 2, 3), { minLength: 0, maxLength: 200 }),
      (tiers) => {
        const m = new Metrics();
        for (const tier of tiers) {
          m.record(tier);
        }
        assert.strictEqual(
          m.total,
          m.tier1Hits + m.tier2Hits + m.tier3Hits,
          `Invariant broken: total=${m.total}, sum=${m.tier1Hits + m.tier2Hits + m.tier3Hits}`
        );
      }
    ),
    { numRuns: 100 }
  );
});

// **Validates: Requirements 8.1**

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
