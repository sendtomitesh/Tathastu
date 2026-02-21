/**
 * TDL module tests — run with: node src/skills/tally/tests/test-all.js
 * Tests every builder and parser with sample XML data.
 */
const tdl = require('../tdl');

let pass = 0, fail = 0;
const asyncTests = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      // Async test — collect for later
      asyncTests.push(result.then(() => { pass++; console.log(`  ✓ ${name}`); })
        .catch(e => { fail++; console.log(`  ✗ ${name}: ${e.message}`); }));
      return;
    }
    pass++; console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++; console.log(`  ✗ ${name}: ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ── Helpers ──
console.log('\nHelpers:');
test('toTallyDate YYYY-MM-DD', () => assert(tdl.toTallyDate('2025-04-01') === '20250401'));
test('toTallyDate YYYYMMDD passthrough', () => assert(tdl.toTallyDate('20250401') === '20250401'));
test('toTallyDate null', () => assert(tdl.toTallyDate(null) === null));
test('formatTallyDate', () => assert(tdl.formatTallyDate('20250401') === '01-04-2025'));

// ── Ledger Master (GSTIN) ──
console.log('\nLedger Master:');
const masterXml = `<ENVELOPE><LEDGER NAME="Meril Life Sciences Pvt Ltd">
  <NAME>Meril Life Sciences Pvt Ltd</NAME><PARENT>Sundry Debtors</PARENT>
  <LEDGSTREGDETAILS.LIST><GSTIN>24AABCM1234F1Z5</GSTIN></LEDGSTREGDETAILS.LIST>
</LEDGER></ENVELOPE>`;

test('build XML has Ledger type', () => {
  const xml = tdl.buildLedgerMasterTdlXml('Test', 'Co');
  assert(xml.includes('<TYPE>Ledger</TYPE>'));
});
test('parse finds GSTIN', () => {
  const r = tdl.parseLedgerMasterTdlResponse(masterXml);
  assert(r.success && r.data.gstin === '24AABCM1234F1Z5');
});
test('parse no GSTIN', () => {
  const r = tdl.parseLedgerMasterTdlResponse('<ENVELOPE><LEDGER NAME="X"><NAME>X</NAME><PARENT>P</PARENT></LEDGER></ENVELOPE>');
  assert(r.success && r.data.gstin === null);
});
test('parse empty', () => {
  const r = tdl.parseLedgerMasterTdlResponse('<ENVELOPE></ENVELOPE>');
  assert(!r.success);
});

// ── Ledger Balance ──
console.log('\nLedger Balance:');
const balXml = `<ENVELOPE><LEDGER NAME="Test"><NAME>Test</NAME><PARENT>Sundry Debtors</PARENT><CLOSINGBALANCE>-25000.50</CLOSINGBALANCE></LEDGER></ENVELOPE>`;

test('build XML', () => assert(tdl.buildLedgerBalanceTdlXml('Test', 'Co').includes('LedgerBalFilter')));
test('parse payable', () => {
  const r = tdl.parseLedgerBalanceTdlResponse(balXml);
  assert(r.success && r.data.balanceType === 'Payable');
});
test('parse receivable', () => {
  const r = tdl.parseLedgerBalanceTdlResponse(balXml.replace('-25000.50', '10000'));
  assert(r.success && r.data.balanceType === 'Receivable');
});
test('parse empty', () => assert(!tdl.parseLedgerBalanceTdlResponse('<ENVELOPE></ENVELOPE>').success));

// ── Ledger Statement ──
console.log('\nLedger Statement:');
const stmtXml = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260115</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S100</VOUCHERNUMBER><NARRATION>Invoice</NARRATION><AMOUNT>-15000</AMOUNT><PARTYLEDGERNAME>Meril</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Receipt"><DATE>20260120</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>R100</VOUCHERNUMBER><NARRATION>Payment</NARRATION><AMOUNT>10000</AMOUNT><PARTYLEDGERNAME>Meril</PARTYLEDGERNAME></VOUCHER>
</ENVELOPE>`;

test('build XML default FY', () => {
  const xml = tdl.buildLedgerStatementTdlXml('Meril', 'Co');
  // After Task 17: no dates set when none provided — Tally uses company FY
  assert(xml.includes('LedgerVchFilter') || !xml.includes('SVFROMDATE'));
});
test('build XML with dates', () => {
  const xml = tdl.buildLedgerStatementTdlXml('Meril', 'Co', '20250101', '20250131');
  assert(xml.includes('20250101'));
});
test('parse entries', () => {
  const r = tdl.parseLedgerStatementTdlResponse(stmtXml, 'Meril', 20);
  assert(r.success && r.data.entries.length === 2);
  assert(r.message.includes('Receivable') || r.message.includes('Payable'));
});
test('parse empty', () => {
  const r = tdl.parseLedgerStatementTdlResponse('<ENVELOPE></ENVELOPE>', 'X', 20);
  assert(r.success && r.message.includes('No transactions'));
});

// ── Vouchers / Daybook ──
console.log('\nVouchers:');
const vchXml = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260218</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S001</VOUCHERNUMBER><NARRATION>Test</NARRATION><AMOUNT>-10000</AMOUNT><PARTYLEDGERNAME>A</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260217</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S002</VOUCHERNUMBER><NARRATION>Old</NARRATION><AMOUNT>-5000</AMOUNT><PARTYLEDGERNAME>B</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Payment"><DATE>20260218</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>P001</VOUCHERNUMBER><NARRATION>Pay</NARRATION><AMOUNT>3000</AMOUNT><PARTYLEDGERNAME>A</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260101</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S003</VOUCHERNUMBER><NARRATION>Jan</NARRATION><AMOUNT>-2000</AMOUNT><PARTYLEDGERNAME>C</PARTYLEDGERNAME></VOUCHER>
</ENVELOPE>`;

test('build XML defaults to no dates when none provided', () => assert(!tdl.buildVouchersTdlXml('Co', null, null, null).includes('SVFROMDATE')));
test('build XML with type filter', () => assert(tdl.buildVouchersTdlXml('Co', null, null, 'Sales').includes('VchTypeFilter')));
test('parse all', () => assert(tdl.parseVouchersTdlResponse(vchXml, 50).data.length === 4));
test('parse date filter today', () => assert(tdl.parseVouchersTdlResponse(vchXml, 50, '20260218', '20260218').data.length === 2));
test('parse date filter range', () => assert(tdl.parseVouchersTdlResponse(vchXml, 50, '20260217', '20260218').data.length === 3));
test('parse limit', () => assert(tdl.parseVouchersTdlResponse(vchXml, 2).data.length === 2));
test('parse empty', () => {
  const r = tdl.parseVouchersTdlResponse('<ENVELOPE></ENVELOPE>', 50);
  assert(r.success && r.message.includes('No vouchers'));
});

// ── Search Ledgers ──
console.log('\nSearch Ledgers:');
const searchXml = `<ENVELOPE>
  <LEDGER NAME="Meril Life Sciences"><NAME>Meril Life Sciences</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
  <LEDGER NAME="Meril Pharma"><NAME>Meril Pharma</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>
</ENVELOPE>`;

test('build XML has Contains', () => assert(tdl.buildSearchLedgersTdlXml('meril', 'Co').includes('Contains')));
test('parse finds 2', () => assert(tdl.parseSearchLedgersResponse(searchXml).data.length === 2));
test('parse empty', () => assert(tdl.parseSearchLedgersResponse('<ENVELOPE></ENVELOPE>').data.length === 0));

// ── List Ledgers ──
console.log('\nList Ledgers:');
const listXml = `<ENVELOPE>
  <LEDGER NAME="HDFC Bank"><NAME>HDFC Bank</NAME><PARENT>Bank Accounts</PARENT></LEDGER>
  <LEDGER NAME="SBI"><NAME>SBI</NAME><PARENT>Bank Accounts</PARENT></LEDGER>
</ENVELOPE>`;

test('build list XML no group', () => assert(tdl.buildListLedgersTdlXml(null, 'Co').includes('LedgerList')));
test('build list XML with group', () => assert(tdl.buildListLedgersTdlXml('Bank Accounts', 'Co').includes('CHILDOF')));
test('build names XML', () => assert(tdl.buildListLedgerNamesTdlXml('Sundry Debtors', 'Co').includes('CHILDOF')));
test('parse list', () => assert(tdl.parseListLedgersTdlResponse(listXml).data.length === 2));
test('parse names', () => assert(tdl.parseListLedgerNamesResponse(listXml).data.length === 2));
test('parse list empty', () => assert(tdl.parseListLedgersTdlResponse('<ENVELOPE></ENVELOPE>').data.length === 0));

// ── Outstanding ──
console.log('\nOutstanding:');
const outXml = `<ENVELOPE>
  <LEDGER NAME="Party A"><CLOSINGBALANCE>-25000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Party B"><CLOSINGBALANCE>-10000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Party C"><CLOSINGBALANCE>0</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

test('build XML', () => assert(tdl.buildOutstandingTdlXml('Sundry Debtors', 'Co').includes('NonZeroBalFilter')));
test('parse filters zero', () => {
  const r = tdl.parseOutstandingTdlResponse(outXml, 'Sundry Debtors');
  assert(r.success && r.data.entries.length === 2);
});
test('parse empty', () => {
  const r = tdl.parseOutstandingTdlResponse('<ENVELOPE></ENVELOPE>', 'Sundry Debtors');
  assert(r.success && r.message.includes('No outstanding'));
});

// ── Sales/Purchase Report ──
console.log('\nSales/Purchase Report:');
const spXml = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260201</DATE><VOUCHERNUMBER>S200</VOUCHERNUMBER><AMOUNT>-20000</AMOUNT><PARTYLEDGERNAME>A</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260205</DATE><VOUCHERNUMBER>S201</VOUCHERNUMBER><AMOUNT>-15000</AMOUNT><PARTYLEDGERNAME>A</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260210</DATE><VOUCHERNUMBER>S202</VOUCHERNUMBER><AMOUNT>-8000</AMOUNT><PARTYLEDGERNAME>B</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260115</DATE><VOUCHERNUMBER>S199</VOUCHERNUMBER><AMOUNT>-5000</AMOUNT><PARTYLEDGERNAME>C</PARTYLEDGERNAME></VOUCHER>
</ENVELOPE>`;

test('build sales XML', () => assert(tdl.buildSalesPurchaseReportTdlXml('Co', 'sales', null, null).includes('"Sales"')));
test('build purchase XML', () => assert(tdl.buildSalesPurchaseReportTdlXml('Co', 'purchase', null, null).includes('"Purchase"')));
test('parse all', () => assert(tdl.parseSalesPurchaseReportTdlResponse(spXml, 'sales').data.entries.length === 4));
test('parse date filter Feb', () => {
  const r = tdl.parseSalesPurchaseReportTdlResponse(spXml, 'sales', '20260201', '20260228');
  assert(r.data.entries.length === 3, `expected 3, got ${r.data.entries.length}`);
});
test('parse empty', () => {
  const r = tdl.parseSalesPurchaseReportTdlResponse('<ENVELOPE></ENVELOPE>', 'purchase');
  assert(r.success && r.message.includes('No purchase'));
});

// ── Cash & Bank Balance ──
console.log('\nCash & Bank Balance:');
const cashBankXml = `<ENVELOPE>
  <LEDGER NAME="HDFC Bank"><NAME>HDFC Bank</NAME><PARENT>Bank Accounts</PARENT><CLOSINGBALANCE>-250000.50</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="SBI Current"><NAME>SBI Current</NAME><PARENT>Bank Accounts</PARENT><CLOSINGBALANCE>-180000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Petty Cash"><NAME>Petty Cash</NAME><PARENT>Cash-in-Hand</PARENT><CLOSINGBALANCE>-15000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Office Rent"><NAME>Office Rent</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>50000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

test('build cash-bank XML', () => {
  const xml = tdl.buildCashBankBalanceTdlXml('Co');
  assert(xml.includes('CashBankList') && xml.includes('BankLedgers') && xml.includes('CashLedgers'));
});
test('parse cash-bank entries (filters non-bank)', () => {
  const r = tdl.parseCashBankBalanceTdlResponse(cashBankXml);
  assert(r.success && r.data.entries.length === 3, `expected 3, got ${r.data.entries.length}`);
});
test('parse cash-bank total', () => {
  const r = tdl.parseCashBankBalanceTdlResponse(cashBankXml);
  assert(r.data.total === -445000.50, `expected -445000.50, got ${r.data.total}`);
});
test('parse cash-bank message has emoji', () => {
  const r = tdl.parseCashBankBalanceTdlResponse(cashBankXml);
  assert(r.message.includes('🏦') && r.message.includes('💵'));
});
test('parse cash-bank empty', () => {
  const r = tdl.parseCashBankBalanceTdlResponse('<ENVELOPE></ENVELOPE>');
  assert(r.success && r.message.includes('No cash'));
});

// ── Profit & Loss ──
console.log('\nProfit & Loss:');
const plXml = `<ENVELOPE>
  <GROUP NAME="Sales Accounts"><NAME>Sales Accounts</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-500000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Direct Incomes"><NAME>Direct Incomes</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-50000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Direct Expenses"><NAME>Direct Expenses</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>200000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Indirect Expenses"><NAME>Indirect Expenses</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>150000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Current Assets"><NAME>Current Assets</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-300000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Capital Account"><NAME>Capital Account</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>100000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

test('build P&L XML default FY', () => {
  const xml = tdl.buildProfitLossTdlXml('Co');
  assert(xml.includes('PLGroups') && !xml.includes('SVFROMDATE'), 'should NOT include SVFROMDATE when no dates given');
});
test('build P&L XML with dates', () => {
  const xml = tdl.buildProfitLossTdlXml('Co', '20250401', '20260331');
  assert(xml.includes('20250401') && xml.includes('20260331') && xml.includes('SVFROMDATE'));
});
test('parse P&L groups (filters by known P&L names)', () => {
  const r = tdl.parseProfitLossTdlResponse(plXml, '20250401', '20260219');
  assert(r.success && r.data.groups.length === 4, `expected 4, got ${r.data.groups.length}`);
});
test('parse P&L income/expense totals', () => {
  const r = tdl.parseProfitLossTdlResponse(plXml, '20250401', '20260219');
  assert(r.data.totalIncome === 550000, `expected 550000, got ${r.data.totalIncome}`);
  assert(r.data.totalExpense === 350000, `expected 350000, got ${r.data.totalExpense}`);
});
test('parse P&L net profit', () => {
  const r = tdl.parseProfitLossTdlResponse(plXml, '20250401', '20260219');
  assert(r.data.netProfit === 200000, `expected 200000, got ${r.data.netProfit}`);
  assert(r.message.includes('Net Profit'));
});
test('parse P&L categorizes by name not sign (inverted signs)', () => {
  // Some companies have inverted signs: income positive, expense negative
  const invertedXml = `<ENVELOPE>
    <GROUP NAME="Direct Incomes"><NAME>Direct Incomes</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>35173673</CLOSINGBALANCE></GROUP>
    <GROUP NAME="Indirect Expenses"><NAME>Indirect Expenses</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-32256442.53</CLOSINGBALANCE></GROUP>
    <GROUP NAME="Purchase Accounts"><NAME>Purchase Accounts</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-2958000</CLOSINGBALANCE></GROUP>
    <GROUP NAME="Indirect Incomes"><NAME>Indirect Incomes</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-44544</CLOSINGBALANCE></GROUP>
  </ENVELOPE>`;
  const r = tdl.parseProfitLossTdlResponse(invertedXml);
  // Income = Direct Incomes (35173673) + Indirect Incomes (44544) = 35218217
  assert(r.data.totalIncome === 35218217, `expected 35218217, got ${r.data.totalIncome}`);
  // Expense = Indirect Expenses (32256442.53) + Purchase Accounts (2958000) = 35214442.53
  assert(r.data.totalExpense === 35214442.53, `expected 35214442.53, got ${r.data.totalExpense}`);
  // Net profit = 35218217 - 35214442.53 = 3774.47
  const expectedNet = 35218217 - 35214442.53;
  assert(Math.abs(r.data.netProfit - expectedNet) < 0.01, `expected ~${expectedNet}, got ${r.data.netProfit}`);
  assert(r.message.includes('Net Profit'), 'should show Net Profit');
  // Verify income groups are under Income section
  assert(r.message.includes('Direct Incomes') && r.message.includes('Indirect Incomes'), 'income groups should be listed');
  // Verify expense groups are under Expenses section
  assert(r.message.includes('Indirect Expenses') && r.message.includes('Purchase Accounts'), 'expense groups should be listed');
});
test('parse P&L empty', () => {
  const r = tdl.parseProfitLossTdlResponse('<ENVELOPE></ENVELOPE>');
  assert(r.success && r.message.includes('No P&L'));
});

// ── Expense Report ──
console.log('\nExpense Report:');
const expXml = `<ENVELOPE>
  <LEDGER NAME="Rent"><NAME>Rent</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>50000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Salary"><NAME>Salary</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>120000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Electricity"><NAME>Electricity</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>8500</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Freight"><NAME>Freight</NAME><PARENT>Direct Expenses</PARENT><CLOSINGBALANCE>15000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Discount Given"><NAME>Discount Given</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>0</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

test('build expense XML', () => {
  const xml = tdl.buildExpenseReportTdlXml('Co', '20260201', '20260219');
  assert(xml.includes('ExpenseLedgers') && xml.includes('IndirectExpLedgers') && xml.includes('SVFROMDATE'));
});
test('parse expense entries (filters zero)', () => {
  const r = tdl.parseExpenseReportTdlResponse(expXml, '20260201', '20260219');
  assert(r.success && r.data.entries.length === 4, `expected 4, got ${r.data.entries.length}`);
});
test('parse expense sorted by amount desc', () => {
  const r = tdl.parseExpenseReportTdlResponse(expXml, '20260201', '20260219');
  assert(r.data.entries[0].name === 'Salary', `expected Salary first, got ${r.data.entries[0].name}`);
});
test('parse expense total', () => {
  const r = tdl.parseExpenseReportTdlResponse(expXml, '20260201', '20260219');
  assert(r.data.total === 193500, `expected 193500, got ${r.data.total}`);
});
test('parse expense empty', () => {
  const r = tdl.parseExpenseReportTdlResponse('<ENVELOPE></ENVELOPE>');
  assert(r.success && r.message.includes('No expenses'));
});

// ── Stock Summary ──
console.log('\nStock Summary:');
const stockXml = `<ENVELOPE>
  <STOCKITEM NAME="Widget A"><NAME>Widget A</NAME><PARENT>Finished Goods</PARENT><CLOSINGBALANCE>500 Nos</CLOSINGBALANCE><CLOSINGRATE>120</CLOSINGRATE><CLOSINGVALUE>60000</CLOSINGVALUE></STOCKITEM>
  <STOCKITEM NAME="Widget B"><NAME>Widget B</NAME><PARENT>Finished Goods</PARENT><CLOSINGBALANCE>200 Kg</CLOSINGBALANCE><CLOSINGRATE>250</CLOSINGRATE><CLOSINGVALUE>50000</CLOSINGVALUE></STOCKITEM>
  <STOCKITEM NAME="Raw Material X"><NAME>Raw Material X</NAME><PARENT>Raw Materials</PARENT><CLOSINGBALANCE>1000 Nos</CLOSINGBALANCE><CLOSINGRATE>15</CLOSINGRATE><CLOSINGVALUE>15000</CLOSINGVALUE></STOCKITEM>
</ENVELOPE>`;

test('build stock XML no filter', () => {
  const xml = tdl.buildStockSummaryTdlXml('Co');
  assert(xml.includes('StockList') && !xml.includes('StockNameFilter'));
});
test('build stock XML with item filter', () => {
  const xml = tdl.buildStockSummaryTdlXml('Co', 'Widget');
  assert(xml.includes('StockNameFilter') && xml.includes('Contains'));
});
test('parse stock items', () => {
  const r = tdl.parseStockSummaryTdlResponse(stockXml);
  assert(r.success && r.data.items.length === 3, `expected 3, got ${r.data.items.length}`);
});
test('parse stock sorted by value desc', () => {
  const r = tdl.parseStockSummaryTdlResponse(stockXml);
  assert(r.data.items[0].name === 'Widget A', `expected Widget A first, got ${r.data.items[0].name}`);
});
test('parse stock total value', () => {
  const r = tdl.parseStockSummaryTdlResponse(stockXml);
  assert(r.data.totalValue === 125000, `expected 125000, got ${r.data.totalValue}`);
});
test('parse stock qty and unit', () => {
  const r = tdl.parseStockSummaryTdlResponse(stockXml);
  const widgetA = r.data.items.find(i => i.name === 'Widget A');
  assert(widgetA.qty === 500 && widgetA.unit === 'Nos', `qty=${widgetA.qty}, unit=${widgetA.unit}`);
});
test('parse stock empty', () => {
  const r = tdl.parseStockSummaryTdlResponse('<ENVELOPE></ENVELOPE>');
  assert(r.success && r.message.includes('No stock'));
});

// ── GST Summary ──
console.log('\nGST Summary:');
const gstXml = `<ENVELOPE>
  <LEDGER NAME="CGST Output"><NAME>CGST Output</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="SGST Output"><NAME>SGST Output</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="CGST Input"><NAME>CGST Input</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>10000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="SGST Input"><NAME>SGST Input</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>10000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Zero Tax"><NAME>Zero Tax</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>0</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

test('build GST XML', () => {
  const xml = tdl.buildGstSummaryTdlXml('Co', '20260201', '20260219');
  assert(xml.includes('GSTLedgers') && xml.includes('CHILDOF'));
});
test('parse GST entries (filters zero)', () => {
  const r = tdl.parseGstSummaryTdlResponse(gstXml, '20260201', '20260219');
  assert(r.success && r.data.entries.length === 4, `expected 4, got ${r.data.entries.length}`);
});
test('parse GST output total', () => {
  const r = tdl.parseGstSummaryTdlResponse(gstXml, '20260201', '20260219');
  assert(r.data.totalOutput === 50000, `expected 50000, got ${r.data.totalOutput}`);
});
test('parse GST input total', () => {
  const r = tdl.parseGstSummaryTdlResponse(gstXml, '20260201', '20260219');
  assert(r.data.totalInput === 20000, `expected 20000, got ${r.data.totalInput}`);
});
test('parse GST net liability', () => {
  const r = tdl.parseGstSummaryTdlResponse(gstXml, '20260201', '20260219');
  assert(r.data.netLiability === 30000, `expected 30000, got ${r.data.netLiability}`);
  assert(r.message.includes('Payable'));
});
test('parse GST empty', () => {
  const r = tdl.parseGstSummaryTdlResponse('<ENVELOPE></ENVELOPE>');
  assert(r.success && r.message.includes('No GST'));
});

// ── Bill Outstanding ──
console.log('\nBill Outstanding:');
const billXml = `<ENVELOPE>
  <BILL NAME="INV-001"><NAME>INV-001</NAME><PARENT>Meril</PARENT><CLOSINGBALANCE>-35000</CLOSINGBALANCE><FINALDUEDATE>20260115</FINALDUEDATE></BILL>
  <BILL NAME="INV-002"><NAME>INV-002</NAME><PARENT>Meril</PARENT><CLOSINGBALANCE>-20000</CLOSINGBALANCE><FINALDUEDATE>20260315</FINALDUEDATE></BILL>
  <BILL NAME="INV-003"><NAME>INV-003</NAME><PARENT>Meril</PARENT><CLOSINGBALANCE>0</CLOSINGBALANCE><FINALDUEDATE>20260101</FINALDUEDATE></BILL>
</ENVELOPE>`;

test('build bill XML', () => {
  const xml = tdl.buildBillOutstandingTdlXml('Meril', 'Co');
  assert(xml.includes('BillList') && xml.includes('PendingBillFilter') && xml.includes('Meril'));
});
test('parse bill entries (filters zero)', () => {
  const r = tdl.parseBillOutstandingTdlResponse(billXml, 'Meril');
  assert(r.success && r.data.bills.length === 2, `expected 2, got ${r.data.bills.length}`);
});
test('parse bill total', () => {
  const r = tdl.parseBillOutstandingTdlResponse(billXml, 'Meril');
  assert(r.data.total === -55000, `expected -55000, got ${r.data.total}`);
});
test('parse bill overdue detection', () => {
  const r = tdl.parseBillOutstandingTdlResponse(billXml, 'Meril');
  // INV-001 due 20260115 is before today (20260219), should be overdue
  assert(r.message.includes('overdue'), 'should detect overdue bill');
});
test('parse bill empty', () => {
  const r = tdl.parseBillOutstandingTdlResponse('<ENVELOPE></ENVELOPE>', 'Meril');
  assert(r.success && r.message.includes('No pending'));
});

// ── Party Invoices ──
console.log('\nParty Invoices:');
const invoiceXml = `<ENVELOPE>
  <VOUCHER REMOTEID="abc" VCHKEY="abc" VCHTYPE="Sales" OBJVIEW="Invoice Voucher View">
    <DATE TYPE="Date">20260215</DATE>
    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <VOUCHERNUMBER>INV-001</VOUCHERNUMBER>
    <PARTYLEDGERNAME TYPE="String">Meril Life Sciences</PARTYLEDGERNAME>
    <AMOUNT TYPE="Amount">-50000</AMOUNT>
    <NARRATION TYPE="String">Feb invoice</NARRATION>
    <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME TYPE="String">Widget A</STOCKITEMNAME>
      <RATE TYPE="Rate">100</RATE>
      <AMOUNT TYPE="Amount">40000</AMOUNT>
      <BILLEDQTY TYPE="Number">400</BILLEDQTY>
    </ALLINVENTORYENTRIES.LIST>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME TYPE="String">Meril Life Sciences</LEDGERNAME>
      <AMOUNT TYPE="Amount">-50000</AMOUNT>
      <ISPARTYLEDGER TYPE="Logical">Yes</ISPARTYLEDGER>
    </LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME TYPE="String">Sales Account</LEDGERNAME>
      <AMOUNT TYPE="Amount">40000</AMOUNT>
      <ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER>
    </LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME TYPE="String">CGST Output</LEDGERNAME>
      <AMOUNT TYPE="Amount">5000</AMOUNT>
      <ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER>
    </LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME TYPE="String">SGST Output</LEDGERNAME>
      <AMOUNT TYPE="Amount">5000</AMOUNT>
      <ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER>
    </LEDGERENTRIES.LIST>
  </VOUCHER>
  <VOUCHER REMOTEID="def" VCHKEY="def" VCHTYPE="Sales" OBJVIEW="Invoice Voucher View">
    <DATE TYPE="Date">20260110</DATE>
    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <VOUCHERNUMBER>INV-002</VOUCHERNUMBER>
    <PARTYLEDGERNAME TYPE="String">Meril Life Sciences</PARTYLEDGERNAME>
    <AMOUNT TYPE="Amount">-30000</AMOUNT>
    <NARRATION TYPE="String">Jan invoice</NARRATION>
    <ALLINVENTORYENTRIES.LIST>     </ALLINVENTORYENTRIES.LIST>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME TYPE="String">Meril Life Sciences</LEDGERNAME>
      <AMOUNT TYPE="Amount">-30000</AMOUNT>
      <ISPARTYLEDGER TYPE="Logical">Yes</ISPARTYLEDGER>
    </LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME TYPE="String">Service Income</LEDGERNAME>
      <AMOUNT TYPE="Amount">30000</AMOUNT>
      <ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER>
    </LEDGERENTRIES.LIST>
  </VOUCHER>
</ENVELOPE>`;

test('build party invoices XML', () => {
  const xml = tdl.buildPartyInvoicesTdlXml('Meril', 'Co', '20260101', '20260228');
  assert(xml.includes('PartyInvoices') && xml.includes('Meril') && xml.includes('SVFROMDATE'));
});
test('build party invoices XML no dates', () => {
  const xml = tdl.buildPartyInvoicesTdlXml('Meril', 'Co');
  assert(xml.includes('PartyInvoices') && !xml.includes('SVFROMDATE'));
});
test('build party invoices XML custom voucher type', () => {
  const xml = tdl.buildPartyInvoicesTdlXml('Meril', 'Co', null, null, 'Purchase');
  assert(xml.includes('"Purchase"'));
});
test('parse party invoices', () => {
  const r = tdl.parsePartyInvoicesTdlResponse(invoiceXml, 'Meril Life Sciences');
  assert(r.success && r.data.invoices.length === 2, `expected 2, got ${r.data.invoices.length}`);
});
test('parse party invoices sorted newest first', () => {
  const r = tdl.parsePartyInvoicesTdlResponse(invoiceXml, 'Meril Life Sciences');
  assert(r.data.invoices[0].number === 'INV-001', 'newest should be first');
  assert(r.data.invoices[1].number === 'INV-002', 'oldest should be second');
});
test('parse party invoices total', () => {
  const r = tdl.parsePartyInvoicesTdlResponse(invoiceXml, 'Meril Life Sciences');
  assert(r.data.total === 80000, `expected 80000, got ${r.data.total}`);
});
test('parse party invoices with inventory items', () => {
  const r = tdl.parsePartyInvoicesTdlResponse(invoiceXml, 'Meril Life Sciences');
  const inv1 = r.data.invoices[0];
  assert(inv1.items.length === 1, `expected 1 item, got ${inv1.items.length}`);
  assert(inv1.items[0].name === 'Widget A');
  assert(inv1.items[0].qty === 400);
});
test('parse party invoices ledger entries (excludes party)', () => {
  const r = tdl.parsePartyInvoicesTdlResponse(invoiceXml, 'Meril Life Sciences');
  const inv1 = r.data.invoices[0];
  assert(inv1.ledgerEntries.length === 3, `expected 3 non-party entries, got ${inv1.ledgerEntries.length}`);
  assert(inv1.ledgerEntries.some(e => e.name === 'CGST Output'), 'should have CGST');
});
test('parse party invoices date filter', () => {
  const r = tdl.parsePartyInvoicesTdlResponse(invoiceXml, 'Meril Life Sciences', '20260201', '20260228');
  assert(r.data.invoices.length === 1, `expected 1 (Feb only), got ${r.data.invoices.length}`);
  assert(r.data.invoices[0].number === 'INV-001');
});
test('parse party invoices empty', () => {
  const r = tdl.parsePartyInvoicesTdlResponse('<ENVELOPE></ENVELOPE>', 'Meril');
  assert(r.success && r.message.includes('No invoices'));
});
test('parse party invoices message format', () => {
  const r = tdl.parsePartyInvoicesTdlResponse(invoiceXml, 'Meril Life Sciences');
  assert(r.message.includes('INV-001') && r.message.includes('INV-002'));
  assert(r.message.includes('Widget A'), 'should show inventory item');
  assert(r.message.includes('CGST Output'), 'should show tax breakup');
});

// ── Invoice PDF ──
console.log('\nInvoice PDF:');
const invoiceDetailXml = `<ENVELOPE>
  <VOUCHER REMOTEID="abc" VCHKEY="abc" VCHTYPE="Sales" OBJVIEW="Invoice Voucher View">
    <DATE TYPE="Date">20260215</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>INV-001</VOUCHERNUMBER>
    <PARTYLEDGERNAME TYPE="String">Meril Life Sciences</PARTYLEDGERNAME><AMOUNT TYPE="Amount">-59000</AMOUNT><NARRATION TYPE="String">Feb invoice</NARRATION>
    <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME TYPE="String">Widget A</STOCKITEMNAME><RATE TYPE="Rate">100</RATE><AMOUNT TYPE="Amount">40000</AMOUNT><BILLEDQTY TYPE="Number">400</BILLEDQTY>
    </ALLINVENTORYENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">Meril Life Sciences</LEDGERNAME><AMOUNT TYPE="Amount">-59000</AMOUNT><ISPARTYLEDGER TYPE="Logical">Yes</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">Sales Account</LEDGERNAME><AMOUNT TYPE="Amount">50000</AMOUNT><ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">CGST Output</LEDGERNAME><AMOUNT TYPE="Amount">4500</AMOUNT><ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">SGST Output</LEDGERNAME><AMOUNT TYPE="Amount">4500</AMOUNT><ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
  </VOUCHER>
</ENVELOPE>`;

const companyInfoXml = `<ENVELOPE><BODY><DATA><COLLECTION>
  <COMPANY NAME="Test Co" RESERVEDNAME="">
    <NAME TYPE="String">Test Co</NAME><BASICCOMPANYFORMALNAME TYPE="String">Test Company Pvt Ltd</BASICCOMPANYFORMALNAME>
    <EMAIL TYPE="String">test@example.com</EMAIL><STATENAME TYPE="String">Gujarat</STATENAME><PINCODE TYPE="String">380001</PINCODE>
    <ADDRESS.LIST TYPE="String"><ADDRESS TYPE="String">123 Main St</ADDRESS><ADDRESS TYPE="String">Ahmedabad</ADDRESS></ADDRESS.LIST>
  </COMPANY>
</COLLECTION></DATA></BODY></ENVELOPE>`;

const partyDetailXml = `<ENVELOPE><BODY><DATA><COLLECTION>
  <LEDGER NAME="Meril Life Sciences" RESERVEDNAME="">
    <ADDRESS.LIST TYPE="String"><ADDRESS TYPE="String">456 Park Ave</ADDRESS><ADDRESS TYPE="String">Mumbai</ADDRESS></ADDRESS.LIST>
    <PARENT TYPE="String">Sundry Debtors</PARENT>
    <LEDGSTREGDETAILS.LIST><GSTIN TYPE="String">24AABCM1234F1Z5</GSTIN></LEDGSTREGDETAILS.LIST>
  </LEDGER>
</COLLECTION></DATA></BODY></ENVELOPE>`;

test('build invoice detail XML', () => {
  const xml = tdl.buildInvoiceDetailTdlXml('INV-001', 'Co');
  assert(xml.includes('InvoiceDetail') && xml.includes('INV-001'));
});
test('parse invoice detail', () => {
  const inv = tdl.parseInvoiceDetailResponse(invoiceDetailXml);
  assert(inv !== null, 'should parse');
  assert(inv.number === 'INV-001');
  assert(inv.party === 'Meril Life Sciences');
  assert(inv.amount === -59000);
  assert(inv.items.length === 1, 'should have 1 item');
  assert(inv.ledgerEntries.length === 4, 'should have 4 ledger entries');
});
test('parse invoice detail empty', () => {
  assert(tdl.parseInvoiceDetailResponse('<ENVELOPE></ENVELOPE>') === null);
});
test('parse company info', () => {
  const co = tdl.parseCompanyInfoResponse(companyInfoXml);
  assert(co.name === 'Test Company Pvt Ltd');
  assert(co.address.length === 2);
  assert(co.email === 'test@example.com');
  assert(co.state === 'Gujarat');
});
test('parse company info empty', () => {
  const co = tdl.parseCompanyInfoResponse('<ENVELOPE></ENVELOPE>');
  assert(co.name === '');
});
test('parse party detail', () => {
  const p = tdl.parsePartyDetailResponse(partyDetailXml);
  assert(p.address.length === 2);
  assert(p.gstin === '24AABCM1234F1Z5');
});
test('parse party detail empty', () => {
  const p = tdl.parsePartyDetailResponse('<ENVELOPE></ENVELOPE>');
  assert(p.name === '');
});
test('generate invoice HTML', () => {
  const inv = tdl.parseInvoiceDetailResponse(invoiceDetailXml);
  const co = tdl.parseCompanyInfoResponse(companyInfoXml);
  const p = tdl.parsePartyDetailResponse(partyDetailXml);
  const html = tdl.generateInvoiceHtml(inv, co, p);
  assert(html.includes('INV-001'), 'should have invoice number');
  assert(html.includes('Meril Life Sciences'), 'should have party name');
  assert(html.includes('Widget A'), 'should have item name');
  assert(html.includes('CGST Output'), 'should have tax entry');
  assert(html.includes('Test Company Pvt Ltd'), 'should have company name');
  assert(html.includes('24AABCM1234F1Z5'), 'should have GSTIN');
  assert(html.includes('Tax Invoice'), 'should have Tax Invoice title');
  assert(html.includes('Authorised Signatory'), 'should have signatory section');
  assert(html.includes('Rupees'), 'should have amount in words');
});

// ── Amount in Words ──
console.log('\nAmount in Words:');
test('amountInWords simple', () => {
  assert(tdl.amountInWords(1000) === 'One Thousand Rupees Only');
});
test('amountInWords lakhs', () => {
  assert(tdl.amountInWords(150000) === 'One Lakh Fifty Thousand Rupees Only');
});
test('amountInWords crores', () => {
  assert(tdl.amountInWords(12345678) === 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only');
});
test('amountInWords with paise', () => {
  const result = tdl.amountInWords(59000.50);
  assert(result.includes('Fifty Nine Thousand') && result.includes('Fifty Paise'), `got: ${result}`);
});
test('amountInWords zero', () => {
  assert(tdl.amountInWords(0) === 'Zero');
});

// ── Tally Manager ──
console.log('\nTally Manager:');

test('parseTallyIni finds install path', () => {
  const ini = tdl.parseTallyIni();
  // On this machine, TallyPrime is at C:\Program Files\TallyPrime
  assert(ini.installPath !== null, 'installPath should not be null');
  assert(ini.dataPath !== null, 'dataPath should not be null');
  assert(ini.port === 9000, `expected port 9000, got ${ini.port}`);
});

test('parseTallyIni finds exePath', () => {
  const ini = tdl.parseTallyIni();
  assert(ini.exePath !== null && ini.exePath.includes('tally.exe'), 'exePath should contain tally.exe');
});

test('scanDataFolder finds companies', () => {
  const ini = tdl.parseTallyIni();
  if (ini.dataPath) {
    const companies = tdl.scanDataFolder(ini.dataPath);
    assert(companies.length > 0, 'should find at least one company folder');
    assert(companies[0].id && companies[0].folderPath, 'company should have id and folderPath');
  }
});

test('extractCompanyName reads name from binary file', () => {
  const ini = tdl.parseTallyIni();
  if (ini.dataPath) {
    const fs = require('fs');
    const path = require('path');
    // Find a Company.1800 file
    const dirs = fs.readdirSync(ini.dataPath, { withFileTypes: true }).filter(d => d.isDirectory());
    let found = false;
    for (const d of dirs) {
      const compFile = path.join(ini.dataPath, d.name, 'Company.1800');
      if (fs.existsSync(compFile)) {
        const name = tdl.extractCompanyName(compFile);
        assert(name && name.length >= 4, 'should extract a company name, got: ' + name);
        found = true;
        break;
      }
    }
    assert(found, 'should find at least one Company.1800 file');
  }
});

test('scanDataFolder returns names from binary files', () => {
  const ini = tdl.parseTallyIni();
  if (ini.dataPath) {
    const companies = tdl.scanDataFolder(ini.dataPath);
    const withNames = companies.filter(c => c.name);
    assert(withNames.length > 0, 'at least one company should have a name from binary extraction');
  }
});

test('buildListCompaniesTdlXml', () => {
  const xml = tdl.buildListCompaniesTdlXml();
  assert(xml.includes('CompanyList') && xml.includes('Company'));
});

test('parseListCompaniesTdlResponse', () => {
  const xml = `<ENVELOPE><BODY><DATA><COLLECTION>
    <COMPANY NAME="Test Co" RESERVEDNAME="">
      <STARTINGFROM TYPE="Date">20240401</STARTINGFROM>
      <BOOKSFROM TYPE="Date">20240401</BOOKSFROM>
      <NAME TYPE="String">Test Co</NAME>
    </COMPANY>
    <COMPANY NAME="Another Co" RESERVEDNAME="">
      <STARTINGFROM TYPE="Date">20230401</STARTINGFROM>
      <BOOKSFROM TYPE="Date">20230401</BOOKSFROM>
      <NAME TYPE="String">Another Co</NAME>
    </COMPANY>
  </COLLECTION></DATA></BODY></ENVELOPE>`;
  const companies = tdl.parseListCompaniesTdlResponse(xml);
  assert(companies.length === 2, `expected 2, got ${companies.length}`);
  assert(companies[0].name === 'Test Co');
  assert(companies[1].startingFrom === '20230401');
});

test('parseListCompaniesTdlResponse empty', () => {
  const companies = tdl.parseListCompaniesTdlResponse('<ENVELOPE></ENVELOPE>');
  assert(companies.length === 0);
});

test('isTallyRunning returns object', () => {
  const status = tdl.isTallyRunning();
  assert(typeof status.running === 'boolean', 'running should be boolean');
  assert(status.running === true || status.running === false);
});

// ── Top Reports ──
console.log('\nTop Reports:');
const topVouchersXml = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260201</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S1</VOUCHERNUMBER><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget A</STOCKITEMNAME><RATE>100</RATE><AMOUNT>30000</AMOUNT><BILLEDQTY>300</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget B</STOCKITEMNAME><RATE>200</RATE><AMOUNT>20000</AMOUNT><BILLEDQTY>100</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260205</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S2</VOUCHERNUMBER><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-30000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget A</STOCKITEMNAME><RATE>100</RATE><AMOUNT>30000</AMOUNT><BILLEDQTY>300</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260210</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S3</VOUCHERNUMBER><PARTYLEDGERNAME>Customer B</PARTYLEDGERNAME><AMOUNT>-20000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget B</STOCKITEMNAME><RATE>200</RATE><AMOUNT>20000</AMOUNT><BILLEDQTY>100</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260115</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S4</VOUCHERNUMBER><PARTYLEDGERNAME>Customer C</PARTYLEDGERNAME><AMOUNT>-10000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget C</STOCKITEMNAME><RATE>50</RATE><AMOUNT>10000</AMOUNT><BILLEDQTY>200</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
</ENVELOPE>`;

test('build top report XML sales', () => {
  const xml = tdl.buildTopReportTdlXml('Co', 'sales', '20260201', '20260228');
  assert(xml.includes('TopReportVouchers') && xml.includes('"Sales"'));
});
test('build top report XML purchase', () => {
  const xml = tdl.buildTopReportTdlXml('Co', 'purchase');
  assert(xml.includes('"Purchase"'));
});
test('parse top parties all', () => {
  const r = tdl.parseTopPartiesResponse(topVouchersXml, 'sales', 10);
  assert(r.success && r.data.entries.length === 3, `expected 3, got ${r.data.entries.length}`);
});
test('parse top parties sorted by total desc', () => {
  const r = tdl.parseTopPartiesResponse(topVouchersXml, 'sales', 10);
  assert(r.data.entries[0].name === 'Customer A', `expected Customer A first, got ${r.data.entries[0].name}`);
  assert(r.data.entries[0].total === 80000, `expected 80000, got ${r.data.entries[0].total}`);
});
test('parse top parties with limit', () => {
  const r = tdl.parseTopPartiesResponse(topVouchersXml, 'sales', 2);
  assert(r.data.entries.length === 2, `expected 2, got ${r.data.entries.length}`);
});
test('parse top parties date filter', () => {
  const r = tdl.parseTopPartiesResponse(topVouchersXml, 'sales', 10, '20260201', '20260228');
  assert(r.data.entries.length === 2, `expected 2 (Feb only), got ${r.data.entries.length}`);
});
test('parse top parties empty', () => {
  const r = tdl.parseTopPartiesResponse('<ENVELOPE></ENVELOPE>', 'sales', 10);
  assert(r.success && r.message.includes('No customers'));
});
test('parse top parties percentage', () => {
  const r = tdl.parseTopPartiesResponse(topVouchersXml, 'sales', 10);
  assert(r.message.includes('%'), 'should show percentage');
});
test('parse top items all', () => {
  const r = tdl.parseTopItemsResponse(topVouchersXml, 'sales', 10);
  assert(r.success && r.data.entries.length === 3, `expected 3 items, got ${r.data.entries.length}`);
});
test('parse top items sorted by value', () => {
  const r = tdl.parseTopItemsResponse(topVouchersXml, 'sales', 10);
  assert(r.data.entries[0].name === 'Widget A', `expected Widget A first, got ${r.data.entries[0].name}`);
  assert(r.data.entries[0].total === 60000, `expected 60000, got ${r.data.entries[0].total}`);
});
test('parse top items with limit', () => {
  const r = tdl.parseTopItemsResponse(topVouchersXml, 'sales', 2);
  assert(r.data.entries.length === 2);
});
test('parse top items date filter', () => {
  const r = tdl.parseTopItemsResponse(topVouchersXml, 'sales', 10, '20260201', '20260228');
  assert(r.data.entries.length === 2, `expected 2 (Feb only, Widget A + B), got ${r.data.entries.length}`);
});
test('parse top items qty aggregation', () => {
  const r = tdl.parseTopItemsResponse(topVouchersXml, 'sales', 10);
  const widgetA = r.data.entries.find(e => e.name === 'Widget A');
  assert(widgetA.qty === 600, `expected qty 600, got ${widgetA.qty}`);
  assert(widgetA.count === 2, `expected 2 txns, got ${widgetA.count}`);
});
test('parse top items empty', () => {
  const r = tdl.parseTopItemsResponse('<ENVELOPE></ENVELOPE>', 'sales', 10);
  assert(r.success && r.message.includes('No items'));
});

// ── Trial Balance ──
console.log('\nTrial Balance:');
const tbXml = `<ENVELOPE>
  <GROUP NAME="Capital Account"><NAME>Capital Account</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>-100000</OPENINGBALANCE><CLOSINGBALANCE>-150000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Current Assets"><NAME>Current Assets</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>200000</OPENINGBALANCE><CLOSINGBALANCE>300000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Current Liabilities"><NAME>Current Liabilities</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>-50000</OPENINGBALANCE><CLOSINGBALANCE>-80000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Fixed Assets"><NAME>Fixed Assets</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>50000</OPENINGBALANCE><CLOSINGBALANCE>60000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Sales Accounts"><NAME>Sales Accounts</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>-200000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Direct Expenses"><NAME>Direct Expenses</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>70000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Sub Group"><NAME>Sub Group</NAME><PARENT>Current Assets</PARENT><OPENINGBALANCE>10000</OPENINGBALANCE><CLOSINGBALANCE>15000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

test('build trial balance XML default FY', () => {
  const xml = tdl.buildTrialBalanceTdlXml('Co');
  assert(xml.includes('TrialBalGroups') && !xml.includes('SVFROMDATE'));
});
test('build trial balance XML with dates', () => {
  const xml = tdl.buildTrialBalanceTdlXml('Co', '20250401', '20260331');
  assert(xml.includes('SVFROMDATE') && xml.includes('20250401'));
});
test('parse trial balance filters top-level only', () => {
  const r = tdl.parseTrialBalanceTdlResponse(tbXml);
  assert(r.success);
  // Sub Group has parent "Current Assets" so should be excluded
  const names = r.data.groups.map(g => g.name);
  assert(!names.includes('Sub Group'), 'should exclude sub-groups');
  assert(r.data.groups.length === 6, `expected 6 top-level groups, got ${r.data.groups.length}`);
});
test('parse trial balance debit/credit totals', () => {
  const r = tdl.parseTrialBalanceTdlResponse(tbXml);
  // Debit (positive): Current Assets 300000 + Fixed Assets 60000 + Direct Expenses 70000 = 430000
  assert(r.data.totalDebit === 430000, `expected debit 430000, got ${r.data.totalDebit}`);
  // Credit (negative): Capital Account 150000 + Current Liabilities 80000 + Sales Accounts 200000 = 430000
  assert(r.data.totalCredit === 430000, `expected credit 430000, got ${r.data.totalCredit}`);
});
test('parse trial balance balanced message', () => {
  const r = tdl.parseTrialBalanceTdlResponse(tbXml);
  assert(r.message.includes('Balanced'), 'should show balanced when debit = credit');
});
test('parse trial balance unbalanced', () => {
  const unbalXml = `<ENVELOPE>
    <GROUP NAME="Current Assets"><NAME>Current Assets</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>100000</CLOSINGBALANCE></GROUP>
    <GROUP NAME="Capital Account"><NAME>Capital Account</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>-80000</CLOSINGBALANCE></GROUP>
  </ENVELOPE>`;
  const r = tdl.parseTrialBalanceTdlResponse(unbalXml);
  assert(r.message.includes('Difference'), 'should show difference when unbalanced');
  assert(r.data.difference === 20000, `expected diff 20000, got ${r.data.difference}`);
});
test('parse trial balance empty', () => {
  const r = tdl.parseTrialBalanceTdlResponse('<ENVELOPE></ENVELOPE>');
  assert(r.success && r.message.includes('No Trial Balance'));
});

// ── Balance Sheet ──
console.log('\nBalance Sheet:');
const bsXml = `<ENVELOPE>
  <GROUP NAME="Capital Account"><NAME>Capital Account</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-500000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Current Assets"><NAME>Current Assets</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>300000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Current Liabilities"><NAME>Current Liabilities</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-100000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Fixed Assets"><NAME>Fixed Assets</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>250000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Investments"><NAME>Investments</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>50000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Sales Accounts"><NAME>Sales Accounts</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-800000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Direct Expenses"><NAME>Direct Expenses</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>400000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Indirect Expenses"><NAME>Indirect Expenses</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>200000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Sub Group"><NAME>Sub Group</NAME><PARENT>Current Assets</PARENT><CLOSINGBALANCE>50000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

test('build balance sheet XML default FY', () => {
  const xml = tdl.buildBalanceSheetTdlXml('Co');
  assert(xml.includes('BSGroups') && !xml.includes('SVFROMDATE'));
});
test('build balance sheet XML with dates', () => {
  const xml = tdl.buildBalanceSheetTdlXml('Co', '20250401', '20260331');
  assert(xml.includes('SVFROMDATE'));
});
test('parse balance sheet excludes P&L groups', () => {
  const r = tdl.parseBalanceSheetTdlResponse(bsXml);
  assert(r.success);
  const allNames = [...r.data.assets.map(a => a.name), ...r.data.liabilities.map(l => l.name)];
  assert(!allNames.includes('Sales Accounts'), 'should exclude Sales Accounts');
  assert(!allNames.includes('Direct Expenses'), 'should exclude Direct Expenses');
  assert(!allNames.includes('Indirect Expenses'), 'should exclude Indirect Expenses');
  assert(!allNames.includes('Sub Group'), 'should exclude sub-groups');
});
test('parse balance sheet assets', () => {
  const r = tdl.parseBalanceSheetTdlResponse(bsXml);
  const assetNames = r.data.assets.map(a => a.name);
  assert(assetNames.includes('Current Assets'), 'should have Current Assets');
  assert(assetNames.includes('Fixed Assets'), 'should have Fixed Assets');
  assert(assetNames.includes('Investments'), 'should have Investments');
  assert(r.data.totalAssets === 600000, `expected 600000, got ${r.data.totalAssets}`);
});
test('parse balance sheet liabilities', () => {
  const r = tdl.parseBalanceSheetTdlResponse(bsXml);
  const liabNames = r.data.liabilities.map(l => l.name);
  assert(liabNames.includes('Capital Account'), 'should have Capital Account');
  assert(liabNames.includes('Current Liabilities'), 'should have Current Liabilities');
  assert(r.data.totalLiabilities === 600000, `expected 600000, got ${r.data.totalLiabilities}`);
});
test('parse balance sheet balanced', () => {
  const r = tdl.parseBalanceSheetTdlResponse(bsXml);
  assert(r.message.includes('Balanced'), 'should show balanced');
});
test('parse balance sheet empty', () => {
  const r = tdl.parseBalanceSheetTdlResponse('<ENVELOPE></ENVELOPE>');
  assert(r.success && r.message.includes('No Balance Sheet'));
});

// ── Ageing Analysis ──
console.log('\nAgeing Analysis:');
// Create bills with various due dates relative to "today"
const today = new Date();
const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return fmt(d); };

