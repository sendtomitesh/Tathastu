/**
 * End-to-end test: auto-fetch data for each report type, then export to Excel.
 * Simulates the orchestrator's auto-fetch flow by calling the data action first,
 * then passing the result to export_excel — exactly what the orchestrator does.
 *
 * Run: node src/skills/tally/tests/test-excel-all-exports.js
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
  mock.checkTallyStatus = async () => ({ responding: true, companies: [], activeCompany: 'TestCo' });
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

// ── Sample XML responses for each report type ──

const LEDGER_LIST_XML = `<ENVELOPE>
  <LEDGER NAME="HDFC Bank"><NAME>HDFC Bank</NAME><PARENT>Bank Accounts</PARENT></LEDGER>
  <LEDGER NAME="SBI"><NAME>SBI</NAME><PARENT>Bank Accounts</PARENT></LEDGER>
  <LEDGER NAME="Cash"><NAME>Cash</NAME><PARENT>Cash-in-Hand</PARENT></LEDGER>
</ENVELOPE>`;

const VOUCHERS_XML = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S001</VOUCHERNUMBER><NARRATION>Test sale</NARRATION><AMOUNT>-10000</AMOUNT><PARTYLEDGERNAME>Party A</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Payment"><DATE>20260219</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>P001</VOUCHERNUMBER><NARRATION>Rent</NARRATION><AMOUNT>5000</AMOUNT><PARTYLEDGERNAME>Landlord</PARTYLEDGERNAME></VOUCHER>
</ENVELOPE>`;

const SALES_XML = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260219</DATE><VOUCHERNUMBER>S1</VOUCHERNUMBER><AMOUNT>-10000</AMOUNT><PARTYLEDGERNAME>Party A</PARTYLEDGERNAME></VOUCHER>
</ENVELOPE>`;

const OUTSTANDING_XML = `<ENVELOPE>
  <LEDGER NAME="Party A"><CLOSINGBALANCE>-25000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Party B"><CLOSINGBALANCE>-15000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const TRIAL_BALANCE_XML = `<ENVELOPE>
  <GROUP NAME="Sales Accounts"><NAME>Sales Accounts</NAME><PARENT>Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>-500000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Purchase Accounts"><NAME>Purchase Accounts</NAME><PARENT>Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>300000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

const BALANCE_SHEET_XML = `<ENVELOPE>
  <GROUP NAME="Capital Account"><NAME>Capital Account</NAME><PARENT>Primary</PARENT><CLOSINGBALANCE>-1000000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Fixed Assets"><NAME>Fixed Assets</NAME><PARENT>Primary</PARENT><CLOSINGBALANCE>500000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

const PL_XML = `<ENVELOPE>
  <GROUP NAME="Sales Accounts"><NAME>Sales Accounts</NAME><PARENT>Profit &amp; Loss A/c</PARENT><CLOSINGBALANCE>-500000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Purchase Accounts"><NAME>Purchase Accounts</NAME><PARENT>Profit &amp; Loss A/c</PARENT><CLOSINGBALANCE>300000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

const EXPENSE_XML = `<ENVELOPE>
  <LEDGER NAME="Rent"><NAME>Rent</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>50000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Salary"><NAME>Salary</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>200000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const STOCK_XML = `<ENVELOPE>
  <STOCKITEM NAME="Widget A"><NAME>Widget A</NAME><PARENT>Finished Goods</PARENT><CLOSINGBALANCE>500 Nos</CLOSINGBALANCE><CLOSINGRATE>120</CLOSINGRATE><CLOSINGVALUE>60000</CLOSINGVALUE></STOCKITEM>
  <STOCKITEM NAME="Widget B"><NAME>Widget B</NAME><PARENT>Finished Goods</PARENT><CLOSINGBALANCE>200 Nos</CLOSINGBALANCE><CLOSINGRATE>80</CLOSINGRATE><CLOSINGVALUE>16000</CLOSINGVALUE></STOCKITEM>
</ENVELOPE>`;

const GST_XML = `<ENVELOPE>
  <LEDGER NAME="CGST Output"><NAME>CGST Output</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="SGST Output"><NAME>SGST Output</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const CASH_BANK_XML = `<ENVELOPE>
  <LEDGER NAME="HDFC Bank"><NAME>HDFC Bank</NAME><PARENT>Bank Accounts</PARENT><CLOSINGBALANCE>-250000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Cash"><NAME>Cash</NAME><PARENT>Cash-in-Hand</PARENT><CLOSINGBALANCE>-15000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

/**
 * Helper: simulate the orchestrator's auto-fetch + export flow.
 * 1. Call the data action to get report data
 * 2. Pass that data to export_excel
 */
