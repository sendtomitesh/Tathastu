'use strict';

const fc = require('fast-check');
const assert = require('assert');
const { normalize, tokenize } = require('../normalizer');

// Punctuation characters that should be removed (per design doc)
const PUNCTUATION_CHARS = ['.', ',', '?', '!', ';', ':', '"', "'", '(', ')', '[', ']', '{', '}'];
const PUNCTUATION_RE = /[.,?!;:"'()\[\]{}]/;

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

console.log('\n=== Normalizer Property Tests ===\n');

// Feature: local-intent-resolver, Property 7: Normalization correctness
test('Property 7: output is lowercase', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
      const result = normalize(input);
      assert.strictEqual(result, result.toLowerCase(), 'output must be lowercase');
    }),
    { numRuns: 100 }
  );
});

test('Property 7: output has no punctuation', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
      const result = normalize(input);
      assert.ok(!PUNCTUATION_RE.test(result), `output contains punctuation: "${result}"`);
    }),
    { numRuns: 100 }
  );
});

test('Property 7: output has no consecutive spaces', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
      const result = normalize(input);
      assert.ok(!result.includes('  '), `output has consecutive spaces: "${result}"`);
    }),
    { numRuns: 100 }
  );
});

test('Property 7: output has no leading/trailing whitespace', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
      const result = normalize(input);
      assert.strictEqual(result, result.trim(), 'output must have no leading/trailing whitespace');
    }),
    { numRuns: 100 }
  );
});

// Feature: local-intent-resolver, Property 8: Normalization idempotence
test('Property 8: normalize(normalize(x)) === normalize(x)', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
      const once = normalize(input);
      const twice = normalize(once);
      assert.strictEqual(twice, once, `idempotence failed: normalize("${once}") => "${twice}"`);
    }),
    { numRuns: 100 }
  );
});

console.log('\n=== Normalizer Unit Tests ===\n');

// --- Hindi transliterations from knowledge.md ---
test('Hindi: "khata" transliterates to "ledger"', () => {
  const result = normalize('khata');
  assert.strictEqual(result, 'ledger');
});

test('Hindi: "baki" transliterates to "outstanding"', () => {
  const result = normalize('baki');
  assert.strictEqual(result, 'outstanding');
});

test('Hindi: "bikri" transliterates to "sales"', () => {
  const result = normalize('bikri');
  assert.strictEqual(result, 'sales');
});

test('Hindi: "kharid" transliterates to "purchase"', () => {
  const result = normalize('kharid');
  assert.strictEqual(result, 'purchase');
});

test('Hindi: "kharcha" transliterates to "expenses"', () => {
  const result = normalize('kharcha');
  assert.strictEqual(result, 'expenses');
});

test('Hindi Devanagari: "खाता" transliterates to "ledger"', () => {
  const result = normalize('खाता');
  assert.strictEqual(result, 'ledger');
});

test('Hindi Devanagari: "बाकी" transliterates to "outstanding"', () => {
  const result = normalize('बाकी');
  assert.strictEqual(result, 'outstanding');
});

// --- Gujarati transliterations from knowledge.md ---
test('Gujarati: "khatu" transliterates to "ledger"', () => {
  const result = normalize('khatu');
  assert.strictEqual(result, 'ledger');
});

test('Gujarati: "vechan" transliterates to "sales"', () => {
  const result = normalize('vechan');
  assert.strictEqual(result, 'sales');
});

test('Gujarati script: "ખાતું" transliterates to "ledger"', () => {
  const result = normalize('ખાતું');
  assert.strictEqual(result, 'ledger');
});

// --- Edge cases ---
test('Edge: empty string returns empty string', () => {
  assert.strictEqual(normalize(''), '');
});

test('Edge: only punctuation returns empty string', () => {
  assert.strictEqual(normalize('.,?!;:'), '');
});

test('Edge: only whitespace returns empty string', () => {
  assert.strictEqual(normalize('   \t  \n  '), '');
});

test('Edge: mixed scripts - Hindi + English', () => {
  const result = normalize('khata meril');
  assert.strictEqual(result, 'ledger meril');
});

test('Edge: mixed scripts - Gujarati + English with punctuation', () => {
  const result = normalize('ખાતું meril?');
  assert.strictEqual(result, 'ledger meril');
});

test('Edge: tokenize returns correct set from normalized text', () => {
  const tokens = tokenize('ledger meril');
  assert.ok(tokens.has('ledger'));
  assert.ok(tokens.has('meril'));
  assert.strictEqual(tokens.size, 2);
});

test('Edge: tokenize on empty string returns empty set', () => {
  const tokens = tokenize('');
  assert.strictEqual(tokens.size, 0);
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
