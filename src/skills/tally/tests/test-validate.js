/**
 * Comprehensive validation tests for every execute() action.
 * Each test uses realistic multi-record sample XML and validates:
 *   - success flag
 *   - message contains expected content (emojis, party names, amounts)
 *   - data structure has correct keys and values
 *   - amounts/totals are computed correctly
 *   - edge cases (empty, missing params, bad dates)
 *
 * Run: node src/skills/tally/tests/test-validate.js
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
    if (mockResponses.checkTallyStatus) return mockResponses.checkTallyStatus();
    return { responding: true, companies: [], activeCompany: 'TestCo Pvt Ltd' };
  };
  mock.isTallyRunning = () => mockResponses.isTallyRunning ? mockResponses.isTallyRunning() : { running: true, pid: 1234 };
  mock.parseTallyIni = () => mockResponses.parseTallyIni ? mockResponses.parseTallyIni() : { installPath: 'C:\\Tally', dataPath: 'C:\\Data', exePath: 'C:\\Tally\\tally.exe', port: 9000, loadCompanies: ['10001'] };
  mock.scanDataFolder = () => mockResponses.scanDataFolder ? mockResponses.scanDataFolder() : [{ id: '10001', name: 'TestCo Pvt Ltd', folderPath: 'C:\\Data\\10001', tallyVersion: 'TallyPrime', totalSizeMB: 50, fileCount: 100 }];
  mock.restartTally = async () => ({ success: true, message: '✅ Restarted' });
  mock.startTally = async () => true;
  mock.getFullStatus = async () => ({ success: true, message: '✅ Running', data: {} });
  mock.openCompany = async (q) => ({ success: true, message: `✅ Opened ${q}` });
  // htmlToPdfBuffer — mock to avoid needing puppeteer
  mock.htmlToPdfBuffer = async (html) => Buffer.from('fake-pdf-content');
  return mock;
}

function loadExecuteWithMock(mock) {
  const tdlModulePath = require.resolve('../tdl');
  const indexModulePath = require.resolve('../index');
  delete require.cache[indexModulePath];
  require.cache[tdlModulePath] = { id: tdlModulePath, filename: tdlModulePath, loaded: true, exports: mock };
  return require('../index').execute;
}

function reset() { calls.length = 0; for (const k of Object.keys(mockResponses)) delete mockResponses[k]; }

const cfg = { port: 9000, companyName: 'TestCo Pvt Ltd' };

// ═══════════════════════════════════════════════════════════════
// Realistic sample XML data — multiple records, realistic values
// ═══════════════════════════════════════════════════════════════

const SEARCH_SINGLE = `<ENVELOPE>
  <LEDGER NAME="Rajesh Traders"><NAME>Rajesh Traders</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
</ENVELOPE>`;

const SEARCH_MULTI = `<ENVELOPE>
  <LEDGER NAME="Rajesh Traders"><NAME>Rajesh Traders</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
  <LEDGER NAME="Rajesh Enterprises"><NAME>Rajesh Enterprises</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>
  <LEDGER NAME="Rajesh & Sons"><NAME>Rajesh &amp; Sons</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
</ENVELOPE>`;

const LEDGER_STATEMENT = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260110</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>INV-501</VOUCHERNUMBER><NARRATION>Jan sale</NARRATION><AMOUNT>-75000</AMOUNT><PARTYLEDGERNAME>Rajesh Traders</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Receipt"><DATE>20260125</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>REC-201</VOUCHERNUMBER><NARRATION>Payment received</NARRATION><AMOUNT>50000</AMOUNT><PARTYLEDGERNAME>Rajesh Traders</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260205</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>INV-520</VOUCHERNUMBER><NARRATION>Feb sale</NARRATION><AMOUNT>-120000</AMOUNT><PARTYLEDGERNAME>Rajesh Traders</PARTYLEDGERNAME></VOUCHER>
</ENVELOPE>`;

const VOUCHERS_MULTI = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260220</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-001</VOUCHERNUMBER><NARRATION>Widget sale</NARRATION><AMOUNT>-45000</AMOUNT><PARTYLEDGERNAME>Alpha Corp</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Purchase"><DATE>20260220</DATE><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><VOUCHERNUMBER>P-001</VOUCHERNUMBER><NARRATION>Raw material</NARRATION><AMOUNT>30000</AMOUNT><PARTYLEDGERNAME>Beta Supplies</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Payment"><DATE>20260220</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>PAY-001</VOUCHERNUMBER><NARRATION>Rent payment</NARRATION><AMOUNT>15000</AMOUNT><PARTYLEDGERNAME>Landlord</PARTYLEDGERNAME></VOUCHER>
  <VOUCHER VCHTYPE="Receipt"><DATE>20260220</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>REC-001</VOUCHERNUMBER><NARRATION>Cash received</NARRATION><AMOUNT>-25000</AMOUNT><PARTYLEDGERNAME>Gamma Ltd</PARTYLEDGERNAME></VOUCHER>
</ENVELOPE>`;

const LIST_LEDGERS_25 = `<ENVELOPE>${
  Array.from({ length: 25 }, (_, i) => `<LEDGER NAME="Ledger ${i+1}"><NAME>Ledger ${i+1}</NAME><PARENT>Group ${i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C'}</PARENT></LEDGER>`).join('\n')
}</ENVELOPE>`;

const MASTER_WITH_GSTIN = `<ENVELOPE><LEDGER NAME="Rajesh Traders">
  <NAME>Rajesh Traders</NAME><PARENT>Sundry Debtors</PARENT>
  <LEDGSTREGDETAILS.LIST><GSTIN>24AABCR9876F1Z5</GSTIN></LEDGSTREGDETAILS.LIST>
  <LEDGERPHONE>9876543210</LEDGERPHONE>
  <ADDRESS.LIST><ADDRESS>123 MG Road, Ahmedabad</ADDRESS></ADDRESS.LIST>
</LEDGER></ENVELOPE>`;

const BALANCE_RECEIVABLE = `<ENVELOPE><LEDGER NAME="Rajesh Traders"><NAME>Rajesh Traders</NAME><PARENT>Sundry Debtors</PARENT><CLOSINGBALANCE>-145000</CLOSINGBALANCE></LEDGER></ENVELOPE>`;

const OUTSTANDING_MULTI = `<ENVELOPE>
  <LEDGER NAME="Alpha Corp"><CLOSINGBALANCE>-250000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Beta Ltd"><CLOSINGBALANCE>-75000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Gamma Inc"><CLOSINGBALANCE>-0</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Delta Co"><CLOSINGBALANCE>-180000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const CASH_BANK_MULTI = `<ENVELOPE>
  <LEDGER NAME="HDFC Bank A/c"><NAME>HDFC Bank A/c</NAME><PARENT>Bank Accounts</PARENT><CLOSINGBALANCE>-850000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="SBI Current A/c"><NAME>SBI Current A/c</NAME><PARENT>Bank Accounts</PARENT><CLOSINGBALANCE>-320000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Cash"><NAME>Cash</NAME><PARENT>Cash-in-Hand</PARENT><CLOSINGBALANCE>-45000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Petty Cash"><NAME>Petty Cash</NAME><PARENT>Cash-in-Hand</PARENT><CLOSINGBALANCE>-5000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const PL_MULTI = `<ENVELOPE>
  <GROUP NAME="Sales Accounts"><NAME>Sales Accounts</NAME><PARENT>Revenue</PARENT><CLOSINGBALANCE>-2500000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Direct Incomes"><NAME>Direct Incomes</NAME><PARENT>Revenue</PARENT><CLOSINGBALANCE>-150000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Purchase Accounts"><NAME>Purchase Accounts</NAME><PARENT>Expenses</PARENT><CLOSINGBALANCE>1800000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Direct Expenses"><NAME>Direct Expenses</NAME><PARENT>Expenses</PARENT><CLOSINGBALANCE>200000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Indirect Expenses"><NAME>Indirect Expenses</NAME><PARENT>Expenses</PARENT><CLOSINGBALANCE>350000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

const EXPENSE_MULTI = `<ENVELOPE>
  <LEDGER NAME="Rent"><NAME>Rent</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>180000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Salary"><NAME>Salary</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>450000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Electricity"><NAME>Electricity</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>35000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Internet"><NAME>Internet</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>12000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Zero Expense"><NAME>Zero Expense</NAME><PARENT>Indirect Expenses</PARENT><CLOSINGBALANCE>0</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const STOCK_MULTI = `<ENVELOPE>
  <STOCKITEM NAME="Widget A"><NAME>Widget A</NAME><PARENT>Finished Goods</PARENT><CLOSINGBALANCE>500 Nos</CLOSINGBALANCE><CLOSINGRATE>120</CLOSINGRATE><CLOSINGVALUE>60000</CLOSINGVALUE></STOCKITEM>
  <STOCKITEM NAME="Widget B"><NAME>Widget B</NAME><PARENT>Finished Goods</PARENT><CLOSINGBALANCE>200 Pcs</CLOSINGBALANCE><CLOSINGRATE>350</CLOSINGRATE><CLOSINGVALUE>70000</CLOSINGVALUE></STOCKITEM>
  <STOCKITEM NAME="Raw Material X"><NAME>Raw Material X</NAME><PARENT>Raw Materials</PARENT><CLOSINGBALANCE>1000 Kgs</CLOSINGBALANCE><CLOSINGRATE>50</CLOSINGRATE><CLOSINGVALUE>50000</CLOSINGVALUE></STOCKITEM>
</ENVELOPE>`;

const GST_MULTI = `<ENVELOPE>
  <LEDGER NAME="CGST Output"><NAME>CGST Output</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>-45000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="SGST Output"><NAME>SGST Output</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>-45000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="CGST Input"><NAME>CGST Input</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>30000</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="SGST Input"><NAME>SGST Input</NAME><PARENT>Duties &amp; Taxes</PARENT><CLOSINGBALANCE>30000</CLOSINGBALANCE></LEDGER>
</ENVELOPE>`;

const BILLS_MULTI = `<ENVELOPE>
  <BILL NAME="INV-501"><NAME>INV-501</NAME><PARENT>Rajesh Traders</PARENT><CLOSINGBALANCE>-75000</CLOSINGBALANCE><FINALDUEDATE>20260115</FINALDUEDATE></BILL>
  <BILL NAME="INV-520"><NAME>INV-520</NAME><PARENT>Rajesh Traders</PARENT><CLOSINGBALANCE>-120000</CLOSINGBALANCE><FINALDUEDATE>20260305</FINALDUEDATE></BILL>
  <BILL NAME="INV-530"><NAME>INV-530</NAME><PARENT>Rajesh Traders</PARENT><CLOSINGBALANCE>0</CLOSINGBALANCE><FINALDUEDATE>20260101</FINALDUEDATE></BILL>
</ENVELOPE>`;

const INVOICES_MULTI = `<ENVELOPE>
  <VOUCHER REMOTEID="a1" VCHKEY="a1" VCHTYPE="Sales" OBJVIEW="Invoice Voucher View">
    <DATE>20260110</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>INV-501</VOUCHERNUMBER>
    <PARTYLEDGERNAME>Rajesh Traders</PARTYLEDGERNAME><AMOUNT>-75000</AMOUNT><NARRATION>Jan sale</NARRATION>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget A</STOCKITEMNAME><RATE>120</RATE><AMOUNT>60000</AMOUNT><BILLEDQTY>500</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME>Rajesh Traders</LEDGERNAME><AMOUNT>-75000</AMOUNT><ISPARTYLEDGER>Yes</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME>Sales Account</LEDGERNAME><AMOUNT>60000</AMOUNT><ISPARTYLEDGER>No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME>CGST Output</LEDGERNAME><AMOUNT>7500</AMOUNT><ISPARTYLEDGER>No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME>SGST Output</LEDGERNAME><AMOUNT>7500</AMOUNT><ISPARTYLEDGER>No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
  </VOUCHER>
  <VOUCHER REMOTEID="a2" VCHKEY="a2" VCHTYPE="Sales" OBJVIEW="Invoice Voucher View">
    <DATE>20260205</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>INV-520</VOUCHERNUMBER>
    <PARTYLEDGERNAME>Rajesh Traders</PARTYLEDGERNAME><AMOUNT>-120000</AMOUNT><NARRATION>Feb sale</NARRATION>
    <LEDGERENTRIES.LIST><LEDGERNAME>Rajesh Traders</LEDGERNAME><AMOUNT>-120000</AMOUNT><ISPARTYLEDGER>Yes</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME>Sales Account</LEDGERNAME><AMOUNT>120000</AMOUNT><ISPARTYLEDGER>No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
  </VOUCHER>
</ENVELOPE>`;

const INVOICE_DETAIL = `<ENVELOPE>
  <VOUCHER REMOTEID="a1" VCHKEY="a1" VCHTYPE="Sales" OBJVIEW="Invoice Voucher View">
    <DATE TYPE="Date">20260110</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>INV-501</VOUCHERNUMBER>
    <PARTYLEDGERNAME TYPE="String">Rajesh Traders</PARTYLEDGERNAME><AMOUNT TYPE="Amount">-75000</AMOUNT><NARRATION TYPE="String">Jan sale</NARRATION>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget A</STOCKITEMNAME><RATE>120</RATE><AMOUNT>60000</AMOUNT><BILLEDQTY>500</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">Rajesh Traders</LEDGERNAME><AMOUNT TYPE="Amount">-75000</AMOUNT><ISPARTYLEDGER TYPE="Logical">Yes</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">Sales Account</LEDGERNAME><AMOUNT TYPE="Amount">60000</AMOUNT><ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">CGST Output</LEDGERNAME><AMOUNT TYPE="Amount">7500</AMOUNT><ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME TYPE="String">SGST Output</LEDGERNAME><AMOUNT TYPE="Amount">7500</AMOUNT><ISPARTYLEDGER TYPE="Logical">No</ISPARTYLEDGER></LEDGERENTRIES.LIST>
  </VOUCHER>
</ENVELOPE>`;

const COMPANY_INFO = `<ENVELOPE><BODY><DATA><COLLECTION>
  <COMPANY NAME="TestCo Pvt Ltd" RESERVEDNAME="">
    <NAME TYPE="String">TestCo Pvt Ltd</NAME>
    <BASICCOMPANYFORMALNAME TYPE="String">TestCo Private Limited</BASICCOMPANYFORMALNAME>
    <ADDRESS.LIST TYPE="String"><ADDRESS TYPE="String">456 Industrial Area</ADDRESS><ADDRESS TYPE="String">Ahmedabad, Gujarat 380015</ADDRESS></ADDRESS.LIST>
    <LEDGERPHONE TYPE="String">079-12345678</LEDGERPHONE>
    <INCOMETAXNUMBER TYPE="String">AABCT1234F</INCOMETAXNUMBER>
    <GSTREGISTRATIONNUMBER TYPE="String">24AABCT1234F1Z5</GSTREGISTRATIONNUMBER>
    <LEDGERBANKNAME TYPE="String">HDFC Bank</LEDGERBANKNAME>
    <LEDGERBANKACCOUNTNUMBER TYPE="String">50100123456789</LEDGERBANKACCOUNTNUMBER>
    <LEDGERBANKIFSCCODE TYPE="String">HDFC0001234</LEDGERBANKIFSCCODE>
    <LEDGERBANKBRANCHNAME TYPE="String">Ahmedabad Main</LEDGERBANKBRANCHNAME>
  </COMPANY>
</COLLECTION></DATA></BODY></ENVELOPE>`;

const PARTY_DETAIL = `<ENVELOPE><BODY><DATA><COLLECTION>
  <LEDGER NAME="Rajesh Traders" RESERVEDNAME="">
    <ADDRESS.LIST TYPE="String"><ADDRESS TYPE="String">789 Market Road</ADDRESS><ADDRESS TYPE="String">Surat, Gujarat</ADDRESS></ADDRESS.LIST>
    <PARENT TYPE="String">Sundry Debtors</PARENT>
    <LEDGERPHONE TYPE="String">9876543210</LEDGERPHONE>
    <LEDGSTREGDETAILS.LIST><GSTIN>24AABCR9876F1Z5</GSTIN></LEDGSTREGDETAILS.LIST>
  </LEDGER>
</COLLECTION></DATA></BODY></ENVELOPE>`;

const TB_MULTI = `<ENVELOPE>
  <GROUP NAME="Current Assets"><NAME>Current Assets</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>500000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Fixed Assets"><NAME>Fixed Assets</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>300000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Capital Account"><NAME>Capital Account</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>-600000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Current Liabilities"><NAME>Current Liabilities</NAME><PARENT>&#4; Primary</PARENT><OPENINGBALANCE>0</OPENINGBALANCE><CLOSINGBALANCE>-200000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

const BS_MULTI = `<ENVELOPE>
  <GROUP NAME="Current Assets"><NAME>Current Assets</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>500000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Fixed Assets"><NAME>Fixed Assets</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>300000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Capital Account"><NAME>Capital Account</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-600000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Current Liabilities"><NAME>Current Liabilities</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-200000</CLOSINGBALANCE></GROUP>
  <GROUP NAME="Sales Accounts"><NAME>Sales Accounts</NAME><PARENT>&#4; Primary</PARENT><CLOSINGBALANCE>-500000</CLOSINGBALANCE></GROUP>
</ENVELOPE>`;

const now = new Date();
const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; };

const AGEING_BILLS = `<ENVELOPE>
  <BILL NAME="B1"><NAME>B1</NAME><PARENT>Alpha Corp</PARENT><CLOSINGBALANCE>-50000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(10)}</FINALDUEDATE></BILL>
  <BILL NAME="B2"><NAME>B2</NAME><PARENT>Alpha Corp</PARENT><CLOSINGBALANCE>-30000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(45)}</FINALDUEDATE></BILL>
  <BILL NAME="B3"><NAME>B3</NAME><PARENT>Beta Ltd</PARENT><CLOSINGBALANCE>-100000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(95)}</FINALDUEDATE></BILL>
  <BILL NAME="B4"><NAME>B4</NAME><PARENT>Gamma Inc</PARENT><CLOSINGBALANCE>-20000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(70)}</FINALDUEDATE></BILL>
</ENVELOPE>`;

const INACTIVE_VOUCHERS = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>${daysAgo(5)}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Active Customer</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Active Item</STOCKITEMNAME><AMOUNT>50000</AMOUNT></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>${daysAgo(60)}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Dormant Customer</PARTYLEDGERNAME><AMOUNT>-30000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Slow Item</STOCKITEMNAME><AMOUNT>30000</AMOUNT></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>${daysAgo(120)}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Dead Customer</PARTYLEDGERNAME><AMOUNT>-10000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Dead Item</STOCKITEMNAME><AMOUNT>10000</AMOUNT></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
</ENVELOPE>`;

const TOP_SALES = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260210</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S1</VOUCHERNUMBER><PARTYLEDGERNAME>Big Customer</PARTYLEDGERNAME><AMOUNT>-500000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Premium Widget</STOCKITEMNAME><RATE>1000</RATE><AMOUNT>500000</AMOUNT><BILLEDQTY>500</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260215</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S2</VOUCHERNUMBER><PARTYLEDGERNAME>Medium Customer</PARTYLEDGERNAME><AMOUNT>-200000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Standard Widget</STOCKITEMNAME><RATE>200</RATE><AMOUNT>200000</AMOUNT><BILLEDQTY>1000</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260218</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S3</VOUCHERNUMBER><PARTYLEDGERNAME>Small Customer</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Premium Widget</STOCKITEMNAME><RATE>1000</RATE><AMOUNT>50000</AMOUNT><BILLEDQTY>50</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
</ENVELOPE>`;

const ORDER_VOUCHERS = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales Order"><DATE>20260201</DATE><VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME><VOUCHERNUMBER>SO-001</VOUCHERNUMBER><PARTYLEDGERNAME>Alpha Corp</PARTYLEDGERNAME><AMOUNT>-100000</AMOUNT><NARRATION>Feb order</NARRATION>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget A</STOCKITEMNAME><RATE>200</RATE><AMOUNT>100000</AMOUNT><BILLEDQTY>500</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Sales Order"><DATE>20260210</DATE><VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME><VOUCHERNUMBER>SO-002</VOUCHERNUMBER><PARTYLEDGERNAME>Beta Ltd</PARTYLEDGERNAME><AMOUNT>-75000</AMOUNT><NARRATION>Widget order</NARRATION></VOUCHER>
  <VOUCHER VCHTYPE="Sales Order"><DATE>20260215</DATE><VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME><VOUCHERNUMBER>SO-003</VOUCHERNUMBER><PARTYLEDGERNAME>Alpha Corp</PARTYLEDGERNAME><AMOUNT>-50000</AMOUNT><NARRATION>Additional</NARRATION></VOUCHER>
</ENVELOPE>`;

const ORDER_INVOICES = `<ENVELOPE>
  <VOUCHER VCHTYPE="Sales"><DATE>20260205</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Alpha Corp</PARTYLEDGERNAME><AMOUNT>-80000</AMOUNT></VOUCHER>
  <VOUCHER VCHTYPE="Sales"><DATE>20260212</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Beta Ltd</PARTYLEDGERNAME><AMOUNT>-75000</AMOUNT></VOUCHER>
</ENVELOPE>`;

const VOUCHER_TYPE_COUNTS = `<ENVELOPE>
  <VOUCHER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME></VOUCHER>
  <VOUCHER><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME></VOUCHER>
</ENVELOPE>`;

const OVERDUE_BILLS = `<ENVELOPE>
  <BILL NAME="INV-100"><NAME>INV-100</NAME><PARENT>Alpha Corp</PARENT><CLOSINGBALANCE>-50000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(30)}</FINALDUEDATE></BILL>
  <BILL NAME="INV-200"><NAME>INV-200</NAME><PARENT>Beta Ltd</PARENT><CLOSINGBALANCE>-25000</CLOSINGBALANCE><FINALDUEDATE>${daysAgo(15)}</FINALDUEDATE></BILL>
</ENVELOPE>`;

const PARTY_CONTACTS = `<ENVELOPE>
  <LEDGER NAME="Alpha Corp"><NAME>Alpha Corp</NAME><LEDGERMOBILE>9876543210</LEDGERMOBILE></LEDGER>
  <LEDGER NAME="Beta Ltd"><NAME>Beta Ltd</NAME><LEDGERMOBILE></LEDGERMOBILE></LEDGER>
</ENVELOPE>`;

const CREATE_SUCCESS = '<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ERRORS>0</ERRORS></IMPORTRESULT></DATA></BODY></ENVELOPE>';
const CREATE_FAILURE = '<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger "Sales Account" not found</LINEERROR></IMPORTRESULT></DATA></BODY></ENVELOPE>';

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

async function runTests() {

  // ── get_ledger ──
  console.log('\n=== get_ledger ===');

  await test('returns statement with correct entries and amounts', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? SEARCH_SINGLE : LEDGER_STATEMENT; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_ledger', { party_name: 'Rajesh Traders' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.entries.length === 3, `expected 3 entries, got ${r.data.entries.length}`);
    assert(r.message.includes('Rajesh Traders'), 'message should include party name');
    assert(r.message.includes('INV-501'), 'message should include voucher number');
    assert(r.message.includes('75,000'), 'message should include formatted amount');
  });

  await test('returns suggestions for ambiguous name', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => SEARCH_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_ledger', { party_name: 'Rajesh' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.suggestions.length === 3, `expected 3 suggestions, got ${r.data.suggestions.length}`);
    assert(r.message.includes('Rajesh Traders'), 'should list Rajesh Traders');
    assert(r.message.includes('Rajesh Enterprises'), 'should list Rajesh Enterprises');
  });

  // ── get_vouchers ──
  console.log('\n=== get_vouchers ===');

  await test('returns multiple voucher types with correct data', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => VOUCHERS_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_vouchers', { date_from: '2026-02-20', date_to: '2026-02-20' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.length === 4, `expected 4 vouchers, got ${r.data.length}`);
    assert(r.message.includes('Sales'), 'should mention Sales');
    assert(r.message.includes('Alpha Corp'), 'should mention party');
  });

  // ── list_ledgers ──
  console.log('\n=== list_ledgers ===');

  await test('paginates 25 ledgers correctly', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => LIST_LEDGERS_25;
    const exec = loadExecuteWithMock(mock);
    const r1 = await exec('tally', 'list_ledgers', { page: 1 }, cfg);
    assert(r1.success, 'page 1 should succeed');
    assert(r1.message.includes('Page 1/2'), 'should show page 1/2');
    assert(r1.message.includes('Ledger 1'), 'should have first ledger');
    assert(!r1.message.includes('Ledger 21'), 'should NOT have 21st on page 1');
    const r2 = await exec('tally', 'list_ledgers', { page: 2 }, cfg);
    assert(r2.message.includes('Page 2/2'), 'should show page 2/2');
    assert(r2.message.includes('Ledger 21'), 'should have 21st on page 2');
  });

  // ── get_party_gstin ──
  console.log('\n=== get_party_gstin ===');

  await test('returns GSTIN with correct value', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? SEARCH_SINGLE : MASTER_WITH_GSTIN; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_party_gstin', { party_name: 'Rajesh Traders' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.gstin === '24AABCR9876F1Z5', `expected GSTIN 24AABCR9876F1Z5, got ${r.data.gstin}`);
    assert(r.message.includes('24AABCR9876F1Z5'), 'message should include GSTIN');
  });

  // ── get_party_balance ──
  console.log('\n=== get_party_balance ===');

  await test('returns balance with correct amount', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? SEARCH_SINGLE : BALANCE_RECEIVABLE; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_party_balance', { party_name: 'Rajesh Traders' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.balanceType, 'should have balance type');
    assert(r.data.closingBalance === -145000, `expected -145000, got ${r.data.closingBalance}`);
    assert(r.message.includes('1,45,000') || r.message.includes('145,000') || r.message.includes('145000'), 'message should include amount');
  });

  // ── get_outstanding ──
  console.log('\n=== get_outstanding ===');

  await test('filters zero balances and returns correct total', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => OUTSTANDING_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_outstanding', { type: 'receivable' }, cfg);
    assert(r.success, 'should succeed');
    // Gamma Inc has 0 balance — should be filtered out
    const entries = r.data.entries;
    assert(entries.length === 3, `expected 3 non-zero entries, got ${entries.length}`);
    assert(!entries.find(e => e.name === 'Gamma Inc'), 'should filter out zero balance');
    assert(r.message.includes('Alpha Corp'), 'should include Alpha Corp');
  });

  // ── get_cash_bank_balance ──
  console.log('\n=== get_cash_bank_balance ===');

  await test('returns all bank and cash accounts with totals', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => CASH_BANK_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_cash_bank_balance', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.entries.length === 4, `expected 4 entries, got ${r.data.entries.length}`);
    assert(r.message.includes('HDFC'), 'should include HDFC');
    assert(r.message.includes('Cash'), 'should include Cash');
    // Tally uses negative = credit = money available. Total = -(850000+320000+45000+5000)
    assert(r.data.total === -1220000, `expected total -1220000, got ${r.data.total}`);
  });

  // ── get_profit_loss ──
  console.log('\n=== get_profit_loss ===');

  await test('categorizes income and expenses correctly', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => PL_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_profit_loss', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.totalIncome > 0, 'should have positive income');
    assert(r.data.totalExpense > 0, 'should have positive expenses');
    assert(r.message.includes('Sales Accounts'), 'should include Sales Accounts');
    assert(r.message.includes('Indirect Expenses'), 'should include Indirect Expenses');
  });

  await test('ignores reversed date range', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => PL_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_profit_loss', { date_from: '2026-12-31', date_to: '2026-01-01' }, cfg);
    assert(r.success, 'should succeed (bad dates nulled)');
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(!postCalls[0].xml.includes('SVFROMDATE'), 'should NOT set SVFROMDATE for reversed dates');
  });

  // ── get_expense_report ──
  console.log('\n=== get_expense_report ===');

  await test('filters zero expenses and sorts by amount', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => EXPENSE_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_expense_report', {}, cfg);
    assert(r.success, 'should succeed');
    const entries = r.data.entries;
    assert(!entries.find(e => e.name === 'Zero Expense'), 'should filter zero expense');
    assert(entries.length === 4, `expected 4 non-zero, got ${entries.length}`);
    assert(entries[0].amount >= entries[1].amount, 'should be sorted desc by amount');
    assert(entries[0].name === 'Salary', `expected Salary first, got ${entries[0].name}`);
  });

  // ── get_stock_summary ──
  console.log('\n=== get_stock_summary ===');

  await test('returns items with qty, unit, and value', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => STOCK_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_stock_summary', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.items.length === 3, `expected 3 items, got ${r.data.items.length}`);
    const widgetB = r.data.items.find(i => i.name === 'Widget B');
    assert(widgetB, 'should have Widget B');
    assert(widgetB.closingValue === 70000, `expected 70000, got ${widgetB.closingValue}`);
    assert(r.data.totalValue === 180000, `expected total 180000, got ${r.data.totalValue}`);
  });

  // ── get_gst_summary ──
  console.log('\n=== get_gst_summary ===');

  await test('computes output, input, and net liability', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => GST_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_gst_summary', {}, cfg);
    assert(r.success, 'should succeed');
    // Output: 45000 + 45000 = 90000, Input: 30000 + 30000 = 60000, Net: 30000
    assert(r.data.totalOutput === 90000, `expected output 90000, got ${r.data.totalOutput}`);
    assert(r.data.totalInput === 60000, `expected input 60000, got ${r.data.totalInput}`);
    assert(r.data.netLiability === 30000, `expected net 30000, got ${r.data.netLiability}`);
  });

  // ── get_bill_outstanding ──
  console.log('\n=== get_bill_outstanding ===');

  await test('returns bills with overdue detection', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? SEARCH_SINGLE : BILLS_MULTI; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_bill_outstanding', { party_name: 'Rajesh Traders' }, cfg);
    assert(r.success, 'should succeed');
    // INV-530 has 0 balance — should be filtered
    assert(r.data.bills.length === 2, `expected 2 non-zero bills, got ${r.data.bills.length}`);
    assert(r.message.includes('INV-501'), 'should include INV-501');
    assert(r.message.includes('INV-520'), 'should include INV-520');
  });

  // ── get_party_invoices ──
  console.log('\n=== get_party_invoices ===');

  await test('returns invoices sorted newest first with totals', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? SEARCH_SINGLE : INVOICES_MULTI; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_party_invoices', { party_name: 'Rajesh Traders' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.invoices.length === 2, `expected 2 invoices, got ${r.data.invoices.length}`);
    // Newest first
    assert(r.data.invoices[0].number === 'INV-520', `expected INV-520 first, got ${r.data.invoices[0].number}`);
    assert(r.data.total === 195000, `expected total 195000, got ${r.data.total}`);
    assert(r.message.includes('Rajesh Traders'), 'message should include party');
  });

  // ── get_invoice_pdf ──
  console.log('\n=== get_invoice_pdf ===');

  await test('returns PDF attachment with correct metadata', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; if (n === 1) return INVOICE_DETAIL; if (n === 2) return COMPANY_INFO; return PARTY_DETAIL; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_invoice_pdf', { invoice_number: 'INV-501' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.attachment, 'should have attachment');
    assert(r.attachment.filename.includes('INV-501'), 'filename should include invoice number');
    assert(Buffer.isBuffer(r.attachment.buffer), 'should have buffer');
    assert(r.data.invoice.party === 'Rajesh Traders', 'should have correct party');
    assert(r.data.company.name === 'TestCo Pvt Ltd' || r.data.company.name === 'TestCo Private Limited', 'should have company name');
  });

  await test('returns error for missing invoice', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => '<ENVELOPE></ENVELOPE>';
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_invoice_pdf', { invoice_number: 'NONEXIST' }, cfg);
    assert(!r.success, 'should fail');
    assert(r.message.includes('not found'), 'should say not found');
  });

  // ── get_trial_balance ──
  console.log('\n=== get_trial_balance ===');

  await test('returns balanced TB with correct debit/credit', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => TB_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_trial_balance', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.groups.length === 4, `expected 4 groups, got ${r.data.groups.length}`);
    // Debit: 500000 + 300000 = 800000, Credit: 600000 + 200000 = 800000
    assert(r.data.totalDebit === 800000, `expected debit 800000, got ${r.data.totalDebit}`);
    assert(r.data.totalCredit === 800000, `expected credit 800000, got ${r.data.totalCredit}`);
  });

  // ── get_balance_sheet ──
  console.log('\n=== get_balance_sheet ===');

  await test('excludes P&L groups and separates assets/liabilities', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => BS_MULTI;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_balance_sheet', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.assets.length === 2, `expected 2 asset groups, got ${r.data.assets.length}`);
    assert(r.data.liabilities.length === 2, `expected 2 liability groups, got ${r.data.liabilities.length}`);
    const allNames = [...r.data.assets.map(a => a.name), ...r.data.liabilities.map(l => l.name)];
    assert(!allNames.includes('Sales Accounts'), 'should exclude P&L groups');
  });

  // ── get_ageing_analysis ──
  console.log('\n=== get_ageing_analysis ===');

  await test('buckets bills correctly by age', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => AGEING_BILLS;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_ageing_analysis', { type: 'receivable' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.totalBills === 4, `expected 4 bills, got ${r.data.totalBills}`);
    assert(r.data.buckets.length === 4, 'should have 4 buckets');
    // B1 (10 days) → 0-30 bucket = 50000
    assert(r.data.buckets[0].amount === 50000, `0-30 bucket: expected 50000, got ${r.data.buckets[0].amount}`);
    // B2 (45 days) → 31-60 bucket = 30000
    assert(r.data.buckets[1].amount === 30000, `31-60 bucket: expected 30000, got ${r.data.buckets[1].amount}`);
    // B4 (70 days) → 61-90 bucket = 20000
    assert(r.data.buckets[2].amount === 20000, `61-90 bucket: expected 20000, got ${r.data.buckets[2].amount}`);
    // B3 (95 days) → 90+ bucket = 100000
    assert(r.data.buckets[3].amount === 100000, `90+ bucket: expected 100000, got ${r.data.buckets[3].amount}`);
  });

  // ── get_inactive_customers ──
  console.log('\n=== get_inactive_customers/suppliers/items ===');

  await test('identifies inactive customers by days threshold', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => INACTIVE_VOUCHERS;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_inactive_customers', { days: 30 }, cfg);
    assert(r.success, 'should succeed');
    // Active Customer (5 days ago) should NOT be inactive
    // Dormant Customer (60 days ago) and Dead Customer (120 days ago) should be inactive
    assert(r.data.entries.length === 2, `expected 2 inactive, got ${r.data.entries.length}`);
    const names = r.data.entries.map(e => e.name);
    assert(names.includes('Dormant Customer'), 'should include Dormant Customer');
    assert(names.includes('Dead Customer'), 'should include Dead Customer');
    assert(!names.includes('Active Customer'), 'should NOT include Active Customer');
  });

  await test('identifies inactive items by days threshold', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => INACTIVE_VOUCHERS;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_inactive_items', { days: 30 }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.entries.length === 2, `expected 2 inactive items, got ${r.data.entries.length}`);
    const names = r.data.entries.map(e => e.name);
    assert(names.includes('Slow Item'), 'should include Slow Item');
    assert(names.includes('Dead Item'), 'should include Dead Item');
  });

  // ── get_top_customers ──
  console.log('\n=== get_top_customers/suppliers/items ===');

  await test('returns top customers sorted by value', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => TOP_SALES;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_top_customers', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.entries[0].name === 'Big Customer', `expected Big Customer first, got ${r.data.entries[0].name}`);
    assert(r.data.entries[0].total === 500000, `expected 500000, got ${r.data.entries[0].total}`);
    assert(r.data.entries.length === 3, `expected 3, got ${r.data.entries.length}`);
  });

  await test('respects limit parameter', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => TOP_SALES;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_top_customers', { limit: 2 }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.entries.length === 2, `expected 2 with limit, got ${r.data.entries.length}`);
  });

  await test('returns top items sorted by value', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => TOP_SALES;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_top_items', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.entries[0].name === 'Premium Widget', `expected Premium Widget first, got ${r.data.entries[0].name}`);
    // Premium Widget: 500000 + 50000 = 550000
    assert(r.data.entries[0].total === 550000, `expected 550000, got ${r.data.entries[0].total}`);
  });

  // ── get_sales_orders / get_purchase_orders ──
  console.log('\n=== get_sales_orders / get_purchase_orders ===');

  await test('returns orders with items and party grouping', async () => {
    const mock = mockTdl(); reset();
    mockResponses.postTally = async () => ORDER_VOUCHERS;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_sales_orders', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.orders.length === 3, `expected 3 orders, got ${r.data.orders.length}`);
    // Newest first
    assert(r.data.orders[0].number === 'SO-003', `expected SO-003 first, got ${r.data.orders[0].number}`);
    assert(r.data.total === 225000, `expected total 225000, got ${r.data.total}`);
    assert(r.data.byParty['Alpha Corp'].count === 2, 'Alpha Corp should have 2 orders');
  });

  await test('shows voucher types when no orders exist', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? '<ENVELOPE></ENVELOPE>' : VOUCHER_TYPE_COUNTS; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_sales_orders', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.voucherTypes, 'should have voucherTypes');
    assert(r.data.voucherTypes.length === 5, `expected 5 types, got ${r.data.voucherTypes.length}`);
    assert(r.message.includes('Available voucher types'), 'should show available types');
    assert(r.message.includes('Payment'), 'should list Payment');
  });

  await test('accepts custom voucher_type parameter', async () => {
    const mock = mockTdl(); reset();
    const paymentXml = `<ENVELOPE>
      <VOUCHER VCHTYPE="Payment"><DATE>20260210</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>PAY-001</VOUCHERNUMBER><PARTYLEDGERNAME>Vendor A</PARTYLEDGERNAME><AMOUNT>25000</AMOUNT><NARRATION>Rent</NARRATION></VOUCHER>
    </ENVELOPE>`;
    mockResponses.postTally = async () => paymentXml;
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_sales_orders', { voucher_type: 'Payment' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.orders.length === 1, `expected 1, got ${r.data.orders.length}`);
    const postCalls = calls.filter(c => c.fn === 'postTally');
    assert(postCalls[0].xml.includes('"Payment"'), 'should query Payment type');
  });

  // ── get_pending_orders ──
  console.log('\n=== get_pending_orders ===');

  await test('computes pending amounts per party', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? ORDER_VOUCHERS : ORDER_INVOICES; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_pending_orders', {}, cfg);
    assert(r.success, 'should succeed');
    // Alpha Corp: ordered 150000, invoiced 80000 → pending 70000
    // Beta Ltd: ordered 75000, invoiced 75000 → fulfilled (0)
    assert(r.data.pending.length === 1, `expected 1 pending party, got ${r.data.pending.length}`);
    assert(r.data.pending[0].party === 'Alpha Corp', `expected Alpha Corp, got ${r.data.pending[0].party}`);
    assert(r.data.pending[0].pending === 70000, `expected 70000 pending, got ${r.data.pending[0].pending}`);
  });

  // ── get_payment_reminders ──
  console.log('\n=== get_payment_reminders ===');

  await test('returns reminders with contact info', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? OVERDUE_BILLS : PARTY_CONTACTS; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'get_payment_reminders', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.reminders.length === 2, `expected 2 reminders, got ${r.data.reminders.length}`);
    const alpha = r.data.reminders.find(rm => rm.party === 'Alpha Corp');
    assert(alpha, 'should have Alpha Corp');
    assert(alpha.canSend === true, 'Alpha Corp should be sendable (has phone)');
    const beta = r.data.reminders.find(rm => rm.party === 'Beta Ltd');
    assert(beta, 'should have Beta Ltd');
    assert(beta.canSend === false, 'Beta Ltd should NOT be sendable (no phone)');
  });

  // ── send_reminder ──
  console.log('\n=== send_reminder ===');

  await test('generates reminder text for party with bills', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; if (n === 1) return SEARCH_SINGLE; if (n === 2) return BILLS_MULTI; return PARTY_DETAIL; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'send_reminder', { party_name: 'Rajesh Traders' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.party === 'Rajesh Traders', 'should have correct party');
    assert(r.data.reminderText, 'should have reminder text');
    assert(r.data.phone === '9876543210', `expected phone 9876543210, got ${r.data.phone}`);
    assert(r.message.includes('Reminder'), 'message should mention Reminder');
  });

  // ── create_voucher ──
  console.log('\n=== create_voucher ===');

  await test('creates voucher successfully', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? SEARCH_SINGLE : CREATE_SUCCESS; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'create_voucher', { voucher_type: 'Sales', party_name: 'Rajesh Traders', amount: 50000, narration: 'Test sale' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.message.includes('Voucher Created') || r.message.includes('✅'), 'should confirm creation');
    assert(r.data.voucherData.party === 'Rajesh Traders', 'should have correct party');
  });

  await test('returns Tally error on creation failure', async () => {
    const mock = mockTdl(); reset();
    let n = 0;
    mockResponses.postTally = async () => { n++; return n === 1 ? SEARCH_SINGLE : CREATE_FAILURE; };
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'create_voucher', { voucher_type: 'Sales', party_name: 'Rajesh Traders', amount: 50000 }, cfg);
    assert(!r.success, 'should fail');
    assert(r.message.includes('Sales Account'), 'should include Tally error message');
  });

  await test('validates missing party', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'create_voucher', { voucher_type: 'Sales', amount: 50000 }, cfg);
    assert(!r.success, 'should fail');
  });

  await test('validates zero amount', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'create_voucher', { voucher_type: 'Sales', party_name: 'X', amount: 0 }, cfg);
    assert(!r.success, 'should fail');
  });

  await test('validates invalid voucher type', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'create_voucher', { voucher_type: 'InvalidType', party_name: 'X', amount: 100 }, cfg);
    assert(!r.success, 'should fail');
  });

  // ── export_excel ──
  console.log('\n=== export_excel ===');

  await test('exports outstanding data as Excel', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const reportData = { entries: [{ name: 'Alpha Corp', closingBalance: -250000 }, { name: 'Beta Ltd', closingBalance: -75000 }] };
    const r = await exec('tally', 'export_excel', { _reportData: reportData, report_name: 'Outstanding Receivable' }, cfg);
    assert(r.success, 'should succeed');
    assert(r.attachment, 'should have attachment');
    assert(r.attachment.filename === 'Outstanding Receivable.xlsx', `expected filename, got ${r.attachment.filename}`);
    assert(Buffer.isBuffer(r.attachment.buffer), 'should have buffer');
  });

  await test('fails without report data', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'export_excel', {}, cfg);
    assert(!r.success, 'should fail');
    assert(r.message.includes('No report data'), 'should say no data');
  });

  // ── Tally management ──
  console.log('\n=== Tally management ===');

  await test('tally_status returns status', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'tally_status', {}, cfg);
    assert(r.success, 'should succeed');
  });

  await test('list_companies returns companies', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'list_companies', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.data.companies.length >= 1, 'should have companies');
    assert(r.message.includes('TestCo'), 'should include company name');
  });

  await test('open_company opens company', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'open_company', { company_name: 'TestCo' }, cfg);
    assert(r.success, 'should succeed');
  });

  await test('open_company without name lists options', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'open_company', {}, cfg);
    assert(r.success, 'should succeed');
    assert(r.message.includes('Which company'), 'should ask which company');
  });

  await test('unknown action returns error', async () => {
    const mock = mockTdl(); reset();
    const exec = loadExecuteWithMock(mock);
    const r = await exec('tally', 'totally_fake_action', {}, cfg);
    assert(!r.success, 'should fail');
    assert(r.message.includes('Unknown'), 'should say unknown');
  });

  // ── Summary ──
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`${pass} passed, ${fail} failed out of ${pass + fail} tests`);
  process.exit(fail > 0 ? 1 : 0);
}

runTests();