const ageingXml = `<ENVELOPE>
  <BILL NAME="INV-001"><NAME>INV-001</NAME><PARENT>Party A</PARENT><CLOSINGBALANCE>-10000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(10)}</FINALDUEDATE></BILL>
  <BILL NAME="INV-002"><NAME>INV-002</NAME><PARENT>Party A</PARENT><CLOSINGBALANCE>-20000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(45)}</FINALDUEDATE></BILL>
  <BILL NAME="INV-003"><NAME>INV-003</NAME><PARENT>Party B</PARENT><CLOSINGBALANCE>-15000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(75)}</FINALDUEDATE></BILL>
  <BILL NAME="INV-004"><NAME>INV-004</NAME><PARENT>Party C</PARENT><CLOSINGBALANCE>-50000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(120)}</FINALDUEDATE></BILL>
  <BILL NAME="INV-005"><NAME>INV-005</NAME><PARENT>Party C</PARENT><CLOSINGBALANCE>0</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(5)}</FINALDUEDATE></BILL>
</ENVELOPE>`;

test('build ageing XML', () => {
  const xml = tdl.buildAgeingAnalysisTdlXml('Sundry Debtors', 'Co');
  assert(xml.includes('AgeingBills') && xml.includes('AgeingNonZeroFilter'));
});
test('parse ageing filters zero balance', () => {
  const r = tdl.parseAgeingAnalysisTdlResponse(ageingXml, 'Sundry Debtors');
  assert(r.success && r.data.totalBills === 4, `expected 4 bills, got ${r.data.totalBills}`);
});
test('parse ageing buckets', () => {
  const r = tdl.parseAgeingAnalysisTdlResponse(ageingXml, 'Sundry Debtors');
  const buckets = r.data.buckets;
  // INV-001: 10 days → 0-30 bucket (10000)
  assert(buckets[0].amount === 10000, `0-30 bucket: expected 10000, got ${buckets[0].amount}`);
  // INV-002: 45 days → 31-60 bucket (20000)
  assert(buckets[1].amount === 20000, `31-60 bucket: expected 20000, got ${buckets[1].amount}`);
  // INV-003: 75 days → 61-90 bucket (15000)
  assert(buckets[2].amount === 15000, `61-90 bucket: expected 15000, got ${buckets[2].amount}`);
  // INV-004: 120 days → 90+ bucket (50000)
  assert(buckets[3].amount === 50000, `90+ bucket: expected 50000, got ${buckets[3].amount}`);
});
test('parse ageing total outstanding', () => {
  const r = tdl.parseAgeingAnalysisTdlResponse(ageingXml, 'Sundry Debtors');
  assert(r.data.totalOutstanding === 95000, `expected 95000, got ${r.data.totalOutstanding}`);
});
test('parse ageing parties aggregation', () => {
  const r = tdl.parseAgeingAnalysisTdlResponse(ageingXml, 'Sundry Debtors');
  assert(r.data.parties.length === 3, `expected 3 parties, got ${r.data.parties.length}`);
  // Party C should be first (highest total: 50000)
  assert(r.data.parties[0].name === 'Party C', `expected Party C first, got ${r.data.parties[0].name}`);
  assert(r.data.parties[0].total === 50000, `expected 50000, got ${r.data.parties[0].total}`);
});
test('parse ageing oldest days tracking', () => {
  const r = tdl.parseAgeingAnalysisTdlResponse(ageingXml, 'Sundry Debtors');
  const partyC = r.data.parties.find(p => p.name === 'Party C');
  assert(partyC.oldestDays === 120, `expected 120 days, got ${partyC.oldestDays}`);
});
test('parse ageing receivable label', () => {
  const r = tdl.parseAgeingAnalysisTdlResponse(ageingXml, 'Sundry Debtors');
  assert(r.message.includes('Receivable'), 'should show Receivable for Sundry Debtors');
});
test('parse ageing payable label', () => {
  const r = tdl.parseAgeingAnalysisTdlResponse(ageingXml, 'Sundry Creditors');
  assert(r.message.includes('Payable'), 'should show Payable for Sundry Creditors');
});
test('parse ageing empty', () => {
  const r = tdl.parseAgeingAnalysisTdlResponse('<ENVELOPE></ENVELOPE>', 'Sundry Debtors');
  assert(r.success && r.message.includes('No pending'));
});
test('parse ageing warning for 90+ days', () => {
  const r = tdl.parseAgeingAnalysisTdlResponse(ageingXml, 'Sundry Debtors');
  assert(r.message.includes('⚠️'), 'should show warning for 90+ day parties');
});

