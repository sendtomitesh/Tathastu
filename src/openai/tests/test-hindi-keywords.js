/**
 * Tests for Hindi/Hinglish/Gujarati keyword patterns in parseWithKeyword().
 * Run: node src/openai/tests/test-hindi-keywords.js
 */

const path = require('path');

// We need getActionsForPrompt from config/load
const { getActionsForPrompt } = require('../../config/load');

// Load parseWithKeyword
const { parseWithKeyword } = require('../parse');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// Minimal config with tally actions
const config = {
  skills: [{
    id: 'tally', name: 'Tally', config: { port: 9000 },
    actions: [
      { id: 'get_ledger', description: 'Get ledger', parameters: ['party_name', 'date_from', 'date_to', 'page'] },
      { id: 'get_vouchers', description: 'Get vouchers', parameters: ['date_from', 'date_to', 'voucher_type', 'limit', 'page'] },
      { id: 'get_party_balance', description: 'Get balance', parameters: ['party_name'] },
      { id: 'get_sales_report', description: 'Sales report', parameters: ['type', 'date_from', 'date_to'] },
      { id: 'get_outstanding', description: 'Outstanding', parameters: ['type', 'page'] },
      { id: 'get_profit_loss', description: 'P&L', parameters: ['date_from', 'date_to'] },
      { id: 'get_expense_report', description: 'Expenses', parameters: ['date_from', 'date_to'] },
      { id: 'get_cash_bank_balance', description: 'Cash bank', parameters: [] },
      { id: 'get_stock_summary', description: 'Stock', parameters: ['item_name'] },
      { id: 'get_gst_summary', description: 'GST', parameters: ['date_from', 'date_to'] },
      { id: 'tally_status', description: 'Tally status', parameters: [] },
      { id: 'list_ledgers', description: 'List ledgers', parameters: ['group_filter', 'page'] },
      { id: 'create_voucher', description: 'Create voucher', parameters: ['voucher_type', 'party_name', 'amount', 'date', 'narration'] },
      { id: 'get_party_invoices', description: 'Get invoices', parameters: ['party_name', 'date_from', 'date_to', 'voucher_type', 'page'] },
      { id: 'compare_periods', description: 'Compare periods', parameters: ['report_type', 'period'] },
      { id: 'set_alert', description: 'Set alert', parameters: ['alert_type', 'threshold'] },
      { id: 'list_alerts', description: 'List alerts', parameters: [] },
      { id: 'remove_alert', description: 'Remove alert', parameters: ['alert_id'] },
      { id: 'send_daily_summary', description: 'Daily summary', parameters: [] },
      { id: 'switch_company', description: 'Switch company', parameters: ['company_name'] },
    ]
  }]
};

function kw(text) { return parseWithKeyword(text, config); }

// ═══════════════════════════════════════════════
console.log('\nHindi/Hinglish Ledger Patterns:');
// ═══════════════════════════════════════════════

test('"meril ka ledger dikhao" → get_ledger(meril)', () => {
  const r = kw('meril ka ledger dikhao');
  assert(r.action === 'get_ledger', `expected get_ledger, got ${r.action}`);
  assert(r.params.party_name === 'meril', `expected meril, got ${r.params.party_name}`);
});

test('"mujhe bhavesh ka hisaab dikhao" → get_ledger(bhavesh)', () => {
  const r = kw('mujhe bhavesh ka hisaab dikhao');
  assert(r.action === 'get_ledger', `expected get_ledger, got ${r.action}`);
  assert(r.params.party_name === 'bhavesh', `expected bhavesh, got ${r.params.party_name}`);
});

test('"dhrupal ka khata batao" → get_ledger(dhrupal)', () => {
  const r = kw('dhrupal ka khata batao');
  assert(r.action === 'get_ledger', `expected get_ledger, got ${r.action}`);
  assert(r.params.party_name === 'dhrupal', `expected dhrupal, got ${r.params.party_name}`);
});

