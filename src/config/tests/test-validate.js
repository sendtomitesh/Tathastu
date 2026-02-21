/**
 * Tests for src/config/validate.js
 * Run: node src/config/tests/test-validate.js
 */

const { validateConfig } = require('../validate');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('\nConfig Validation:');

test('valid config returns no issues', () => {
  const config = {
    llm: { provider: 'keyword' },
    skills: [{
      id: 'tally', name: 'Tally', config: { port: 9000 },
      actions: [{ id: 'get_ledger', description: 'Get ledger', parameters: ['party_name'] }]
    }],
    whatsapp: { onlyFromMe: true },
  };
  const issues = validateConfig(config);
  assert(issues.length === 0, `Expected 0 issues, got: ${issues.join('; ')}`);
});

test('null config returns error', () => {
  const issues = validateConfig(null);
  assert(issues.length === 1, 'should have 1 issue');
  assert(issues[0].includes('null'), 'should mention null');
});

test('invalid LLM provider flagged', () => {
  const config = { llm: { provider: 'gpt5' }, skills: [] };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('gpt5')), 'should flag invalid provider');
});

test('missing skills array flagged', () => {
  const config = { llm: { provider: 'keyword' } };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('skills')), 'should flag missing skills');
});

test('empty skills array flagged', () => {
  const config = { llm: { provider: 'keyword' }, skills: [] };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('No enabled skills')), 'should flag empty skills');
});

test('duplicate skill id flagged', () => {
  const config = {
    llm: { provider: 'keyword' },
    skills: [
      { id: 'tally', name: 'A', actions: [{ id: 'x', description: 'x', parameters: [] }] },
      { id: 'tally', name: 'B', actions: [{ id: 'y', description: 'y', parameters: [] }] },
    ]
  };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('duplicate skill id')), 'should flag duplicate');
});

test('missing action id flagged', () => {
  const config = {
    llm: { provider: 'keyword' },
    skills: [{ id: 'tally', name: 'Tally', actions: [{ description: 'test', parameters: [] }] }]
  };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('missing "id"')), 'should flag missing action id');
});

test('missing action description flagged', () => {
  const config = {
    llm: { provider: 'keyword' },
    skills: [{ id: 'tally', name: 'Tally', actions: [{ id: 'get_ledger', parameters: [] }] }]
  };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('missing "description"')), 'should flag missing description');
});

test('duplicate action id flagged', () => {
  const config = {
    llm: { provider: 'keyword' },
    skills: [{
      id: 'tally', name: 'Tally',
      actions: [
        { id: 'get_ledger', description: 'a', parameters: [] },
        { id: 'get_ledger', description: 'b', parameters: [] },
      ]
    }]
  };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('duplicate action id')), 'should flag duplicate action');
});

test('tally missing port flagged', () => {
  const config = {
    llm: { provider: 'keyword' },
    skills: [{ id: 'tally', name: 'Tally', config: {}, actions: [{ id: 'x', description: 'x', parameters: [] }] }]
  };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('config.port')), 'should flag missing port');
});

test('onlySelfChat without onlyFromMe flagged', () => {
  const config = {
    llm: { provider: 'keyword' },
    skills: [{ id: 'tally', name: 'Tally', config: { port: 9000 }, actions: [{ id: 'x', description: 'x', parameters: [] }] }],
    whatsapp: { onlySelfChat: true, onlyFromMe: false },
  };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('onlySelfChat')), 'should flag inconsistency');
});

test('translation enabled without API key flagged', () => {
  const origKey = process.env.SARVAM_API_KEY;
  delete process.env.SARVAM_API_KEY;
  const config = {
    llm: { provider: 'keyword' },
    skills: [{ id: 'tally', name: 'Tally', config: { port: 9000 }, actions: [{ id: 'x', description: 'x', parameters: [] }] }],
    translation: { enabled: true },
  };
  const issues = validateConfig(config);
  assert(issues.some(i => i.includes('translation')), 'should flag missing API key');
  if (origKey) process.env.SARVAM_API_KEY = origKey;
});

console.log(`\n${'═'.repeat(40)}`);
console.log(`Config validation tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