// ── Invoice PDF Bank Details ──
console.log('\nInvoice PDF Bank Details:');
test('parseCompanyInfoResponse extracts bank details', () => {
  const xmlWithBank = `<ENVELOPE><BODY><DATA><COLLECTION>
    <COMPANY NAME="Test Co" RESERVEDNAME="">
      <NAME TYPE="String">Test Co</NAME><BASICCOMPANYFORMALNAME TYPE="String">Test Company Pvt Ltd</BASICCOMPANYFORMALNAME>
      <EMAIL TYPE="String">test@example.com</EMAIL><STATENAME TYPE="String">Gujarat</STATENAME>
      <ADDRESS.LIST TYPE="String"><ADDRESS TYPE="String">123 Main St</ADDRESS></ADDRESS.LIST>
      <BANKNAME TYPE="String">HDFC Bank</BANKNAME>
      <ACCOUNTNUMBER TYPE="String">12345678901234</ACCOUNTNUMBER>
      <IFSCCODE TYPE="String">HDFC0001234</IFSCCODE>
      <BANKBRANCHNAME TYPE="String">Ahmedabad Main</BANKBRANCHNAME>
    </COMPANY>
  </COLLECTION></DATA></BODY></ENVELOPE>`;
  const co = tdl.parseCompanyInfoResponse(xmlWithBank);
  assert(co.bankName === 'HDFC Bank', `expected HDFC Bank, got ${co.bankName}`);
  assert(co.accountNumber === '12345678901234', `expected 12345678901234, got ${co.accountNumber}`);
  assert(co.ifscCode === 'HDFC0001234', `expected HDFC0001234, got ${co.ifscCode}`);
  assert(co.bankBranch === 'Ahmedabad Main', `expected Ahmedabad Main, got ${co.bankBranch}`);
});
test('parseCompanyInfoResponse handles missing bank details', () => {
  const xmlNoBank = `<ENVELOPE><BODY><DATA><COLLECTION>
    <COMPANY NAME="Test Co" RESERVEDNAME="">
      <NAME TYPE="String">Test Co</NAME><BASICCOMPANYFORMALNAME TYPE="String">Test Company Pvt Ltd</BASICCOMPANYFORMALNAME>
    </COMPANY>
  </COLLECTION></DATA></BODY></ENVELOPE>`;
  const co = tdl.parseCompanyInfoResponse(xmlNoBank);
  assert(co.bankName === '', 'bankName should be empty');
  assert(co.accountNumber === '', 'accountNumber should be empty');
});
test('generateInvoiceHtml includes bank details when present', () => {
  const inv = { date: '20260215', number: 'INV-001', type: 'Sales', party: 'Test Party', amount: -10000, narration: '', items: [], ledgerEntries: [{ name: 'Sales', amount: 10000, isParty: false }] };
  const co = { name: 'Test Co', address: [], email: '', state: '', pincode: '', gstin: '', phone: '', bankName: 'HDFC Bank', accountNumber: '1234567890', ifscCode: 'HDFC0001234', bankBranch: 'Main Branch' };
  const party = { name: 'Test Party', address: [], gstin: '', state: '', phone: '', email: '' };
  const html = tdl.generateInvoiceHtml(inv, co, party);
  assert(html.includes('HDFC Bank'), 'should include bank name');
  assert(html.includes('1234567890'), 'should include account number');
  assert(html.includes('HDFC0001234'), 'should include IFSC code');
  assert(html.includes('Main Branch'), 'should include branch name');
  assert(html.includes('Bank Details'), 'should have Bank Details label');
});
test('generateInvoiceHtml omits bank section when no bank details', () => {
  const inv = { date: '20260215', number: 'INV-002', type: 'Sales', party: 'Test', amount: -5000, narration: '', items: [], ledgerEntries: [{ name: 'Sales', amount: 5000, isParty: false }] };
  const co = { name: 'Test Co', address: [], email: '', state: '', pincode: '', gstin: '', phone: '', bankName: '', accountNumber: '', ifscCode: '', bankBranch: '' };
  const party = { name: 'Test', address: [], gstin: '', state: '', phone: '', email: '' };
  const html = tdl.generateInvoiceHtml(inv, co, party);
  assert(!html.includes('Bank Details'), 'should NOT have Bank Details when empty');
});