test('"hisaab of meril" → get_ledger(meril)', () => {
  const r = kw('hisaab of meril');
  assert(r.action === 'get_ledger', `expected get_ledger, got ${r.action}`);
  assert(r.params.party_name === 'meril', `expected meril, got ${r.params.party_name}`);
});

// ═══════════════════════════════════════════════
console.log('\nHindi/Hinglish Balance Patterns:');
// ═══════════════════════════════════════════════

test('"meril ka balance" → get_party_balance(meril)', () => {
  const r = kw('meril ka balance');
  assert(r.action === 'get_party_balance', `expected get_party_balance, got ${r.action}`);
  assert(r.params.party_name === 'meril', `expected meril, got ${r.params.party_name}`);
});

test('"meril se kitna lena hai" → get_party_balance(meril)', () => {
  const r = kw('meril se kitna lena hai');
  // This should match the Hindi balance pattern
  assert(r.action === 'get_party_balance', `expected get_party_balance, got ${r.action}`);
});

test('"bhavesh ka baaki" → get_party_balance(bhavesh)', () => {
  const r = kw('bhavesh ka baaki');
  assert(r.action === 'get_party_balance', `expected get_party_balance, got ${r.action}`);
  assert(r.params.party_name === 'bhavesh', `expected bhavesh, got ${r.params.party_name}`);
});

// ═══════════════════════════════════════════════
console.log('\nHindi/Hinglish Sales/Purchase:');
// ═══════════════════════════════════════════════

test('"mujhe sales dikhao" → get_sales_report(sales)', () => {
  const r = kw('mujhe sales dikhao');
  assert(r.action === 'get_sales_report', `expected get_sales_report, got ${r.action}`);
  assert(r.params.type === 'sales', `expected sales, got ${r.params.type}`);
});

test('"bikri dikhao" → get_sales_report(sales)', () => {
  const r = kw('bikri dikhao');
  assert(r.action === 'get_sales_report', `expected get_sales_report, got ${r.action}`);
});

test('"purchase dikhao" → get_sales_report(purchase)', () => {
  const r = kw('purchase dikhao');
  assert(r.action === 'get_sales_report', `expected get_sales_report, got ${r.action}`);
  assert(r.params.type === 'purchase', `expected purchase, got ${r.params.type}`);
});

test('"kharidari dikhao" → get_sales_report(purchase)', () => {
  const r = kw('kharidari dikhao');
  assert(r.action === 'get_sales_report', `expected get_sales_report, got ${r.action}`);
  assert(r.params.type === 'purchase', `expected purchase, got ${r.params.type}`);
});

// ═══════════════════════════════════════════════
console.log('\nHindi/Hinglish Vouchers:');
// ═══════════════════════════════════════════════

test('"aaj ke voucher dikhao" → get_vouchers', () => {
  const r = kw('aaj ke voucher dikhao');
  assert(r.action === 'get_vouchers', `expected get_vouchers, got ${r.action}`);
});