async function testExportFlow(execute, dataAction, dataParams, mockXml, reportName) {
  resetCalls(); resetMockResponses();
  mockResponses.postTally = async () => mockXml;

  // Step 1: fetch data (like orchestrator auto-fetch does)
  const dataResult = await execute('tally', dataAction, dataParams, skillConfig);
  if (!dataResult.success) {
    throw new Error(`Data fetch failed for ${dataAction}: ${dataResult.message}`);
  }

  // Step 2: export to Excel (like orchestrator passes _reportData)
  resetCalls(); resetMockResponses();
  const exportResult = await execute('tally', 'export_excel', {
    _reportData: dataResult.data,
    report_name: reportName,
  }, skillConfig);

  return exportResult;
}

async function runTests() {
  console.log('\nExcel Export — All report types end-to-end:\n');

  // 1. Ledger list
  await test('export ledger list → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'list_ledgers', {}, LEDGER_LIST_XML, 'ledgers');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    assert(r.attachment.filename.includes('ledgers'), `filename should contain "ledgers", got: ${r.attachment.filename}`);
    assert(r.attachment.buffer.length > 0, 'buffer should not be empty');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 2. Vouchers
  await test('export vouchers → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_vouchers', {}, VOUCHERS_XML, 'vouchers');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    assert(r.attachment.buffer.length > 0, 'buffer should not be empty');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 3. Sales report
  await test('export sales report → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_sales_report', {}, SALES_XML, 'sales');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 4. Outstanding receivable
  await test('export outstanding receivable → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_outstanding', { type: 'receivable' }, OUTSTANDING_XML, 'outstanding receivable');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 5. Trial balance
  await test('export trial balance → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_trial_balance', {}, TRIAL_BALANCE_XML, 'trial balance');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 6. Balance sheet
  await test('export balance sheet → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_balance_sheet', {}, BALANCE_SHEET_XML, 'balance sheet');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 7. Profit & Loss
  await test('export profit loss → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_profit_loss', {}, PL_XML, 'profit loss');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 8. Expenses
  await test('export expenses → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_expense_report', {}, EXPENSE_XML, 'expenses');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 9. Stock summary
  await test('export stock summary → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_stock_summary', {}, STOCK_XML, 'stock summary');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 10. GST summary
  await test('export GST summary → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_gst_summary', {}, GST_XML, 'gst summary');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 11. Cash & Bank balance
  await test('export cash bank balance → Excel', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    const r = await testExportFlow(execute, 'get_cash_bank_balance', {}, CASH_BANK_XML, 'cash bank');
    assert(r.success, `export failed: ${r.message}`);
    assert(r.attachment, 'should have attachment');
    console.log(`      → ${r.attachment.filename} (${r.attachment.buffer.length} bytes)`);
  });

  // 12. Export help
  await test('"what can you export" shows help list', async () => {
    const mock = mockTdl();
    const execute = loadExecuteWithMock(mock);
    resetCalls(); resetMockResponses();
    const r = await execute('tally', 'export_excel', { _showHelp: true }, skillConfig);
    assert(r.success, 'should succeed');
    assert(r.message.includes('Ledgers'), 'should list Ledgers');
    assert(r.message.includes('Vouchers'), 'should list Vouchers');
    assert(r.message.includes('Trial Balance'), 'should list Trial Balance');
    assert(r.message.includes('P&L'), 'should list P&L');
    assert(r.message.includes('Stock'), 'should list Stock');
    assert(r.message.includes('GST'), 'should list GST');
    assert(r.message.includes('Ageing'), 'should list Ageing');
    console.log(`      → Help message OK (${r.message.split('\n').length} lines)`);
  });

  // ── Summary ──
  console.log(`\n${pass} passed, ${fail} failed out of ${pass + fail} tests`);
  process.exit(fail > 0 ? 1 : 0);
}

runTests();
