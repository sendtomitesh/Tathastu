'use strict';

const assert = require('assert');
const { isCorrectionTrigger, DEFAULT_TRIGGERS } = require('../feedback-handler');

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

console.log('\n=== FeedbackHandler Unit Tests ===\n');

// Default triggers
test('"wrong" is a correction trigger (case-insensitive)', () => {
  assert.strictEqual(isCorrectionTrigger('wrong'), true);
  assert.strictEqual(isCorrectionTrigger('Wrong'), true);
  assert.strictEqual(isCorrectionTrigger('WRONG'), true);
});

test('"galat" is a correction trigger', () => {
  assert.strictEqual(isCorrectionTrigger('galat'), true);
  assert.strictEqual(isCorrectionTrigger('Galat'), true);
});

test('"ખોટું" (Gujarati) is a correction trigger', () => {
  assert.strictEqual(isCorrectionTrigger('ખોટું'), true);
});

test('"ghalat" is a correction trigger', () => {
  assert.strictEqual(isCorrectionTrigger('ghalat'), true);
});

// Non-triggers
test('regular messages are NOT correction triggers', () => {
  assert.strictEqual(isCorrectionTrigger('show ledger'), false);
  assert.strictEqual(isCorrectionTrigger('that is wrong answer'), false);
});

// Edge cases
test('empty/null/undefined returns false', () => {
  assert.strictEqual(isCorrectionTrigger(''), false);
  assert.strictEqual(isCorrectionTrigger(null), false);
  assert.strictEqual(isCorrectionTrigger(undefined), false);
  assert.strictEqual(isCorrectionTrigger('   '), false);
});

// Whitespace trimming
test('trigger with surrounding whitespace still matches', () => {
  assert.strictEqual(isCorrectionTrigger('  wrong  '), true);
});

// Custom triggers
test('custom triggers override defaults', () => {
  const custom = ['nope', 'undo'];
  assert.strictEqual(isCorrectionTrigger('nope', custom), true);
  assert.strictEqual(isCorrectionTrigger('wrong', custom), false);
});

console.log(`\n  Results: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
