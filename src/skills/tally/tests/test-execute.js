/**
 * Tests for src/skills/tally/index.js execute() function.
 * Mocks the TDL client to test action routing, dynamic company detection,
 * cache behavior, and error handling with sample data.
 *
 * Run: node src/skills/tally/tests/test-execute.js
 */

let pass = 0, fail = 0;
function test(name, fn) {
  return fn().then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch(e => { fail++; console.log(`  ✗ ${name}: ${e.message}`); });
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ── Mock setup ──
// We intercept require('./tdl') by patching the module cache.
// First, load the real tdl to get all function signatures, then override.
const path = require('path');
const realTdl = require('../tdl');

// Build a mock TDL client that records calls and returns canned responses
const calls = [];
const mockResponses = {};

function mockTdl() {
  const mock = {};
  // Copy all real functions as defaults
  for (const key of Object.keys(realTdl)) {
    if (typeof realTdl[key] === 'function') {
      mock[key] = realTdl[key];
    }
  }

  // Override postTally to return canned XML
  mock.postTally = async (url, xml) => {
    calls.push({ fn: 'postTally', url, xml });
    if (mockResponses.postTally) return mockResponses.postTally(url, xml);
    return '<ENVELOPE></ENVELOPE>';
  };

  // Override checkTallyStatus to return canned status
  mock.checkTallyStatus = async (baseUrl) => {
    calls.push({ fn: 'checkTallyStatus', baseUrl });
    if (mockResponses.checkTallyStatus) return mockResponses.checkTallyStatus(baseUrl);
    return { responding: true, companies: [], activeCompany: 'Mobibox Pvt Ltd' };
  };

  // Override isTallyRunning
  mock.isTallyRunning = () => {
    calls.push({ fn: 'isTallyRunning' });
    if (mockResponses.isTallyRunning) return mockResponses.isTallyRunning();
    return { running: true, pid: 1234 };
  };

  // Override parseTallyIni
  mock.parseTallyIni = (p) => {
    calls.push({ fn: 'parseTallyIni' });
    if (mockResponses.parseTallyIni) return mockResponses.parseTallyIni(p);
    return { installPath: 'C:\\TallyPrime', dataPath: 'C:\\TallyData', exePath: 'C:\\TallyPrime\\tally.exe', port: 9000, loadCompanies: ['10001'] };
  };

  // Override scanDataFolder
  mock.scanDataFolder = (dp) => {
    calls.push({ fn: 'scanDataFolder', dataPath: dp });
    if (mockResponses.scanDataFolder) return mockResponses.scanDataFolder(dp);
    return [
      { id: '10001', name: 'SendMe Technologies Pvt Ltd', folderPath: 'C:\\TallyData\\10001', tallyVersion: 'TallyPrime', totalSizeMB: 50, fileCount: 120 },
      { id: '10002', name: 'Mobibox Pvt Ltd', folderPath: 'C:\\TallyData\\10002', tallyVersion: 'TallyPrime', totalSizeMB: 30, fileCount: 80 },
    ];
  };

  // Override restartTally
  mock.restartTally = async (exePath) => {
    calls.push({ fn: 'restartTally', exePath });
    if (mockResponses.restartTally) return mockResponses.restartTally(exePath);
    return { success: true, message: '✅ Tally restarted. Active company: Mobibox Pvt Ltd' };
  };

  // Override startTally
  mock.startTally = async (exePath) => {
    calls.push({ fn: 'startTally', exePath });
    return true;
  };

  // Override getFullStatus
  mock.getFullStatus = async (baseUrl) => {
    calls.push({ fn: 'getFullStatus', baseUrl });
    if (mockResponses.getFullStatus) return mockResponses.getFullStatus(baseUrl);
    return { success: true, message: '🖥️ *Tally Status*\n\n✅ Running', data: {} };
  };

  // Override openCompany
  mock.openCompany = async (query) => {
    calls.push({ fn: 'openCompany', query });
    if (mockResponses.openCompany) return mockResponses.openCompany(query);
    return { success: true, message: '✅ Opened *Mobibox Pvt Ltd* in TallyPrime.' };
  };

  return mock;
}

// Inject mock into require cache so index.js picks it up
function loadExecuteWithMock(mock) {
  const tdlModulePath = require.resolve('../tdl');
  const indexModulePath = require.resolve('../index');
  // Clear both from cache
  delete require.cache[indexModulePath];
  // Replace tdl module in cache
  require.cache[tdlModulePath] = { id: tdlModulePath, filename: tdlModulePath, loaded: true, exports: mock };
  const { execute } = require('../index');
  return execute;
}

function resetCalls() { calls.length = 0; }
function resetMockResponses() { for (const k of Object.keys(mockResponses)) delete mockResponses[k]; }

// Sample XML responses for various actions
const SAMPLE_LEDGER_SEARCH_XML = `<ENVELOPE>
  <LEDGER NAME="Meril Life Sciences Pvt Ltd"><NAME>Meril Life Sciences Pvt Ltd</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
</ENVELOPE>`;

const SAMPLE_LEDGER_STATEMENT_XML = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260215</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S100</VOUCHERNUMBER><NARRATION>Invoice</NARRATION><AMOUNT>-15000</AMOUNT><PARTYLEDGERNAME>Meril Life Sciences Pvt Ltd</PARTYLEDGERNAME></VOUCHER>
</ENVELOPE>`;

const SAMPLE_VOUCHERS_XML = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S001</VOUCHERNUMBER><NARRATION>Test</NARRATION><AMOUNT>-10000</AMOUNT><PARTYLEDGERNAME>A</PARTYLEDGERNAME></VOUCHER>
</ENVELOPE>`;

const SAMPLE_LIST_LEDGERS_XML = `<ENVELOPE>
  <LEDGER NAME="HDFC Bank"><NAME>HDFC Bank</NAME><PARENT>Bank Accounts</PARENT></LEDGER>
  <LEDGER NAME="SBI"><NAME>SBI</NAME><PARENT>Bank Accounts</PARENT></LEDGER>
</ENVELOPE>`;

const SAMPLE_MASTER_XML = `<ENVELOPE><LEDGER NAME="Meril Life Sciences Pvt Ltd">
  <NAME>Meril Life Sciences Pvt Ltd</NAME><PARENT>Sundry Debtors</PARENT>
  <LEDGSTREGDETAILS.LIST><GSTIN>24AABCM1234F1Z5</GSTIN></LEDGSTREGDETAILS.LIST>
</LEDGER></ENVELOPE>`;

const SAMPLE_BALANCE_XML = `<ENVELOPE><LEDGER NAME="Meril"><NAME>Meril</NAME><PARENT>Sundry Debtors</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE></LEDGER></ENVELOPE>`;

const SAMPLE_OUTSTANDING_XML = `<ENVELOPE>
  <LEDGER NAME="Party A"><CLOSINGBALANCE>-25000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const SAMPLE_CASH_BANK_XML = `<ENVELOPE>
  <LEDGER NAME="HDFC Bank"><NAME>HDFC Bank</NAME><PARENT>Bank Accounts</PARENT><CLOSINGBALANCE>-250000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const SAMPLE_PL_XML = `<ENVELOPE>
  <GROUP NAME="Sales Accounts"><NAME>Sales Accounts</NAME><PARENT>Profit &amp; Loss A/c</PARENT><CLOSINGBALANCE>-500000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

const SAMPLE_EXPENSE_XML = `<ENVELOPE>
  <LEDGER NAME="Rent"><NAME>Rent</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>50000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const SAMPLE_STOCK_XML = `<ENVELOPE>
  <STOCKITEM NAME="Widget A"><NAME>Widget A</NAME><PARENT>Finished Goods</PARENT><CLOSINGBALANCE>500 Nos</CLOSINGBALANCE><CLOSINGRATE>120</CLOSINGRATE><CLOSINGVALUE>60000</CLOSINGVALUE></STOCKITEM>
</ENVELOPE>`;

const SAMPLE_GST_XML = `<ENVELOPE>
  <LEDGER NAME="CGST Output"><NAME>CGST Output</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const SAMPLE_BILL_XML = `<ENVELOPE>
  <BILL NAME="INV-001"><NAME>INV-001</NAME><PARENT>Meril</PARENT><CLOSINGBALANCE>-35000</CLOSINGBALANCE><FINALDUEDATE>20260115</FINALDUEDATE></BILL>
</ENVELOPE>`;

const SAMPLE_INVOICE_XML = `<ENVELOPE>
  <VOUCHER REMOTEID="abc" VCHKEY="abc" VCHTYPE="Sales" OBJVIEW="Invoice Voucher View">
    <DATE TYPE="Date">20260215</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>INV-001</VOUCHERNUMBER>
    <PARTYLEDGERNAME TYPE="String">Meril Life Sciences Pvt Ltd</PARTYLEDGERNAME><AMOUNT TYPE="Amount">-50000</AMOUNT><NARRATION TYPE="String">Test</NARRATION>
    <ALLINVENTORYENTRIES.LIST>     </ALLINVENTORYENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">Meril Life Sciences Pvt Ltd</LEDGERNAME><AMOUNT TYPE="Amount">-50000</AMOUNT><ISPARTYLEDGER TYPE="Logical">Yes</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">Sales Account</LEDGERNAME><AMOUNT TYPE="Amount">50000</AMOUNT><ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
  </VOUCHER>
</ENVELOPE>`;

// ── Tests ──
const skillConfig = { port: 9000, companyName: 'SendMe Technologies Pvt Ltd' };

async function runTests() {
  // ═══════════════════════════════════════════════
  console.log('\nDynamic Company Detection:');
  // ═══════════════════════════════════════════════

  await test('auto-detects active company from Tally for data queries', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let postTallyCallCount = 0;
    mockResponses.checkTallyStatus = async () => ({ responding: true, companies: [], activeCompany: 'Mobibox Pvt Ltd' });
    mockResponses.postTally = async (url, xml) => {
      postTallyCallCount++;
      // First call = search ledgers, second = ledger statement
      if (postTallyCallCount === 1) return SAMPLE_LEDGER_SEARCH_XML;
      return SAMPLE_LEDGER_STATEMENT_XML;
    };
    const execute = loadExecuteWithMock(mock);
    const result = await execute('tally', 'get_ledger', { party_name: 'Meril Life Sciences Pvt Ltd' }, skillConfig);
    assert(result.success, 'should succeed');
    // Verify checkTallyStatus was called (company detection)
    const statusCalls = calls.filter(c => c.fn === 'checkTallyStatus');
    assert(statusCalls.length === 1, 'should call checkTallyStatus once');
    // Verify the XML sent to postTally uses Mobibox, not SendMe
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(postCalls.length >= 1, 'should call postTally');
    assert(postCalls[0].xml.includes('Mobibox Pvt Ltd'), 'XML should use detected company "Mobibox Pvt Ltd", not static config');
  });

  await test('uses cached company on subsequent calls within 60s', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let statusCallCount = 0;
    mockResponses.checkTallyStatus = async () => { statusCallCount++; return { responding: true, companies: [], activeCompany: 'Mobibox Pvt Ltd' }; };
    mockResponses.postTally = async () => SAMPLE_LIST_LEDGERS_XML;
    const execute = loadExecuteWithMock(mock);
    // First call — should query Tally for company
    await execute('tally', 'list_ledgers', {}, skillConfig);
    const firstCount = statusCallCount;
    // Second call — should use cache
    resetCalls();
    await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(statusCallCount === firstCount, `should NOT call checkTallyStatus again, called ${statusCallCount} times total`);
  });

  await test('skips company detection for offline actions', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    await execute('tally', 'list_companies', {}, skillConfig);
    const statusCalls = calls.filter(c => c.fn === 'checkTallyStatus');
    assert(statusCalls.length === 0, 'should NOT call checkTallyStatus for list_companies');
  });

  await test('skips company detection for tally_status', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    await execute('tally', 'tally_status', {}, skillConfig);
    const statusCalls = calls.filter(c => c.fn === 'checkTallyStatus');
    assert(statusCalls.length === 0, 'should NOT call checkTallyStatus for tally_status');
  });

  await test('skips company detection for start_tally', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.isTallyRunning = () => ({ running: false, pid: null });
    const execute = loadExecuteWithMock(mock);
    await execute('tally', 'start_tally', {}, skillConfig);
    const statusCalls = calls.filter(c => c.fn === 'checkTallyStatus');
    assert(statusCalls.length === 0, 'should NOT call checkTallyStatus for start_tally');
  });

  // ═══════════════════════════════════════════════
  console.log('\nCache Clearing:');
  // ═══════════════════════════════════════════════

  await test('open_company clears cache on success', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let statusCallCount = 0;
    mockResponses.checkTallyStatus = async () => { statusCallCount++; return { responding: true, companies: [], activeCompany: 'Mobibox Pvt Ltd' }; };
    mockResponses.postTally = async () => SAMPLE_LIST_LEDGERS_XML;
    mockResponses.openCompany = async () => ({ success: true, message: '✅ Opened *Mobibox Pvt Ltd*' });
    const execute = loadExecuteWithMock(mock);
    // Prime the cache
    await execute('tally', 'list_ledgers', {}, skillConfig);
    const countAfterPrime = statusCallCount;
    // Open company — should clear cache
    await execute('tally', 'open_company', { company_name: 'Mobibox' }, skillConfig);
    // Next data query should re-detect company
    resetCalls();
    await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(statusCallCount > countAfterPrime, 'should re-detect company after open_company');
  });

  await test('open_company does NOT clear cache on failure', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let statusCallCount = 0;
    mockResponses.checkTallyStatus = async () => { statusCallCount++; return { responding: true, companies: [], activeCompany: 'SendMe Technologies Pvt Ltd' }; };
    mockResponses.postTally = async () => SAMPLE_LIST_LEDGERS_XML;
    mockResponses.openCompany = async () => ({ success: false, message: 'Company not found' });
    const execute = loadExecuteWithMock(mock);
    // Prime the cache
    await execute('tally', 'list_ledgers', {}, skillConfig);
    const countAfterPrime = statusCallCount;
    // Failed open_company — cache should remain
    await execute('tally', 'open_company', { company_name: 'NonExistent' }, skillConfig);
    // Next data query should use cache (no re-detect)
    resetCalls();
    await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(statusCallCount === countAfterPrime, 'should NOT re-detect after failed open_company');
  });

  await test('restart_tally clears cache', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let statusCallCount = 0;
    mockResponses.checkTallyStatus = async () => { statusCallCount++; return { responding: true, companies: [], activeCompany: 'Mobibox Pvt Ltd' }; };
    mockResponses.postTally = async () => SAMPLE_LIST_LEDGERS_XML;
    const execute = loadExecuteWithMock(mock);
    // Prime the cache
    await execute('tally', 'list_ledgers', {}, skillConfig);
    const countAfterPrime = statusCallCount;
    // Restart — should clear cache
    await execute('tally', 'restart_tally', {}, skillConfig);
    // Next data query should re-detect
    resetCalls();
    await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(statusCallCount > countAfterPrime, 'should re-detect company after restart_tally');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — get_ledger:');
  // ═══════════════════════════════════════════════

  await test('get_ledger returns statement for exact match', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? SAMPLE_LEDGER_SEARCH_XML : SAMPLE_LEDGER_STATEMENT_XML; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_ledger', { party_name: 'Meril Life Sciences Pvt Ltd' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data && r.data.entries, 'should have entries');
  });

  await test('get_ledger returns error for missing party_name', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_ledger', {}, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('specify a party'), 'should ask for party name');
  });

  await test('get_ledger returns suggestions for multiple matches', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const multiXml = `<ENVELOPE>
      <LEDGER NAME="Meril Life Sciences"><NAME>Meril Life Sciences</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
      <LEDGER NAME="Meril Pharma"><NAME>Meril Pharma</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => multiXml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_ledger', { party_name: 'Meril' }, skillConfig);
    assert(r.success, 'should succeed with suggestions');
    assert(r.data && r.data.suggestions, 'should have suggestions');
    assert(r.message.includes('Did you mean'), 'should ask user to pick');
  });

  await test('get_ledger handles no match', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => '<ENVELOPE></ENVELOPE>';
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_ledger', { party_name: 'ZZZZZ' }, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('not found'), 'should say not found');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — vouchers/daybook:');
  // ═══════════════════════════════════════════════

  await test('get_vouchers returns vouchers', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_VOUCHERS_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_vouchers', { date_from: '2026-02-19', date_to: '2026-02-19' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data && r.data.length >= 1, 'should have voucher data');
  });

  await test('get_daybook routes same as get_vouchers', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_VOUCHERS_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_daybook', {}, skillConfig);
    assert(r.success, 'should succeed');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — list_ledgers:');
  // ═══════════════════════════════════════════════

  await test('list_ledgers returns ledger list', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_LIST_LEDGERS_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data && r.data.length === 2, `expected 2 ledgers, got ${r.data?.length}`);
  });

  await test('list_ledgers with group_filter', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_LIST_LEDGERS_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_ledgers', { group_filter: 'Bank Accounts' }, skillConfig);
    assert(r.success, 'should succeed');
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(postCalls[0].xml.includes('CHILDOF'), 'should include group filter in XML');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — party GSTIN/balance:');
  // ═══════════════════════════════════════════════

  await test('get_party_gstin returns GSTIN', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? SAMPLE_LEDGER_SEARCH_XML : SAMPLE_MASTER_XML; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_party_gstin', { party_name: 'Meril Life Sciences Pvt Ltd' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data && r.data.gstin === '24AABCM1234F1Z5', 'should have GSTIN');
  });

  await test('get_party_balance returns balance', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? SAMPLE_LEDGER_SEARCH_XML : SAMPLE_BALANCE_XML; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_party_balance', { party_name: 'Meril Life Sciences Pvt Ltd' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data && r.data.balanceType, 'should have balance type');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — reports:');
  // ═══════════════════════════════════════════════

  await test('get_sales_report returns sales data', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const salesXml = `<ENVELOPE><VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERNUMBER>S1</VOUCHERNUMBER><AMOUNT>-10000</AMOUNT><PARTYLEDGERNAME>A</PARTYLEDGERNAME></VOUCHER></ENVELOPE>`;
    mockResponses.postTally = async () => salesXml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_sales_report', {}, skillConfig);
    assert(r.success, 'should succeed');
  });

  await test('get_purchase_report routes as purchase', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => '<ENVELOPE></ENVELOPE>';
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_purchase_report', {}, skillConfig);
    assert(r.success, 'should succeed (empty is ok)');
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(postCalls[0].xml.includes('"Purchase"'), 'should query for Purchase type');
  });

  await test('get_outstanding returns outstanding', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_OUTSTANDING_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_outstanding', { type: 'payable' }, skillConfig);
    assert(r.success, 'should succeed');
  });

  await test('get_cash_bank_balance returns balances', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_CASH_BANK_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_cash_bank_balance', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data && r.data.entries, 'should have entries');
  });

  await test('get_profit_loss returns P&L', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_PL_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_profit_loss', {}, skillConfig);
    assert(r.success, 'should succeed');
  });

  await test('get_expense_report returns expenses', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_EXPENSE_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_expense_report', {}, skillConfig);
    assert(r.success, 'should succeed');
  });

  await test('get_stock_summary returns stock', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_STOCK_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_stock_summary', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data && r.data.items, 'should have items');
  });

  await test('get_gst_summary returns GST data', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => SAMPLE_GST_XML;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_gst_summary', {}, skillConfig);
    assert(r.success, 'should succeed');
  });

  await test('get_bill_outstanding returns bills', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? SAMPLE_LEDGER_SEARCH_XML : SAMPLE_BILL_XML; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_bill_outstanding', { party_name: 'Meril Life Sciences Pvt Ltd' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data && r.data.bills, 'should have bills');
  });

  await test('get_party_invoices returns invoices', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? SAMPLE_LEDGER_SEARCH_XML : SAMPLE_INVOICE_XML; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_party_invoices', { party_name: 'Meril Life Sciences Pvt Ltd' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data && r.data.invoices, 'should have invoices');
  });

  await test('get_party_invoices requires party_name', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_party_invoices', {}, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('specify a party'), 'should ask for party name');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — Tally management:');
  // ═══════════════════════════════════════════════

  await test('tally_status calls getFullStatus', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'tally_status', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(calls.some(c => c.fn === 'getFullStatus'), 'should call getFullStatus');
  });

  await test('list_companies returns companies from disk', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_companies', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('SendMe Technologies'), 'should list SendMe');
    assert(r.message.includes('Mobibox'), 'should list Mobibox');
    assert(r.data.companies.length === 2, 'should have 2 companies');
  });

  await test('list_companies handles empty data folder', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.scanDataFolder = () => [];
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_companies', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('No company'), 'should say no companies');
  });

  await test('start_tally when already running', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.isTallyRunning = () => ({ running: true, pid: 5678 });
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'start_tally', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('already running'), 'should say already running');
  });

  await test('start_tally when not running', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.isTallyRunning = () => ({ running: false, pid: null });
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'start_tally', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('starting up'), 'should say starting');
  });

  await test('restart_tally calls restartTally', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'restart_tally', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(calls.some(c => c.fn === 'restartTally'), 'should call restartTally');
  });

  await test('open_company without name lists companies', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'open_company', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('Which company'), 'should ask which company');
    assert(r.data.companies.length === 2, 'should list companies');
  });

  await test('open_company with name calls openCompany', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'open_company', { company_name: 'Mobibox' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(calls.some(c => c.fn === 'openCompany' && c.query === 'Mobibox'), 'should call openCompany with Mobibox');
  });

  // ═══════════════════════════════════════════════
  console.log('\nError Handling:');
  // ═══════════════════════════════════════════════

  await test('ECONNREFUSED when Tally not running', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.isTallyRunning = () => ({ running: false, pid: null });
    mockResponses.postTally = async () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('not running'), 'should say Tally not running');
    assert(r.message.includes('start tally'), 'should suggest starting Tally');
  });

  await test('ECONNREFUSED when Tally running but HTTP down', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.isTallyRunning = () => ({ running: true, pid: 1234 });
    mockResponses.postTally = async () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('HTTP server not responding'), 'should say HTTP not responding');
    assert(r.message.includes('restart tally'), 'should suggest restart');
  });

  await test('ETIMEDOUT error', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => { const e = new Error('timeout'); e.code = 'ETIMEDOUT'; throw e; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('too long'), 'should say taking too long');
  });

  await test('unknown action returns error', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'nonexistent_action', {}, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('Unknown'), 'should say unknown action');
  });

  // ═══════════════════════════════════════════════
  console.log('\nPagination:');
  // ═══════════════════════════════════════════════

  await test('list_ledgers page 1 shows first 20', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    // Generate 50 ledgers
    const ledgers = Array.from({ length: 50 }, (_, i) =>
      `<LEDGER NAME="Ledger ${i + 1}"><NAME>Ledger ${i + 1}</NAME><PARENT>Group</PARENT></LEDGER>`
    ).join('\n');
    mockResponses.postTally = async () => `<ENVELOPE>${ledgers}</ENVELOPE>`;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('Page 1/3'), `should show page 1/3, got: ${r.message.slice(-100)}`);
    assert(r.message.includes('Ledger 1'), 'should include first ledger');
    assert(r.message.includes('Ledger 20'), 'should include 20th ledger');
    assert(!r.message.includes('Ledger 21'), 'should NOT include 21st ledger');
    assert(r.message.includes('more'), 'should hint about more pages');
  });

  await test('list_ledgers page 2 shows next 20', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const ledgers = Array.from({ length: 50 }, (_, i) =>
      `<LEDGER NAME="Ledger ${i + 1}"><NAME>Ledger ${i + 1}</NAME><PARENT>Group</PARENT></LEDGER>`
    ).join('\n');
    mockResponses.postTally = async () => `<ENVELOPE>${ledgers}</ENVELOPE>`;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_ledgers', { page: 2 }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('Page 2/3'), 'should show page 2/3');
    assert(r.message.includes('Ledger 21'), 'should include 21st ledger');
    assert(r.message.includes('Ledger 40'), 'should include 40th ledger');
    assert(!r.message.includes('Ledger 41'), 'should NOT include 41st');
  });

  await test('list_ledgers last page has no "more" hint', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const ledgers = Array.from({ length: 25 }, (_, i) =>
      `<LEDGER NAME="L${i + 1}"><NAME>L${i + 1}</NAME><PARENT>G</PARENT></LEDGER>`
    ).join('\n');
    mockResponses.postTally = async () => `<ENVELOPE>${ledgers}</ENVELOPE>`;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_ledgers', { page: 2 }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('Page 2/2'), 'should show page 2/2');
    assert(!r.message.includes('more'), 'should NOT hint about more on last page');
  });

  await test('list_ledgers small list has no pagination', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const ledgers = Array.from({ length: 5 }, (_, i) =>
      `<LEDGER NAME="L${i + 1}"><NAME>L${i + 1}</NAME><PARENT>G</PARENT></LEDGER>`
    ).join('\n');
    mockResponses.postTally = async () => `<ENVELOPE>${ledgers}</ENVELOPE>`;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'list_ledgers', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(!r.message.includes('Page'), 'should NOT show pagination for small list');
  });

  await test('get_outstanding supports pagination', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const entries = Array.from({ length: 30 }, (_, i) =>
      `<LEDGER NAME="Party ${i + 1}"><CLOSINGBALANCE>-${(i + 1) * 1000}</CLOSINGBALANCE></LEDGER>`
    ).join('\n');
    mockResponses.postTally = async () => `<ENVELOPE>${entries}</ENVELOPE>`;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_outstanding', { type: 'payable', page: 2 }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('Page 2/2'), 'should show page 2/2');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — new features:');
  // ═══════════════════════════════════════════════

  await test('get_top_customers returns top customers', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const salesXml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S1</VOUCHERNUMBER><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT>
        <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget</STOCKITEMNAME><RATE>100</RATE><AMOUNT>50000</AMOUNT><BILLEDQTY>500</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
      </VOUCHER>
      <VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S2</VOUCHERNUMBER><PARTYLEDGERNAME>Customer B</PARTYLEDGERNAME><AMOUNT>-30000</AMOUNT>
        <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget</STOCKITEMNAME><RATE>100</RATE><AMOUNT>30000</AMOUNT><BILLEDQTY>300</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
      </VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => salesXml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_top_customers', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.entries.length === 2, `expected 2, got ${r.data.entries.length}`);
    assert(r.data.entries[0].name === 'Customer A', 'Customer A should be first');
  });

  await test('get_top_suppliers routes as purchase', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => '<ENVELOPE></ENVELOPE>';
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_top_suppliers', {}, skillConfig);
    assert(r.success, 'should succeed (empty ok)');
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(postCalls[0].xml.includes('"Purchase"'), 'should query Purchase type');
  });

  await test('get_top_items returns top items', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const salesXml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S1</VOUCHERNUMBER><PARTYLEDGERNAME>A</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT>
        <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget A</STOCKITEMNAME><RATE>100</RATE><AMOUNT>50000</AMOUNT><BILLEDQTY>500</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
      </VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => salesXml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_top_items', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.entries.length === 1, 'should have 1 item');
    assert(r.data.entries[0].name === 'Widget A');
  });

  await test('get_top_customers with limit', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const salesXml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S1</VOUCHERNUMBER><PARTYLEDGERNAME>A</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT></VOUCHER>
      <VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S2</VOUCHERNUMBER><PARTYLEDGERNAME>B</PARTYLEDGERNAME><AMOUNT>-30000</AMOUNT></VOUCHER>
      <VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S3</VOUCHERNUMBER><PARTYLEDGERNAME>C</PARTYLEDGERNAME><AMOUNT>-10000</AMOUNT></VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => salesXml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_top_customers', { limit: 2 }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.entries.length === 2, `expected 2, got ${r.data.entries.length}`);
  });

  await test('get_trial_balance returns trial balance', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const tbXml = `<ENVELOPE>
      <GROUP NAME="Current Assets"><NAME>Current Assets</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>100000</CLOSINGBALANCE></GROUP>
      <GROUP NAME="Capital Account"><NAME>Capital Account</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>-100000</CLOSINGBALANCE></GROUP>
    </ENVELOPE>`;
    mockResponses.postTally = async () => tbXml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_trial_balance', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.groups.length === 2, `expected 2 groups, got ${r.data.groups.length}`);
    assert(r.data.totalDebit === 100000, `expected debit 100000, got ${r.data.totalDebit}`);
  });

  await test('get_trial_balance ignores bad date range', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => '<ENVELOPE><GROUP NAME="X"><NAME>X</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>1000</CLOSINGBALANCE></GROUP></ENVELOPE>';
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_trial_balance', { date_from: '2026-12-31', date_to: '2026-01-01' }, skillConfig);
    assert(r.success, 'should succeed even with bad dates (they get nulled)');
    // Verify SVFROMDATE is NOT in the XML (dates were nulled)
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(!postCalls[0].xml.includes('SVFROMDATE'), 'should NOT include SVFROMDATE when dates are reversed');
  });

  await test('get_balance_sheet returns balance sheet', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const bsXml = `<ENVELOPE>
      <GROUP NAME="Current Assets"><NAME>Current Assets</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>200000</CLOSINGBALANCE></GROUP>
      <GROUP NAME="Capital Account"><NAME>Capital Account</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-200000</CLOSINGBALANCE></GROUP>
      <GROUP NAME="Sales Accounts"><NAME>Sales Accounts</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-500000</CLOSINGBALANCE></GROUP>
    </ENVELOPE>`;
    mockResponses.postTally = async () => bsXml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_balance_sheet', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.assets.length === 1, 'should have 1 asset group');
    assert(r.data.liabilities.length === 1, 'should have 1 liability group');
    // Sales Accounts should be excluded (P&L group)
    const allNames = [...r.data.assets.map(a => a.name), ...r.data.liabilities.map(l => l.name)];
    assert(!allNames.includes('Sales Accounts'), 'should exclude P&L groups');
  });

  await test('get_ageing_analysis receivable', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const now = new Date();
    const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; };
    const billXml = `<ENVELOPE>
      <BILL NAME="B1"><NAME>B1</NAME><PARENT>Party A</PARENT><CLOSINGBALANCE>-10000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(15)}</FINALDUEDATE></BILL>
      <BILL NAME="B2"><NAME>B2</NAME><PARENT>Party A</PARENT><CLOSINGBALANCE>-20000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(100)}</FINALDUEDATE></BILL>
    </ENVELOPE>`;
    mockResponses.postTally = async () => billXml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_ageing_analysis', { type: 'receivable' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.totalBills === 2, `expected 2 bills, got ${r.data.totalBills}`);
    assert(r.data.buckets[0].amount === 10000, '0-30 bucket should have 10000');
    assert(r.data.buckets[3].amount === 20000, '90+ bucket should have 20000');
  });

  await test('get_ageing_analysis payable routes to Sundry Creditors', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => '<ENVELOPE></ENVELOPE>';
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_ageing_analysis', { type: 'payable' }, skillConfig);
    assert(r.success, 'should succeed (empty ok)');
    assert(r.message.includes('No pending'), 'should say no pending bills');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — Inactive Reports:');
  // ═══════════════════════════════════════════════

  await test('get_inactive_customers returns inactive parties', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const now = new Date();
    const ago = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; };
    const xml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Sales"><DATE>${ago(5)}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Active</PARTYLEDGERNAME><AMOUNT>-10000</AMOUNT></VOUCHER>
      <VOUCHER VCHTYPE="Sales"><DATE>${ago(60)}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Dormant</PARTYLEDGERNAME><AMOUNT>-20000</AMOUNT></VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => xml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_inactive_customers', { days: 30 }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.entries.length === 1, `expected 1 inactive, got ${r.data.entries.length}`);
    assert(r.data.entries[0].name === 'Dormant');
  });

  await test('get_inactive_suppliers routes as purchase', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    mockResponses.postTally = async () => '<ENVELOPE></ENVELOPE>';
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_inactive_suppliers', {}, skillConfig);
    assert(r.success, 'should succeed');
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(postCalls[0].xml.includes('"Purchase"'), 'should query Purchase type');
  });

  await test('get_inactive_items returns inactive items', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const now = new Date();
    const ago = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; };
    const xml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Sales"><DATE>${ago(100)}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>X</PARTYLEDGERNAME><AMOUNT>-5000</AMOUNT>
        <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Dead Item</STOCKITEMNAME><AMOUNT>5000</AMOUNT></ALLINVENTORYENTRIES.LIST>
      </VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => xml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_inactive_items', { days: 30 }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.entries.length === 1, `expected 1 inactive item, got ${r.data.entries.length}`);
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — Excel Export:');
  // ═══════════════════════════════════════════════

  await test('export_excel with no data returns error', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'export_excel', {}, skillConfig);
    assert(!r.success, 'should fail without report data');
    assert(r.message.includes('No report data'), 'should say no report data');
  });

  await test('export_excel with report data returns attachment', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const reportData = { entries: [{ name: 'Party A', closingBalance: -25000 }] };
    const r = await execute('tally', 'export_excel', { _reportData: reportData, report_name: 'Outstanding' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.attachment, 'should have attachment');
    assert(r.attachment.filename === 'Outstanding.xlsx', `expected Outstanding.xlsx, got ${r.attachment.filename}`);
    assert(Buffer.isBuffer(r.attachment.buffer), 'attachment should have buffer');
  });

  await test('export_excel with unknown data shape returns error', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'export_excel', { _reportData: { foo: 'bar' }, report_name: 'Unknown' }, skillConfig);
    assert(!r.success, 'should fail for unknown shape');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — Order Tracking:');
  // ═══════════════════════════════════════════════

  await test('get_sales_orders returns orders', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const xml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Sales Order"><DATE>20260210</DATE><VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME><VOUCHERNUMBER>SO-001</VOUCHERNUMBER><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT><NARRATION>Test</NARRATION></VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => xml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_sales_orders', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.orders.length === 1, `expected 1 order, got ${r.data.orders.length}`);
  });

  await test('get_purchase_orders routes as purchase', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    const countsXml = `<ENVELOPE>
      <VOUCHER><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME></VOUCHER>
      <VOUCHER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME></VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? '<ENVELOPE></ENVELOPE>' : countsXml; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_purchase_orders', {}, skillConfig);
    assert(r.success, 'should succeed');
    // Should show available voucher types since no Purchase Orders exist
    assert(r.data.voucherTypes, 'should have voucherTypes');
    assert(r.message.includes('Available voucher types'), 'should show available types');
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(postCalls[0].xml.includes('Purchase Order'), 'first call should query Purchase Order type');
  });

  await test('get_sales_orders with custom voucher_type', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const xml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Payment"><DATE>20260210</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>P-001</VOUCHERNUMBER><PARTYLEDGERNAME>Vendor A</PARTYLEDGERNAME><AMOUNT>10000</AMOUNT><NARRATION>Test</NARRATION></VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => xml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_sales_orders', { voucher_type: 'Payment' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.orders.length === 1, `expected 1 order, got ${r.data.orders.length}`);
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(postCalls[0].xml.includes('"Payment"'), 'should query Payment type');
  });

  await test('get_pending_orders computes pending', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    const orderXml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Sales Order"><DATE>20260210</DATE><VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME><VOUCHERNUMBER>SO-001</VOUCHERNUMBER><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT></VOUCHER>
    </ENVELOPE>`;
    const invoiceXml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Sales"><DATE>20260212</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-30000</AMOUNT></VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? orderXml : invoiceXml; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_pending_orders', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.pending.length === 1, `expected 1 pending, got ${r.data.pending.length}`);
    assert(r.data.pending[0].pending === 20000, `expected 20000 pending, got ${r.data.pending[0].pending}`);
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — Payment Reminders:');
  // ═══════════════════════════════════════════════

  await test('get_payment_reminders returns overdue summary', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const now = new Date();
    const ago = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; };
    let callNum = 0;
    const billXml = `<ENVELOPE>
      <BILL NAME="INV-001"><NAME>INV-001</NAME><PARENT>Party A</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE><FINALDUEDATE>${ago(30)}</FINALDUEDATE></BILL>
    </ENVELOPE>`;
    const contactXml = `<ENVELOPE>
      <LEDGER NAME="Party A"><NAME>Party A</NAME><LEDGERMOBILE>9876543210</LEDGERMOBILE></LEDGER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? billXml : contactXml; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_payment_reminders', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.reminders.length === 1, `expected 1 reminder, got ${r.data.reminders.length}`);
    assert(r.data.reminders[0].party === 'Party A');
    assert(r.data.reminders[0].canSend === true, 'should be sendable (has phone)');
  });

  await test('get_payment_reminders no overdue', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? '<ENVELOPE></ENVELOPE>' : '<ENVELOPE></ENVELOPE>'; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'get_payment_reminders', {}, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('No overdue'), 'should say no overdue');
  });

  await test('send_reminder requires party_name', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'send_reminder', {}, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('specify a party'), 'should ask for party name');
  });

  await test('send_reminder returns reminder text', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const now = new Date();
    const ago = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; };
    let callNum = 0;
    const searchXml = `<ENVELOPE><LEDGER NAME="Party A"><NAME>Party A</NAME><PARENT>Sundry Debtors</PARENT></LEDGER></ENVELOPE>`;
    const billXml = `<ENVELOPE>
      <BILL NAME="INV-001"><NAME>INV-001</NAME><PARENT>Party A</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE><FINALDUEDATE>${ago(30)}</FINALDUEDATE></BILL>
    </ENVELOPE>`;
    const partyXml = `<ENVELOPE><BODY><DATA><COLLECTION>
      <LEDGER NAME="Party A" RESERVEDNAME=""><ADDRESS.LIST TYPE="String"><ADDRESS TYPE="String">Test</ADDRESS></ADDRESS.LIST><PARENT TYPE="String">Sundry Debtors</PARENT><LEDGERPHONE TYPE="String">9876543210</LEDGERPHONE></LEDGER>
    </COLLECTION></DATA></BODY></ENVELOPE>`;
    mockResponses.postTally = async () => { callNum++; if (callNum === 1) return searchXml; if (callNum === 2) return billXml; return partyXml; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'send_reminder', { party_name: 'Party A' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.data.reminderText, 'should have reminder text');
    assert(r.data.party === 'Party A');
  });

  // ═══════════════════════════════════════════════
  console.log('\nAction Routing — Voucher Create:');
  // ═══════════════════════════════════════════════

  await test('create_voucher validates missing party', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'create_voucher', { voucher_type: 'Sales', amount: 50000 }, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('Party'), 'should mention party');
  });

  await test('create_voucher validates invalid type', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'create_voucher', { type: 'Invalid', party_name: 'X', amount: 100 }, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('type'), 'should mention type');
  });

  await test('create_voucher validates zero amount', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'create_voucher', { voucher_type: 'Sales', party_name: 'X', amount: 0 }, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('Amount'), 'should mention amount');
  });

  await test('create_voucher success', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    const searchXml = `<ENVELOPE><LEDGER NAME="Meril"><NAME>Meril</NAME><PARENT>Sundry Debtors</PARENT></LEDGER></ENVELOPE>`;
    const createResp = '<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ERRORS>0</ERRORS></IMPORTRESULT></DATA></BODY></ENVELOPE>';
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? searchXml : createResp; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'create_voucher', { voucher_type: 'Sales', party_name: 'Meril', amount: 50000, narration: 'Test' }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('Voucher Created'), 'should confirm creation');
  });

  await test('create_voucher failure from Tally', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    const searchXml = `<ENVELOPE><LEDGER NAME="Meril"><NAME>Meril</NAME><PARENT>Sundry Debtors</PARENT></LEDGER></ENVELOPE>`;
    const createResp = '<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger not found</LINEERROR></IMPORTRESULT></DATA></BODY></ENVELOPE>';
    mockResponses.postTally = async () => { callNum++; return callNum === 1 ? searchXml : createResp; };
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'create_voucher', { voucher_type: 'Sales', party_name: 'Meril', amount: 50000 }, skillConfig);
    assert(!r.success, 'should fail');
    assert(r.message.includes('Ledger not found'), 'should show Tally error');
  });

  await test('create_voucher resolves party name', async () => {
    const mock = mockTdl();
    resetCalls(); resetMockResponses();
    let callNum = 0;
    const multiXml = `<ENVELOPE>
      <LEDGER NAME="Meril Life Sciences"><NAME>Meril Life Sciences</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
      <LEDGER NAME="Meril Pharma"><NAME>Meril Pharma</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => multiXml;
    const execute = loadExecuteWithMock(mock);
    const r = await execute('tally', 'create_voucher', { voucher_type: 'Sales', party_name: 'Meril', amount: 50000 }, skillConfig);
    assert(r.success, 'should succeed with suggestions');
    assert(r.data.suggestions, 'should have suggestions');
  });

  // ── Summary ──
  console.log(`\n${pass} passed, ${fail} failed out of ${pass + fail} tests`);
  process.exit(fail > 0 ? 1 : 0);
}

runTests();
