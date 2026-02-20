'use strict';

const fc = require('fast-check');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PatternStore } = require('../pattern-store');

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

// Helper: create a temp file path for testing
let tmpCounter = 0;
function tmpFile() {
  tmpCounter++;
  return path.join(__dirname, `_tmp_ps_test_${tmpCounter}_${Date.now()}.json`);
}

// Helper: cleanup temp files
const tmpFiles = [];
function cleanupTmpFiles() {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
  }
}

// Helper: deep equal that ignores prototype differences (fc.record creates null-proto objects)
function assertIntentEqual(actual, expected, msg) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);
}

// Arbitrary for generating valid intent objects
const intentArb = fc.record({
  skillId: fc.oneof(fc.constant('tally'), fc.constant('crm'), fc.constant('util')),
  action: fc.stringMatching(/^[a-z_]{3,20}$/),
  params: fc.constant({}),
  suggestedReply: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 }))
});

// Arbitrary for normalized query keys (lowercase, no punctuation, single spaces)
const queryKeyArb = fc.array(
  fc.stringMatching(/^[a-z0-9]{1,12}$/),
  { minLength: 1, maxLength: 5 }
).map(words => words.join(' '));

console.log('\n=== PatternStore Property Tests ===\n');

// Feature: local-intent-resolver, Property 3: Tier 1 exact match correctness
// **Validates: Requirements 2.1, 2.2, 2.3, 6.1, 6.2**
test('Property 3: get returns entry iff key exists', () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(queryKeyArb, intentArb), { minLength: 0, maxLength: 10 }),
      queryKeyArb,
      (entries, lookupKey) => {
        const filePath = tmpFile();
        tmpFiles.push(filePath);
        const store = new PatternStore(filePath);
        store.load();

        for (const [key, intent] of entries) {
          store.put(key, intent);
        }

        const knownKeys = new Set(entries.map(([k]) => k));
        const result = store.get(lookupKey);

        if (knownKeys.has(lookupKey)) {
          assert.ok(result !== null, `Expected entry for key "${lookupKey}" but got null`);
          assert.ok(result.intent, 'Entry should have intent');
          assert.ok(result.hitCount >= 1, 'hitCount should be >= 1');
        } else {
          assert.strictEqual(result, null, `Expected null for unknown key "${lookupKey}" but got entry`);
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: local-intent-resolver, Property 4: Hit count increment
// **Validates: Requirements 2.3**
test('Property 4: recordHit increases hitCount by 1', () => {
  fc.assert(
    fc.property(queryKeyArb, intentArb, fc.integer({ min: 1, max: 20 }), (key, intent, hits) => {
      const filePath = tmpFile();
      tmpFiles.push(filePath);
      const store = new PatternStore(filePath);
      store.load();
      store.put(key, intent);

      const initialCount = store.get(key).hitCount;
      for (let i = 0; i < hits; i++) {
        store.recordHit(key);
      }
      const finalCount = store.get(key).hitCount;
      assert.strictEqual(finalCount, initialCount + hits, `Expected hitCount ${initialCount + hits}, got ${finalCount}`);
    }),
    { numRuns: 100 }
  );
});

// Feature: local-intent-resolver, Property 9: Pattern store round-trip persistence
// **Validates: Requirements 6.1, 6.2**
test('Property 9: write then load produces equivalent entries', () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(queryKeyArb, intentArb), { minLength: 1, maxLength: 10 }),
      (entries) => {
        const filePath = tmpFile();
        tmpFiles.push(filePath);

        // Write
        const store1 = new PatternStore(filePath);
        store1.load();
        for (const [key, intent] of entries) {
          store1.put(key, intent);
        }
        store1.flush();

        // Read back
        const store2 = new PatternStore(filePath);
        store2.load();

        assert.strictEqual(store2.size(), store1.size(), 'Size mismatch after round-trip');

        for (const { key, entry } of store1.getAll()) {
          const loaded = store2.get(key);
          assert.ok(loaded !== null, `Missing key "${key}" after round-trip`);
          assertIntentEqual(loaded.intent, entry.intent, `Intent mismatch for key "${key}"`);
          assert.strictEqual(loaded.hitCount, entry.hitCount, `hitCount mismatch for key "${key}"`);
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: local-intent-resolver, Property 16: Import/export round-trip
// **Validates: Requirements 12.1, 12.2, 12.4**
test('Property 16: export then import into empty store produces equivalent entries', () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(queryKeyArb, intentArb), { minLength: 1, maxLength: 10 }),
      (entries) => {
        const filePath1 = tmpFile();
        const filePath2 = tmpFile();
        tmpFiles.push(filePath1, filePath2);

        const store1 = new PatternStore(filePath1);
        store1.load();
        for (const [key, intent] of entries) {
          store1.put(key, intent);
        }

        const exported = store1.exportJSON();

        const store2 = new PatternStore(filePath2);
        store2.load();
        store2.importJSON(exported);

        assert.strictEqual(store2.size(), store1.size(), 'Size mismatch after import');

        for (const { key, entry } of store1.getAll()) {
          const imported = store2.get(key);
          assert.ok(imported !== null, `Missing key "${key}" after import`);
          assertIntentEqual(imported.intent, entry.intent, `Intent mismatch for key "${key}"`);
          assert.strictEqual(imported.hitCount, entry.hitCount, `hitCount mismatch for key "${key}"`);
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: local-intent-resolver, Property 17: Import merge keeps higher hit count
// **Validates: Requirements 12.3, 12.4**
test('Property 17: overlapping keys keep higher hitCount', () => {
  fc.assert(
    fc.property(
      queryKeyArb,
      intentArb,
      intentArb,
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 1, max: 100 }),
      (key, intentA, intentB, hitsA, hitsB) => {
        const fileA = tmpFile();
        const fileB = tmpFile();
        tmpFiles.push(fileA, fileB);

        // Store A: put entry then record extra hits
        const storeA = new PatternStore(fileA);
        storeA.load();
        storeA.put(key, intentA);
        for (let i = 1; i < hitsA; i++) storeA.recordHit(key);

        // Store B: put entry then record extra hits
        const storeB = new PatternStore(fileB);
        storeB.load();
        storeB.put(key, intentB);
        for (let i = 1; i < hitsB; i++) storeB.recordHit(key);

        const exportedB = storeB.exportJSON();
        storeA.importJSON(exportedB);

        const merged = storeA.get(key);
        const expectedHitCount = Math.max(hitsA, hitsB);
        assert.strictEqual(merged.hitCount, expectedHitCount,
          `Expected hitCount ${expectedHitCount} (max of ${hitsA}, ${hitsB}), got ${merged.hitCount}`);
      }
    ),
    { numRuns: 100 }
  );
});

console.log('\n=== PatternStore Unit Tests ===\n');

// Unit test: loading from missing file initializes empty
// Requirements: 6.3
test('Unit: load from missing file initializes empty store', () => {
  const store = new PatternStore(path.join(__dirname, '_nonexistent_file.json'));
  store.load();
  assert.strictEqual(store.size(), 0);
});

// Unit test: loading from corrupted JSON file initializes empty
// Requirements: 6.5
test('Unit: load from corrupted JSON initializes empty store', () => {
  const filePath = tmpFile();
  tmpFiles.push(filePath);
  fs.writeFileSync(filePath, '{this is not valid json!!!', 'utf-8');
  const store = new PatternStore(filePath);
  store.load();
  assert.strictEqual(store.size(), 0);
});

// Unit test: importing malformed JSON rejects and leaves store unchanged
// Requirements: 12.6
test('Unit: importJSON with malformed JSON throws and leaves store unchanged', () => {
  const filePath = tmpFile();
  tmpFiles.push(filePath);
  const store = new PatternStore(filePath);
  store.load();
  store.put('existing key', { skillId: 'tally', action: 'test', params: {}, suggestedReply: null });
  const sizeBefore = store.size();

  assert.throws(() => store.importJSON('{bad json'), /malformed/i);
  assert.strictEqual(store.size(), sizeBefore, 'Store should be unchanged after failed import');
});

// Cleanup
cleanupTmpFiles();

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
