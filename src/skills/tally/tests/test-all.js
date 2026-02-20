/**
 * TDL module tests — run with: node src/skills/tally/tests/test-all.js
 * Tests every builder and parser with sample XML data.
 */
const tdl = require('../tdl');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
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
  assert(xml.includes('SVFROMDATE') && xml.includes('LedgerVchFilter'));
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

test('build XML defaults to today', () => assert(tdl.buildVouchersTdlXml('Co', null, null, null).includes('SVFROMDATE')));
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

// ── Summary ──
console.log(`\n${pass} passed, ${fail} failed out of ${pass + fail} tests`);
process.exit(fail > 0 ? 1 : 0);