// ── Inactive Reports ──
console.log('\nInactive Reports:');
const inactiveVouchersXml = (() => {
  const now = new Date();
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const ago = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return fmt(d); };
  return `<ENVELOPE>
    <VOUCHER VCHTYPE="Sales"><DATE>${ago(5)}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Active Customer</PARTYLEDGERNAME><AMOUNT>-10000</AMOUNT>
      <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Active Item</STOCKITEMNAME><AMOUNT>10000</AMOUNT></ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
    <VOUCHER VCHTYPE="Sales"><DATE>${ago(60)}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Dormant Customer</PARTYLEDGERNAME><AMOUNT>-20000</AMOUNT>
      <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Slow Item</STOCKITEMNAME><AMOUNT>20000</AMOUNT></ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
    <VOUCHER VCHTYPE="Sales"><DATE>${ago(100)}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Very Old Customer</PARTYLEDGERNAME><AMOUNT>-5000</AMOUNT>
      <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Dead Item</STOCKITEMNAME><AMOUNT>5000</AMOUNT></ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
  </ENVELOPE>`;
})();

test('build inactive report XML', () => {
  const xml = tdl.buildInactiveReportTdlXml('Co', 'sales');
  assert(xml.includes('InactiveReportVouchers') && xml.includes('"Sales"'));
});
test('parse inactive parties 30 days', () => {
  const r = tdl.parseInactivePartiesResponse(inactiveVouchersXml, 'sales', 30);
  assert(r.success);
  // Active Customer (5 days ago) should NOT be inactive
  // Dormant (60 days) and Very Old (100 days) should be inactive
  assert(r.data.entries.length === 2, `expected 2 inactive, got ${r.data.entries.length}`);
});
test('parse inactive parties 90 days', () => {
  const r = tdl.parseInactivePartiesResponse(inactiveVouchersXml, 'sales', 90);
  // Only Very Old Customer (100 days) should be inactive
  assert(r.data.entries.length === 1, `expected 1 inactive, got ${r.data.entries.length}`);
  assert(r.data.entries[0].name === 'Very Old Customer');
});
test('parse inactive parties all active', () => {
  const r = tdl.parseInactivePartiesResponse(inactiveVouchersXml, 'sales', 365);
  assert(r.data.entries.length === 0, 'all should be active within 365 days');
  assert(r.message.includes('active'), 'should say all active');
});
test('parse inactive parties empty', () => {
  const r = tdl.parseInactivePartiesResponse('<ENVELOPE></ENVELOPE>', 'sales', 30);
  assert(r.data.entries.length === 0);
});
test('parse inactive items 30 days', () => {
  const r = tdl.parseInactiveItemsResponse(inactiveVouchersXml, 'sales', 30);
  assert(r.success);
  assert(r.data.entries.length === 2, `expected 2 inactive items, got ${r.data.entries.length}`);
});
test('parse inactive items 90 days', () => {
  const r = tdl.parseInactiveItemsResponse(inactiveVouchersXml, 'sales', 90);
  assert(r.data.entries.length === 1, `expected 1 inactive item, got ${r.data.entries.length}`);
  assert(r.data.entries[0].name === 'Dead Item');
});
test('parse inactive items empty', () => {
  const r = tdl.parseInactiveItemsResponse('<ENVELOPE></ENVELOPE>', 'sales', 30);
  assert(r.data.entries.length === 0);
});

