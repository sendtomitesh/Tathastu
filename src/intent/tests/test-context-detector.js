'use strict';

const assert = require('assert');
const { isContextDependent, DEFAULT_PATTERNS } = require('../context-detector');

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

console.log('\n=== ContextDetector Unit Tests ===\n');

// Numbers
test('single digit number is context-dependent', () => {
  for (let i = 0; i <= 9; i++) {
    assert.strictEqual(isContextDependent(String(i)), true, `"${i}" should be context-dependent`);
  }
});

test('double digit number is context-dependent', () => {
  assert.strictEqual(isContextDependent('42'), true);
  assert.strictEqual(isContextDependent('99'), true);
});

test('triple digit number is NOT context-dependent', () => {
  assert.strictEqual(isContextDependent('100'), false);
});

// Pagination words
test('"more" is context-dependent (case-insensitive)', () => {
  assert.strictEqual(isContextDependent('more'), true);
  assert.strictEqual(isContextDependent('More'), true);
  assert.strictEqual(isContextDependent('MORE'), true);
});

test('"next" and "next page" are context-dependent', () => {
  assert.strictEqual(isContextDependent('next'), true);
  assert.strictEqual(isContextDependent('next page'), true);
  assert.strictEqual(isContextDependent('Next Page'), true);
});

test('"page N" is context-dependent', () => {
  assert.strictEqual(isContextDependent('page 3'), true);
  assert.strictEqual(isContextDependent('Page 12'), true);
});

// Hindi equivalents
test('Hindi pagination words are context-dependent', () => {
  assert.strictEqual(isContextDependent('aur'), true);
  assert.strictEqual(isContextDependent('aur dikhao'), true);
  assert.strictEqual(isContextDependent('aage'), true);
  assert.strictEqual(isContextDependent('Aur Dikhao'), true);
});

// Gujarati equivalents
test('Gujarati pagination words are context-dependent', () => {
  assert.strictEqual(isContextDependent('vadhu'), true);
  assert.strictEqual(isContextDependent('aagal'), true);
});

// Pronouns and affirmatives
test('pronouns and affirmatives are context-dependent', () => {
  assert.strictEqual(isContextDependent('his'), true);
  assert.strictEqual(isContextDependent('her'), true);
  assert.strictEqual(isContextDependent('their'), true);
  assert.strictEqual(isContextDependent('same'), true);
  assert.strictEqual(isContextDependent('yes'), true);
  assert.strictEqual(isContextDependent('haan'), true);
  assert.strictEqual(isContextDependent('ha'), true);
});

// Non-context messages
test('regular queries are NOT context-dependent', () => {
  assert.strictEqual(isContextDependent('show me ledger for meril'), false);
  assert.strictEqual(isContextDependent('what is my balance'), false);
});

// Edge cases
test('empty/null/undefined returns false', () => {
  assert.strictEqual(isContextDependent(''), false);
  assert.strictEqual(isContextDependent(null), false);
  assert.strictEqual(isContextDependent(undefined), false);
  assert.strictEqual(isContextDependent('   '), false);
});

// Custom patterns
test('custom patterns override defaults', () => {
  const custom = [/^custom$/i];
  assert.strictEqual(isContextDependent('custom', custom), true);
  assert.strictEqual(isContextDependent('more', custom), false);
});

console.log(`\n  Results: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
