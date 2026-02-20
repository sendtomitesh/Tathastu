/**
 * Tests for Excel export auto-fetch and keyword routing.
 * Run: node src/skills/tally/tests/test-excel-export.js
 */

let pass = 0, fail = 0;
function test(name, fn) {
  return fn().then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch(e => { fail++; console.log(`  ✗ ${name}: ${e.message}`); });
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// Test keyword parser
const path = require('path');

function loadParseWithKeyword() {
  const parsePath = require.resolve('../../../openai/parse');
  delete require.cache[parsePath];
  const mod = require('../../../openai/parse');
  return mod.parseWithKeyword;
}

const config = {
  skills: [{
    id: 'tally',
    actions: [
      { id: 'export_excel', description: 'Export report to Excel' },
      { id: 'get_ledger', description: 'Get ledger statement' },
      { id: 'list_ledgers', description: 'List all ledgers' },
      { id: 'get_vouchers', description: 'Get vouchers' },
    ]
  }]
};

async function runTests() {
  const parseWithKeyword = loadParseWithKeyword();

  console.log('\nKeyword Parser — Export patterns:\n');

  await test('"what can you export" routes to export_excel with _showHelp', async () => {
    const r = parseWithKeyword('what can you export', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params._showHelp === true, 'should have _showHelp=true');
  });

  await test('"what can I export" routes to export_excel with _showHelp', async () => {
    const r = parseWithKeyword('what can I export', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params._showHelp === true, 'should have _showHelp=true');
  });

  await test('"export help" routes to export_excel with _showHelp', async () => {
    const r = parseWithKeyword('export help', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params._showHelp === true, 'should have _showHelp=true');
  });

  await test('"export all ledgers to excel" routes to export_excel with report_name=ledger', async () => {
    const r = parseWithKeyword('export all ledgers to excel', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params.report_name === 'ledger', `expected report_name=ledger, got ${r.params.report_name}`);
    assert(!r.params._showHelp, 'should NOT have _showHelp');
  });

  await test('"export all vouchers to excel" routes to export_excel with report_name=voucher', async () => {
    const r = parseWithKeyword('export all vouchers to excel', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params.report_name === 'voucher', `expected report_name=voucher, got ${r.params.report_name}`);
  });

  await test('"export sales to excel" routes with report_name=sales', async () => {
    const r = parseWithKeyword('export sales to excel', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params.report_name === 'sales', `expected report_name=sales, got ${r.params.report_name}`);
  });

  await test('"download excel" routes to export_excel with generic report_name', async () => {
    const r = parseWithKeyword('download excel', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params.report_name === 'Report', `expected report_name=Report, got ${r.params.report_name}`);
  });

  await test('"export excel" routes to export_excel with generic report_name', async () => {
    const r = parseWithKeyword('export excel', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params.report_name === 'Report', `expected report_name=Report, got ${r.params.report_name}`);
  });

  await test('"excel for payment vouchers" routes with report_name=payment', async () => {
    const r = parseWithKeyword('excel for payment vouchers', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params.report_name === 'payment', `expected report_name=payment, got ${r.params.report_name}`);
  });

  await test('"export trial balance to excel" routes with report_name=trial', async () => {
    const r = parseWithKeyword('export trial balance to excel', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params.report_name === 'trial', `expected report_name=trial, got ${r.params.report_name}`);
  });

  await test('"export outstanding to excel" routes with report_name=outstanding', async () => {
    const r = parseWithKeyword('export outstanding to excel', config);
    assert(r.action === 'export_excel', `expected export_excel, got ${r.action}`);
    assert(r.params.report_name === 'outstanding', `expected report_name=outstanding, got ${r.params.report_name}`);
  });

  console.log(`\n${pass} passed, ${fail} failed out of ${pass + fail} tests`);
  process.exit(fail > 0 ? 1 : 0);
}

runTests();