// ── Excel Export ──
console.log('\nExcel Export:');
test('generateExcelBuffer creates buffer', async () => {
  const buf = await tdl.generateExcelBuffer('Test', ['Name', 'Amount'], [['A', 100], ['B', 200]], { totalsRow: ['Total', 300] });
  assert(Buffer.isBuffer(buf), 'should return Buffer');
  assert(buf.length > 100, 'buffer should have content');
});
test('reportToExcel outstanding entries', async () => {
  const data = { entries: [{ name: 'Party A', closingBalance: -25000 }, { name: 'Party B', closingBalance: -10000 }] };
  const result = await tdl.reportToExcel('Outstanding', data);
  assert(result !== null, 'should produce result');
  assert(result.filename === 'Outstanding.xlsx');
  assert(Buffer.isBuffer(result.buffer));
});
test('reportToExcel stock items', async () => {
  const data = { items: [{ name: 'Widget', qty: 100, unit: 'Nos', rate: 50, closingValue: 5000 }] };
  const result = await tdl.reportToExcel('Stock', data);
  assert(result !== null && result.filename === 'Stock.xlsx');
});
test('reportToExcel groups (trial balance)', async () => {
  const data = { groups: [{ name: 'Assets', closing: 100000 }] };
  const result = await tdl.reportToExcel('Trial Balance', data);
  assert(result !== null && result.filename === 'Trial Balance.xlsx');
});
test('reportToExcel bills', async () => {
  const data = { bills: [{ name: 'INV-001', closingBalance: -35000, dueDate: '20260115' }] };
  const result = await tdl.reportToExcel('Bills', data);
  assert(result !== null && result.filename === 'Bills.xlsx');
});
test('reportToExcel ageing buckets', async () => {
  const data = { buckets: [{ label: '0-30', amount: 10000, count: 5 }], totalOutstanding: 10000, totalBills: 5 };
  const result = await tdl.reportToExcel('Ageing', data);
  assert(result !== null && result.filename === 'Ageing.xlsx');
});
test('reportToExcel returns null for unknown shape', async () => {
  const result = await tdl.reportToExcel('Unknown', { foo: 'bar' });
  assert(result === null, 'should return null for unknown data shape');
});

