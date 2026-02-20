'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

let pass = 0, fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    fail++;
    console.log('  \u2717 ' + name + ': ' + e.message);
  }
}

/**
 * Build a minimal config object for testing orchestrator wiring.
 * @param {object} [resolverOverride] - resolver config section (or undefined to omit)
 */
function buildConfig(resolverOverride) {
  const base = {
    openai: { model: 'gpt-4o-mini' },
    llm: { provider: 'keyword', model: 'gpt-4o-mini' },
    whatsapp: { onlyFromMe: false },
    skills: [{
      id: 'tally',
      name: 'Tally',
      config: { port: '9000', companyName: 'Test' },
      actions: [{ id: 'get_ledger', description: 'Get ledger', parameters: ['party_name'] }]
    }],
    tenants: [],
    translation: { enabled: false }
  };
  if (resolverOverride !== undefined) {
    base.resolver = resolverOverride;
  }
  return base;
}

/**
 * Minimal mock registry that always succeeds.
 */
class MockRegistry {
  execute(skillId, action, params) {
    return Promise.resolve({ success: true, message: 'Done.' });
  }
}

console.log('\n=== Orchestrator Wiring Integration Tests ===\n');

// We need to require createOrchestrator — it imports whatsapp/client and translation/sarvam,
// so we use the actual module. The tests only check resolver initialization, not message handling.
const { createOrchestrator } = require('../../bot/orchestrator');

// Test 1: Resolver is created when config.resolver.enabled = true
test('resolver is created when enabled in config', function () {
  const config = buildConfig({
    enabled: true,
    confidenceThreshold: 0.7,
    patternStorePath: path.join(os.tmpdir(), 'test-orch-wiring-' + Date.now() + '.json'),
    openAIFallbackEnabled: true,
    correctionTriggers: ['wrong', 'galat'],
    contextPatterns: ['^\\d{1,2}$', 'more', 'next']
  });
  const logs = [];
  const orch = createOrchestrator({
    config,
    registry: new MockRegistry(),
    onLog: (msg) => logs.push(msg)
  });
  const resolver = orch.getResolver();
  assert.ok(resolver !== null && resolver !== undefined, 'resolver should be created');
  assert.strictEqual(typeof resolver.resolveIntent, 'function', 'resolver should have resolveIntent');
  assert.strictEqual(typeof resolver.getMetrics, 'function', 'resolver should have getMetrics');
  assert.strictEqual(typeof resolver.exportPatterns, 'function', 'resolver should have exportPatterns');
  assert.strictEqual(typeof resolver.importPatterns, 'function', 'resolver should have importPatterns');
  assert.ok(logs.some(l => l.includes('[resolver] Local intent resolver initialized')), 'should log initialization');
});

// Test 2: Resolver is NOT created when config.resolver.enabled = false
test('resolver is not created when disabled in config', function () {
  const config = buildConfig({ enabled: false });
  const orch = createOrchestrator({
    config,
    registry: new MockRegistry(),
    onLog: () => {}
  });
  const resolver = orch.getResolver();
  assert.strictEqual(resolver, null, 'resolver should be null when disabled');
});

// Test 3: Backward compatibility — no resolver config at all
test('backward compatible when no resolver config present', function () {
  const config = buildConfig(undefined);
  // Ensure resolver key is not present
  delete config.resolver;
  const orch = createOrchestrator({
    config,
    registry: new MockRegistry(),
    onLog: () => {}
  });
  const resolver = orch.getResolver();
  assert.strictEqual(resolver, null, 'resolver should be null when config is absent');
});

// Test 4: Resolver is NOT created when resolver config is null
test('resolver is not created when resolver config is null', function () {
  const config = buildConfig(null);
  const orch = createOrchestrator({
    config,
    registry: new MockRegistry(),
    onLog: () => {}
  });
  const resolver = orch.getResolver();
  assert.strictEqual(resolver, null, 'resolver should be null when config is null');
});

// Summary
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
if (fail > 0) process.exit(1);
