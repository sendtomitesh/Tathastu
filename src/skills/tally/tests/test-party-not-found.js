/**
 * Tests that handlePartyNotFound() is used across ALL action handlers
 * that resolve party names. When a party is not found, the bot should
 * search with individual words and show relevant suggestions instead
 * of a plain "not found" message.
 *
 * Run: node src/skills/tally/tests/test-party-not-found.js
 */

let pass = 0, fail = 0;
function test(name, fn) {
  return fn().then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch(e => { fail++; console.log(`  ✗ ${name}: ${e.message}`); });
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const path = require('path');
const realTdl = require('../tdl');

const calls = [];
const mockResponses = {};

function mockTdl() {
  const mock = {};
  for (const key of Object.keys(realTdl)) {
    if (typeof realTdl[key] === 'function') mock[key] = realTdl[key];
  }
  mock.postTally = async (url, xml) => {
    calls.push({ fn: 'postTally', url, xml });
    if (mockResponses.postTally) return mockResponses.postTally(url, xml);
    return '<ENVELOPE></ENVELOPE>';
  };
  mock.checkTallyStatus = async () => {
    calls.push({ fn: 'checkTallyStatus' });
    if (mockResponses.checkTallyStatus) return mockResponses.checkTallyStatus();
    return { responding: true, companies: [], activeCompany: 'TestCo' };
  };
  mock.isTallyRunning = () => ({ running: true, pid: 1234 });
  mock.parseTallyIni = () => ({ installPath: 'C:\\Tally', dataPath: 'C:\\Data', exePath: 'C:\\Tally\\tally.exe', port: 9000, loadCompanies: [] });
  mock.scanDataFolder = () => [];
  return mock;
}

function loadExecuteWithMock(mock) {
  const tdlPath = require.resolve('../tdl');
  const idxPath = require.resolve('../index');
  delete require.cache[idxPath];
  require.cache[tdlPath] = { id: tdlPath, filename: tdlPath, loaded: true, exports: mock };
  return require('../index').execute;
}

function resetCalls() { calls.length = 0; }
function resetMockResponses() { for (const k of Object.keys(mockResponses)) delete mockResponses[k]; }

const skillConfig = { port: 9000 };

// When the initial search returns empty (no match), handlePartyNotFound
// tries individual words. This mock simulates: first call (full name) = empty,
// second call (word search by handlePartyNotFound) = returns suggestions.
const BHAVESH_SUGGESTIONS_XML = `<ENVELOPE>
  <LEDGER NAME="Bhavesh Traders"><NAME>Bhavesh Traders</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
  <LEDGER NAME="Bhavesh Electronics"><NAME>Bhavesh Electronics</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>
  <LEDGER NAME="Bhavesh Kumar"><NAME>Bhavesh Kumar</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
</ENVELOPE>`;

// Helper: set up mock so first search returns empty, word-search returns suggestions
function setupNotFoundWithSuggestions() {
  let callNum = 0;
  mockResponses.postTally = async (url, xml) => {
    callNum++;
    // Call 1: resolvePartyName initial search → empty (no match)
    // Call 2: resolvePartyName word fallback (longest word) → also empty (so resolve returns 'none')
    // Call 3: handlePartyNotFound word search → returns suggestions
    if (callNum <= 2) return '<ENVELOPE></ENVELOPE>';
    return BHAVESH_SUGGESTIONS_XML;
  };
}

// Helper: set up mock so everything returns empty (truly not found)
function setupTrulyNotFound() {
  mockResponses.postTally = async () => '<ENVELOPE></ENVELOPE>';
}

async function runTests() {
  console.log('\nhandlePartyNotFound — all 7 action handlers:\n');

  // ── 1. get_ledger ──
  await test('get_ledger: shows relevant suggestions when party not found', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupNotFoundWithSuggestions();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_ledger', { party_name: 'bhavesh patel' }, skillConfig);
    assert(r.success === true, `expected success=true, got ${r.success}`);
    assert(r.data && r.data.suggestions, 'should have suggestions array');
    assert(r.data.suggestions.length > 0, 'should have at least 1 suggestion');
    assert(r.message.includes('Did you mean'), `message should contain "Did you mean", got: ${r.message}`);
    assert(r.message.includes('Bhavesh'), 'suggestions should contain "Bhavesh"');
    assert(!r.message.includes('2 BNC'), 'should NOT show irrelevant alphabetical results');
  });

  await test('get_ledger: shows "not found" when truly no matches', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupTrulyNotFound();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_ledger', { party_name: 'xyznonexistent' }, skillConfig);
    assert(r.success === false, 'should fail');
    assert(r.message.includes('not found'), 'should say not found');
  });

  // ── 2. get_party_gstin ──
  await test('get_party_gstin: shows relevant suggestions when party not found', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupNotFoundWithSuggestions();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_party_gstin', { party_name: 'bhavesh patel' }, skillConfig);
    assert(r.success === true, `expected success=true, got ${r.success}`);
    assert(r.data && r.data.suggestions, 'should have suggestions');
    assert(r.message.includes('Did you mean'), 'should show suggestions');
    assert(r.message.includes('Bhavesh'), 'should contain relevant names');
  });

  await test('get_party_gstin: shows "not found" when truly no matches', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupTrulyNotFound();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_party_gstin', { party_name: 'xyznonexistent' }, skillConfig);
    assert(r.success === false, 'should fail');
    assert(r.message.includes('not found'), 'should say not found');
  });

  // ── 3. get_party_balance ──
  await test('get_party_balance: shows relevant suggestions when party not found', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupNotFoundWithSuggestions();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_party_balance', { party_name: 'bhavesh patel' }, skillConfig);
    assert(r.success === true, `expected success=true, got ${r.success}`);
    assert(r.data && r.data.suggestions, 'should have suggestions');
    assert(r.message.includes('Did you mean'), 'should show suggestions');
  });

  // ── 4. get_party_invoices ──
  await test('get_party_invoices: shows relevant suggestions when party not found', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupNotFoundWithSuggestions();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_party_invoices', { party_name: 'bhavesh patel' }, skillConfig);
    assert(r.success === true, `expected success=true, got ${r.success}`);
    assert(r.data && r.data.suggestions, 'should have suggestions');
    assert(r.message.includes('Did you mean'), 'should show suggestions');
  });

  // ── 5. get_bill_outstanding ──
  await test('get_bill_outstanding: shows relevant suggestions when party not found', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupNotFoundWithSuggestions();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_bill_outstanding', { party_name: 'bhavesh patel' }, skillConfig);
    assert(r.success === true, `expected success=true, got ${r.success}`);
    assert(r.data && r.data.suggestions, 'should have suggestions');
    assert(r.message.includes('Did you mean'), 'should show suggestions');
  });

  // ── 6. send_reminder ──
  await test('send_reminder: shows relevant suggestions when party not found', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupNotFoundWithSuggestions();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'send_reminder', { party_name: 'bhavesh patel' }, skillConfig);
    assert(r.success === true, `expected success=true, got ${r.success}`);
    assert(r.data && r.data.suggestions, 'should have suggestions');
    assert(r.message.includes('Did you mean'), 'should show suggestions');
  });

  // ── 7. create_voucher ──
  await test('create_voucher: shows relevant suggestions when party not found', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupNotFoundWithSuggestions();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'create_voucher', {
      voucher_type: 'Sales', party_name: 'bhavesh patel', amount: 5000
    }, skillConfig);
    assert(r.success === true, `expected success=true, got ${r.success}`);
    assert(r.data && r.data.suggestions, 'should have suggestions');
    assert(r.message.includes('Did you mean'), 'should show suggestions');
  });

  // ── Verify numbered list format ──
  await test('suggestions include numbered list for selection', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    setupNotFoundWithSuggestions();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_ledger', { party_name: 'bhavesh patel' }, skillConfig);
    assert(r.message.includes('1.'), 'should have numbered item 1');
    assert(r.message.includes('2.'), 'should have numbered item 2');
    assert(r.message.includes('Reply with the number'), 'should tell user to reply with number');
  });

  // ── Summary ──
  console.log(`\n${pass} passed, ${fail} failed out of ${pass + fail} tests`);
  process.exit(fail > 0 ? 1 : 0);
}

runTests();