test('"voucher dikhao" → get_vouchers', () => {
  const r = kw('voucher dikhao');
  assert(r.action === 'get_vouchers', `expected get_vouchers, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nHindi/Hinglish Outstanding:');
// ═══════════════════════════════════════════════

test('"kitna lena hai" → get_outstanding(receivable)', () => {
  const r = kw('kitna lena hai');
  assert(r.action === 'get_outstanding', `expected get_outstanding, got ${r.action}`);
  assert(r.params.type === 'receivable', `expected receivable, got ${r.params.type}`);
});

test('"kitna dena hai" → get_outstanding(payable)', () => {
  const r = kw('kitna dena hai');
  assert(r.action === 'get_outstanding', `expected get_outstanding, got ${r.action}`);
  assert(r.params.type === 'payable', `expected payable, got ${r.params.type}`);
});

// ═══════════════════════════════════════════════
console.log('\nHindi/Hinglish P&L / Expenses:');
// ═══════════════════════════════════════════════

test('"fayda hua ya nuksan" → get_profit_loss', () => {
  const r = kw('fayda hua ya nuksan');
  assert(r.action === 'get_profit_loss', `expected get_profit_loss, got ${r.action}`);
});

test('"munafa kitna hua" → get_profit_loss', () => {
  const r = kw('munafa kitna hua');
  assert(r.action === 'get_profit_loss', `expected get_profit_loss, got ${r.action}`);
});

test('"kharcha dikhao" → get_expense_report', () => {
  const r = kw('kharcha dikhao');
  assert(r.action === 'get_expense_report', `expected get_expense_report, got ${r.action}`);
});

test('"paisa kahan ja raha hai" → get_expense_report', () => {
  const r = kw('paisa kahan ja raha hai');
  assert(r.action === 'get_expense_report', `expected get_expense_report, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nHindi/Hinglish Cash/Bank/Stock/GST:');
// ═══════════════════════════════════════════════

test('"bank mein kitna hai" → get_cash_bank_balance', () => {
  const r = kw('bank mein kitna hai');
  assert(r.action === 'get_cash_bank_balance', `expected get_cash_bank_balance, got ${r.action}`);
});

test('"cash kitna hai" → get_cash_bank_balance', () => {
  const r = kw('cash kitna hai');
  assert(r.action === 'get_cash_bank_balance', `expected get_cash_bank_balance, got ${r.action}`);
});

test('"stock dikhao" → get_stock_summary', () => {
  const r = kw('stock dikhao');
  assert(r.action === 'get_stock_summary', `expected get_stock_summary, got ${r.action}`);
});

test('"maal kitna hai" → get_stock_summary', () => {
  const r = kw('maal kitna hai');
  assert(r.action === 'get_stock_summary', `expected get_stock_summary, got ${r.action}`);
});

test('"gst kitna hai" → get_gst_summary', () => {
  const r = kw('gst kitna hai');
  assert(r.action === 'get_gst_summary', `expected get_gst_summary, got ${r.action}`);
});

test('"tax dikhao" → get_gst_summary', () => {
  const r = kw('tax dikhao');
  assert(r.action === 'get_gst_summary', `expected get_gst_summary, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nHindi/Hinglish Tally & Ledger List:');
// ═══════════════════════════════════════════════

test('"tally chal raha hai" → tally_status', () => {
  const r = kw('tally chal raha hai');
  assert(r.action === 'tally_status', `expected tally_status, got ${r.action}`);
});

test('"tally chalu hai" → tally_status', () => {
  const r = kw('tally chalu hai');
  assert(r.action === 'tally_status', `expected tally_status, got ${r.action}`);
});

test('"sab ledger dikhao" → list_ledgers', () => {
  const r = kw('sab ledger dikhao');
  assert(r.action === 'list_ledgers', `expected list_ledgers, got ${r.action}`);
});

test('"sabhi khate dikhao" → list_ledgers', () => {
  const r = kw('sabhi khate dikhao');
  assert(r.action === 'list_ledgers', `expected list_ledgers, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nGujarati Patterns:');
// ═══════════════════════════════════════════════

test('"badhaa ledger batavo" → list_ledgers', () => {
  const r = kw('badhaa ledger batavo');
  assert(r.action === 'list_ledgers', `expected list_ledgers, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nHindi Greetings:');
// ═══════════════════════════════════════════════

test('"kem cho" → greeting', () => {
  const r = kw('kem cho');
  assert(r.action === 'unknown', `expected unknown (greeting), got ${r.action}`);
  assert(r.suggestedReply && r.suggestedReply.includes('Tathastu'), 'should include Tathastu');
});

test('"kaise ho" → greeting', () => {
  const r = kw('kaise ho');
  assert(r.action === 'unknown', `expected unknown (greeting), got ${r.action}`);
  assert(r.suggestedReply && r.suggestedReply.includes('Welcome'), 'should include Welcome');
});

// ═══════════════════════════════════════════════
console.log('\nCreate Voucher vs Get Invoices:');
// ═══════════════════════════════════════════════

test('"create invoice for meril of Rs. 100" → create_voucher', () => {
  const r = kw('create invoice for meril of Rs. 100');
  assert(r.action === 'create_voucher', `expected create_voucher, got ${r.action}`);
  assert(r.params.party_name === 'meril', `expected meril, got ${r.params.party_name}`);
  assert(r.params.amount === 100, `expected 100, got ${r.params.amount}`);
  assert(r.params.voucher_type === 'Sales', `expected Sales, got ${r.params.voucher_type}`);
});

test('"create sales invoice for meril 50000" → create_voucher(Sales)', () => {
  const r = kw('create sales invoice for meril 50000');
  assert(r.action === 'create_voucher', `expected create_voucher, got ${r.action}`);
  assert(r.params.party_name === 'meril', `expected meril, got ${r.params.party_name}`);
  assert(r.params.amount === 50000, `expected 50000, got ${r.params.amount}`);
  assert(r.params.voucher_type === 'Sales', `expected Sales, got ${r.params.voucher_type}`);
});

test('"record payment from ABC 25000" → create_voucher(Payment)', () => {
  const r = kw('record payment from ABC 25000');
  assert(r.action === 'create_voucher', `expected create_voucher, got ${r.action}`);
  assert(r.params.party_name.toLowerCase() === 'abc', `expected abc, got ${r.params.party_name}`);
  assert(r.params.amount === 25000, `expected 25000, got ${r.params.amount}`);
  assert(r.params.voucher_type === 'Payment', `expected Payment, got ${r.params.voucher_type}`);
});

test('"create receipt from Dhrupal 10000" → create_voucher(Receipt)', () => {
  const r = kw('create receipt from Dhrupal 10000');
  assert(r.action === 'create_voucher', `expected create_voucher, got ${r.action}`);
  assert(r.params.party_name.toLowerCase() === 'dhrupal', `expected dhrupal, got ${r.params.party_name}`);
  assert(r.params.voucher_type === 'Receipt', `expected Receipt, got ${r.params.voucher_type}`);
});

test('"make purchase invoice for Google Cloud of Rs 5000" → create_voucher(Purchase)', () => {
  const r = kw('make purchase invoice for Google Cloud of Rs 5000');
  assert(r.action === 'create_voucher', `expected create_voucher, got ${r.action}`);
  assert(r.params.party_name.toLowerCase() === 'google cloud', `expected google cloud, got ${r.params.party_name}`);
  assert(r.params.amount === 5000, `expected 5000, got ${r.params.amount}`);
});

test('"invoices for meril" → get_party_invoices (NOT create)', () => {
  const r = kw('invoices for meril');
  assert(r.action === 'get_party_invoices', `expected get_party_invoices, got ${r.action}`);
  assert(r.params.party_name === 'meril', `expected meril, got ${r.params.party_name}`);
});

test('"show invoices of ABC" → get_party_invoices (NOT create)', () => {
  const r = kw('show invoices of ABC');
  assert(r.action === 'get_party_invoices', `expected get_party_invoices, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nDaybook Patterns:');
// ═══════════════════════════════════════════════

test('"daybook" → get_daybook', () => {
  const r = kw('daybook');
  assert(r.action === 'get_daybook', `expected get_daybook, got ${r.action}`);
});

test('"day book" → get_daybook', () => {
  const r = kw('day book');
  assert(r.action === 'get_daybook', `expected get_daybook, got ${r.action}`);
});

test('"today\'s entries" → get_daybook', () => {
  const r = kw("today's entries");
  assert(r.action === 'get_daybook', `expected get_daybook, got ${r.action}`);
});

test('"what happened today" → get_daybook', () => {
  const r = kw('what happened today');
  assert(r.action === 'get_daybook', `expected get_daybook, got ${r.action}`);
});

test('"aaj ka daybook" → get_daybook', () => {
  const r = kw('aaj ka daybook');
  assert(r.action === 'get_daybook', `expected get_daybook, got ${r.action}`);
});

test('"aaj kya hua" → get_daybook', () => {
  const r = kw('aaj kya hua');
  assert(r.action === 'get_daybook', `expected get_daybook, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nNew Hindi/Gujarati Patterns:');
// ═══════════════════════════════════════════════

test('"meril ka pending bill" → get_bill_outstanding', () => {
  const r = kw('meril ka pending bill');
  assert(r.action === 'get_bill_outstanding', `expected get_bill_outstanding, got ${r.action}`);
  assert(r.params.party_name === 'meril', `expected meril, got ${r.params.party_name}`);
});

test('"sabse bade customer" → get_top_customers', () => {
  const r = kw('sabse bade customer');
  assert(r.action === 'get_top_customers', `expected get_top_customers, got ${r.action}`);
});

test('"sabse zyada bikne wala" → get_top_items', () => {
  const r = kw('sabse zyada bikne wala');
  assert(r.action === 'get_top_items', `expected get_top_items, got ${r.action}`);
});

test('"purane baaki" → get_ageing_analysis', () => {
  const r = kw('purane baaki');
  assert(r.action === 'get_ageing_analysis', `expected get_ageing_analysis, got ${r.action}`);
});

test('"yaad dilao payment ki" → get_payment_reminders', () => {
  const r = kw('yaad dilao payment ki');
  assert(r.action === 'get_payment_reminders', `expected get_payment_reminders, got ${r.action}`);
});

test('"nafa tota batavo" → get_profit_loss (Gujarati)', () => {
  const r = kw('nafa tota batavo');
  assert(r.action === 'get_profit_loss', `expected get_profit_loss, got ${r.action}`);
});

test('"kharcho batavo" → get_expense_report (Gujarati)', () => {
  const r = kw('kharcho batavo');
  assert(r.action === 'get_expense_report', `expected get_expense_report, got ${r.action}`);
});

test('"sundry debtors" → get_outstanding(receivable)', () => {
  const r = kw('sundry debtors');
  assert(r.action === 'get_outstanding', `expected get_outstanding, got ${r.action}`);
  assert(r.params.type === 'receivable', `expected receivable, got ${r.params.type}`);
});

test('"sundry creditors" → get_outstanding(payable)', () => {
  const r = kw('sundry creditors');
  assert(r.action === 'get_outstanding', `expected get_outstanding, got ${r.action}`);
  assert(r.params.type === 'payable', `expected payable, got ${r.params.type}`);
});

test('"overdue report" → get_ageing_analysis', () => {
  const r = kw('overdue report');
  assert(r.action === 'get_ageing_analysis', `expected get_ageing_analysis, got ${r.action}`);
});

test('"old dues" → get_ageing_analysis', () => {
  const r = kw('old dues');
  assert(r.action === 'get_ageing_analysis', `expected get_ageing_analysis, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nComparison Report Patterns:');
// ═══════════════════════════════════════════════

test('"compare sales this month vs last month" → compare_periods(sales, month)', () => {
  const r = kw('compare sales this month vs last month');
  assert(r.action === 'compare_periods', `expected compare_periods, got ${r.action}`);
  assert(r.params.report_type === 'sales', `expected sales, got ${r.params.report_type}`);
  assert(r.params.period === 'month', `expected month, got ${r.params.period}`);
});

test('"sales comparison" → compare_periods(sales)', () => {
  const r = kw('sales comparison');
  assert(r.action === 'compare_periods', `expected compare_periods, got ${r.action}`);
});

test('"compare expenses quarter" → compare_periods(expenses, quarter)', () => {
  const r = kw('compare expenses quarter');
  assert(r.action === 'compare_periods', `expected compare_periods, got ${r.action}`);
  assert(r.params.report_type === 'expenses', `expected expenses, got ${r.params.report_type}`);
  assert(r.params.period === 'quarter', `expected quarter, got ${r.params.period}`);
});

test('"compare profit year" → compare_periods(pnl, year)', () => {
  const r = kw('compare profit year');
  assert(r.action === 'compare_periods', `expected compare_periods, got ${r.action}`);
  assert(r.params.report_type === 'pnl', `expected pnl, got ${r.params.report_type}`);
  assert(r.params.period === 'year', `expected year, got ${r.params.period}`);
});

test('"purchase vs last month" → compare_periods(purchase, month)', () => {
  const r = kw('purchase vs last month');
  assert(r.action === 'compare_periods', `expected compare_periods, got ${r.action}`);
  assert(r.params.report_type === 'purchase', `expected purchase, got ${r.params.report_type}`);
});

test('"pichle mahine se compare karo sales" → compare_periods(sales)', () => {
  const r = kw('pichle mahine se compare karo sales');
  assert(r.action === 'compare_periods', `expected compare_periods, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nAlert Patterns:');
// ═══════════════════════════════════════════════

test('"alert me when cash drops below 50000" → set_alert(cash_below, 50000)', () => {
  const r = kw('alert me when cash drops below 50000');
  assert(r.action === 'set_alert', `expected set_alert, got ${r.action}`);
  assert(r.params.alert_type === 'cash_below', `expected cash_below, got ${r.params.alert_type}`);
  assert(r.params.threshold === 50000, `expected 50000, got ${r.params.threshold}`);
});

test('"alert when receivable above 10L" → set_alert(receivable_above, 1000000)', () => {
  const r = kw('alert when receivable above 10L');
  assert(r.action === 'set_alert', `expected set_alert, got ${r.action}`);
  assert(r.params.alert_type === 'receivable_above', `expected receivable_above, got ${r.params.alert_type}`);
  assert(r.params.threshold === 1000000, `expected 1000000, got ${r.params.threshold}`);
});

test('"alert payable above 5K" → set_alert(payable_above, 5000)', () => {
  const r = kw('alert payable above 5K');
  assert(r.action === 'set_alert', `expected set_alert, got ${r.action}`);
  assert(r.params.alert_type === 'payable_above', `expected payable_above, got ${r.params.alert_type}`);
  assert(r.params.threshold === 5000, `expected 5000, got ${r.params.threshold}`);
});

test('"show my alerts" → list_alerts', () => {
  const r = kw('show my alerts');
  assert(r.action === 'list_alerts', `expected list_alerts, got ${r.action}`);
});

test('"remove alert 1" → remove_alert(1)', () => {
  const r = kw('remove alert 1');
  assert(r.action === 'remove_alert', `expected remove_alert, got ${r.action}`);
  assert(r.params.alert_id === '1', `expected 1, got ${r.params.alert_id}`);
});

// ═══════════════════════════════════════════════
console.log('\nScheduler / Summary Patterns:');
// ═══════════════════════════════════════════════

test('"daily summary" → send_daily_summary', () => {
  const r = kw('daily summary');
  assert(r.action === 'send_daily_summary', `expected send_daily_summary, got ${r.action}`);
});

test('"send summary" → send_daily_summary', () => {
  const r = kw('send summary');
  assert(r.action === 'send_daily_summary', `expected send_daily_summary, got ${r.action}`);
});

test('"aaj ka summary bhejo" → send_daily_summary', () => {
  const r = kw('aaj ka summary bhejo');
  assert(r.action === 'send_daily_summary', `expected send_daily_summary, got ${r.action}`);
});

// ═══════════════════════════════════════════════
console.log('\nMulti-Company Patterns:');
// ═══════════════════════════════════════════════

test('"switch company to Afflink" → switch_company(Afflink)', () => {
  const r = kw('switch company to Afflink');
  assert(r.action === 'switch_company', `expected switch_company, got ${r.action}`);
  assert(r.params.company_name === 'afflink', `expected afflink, got ${r.params.company_name}`);
});

test('"change company to Mobibox" → switch_company(Mobibox)', () => {
  const r = kw('change company to Mobibox');
  assert(r.action === 'switch_company', `expected switch_company, got ${r.action}`);
  assert(r.params.company_name === 'mobibox', `expected mobibox, got ${r.params.company_name}`);
});

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log(`\n${'═'.repeat(40)}`);
console.log(`Hindi/Hinglish keyword tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