// ── Order Tracking ──
console.log('\nOrder Tracking:');
const orderXml = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales Order"><DATE>20260210</DATE><VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME><VOUCHERNUMBER>SO-001</VOUCHERNUMBER><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT><NARRATION>Feb order</NARRATION>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget A</STOCKITEMNAME><RATE>100</RATE><AMOUNT>50000</AMOUNT><BILLEDQTY>500</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales Order"><DATE>20260215</DATE><VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME><VOUCHERNUMBER>SO-002</VOUCHERNUMBER><PARTYLEDGERNAME>Customer B</PARTYLEDGERNAME><AMOUNT>-30000</AMOUNT><NARRATION>Feb order 2</NARRATION>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget B</STOCKITEMNAME><RATE>200</RATE><AMOUNT>30000</AMOUNT><BILLEDQTY>150</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales Order"><DATE>20260105</DATE><VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME><VOUCHERNUMBER>SO-003</VOUCHERNUMBER><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-20000</AMOUNT><NARRATION>Jan order</NARRATION></VOUCHER>
</ENVELOPE>`;

test('build order tracking XML sales', () => {
  const xml = tdl.buildOrderTrackingTdlXml('Co', 'sales');
  assert(xml.includes('OrderTrackingVouchers') && xml.includes('Sales Order'));
});
test('build order tracking XML purchase', () => {
  const xml = tdl.buildOrderTrackingTdlXml('Co', 'purchase');
  assert(xml.includes('Purchase Order'));
});
test('parse orders all', () => {
  const r = tdl.parseOrderTrackingResponse(orderXml, 'sales');
  assert(r.success && r.data.orders.length === 3, `expected 3, got ${r.data.orders.length}`);
});
test('parse orders sorted newest first', () => {
  const r = tdl.parseOrderTrackingResponse(orderXml, 'sales');
  assert(r.data.orders[0].number === 'SO-002', 'newest should be first');
});
test('parse orders date filter', () => {
  const r = tdl.parseOrderTrackingResponse(orderXml, 'sales', '20260201', '20260228');
  assert(r.data.orders.length === 2, `expected 2 (Feb only), got ${r.data.orders.length}`);
});
test('parse orders with items', () => {
  const r = tdl.parseOrderTrackingResponse(orderXml, 'sales');
  const so1 = r.data.orders.find(o => o.number === 'SO-001');
  assert(so1.items.length === 1 && so1.items[0].name === 'Widget A');
});
test('parse orders total', () => {
  const r = tdl.parseOrderTrackingResponse(orderXml, 'sales');
  assert(r.data.total === 100000, `expected 100000, got ${r.data.total}`);
});
test('parse orders empty', () => {
  const r = tdl.parseOrderTrackingResponse('<ENVELOPE></ENVELOPE>', 'sales');
  assert(r.success && r.message.includes('No sales'));
});
test('compute pending orders', () => {
  const ordersData = tdl.parseOrderTrackingResponse(orderXml, 'sales');
  // Customer A ordered 70000, invoiced 50000 → pending 20000
  // Customer B ordered 30000, invoiced 30000 → fulfilled
  const invoiceXml = `<ENVELOPE>
    <VOUCHER VCHTYPE="Sales"><DATE>20260212</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT></VOUCHER>
    <VOUCHER VCHTYPE="Sales"><DATE>20260216</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Customer B</PARTYLEDGERNAME><AMOUNT>-30000</AMOUNT></VOUCHER>
  </ENVELOPE>`;
  const r = tdl.computePendingOrders(ordersData.data, invoiceXml, 'sales');
  assert(r.success);
  assert(r.data.pending.length === 1, `expected 1 pending party, got ${r.data.pending.length}`);
  assert(r.data.pending[0].party === 'Customer A');
  assert(r.data.pending[0].pending === 20000, `expected 20000 pending, got ${r.data.pending[0].pending}`);
});
test('compute pending orders all fulfilled', () => {
  const ordersData = tdl.parseOrderTrackingResponse(orderXml, 'sales');
  const invoiceXml = `<ENVELOPE>
    <VOUCHER VCHTYPE="Sales"><DATE>20260212</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><AMOUNT>-70000</AMOUNT></VOUCHER>
    <VOUCHER VCHTYPE="Sales"><DATE>20260216</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Customer B</PARTYLEDGERNAME><AMOUNT>-30000</AMOUNT></VOUCHER>
  </ENVELOPE>`;
  const r = tdl.computePendingOrders(ordersData.data, invoiceXml, 'sales');
  assert(r.data.pending.length === 0, 'all should be fulfilled');
  assert(r.message.includes('fully fulfilled'));
});
test('build voucher type counts XML', () => {
  const xml = tdl.buildVoucherTypeCountsTdlXml('Co');
  assert(xml.includes('VchTypeCounts') && xml.includes('VoucherTypeName'));
});
test('parse voucher type counts', () => {
  const xml = `<ENVELOPE>
    <VOUCHER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME></VOUCHER>
    <VOUCHER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME></VOUCHER>
    <VOUCHER><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME></VOUCHER>
    <VOUCHER><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME></VOUCHER>
    <VOUCHER><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME></VOUCHER>
    <VOUCHER><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME></VOUCHER>
  </ENVELOPE>`;
  const counts = tdl.parseVoucherTypeCountsResponse(xml);
  assert(counts.length === 3, `expected 3 types, got ${counts.length}`);
  assert(counts[0].name === 'Payment' && counts[0].count === 3, 'Payment should be first with 3');
  assert(counts[1].name === 'Sales' && counts[1].count === 2, 'Sales should be second with 2');
});
test('parse voucher type counts empty', () => {
  const counts = tdl.parseVoucherTypeCountsResponse('<ENVELOPE></ENVELOPE>');
  assert(counts.length === 0);
});
test('build order tracking XML with custom voucher type', () => {
  const xml = tdl.buildOrderTrackingTdlXml('Co', 'Payment');
  assert(xml.includes('"Payment"'), 'should use custom type name');
});

// ── Payment Reminders ──
console.log('\nPayment Reminders:');
const overdueBillsXml = (() => {
  const now = new Date();
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const ago = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return fmt(d); };
  const future = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return fmt(d); };
  return `<ENVELOPE>
    <BILL NAME="INV-001"><NAME>INV-001</NAME><PARENT>Party A</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE><FINALDUEDATE>${ago(30)}</FINALDUEDATE></BILL>
    <BILL NAME="INV-002"><NAME>INV-002</NAME><PARENT>Party A</PARENT><CLOSINGBALANCE>-15000</CLOSINGBALANCE><FINALDUEDATE>${ago(10)}</FINALDUEDATE></BILL>
    <BILL NAME="INV-003"><NAME>INV-003</NAME><PARENT>Party B</PARENT><CLOSINGBALANCE>-50000</CLOSINGBALANCE><FINALDUEDATE>${ago(60)}</FINALDUEDATE></BILL>
    <BILL NAME="INV-004"><NAME>INV-004</NAME><PARENT>Party C</PARENT><CLOSINGBALANCE>-10000</CLOSINGBALANCE><FINALDUEDATE>${future(10)}</FINALDUEDATE></BILL>
    <BILL NAME="INV-005"><NAME>INV-005</NAME><PARENT>Party D</PARENT><CLOSINGBALANCE>0</CLOSINGBALANCE><FINALDUEDATE>${ago(5)}</FINALDUEDATE></BILL>
  </ENVELOPE>`;
})();

test('build overdue bills XML', () => {
  const xml = tdl.buildOverdueBillsTdlXml('Co');
  assert(xml.includes('OverdueBills'));
});
test('build party contacts XML', () => {
  const xml = tdl.buildPartyContactsTdlXml('Co');
  assert(xml.includes('PartyContacts') && xml.includes('Sundry Debtors'));
});
test('parse overdue bills filters future and zero', () => {
  const { bills, parties } = tdl.parseOverdueBillsResponse(overdueBillsXml);
  // INV-004 is future, INV-005 is zero → should be excluded
  assert(bills.length === 3, `expected 3 overdue bills, got ${bills.length}`);
  assert(parties.length === 2, `expected 2 parties, got ${parties.length}`);
});
test('parse overdue bills sorted by total', () => {
  const { parties } = tdl.parseOverdueBillsResponse(overdueBillsXml);
  assert(parties[0].name === 'Party B', `expected Party B first (50000), got ${parties[0].name}`);
});
test('parse party contacts', () => {
  const contactsXml = `<ENVELOPE>
    <LEDGER NAME="Party A"><NAME>Party A</NAME><LEDGERMOBILE>9876543210</LEDGERMOBILE><EMAIL>a@test.com</EMAIL><LEDGERCONTACT>Mr A</LEDGERCONTACT></LEDGER>
    <LEDGER NAME="Party B"><NAME>Party B</NAME><LEDGERPHONE>0221234567</LEDGERPHONE></LEDGER>
  </ENVELOPE>`;
  const contacts = tdl.parsePartyContactsResponse(contactsXml);
  assert(contacts['Party A'].phone === '9876543210');
  assert(contacts['Party A'].email === 'a@test.com');
  assert(contacts['Party B'].phone === '0221234567');
});
test('generate reminder message', () => {
  const msg = tdl.generateReminderMessage('Test Co', {
    name: 'Party A', totalDue: 40000,
    bills: [{ billName: 'INV-001', amount: -25000, dueDate: '20260120', daysOverdue: 30 }],
  });
  assert(msg.includes('Party A') && msg.includes('40,000') && msg.includes('Test Co'));
  assert(msg.includes('INV-001'));
});
test('format reminder summary', () => {
  const { parties } = tdl.parseOverdueBillsResponse(overdueBillsXml);
  const contacts = { 'Party A': { phone: '9876543210', email: '' }, 'Party B': { phone: '', email: '' } };
  const result = tdl.formatReminderSummary(parties, contacts);
  assert(result.success);
  assert(result.data.reminders.length === 2);
  assert(result.data.reminders[0].canSend === false, 'Party B has no phone'); // Party B is first (highest amount)
  assert(result.message.includes('send reminders'));
});
test('format reminder summary empty', () => {
  const result = tdl.formatReminderSummary([], {});
  assert(result.success && result.message.includes('No overdue'));
});

// ── Voucher Create ──
console.log('\nVoucher Create:');
test('build create voucher XML sales', () => {
  const xml = tdl.buildCreateVoucherXml({ type: 'Sales', party: 'Meril', amount: 50000, narration: 'Test invoice' }, 'Co');
  assert(xml.includes('Import') && xml.includes('Sales') && xml.includes('Meril') && xml.includes('50000'));
  assert(xml.includes('ACTION="Create"'));
});
test('build create voucher XML receipt', () => {
  const xml = tdl.buildCreateVoucherXml({ type: 'Receipt', party: 'Meril', amount: 25000, cashLedger: 'HDFC Bank' }, 'Co');
  assert(xml.includes('Receipt') && xml.includes('HDFC Bank') && xml.includes('25000'));
});
test('build create voucher XML payment', () => {
  const xml = tdl.buildCreateVoucherXml({ type: 'Payment', party: 'Vendor', amount: 10000 }, 'Co');
  assert(xml.includes('Payment') && xml.includes('Cash'));
});
test('build create voucher XML with items', () => {
  const xml = tdl.buildCreateVoucherXml({
    type: 'Sales', party: 'Meril', amount: 50000,
    items: [{ name: 'Widget A', qty: 100, rate: 500 }],
  }, 'Co');
  assert(xml.includes('Widget A') && xml.includes('ALLINVENTORYENTRIES'));
});
test('parse create voucher response success', () => {
  const xml = '<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><LASTVCHID>12345</LASTVCHID><LASTVCHNUMBER>INV-100</LASTVCHNUMBER><COMBINED><CREATED>1</CREATED><ERRORS>0</ERRORS></COMBINED></IMPORTRESULT></DATA></BODY></ENVELOPE>';
  const r = tdl.parseCreateVoucherResponse(xml);
  assert(r.success, 'should succeed');
});
test('parse create voucher response failure', () => {
  const xml = '<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger not found</LINEERROR></IMPORTRESULT></DATA></BODY></ENVELOPE>';
  const r = tdl.parseCreateVoucherResponse(xml);
  assert(!r.success, 'should fail');
  assert(r.message.includes('Ledger not found'));
});
test('validate voucher data valid', () => {
  const errors = tdl.validateVoucherData({ type: 'Sales', party: 'Meril', amount: 50000 });
  assert(errors.length === 0, `expected no errors, got: ${errors.join(', ')}`);
});
test('validate voucher data missing party', () => {
  const errors = tdl.validateVoucherData({ type: 'Sales', party: '', amount: 50000 });
  assert(errors.length > 0 && errors.some(e => e.includes('Party')));
});
test('validate voucher data invalid type', () => {
  const errors = tdl.validateVoucherData({ type: 'Invalid', party: 'X', amount: 100 });
  assert(errors.length > 0 && errors.some(e => e.includes('type')));
});
test('validate voucher data zero amount', () => {
  const errors = tdl.validateVoucherData({ type: 'Sales', party: 'X', amount: 0 });
  assert(errors.length > 0 && errors.some(e => e.includes('Amount')));
});
test('validate voucher data bad items', () => {
  const errors = tdl.validateVoucherData({ type: 'Sales', party: 'X', amount: 100, items: [{ name: '', qty: 0, rate: 0 }] });
  assert(errors.length >= 2, `expected at least 2 item errors, got ${errors.length}`);
});
test('format voucher confirmation', () => {
  const msg = tdl.formatVoucherConfirmation({ type: 'Sales', party: 'Meril', amount: 50000, date: '2026-02-20', narration: 'Test' }, 'INV-100');
  assert(msg.includes('Sales Voucher Created') && msg.includes('Meril') && msg.includes('50,000') && msg.includes('INV-100'));
});

// ── Summary ──
// Wait for async tests (Excel export) to complete
Promise.all(asyncTests).then(() => {
  console.log(`\n${pass} passed, ${fail} failed out of ${pass + fail} tests`);
  process.exit(fail > 0 ? 1 : 0);
});
