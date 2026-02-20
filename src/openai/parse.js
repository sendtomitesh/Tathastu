const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { getActionsForPrompt } = require('../config/load');

// Load local knowledge base once at startup
let _knowledgeBase = '';
try {
  const kbPath = path.join(__dirname, '..', '..', 'config', 'knowledge.md');
  _knowledgeBase = fs.readFileSync(kbPath, 'utf-8').trim();
} catch { /* no knowledge base file — that's fine */ }

/**
 * Build a friendly capabilities message for the user.
 */
function getCapabilitiesMessage() {
  return [
    "Here's what I can help you with:",
    '',
    '📒 *Ledger* — "Ledger for Meril", "Statement of Atul"',
    '💰 *Balance* — "Balance of Google Cloud", "What does Meril owe?"',
    '🧾 *Vouchers* — "Show today\'s vouchers", "Sales vouchers this week"',
    '📋 *Day Book* — "Today\'s daybook", "Daybook for yesterday"',
    '📊 *Sales/Purchase Report* — "Sales this month", "Purchase report for January"',
    '📑 *Outstanding* — "Outstanding receivable", "What do we owe?"',
    '🏦 *Cash & Bank* — "Bank balance", "Cash in hand"',
    '📈 *Profit & Loss* — "P&L this year", "Are we profitable?"',
    '💸 *Expenses* — "Expenses this month", "Where is money going?"',
    '📦 *Stock* — "Stock summary", "Stock of Widget A"',
    '🧾 *GST Summary* — "GST this month", "Tax liability"',
    '📄 *Bill Outstanding* — "Pending bills for Meril", "Unpaid invoices"',
    '📃 *List Ledgers* — "List all ledgers", "Show bank accounts"',
    '🔍 *GSTIN* — "GSTIN of Meril", "GST number for ABC"',
    '🏆 *Top Reports* — "Top customers", "Top selling items", "Top suppliers"',
    '📋 *Trial Balance* — "Trial balance", "Show TB"',
    '🏦 *Balance Sheet* — "Balance sheet", "Assets and liabilities"',
    '⏳ *Ageing Analysis* — "Ageing receivable", "Overdue analysis"',
    '😴 *Inactive Reports* — "Inactive customers", "Dormant suppliers", "Slow items"',
    '📋 *Orders* — "Sales orders", "Purchase orders", "Pending orders"',
    '📨 *Payment Reminders* — "Payment reminders", "Remind Meril about payment"',
    '✏️ *Create Voucher* — "Create sales invoice for Meril 50000", "Record receipt from ABC"',
    '📊 *Excel Export* — "Export excel" (after any report)',
    '🖥️ *Tally Control* — "Tally status", "Restart tally", "Open Mobibox", "List companies"',
    '',
    'Just type naturally or send a voice note — I understand Hindi, Gujarati, English & more! 🎙️'
  ].join('\n');
}

/**
 * Build system prompt from config: list enabled skills and their actions with parameters.
 */
function buildSystemPrompt(config) {
  const actions = getActionsForPrompt(config);
  const lines = [
    'You are a helpful assistant that runs commands across connected services (e.g. accounting, CRM, tools). The user sends a message.',
    'Return ONLY valid JSON, no markdown or explanation.',
    '',
    'IMPORTANT: You will receive recent conversation history. Use it to resolve references like "his", "their", "that party", "payable for them", etc.',
    'For example, if the user previously asked about "Dharmesh" and now says "payable", infer they mean get_party_balance for Dharmesh.',
    'If the previous bot reply listed suggestions (numbered list of party names), and the user replies with a number or a name from that list, use that name as the party_name and REPEAT the same action that was originally requested.',
    'For example: if user asked "ledger for meril", bot replied with a numbered list, and user says "2" or "Meril Life Sciences Pvt Ltd", return get_ledger with that party_name.',
    'ALWAYS try to extract a party_name from the user message even if partial or misspelled. Never return party_name as null if the user mentioned any name.',
    '',
    'If the message matches one of the actions below, return: {"skillId":"<id>","action":"<action>","params":{"param_name":"value"}}',
    'CRITICAL: params MUST be a JSON object with named keys, NOT an array. Example: {"party_name":"Meril"} not ["Meril"]',
    'If the message does NOT match any action (greeting, question, unclear, or off-topic), return:',
    '{"skillId":null,"action":"unknown","params":{},"suggestedReply":"Your brief friendly reply here."}',
    '',
    `For suggestedReply when the user says hello/hi: greet them warmly and list what you can do in a friendly way. Include these capabilities:`,
    '- Ledger/Statement for a party',
    '- Balance (receivable/payable) for a party',
    '- Today\'s vouchers or daybook',
    '- Sales or Purchase report',
    '- Outstanding receivable or payable',
    '- Cash & Bank balances',
    '- Profit & Loss summary',
    '- Expense report',
    '- Stock/Inventory summary',
    '- GST tax summary',
    '- Bill outstanding for a party',
    '- List ledgers',
    '- GSTIN lookup',
    '- Tally status, restart, start, list companies',
    '- Top customers, suppliers, items',
    '- Trial Balance',
    '- Balance Sheet',
    '- Ageing analysis (overdue buckets)',
    '- Inactive customers, suppliers, items',
    '- Sales/Purchase orders and pending orders',
    '- Payment reminders for overdue parties',
    '- Create vouchers (Sales, Purchase, Receipt, Payment)',
    '- Export any report as Excel',
    'Give 1-2 example queries. Keep it under 150 words. Use emojis sparingly.',
    'If the message is unclear (not a greeting, not matching any action), politely say you didn\'t understand and list 2-3 example queries they can try.',
    '',
    'Available actions (skillId, action, parameters):',
  ];
  for (const a of actions) {
    const paramsStr = a.parameters.length ? a.parameters.join(', ') : 'none';
    lines.push(`- skillId="${a.skillId}", action="${a.actionId}", params: [${paramsStr}]. ${a.description}`);
  }
  lines.push('');
  // Tell the LLM today's date so it can resolve relative dates like "yesterday", "last week"
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  lines.push(`Today's date is ${todayStr}. Use this to resolve relative dates like "yesterday", "last week", "this month", "last 7 days", etc. into actual YYYY-MM-DD values for date_from and date_to.`);
  lines.push('IMPORTANT: For get_profit_loss, get_expense_report, get_gst_summary, get_trial_balance, and get_balance_sheet — ONLY set date_from/date_to if the user EXPLICITLY mentions a date or period (e.g. "last month", "this quarter", "Jan to Mar"). If the user just says "p&l" or "trial balance" or "balance sheet" without any date, set date_from and date_to to null. Tally will use the company\'s own financial year which is always correct.');
  lines.push('Extract parameter values from the user message. Use null for missing optional params. For dates use YYYY-MM-DD or YYYYMMDD. For limit use a number.');
  lines.push('PAGINATION: When the user says "more", "next", "next page", "page 2", "show more", "aur dikhao", "aage", repeat the SAME action with the same params but add page=N (next page number). Look at conversation history to find which action was last used and what page was shown.');
  lines.push('VOUCHER TYPE SELECTION: When the bot previously showed a list of available voucher types (e.g. "1. Sales — 32 vouchers, 2. Payment — 1433 vouchers") and the user replies with a voucher type name (e.g. "Payment", "Sales", "Journal") or a number from that list, use get_sales_orders with voucher_type set to that type name. For example, if user says "show me Payment vouchers" or just "Payment", return get_sales_orders with voucher_type="Payment".');
  // Inject local knowledge base if available
  if (_knowledgeBase) {
    lines.push('');
    lines.push('=== DOMAIN KNOWLEDGE BASE ===');
    lines.push('Use the following knowledge to better understand user queries, especially in Hindi/Gujarati, accounting terms, and common abbreviations:');
    lines.push(_knowledgeBase);
    lines.push('=== END KNOWLEDGE BASE ===');
  }
  return lines.join('\n');
}

function parseJsonResponse(content) {
  const cleaned = (content || '').replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  // Ensure params is a plain object, not an array
  let params = parsed.params;
  if (Array.isArray(params)) {
    params = {};
  } else if (!params || typeof params !== 'object') {
    params = {};
  }
  return {
    skillId: parsed.skillId === undefined || parsed.skillId === null ? null : String(parsed.skillId),
    action: typeof parsed.action === 'string' ? parsed.action : 'unknown',
    params,
    suggestedReply: typeof parsed.suggestedReply === 'string' ? parsed.suggestedReply.trim() : null,
  };
}

/** OpenAI (or any OpenAI-compatible API, e.g. Groq). */
async function parseWithOpenAI(userMessage, config, apiKey = process.env.OPENAI_API_KEY, history = []) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (required for provider: openai)');
  const model = config.llm?.model || config.openai?.model || 'gpt-4o-mini';
  const baseURL = config.llm?.baseUrl || undefined;
  const openai = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });

  // Build messages: system + recent history + current user message
  const msgs = [{ role: 'system', content: buildSystemPrompt(config) }];
  for (const h of history) {
    msgs.push({ role: h.role, content: h.content });
  }
  msgs.push({ role: 'user', content: userMessage });

  const completion = await openai.chat.completions.create({
    model,
    messages: msgs,
    temperature: 0.1,
    max_tokens: 500,
  });
  const content = completion.choices?.[0]?.message?.content?.trim() || '';
  try {
    return parseJsonResponse(content);
  } catch (_) {
    return { skillId: null, action: 'unknown', params: {}, suggestedReply: null };
  }
}

/** Ollama (local, no API key). Requires Ollama running with a model (e.g. llama3.2, mistral). */
async function parseWithOllama(userMessage, config, history = []) {
  const model = config.llm?.model || 'llama3.2';
  const baseUrl = (config.llm?.baseUrl || 'http://localhost:11434').replace(/\/$/, '');

  const msgs = [{ role: 'system', content: buildSystemPrompt(config) }];
  for (const h of history) {
    msgs.push({ role: h.role, content: h.content });
  }
  msgs.push({ role: 'user', content: userMessage });

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, stream: false }),
  });
  if (!res.ok) throw new Error('Ollama request failed: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  const content = data.message?.content?.trim() || '';
  try {
    return parseJsonResponse(content);
  } catch (_) {
    return { skillId: null, action: 'unknown', params: {}, suggestedReply: null };
  }
}

/** Simple keyword/regex matching. No API key, no network. Good for fixed commands. */
function parseWithKeyword(userMessage, config) {
  const text = (userMessage || '').trim().toLowerCase();
  const actions = getActionsForPrompt(config);
  const defaultReply = getCapabilitiesMessage();

  if (!text) return { skillId: null, action: 'unknown', params: {}, suggestedReply: defaultReply };

  // Greetings
  if (/^(hi|hello|hey|hiya|good morning|good evening|gm|sup|namaste|namaskar)\s*!?\.?$/i.test(text))
    return { skillId: null, action: 'unknown', params: {}, suggestedReply: "Hey! 👋 Welcome to Tathastu.\n\n" + defaultReply };

  // --- Party-specific actions (need party name extraction) ---

  // get_ledger: "ledger of X", "statement of X", "ledger for X", "transactions for X", "check party X"
  // Stop capturing party name at date-related words so "ledger for dhrupal for 2025" falls through to OpenAI
  const DATE_STOP = /\s+(?:for|from|in|since|during|between|this|last|next|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|20\d{2}|yesterday|today|week|month|quarter|year)\b/i;
  const ledgerMatch = text.match(/(?:get\s+)?(?:ledger|statement|transactions?)\s+(?:of|for)\s+(.+?)(?:\s*\.|$)/i)
    || text.match(/ledger\s+(.+?)(?:\s*\.|$)/i)
    || text.match(/(?:check|search|find|show)\s+(?:for\s+)?(?:party(?:\s+name)?(?:\s+like)?)\s+(.+?)(?:\s+and\b.*|$)/i)
    || text.match(/(?:party|account)\s+(?:details?|info|summary)\s+(?:of|for)\s+(.+?)(?:\s*\.|$)/i);
  if (ledgerMatch) {
    let party = ledgerMatch[1].trim().replace(/\s*\.\s*$/, '');
    // If the captured party name contains date-related words, let OpenAI handle it for proper date extraction
    const datePartIdx = party.search(DATE_STOP);
    if (datePartIdx > 0) {
      // There's a date part — fall through to OpenAI so it can extract both party + dates
      // (keyword parser can't handle dates)
    } else if (party && !DATE_STOP.test(' ' + party)) {
      return { skillId: 'tally', action: 'get_ledger', params: { party_name: party }, suggestedReply: null };
    }
    // else fall through to OpenAI for proper date extraction
  }

  // get_party_balance: "balance of X", "what does X owe"
  const balMatch = text.match(/(?:balance|owe|receivable|payable)\s+(?:of|for|from)\s+(.+?)(?:\s*\.|$)/i);
  if (balMatch) {
    const party = balMatch[1].trim().replace(/\s*\.\s*$/, '');
    if (party) return { skillId: 'tally', action: 'get_party_balance', params: { party_name: party }, suggestedReply: null };
  }

  // get_party_invoices: "invoices for X", "bills of X"
  const invMatch = text.match(/(?:invoices?|bills?)\s+(?:of|for)\s+(.+?)(?:\s*\.|$)/i);
  if (invMatch) {
    const party = invMatch[1].trim().replace(/\s*\.\s*$/, '');
    if (party) return { skillId: 'tally', action: 'get_party_invoices', params: { party_name: party }, suggestedReply: null };
  }

  // get_bill_outstanding: "pending bills for X", "bill outstanding for X"
  const billMatch = text.match(/(?:pending\s+bills?|bill\s+outstanding|unpaid)\s+(?:of|for)\s+(.+?)(?:\s*\.|$)/i);
  if (billMatch) {
    const party = billMatch[1].trim().replace(/\s*\.\s*$/, '');
    if (party) return { skillId: 'tally', action: 'get_bill_outstanding', params: { party_name: party }, suggestedReply: null };
  }

  // get_party_gstin: "gstin of X", "gst number for X"
  const gstinMatch = text.match(/(?:gstin|gst\s*(?:number|no|#))\s+(?:of|for)\s+(.+?)(?:\s*\.|$)/i);
  if (gstinMatch) {
    const party = gstinMatch[1].trim().replace(/\s*\.\s*$/, '');
    if (party) return { skillId: 'tally', action: 'get_party_gstin', params: { party_name: party }, suggestedReply: null };
  }

  // send_reminder: "send reminder to X", "remind X"
  const reminderMatch = text.match(/(?:send\s+)?remind(?:er)?\s+(?:to\s+)?(.+?)(?:\s*\.|$)/i);
  if (reminderMatch && !/^(me|us)$/i.test(reminderMatch[1].trim())) {
    const party = reminderMatch[1].trim().replace(/\s*\.\s*$/, '');
    if (party) return { skillId: 'tally', action: 'send_reminder', params: { party_name: party }, suggestedReply: null };
  }

  // get_invoice_pdf: "send invoice X", "pdf of invoice X", "invoice #X"
  const pdfMatch = text.match(/(?:send|pdf|share)\s+(?:of\s+)?invoice\s+#?(.+?)(?:\s*\.|$)/i) || text.match(/invoice\s+#?([A-Z0-9][\w-]+)/i);
  if (pdfMatch) {
    return { skillId: 'tally', action: 'get_invoice_pdf', params: { invoice_number: pdfMatch[1].trim() }, suggestedReply: null };
  }

  // open_company: "open company X", "switch to X"
  const compMatch = text.match(/(?:open|switch\s+to|load)\s+(?:company\s+)?(.+?)(?:\s*\.|$)/i);
  if (compMatch && !/tally/i.test(compMatch[1])) {
    return { skillId: 'tally', action: 'open_company', params: { company_name: compMatch[1].trim() }, suggestedReply: null };
  }

  // --- Export (must be before voucher/report patterns) ---

  // export_excel: "excel for payment vouchers", "download excel", "export excel"
  if (/\bexcel\b|\bexport\b|\bdownload\b/i.test(text)) {
    const reportMatch = text.match(/\b(voucher|payment|sales|purchase|receipt|journal|outstanding|expense|stock|ledger|p&l|profit|balance|trial|gst)/i);
    const reportName = reportMatch ? reportMatch[1] : null;
    return { skillId: 'tally', action: 'export_excel', params: { report_name: reportName || 'Report' }, suggestedReply: null };
  }

  // --- Vouchers & Daybook ---

  if (/voucher|day\s*book|daybook/i.test(text)) {
    const limitMatch = text.match(/(?:last\s+)?(\d+)\s*(?:voucher|sales|purchase)?/i);
    const wantsAll = /\ball\b/i.test(text);
    const limit = wantsAll ? 0 : (limitMatch ? parseInt(limitMatch[1], 10) : 50);
    const typeMatch = text.match(/\b(sales|purchase|payment|receipt|contra|journal|credit note|debit note)\b/i);
    const voucherType = typeMatch ? typeMatch[1] : null;
    return { skillId: 'tally', action: 'get_vouchers', params: { date_from: null, date_to: null, voucher_type: voucherType, limit }, suggestedReply: null };
  }

  // list_ledgers: "list ledgers", "show ledgers"
  if (/list\s+ledgers?|show\s+ledgers?|ledgers?\s+list/i.test(text)) {
    return { skillId: 'tally', action: 'list_ledgers', params: { group_filter: null }, suggestedReply: null };
  }

  // --- Financial Reports ---

  // trial_balance: "trial balance", "TB"
  if (/trial\s*bal|^tb$/i.test(text)) {
    return { skillId: 'tally', action: 'get_trial_balance', params: { date_from: null, date_to: null }, suggestedReply: null };
  }

  // balance_sheet: "balance sheet", "BS", "assets and liabilities"
  if (/balance\s*sheet|^bs$|assets?\s*(and|&)\s*liabilit/i.test(text)) {
    return { skillId: 'tally', action: 'get_balance_sheet', params: { date_from: null, date_to: null }, suggestedReply: null };
  }

  // profit_loss: "P&L", "profit loss", "profit and loss", "are we profitable"
  if (/p\s*[&n]\s*l|profit\s*(and\s+)?loss|profitab/i.test(text)) {
    return { skillId: 'tally', action: 'get_profit_loss', params: { date_from: null, date_to: null }, suggestedReply: null };
  }

  // sales/purchase report: "sales report", "sales this month", "purchase report", "get sales"
  if (/\bsales\b|\bpurchase\b/i.test(text) && !/voucher|order/i.test(text)) {
    const type = /purchase/i.test(text) ? 'purchase' : 'sales';
    return { skillId: 'tally', action: 'get_sales_report', params: { type, date_from: null, date_to: null }, suggestedReply: null };
  }

  // outstanding: "outstanding", "receivable", "payable", "what do we owe"
  if (/outstanding|receivable|payable|what\s+(?:do\s+)?we\s+owe|who\s+owes/i.test(text)) {
    const type = /payable|we\s+owe|creditor/i.test(text) ? 'payable' : 'receivable';
    return { skillId: 'tally', action: 'get_outstanding', params: { type }, suggestedReply: null };
  }

  // cash_bank: "bank balance", "cash in hand", "cash balance", "how much money"
  if (/bank\s*bal|cash\s*(in\s*hand|bal)|how\s+much\s+money/i.test(text)) {
    return { skillId: 'tally', action: 'get_cash_bank_balance', params: {}, suggestedReply: null };
  }

  // expense_report: "expenses", "expense report", "where is money going"
  if (/expense|where\s+.*money\s+going/i.test(text)) {
    return { skillId: 'tally', action: 'get_expense_report', params: { date_from: null, date_to: null }, suggestedReply: null };
  }

  // stock_summary: "stock", "inventory", "stock of X"
  if (/stock|inventory/i.test(text)) {
    const itemMatch = text.match(/(?:stock|inventory)\s+(?:of|for)\s+(.+?)(?:\s*\.|$)/i);
    return { skillId: 'tally', action: 'get_stock_summary', params: { item_name: itemMatch ? itemMatch[1].trim() : null }, suggestedReply: null };
  }

  // gst_summary: "GST", "tax liability", "GST summary"
  if (/\bgst\b|tax\s*liab/i.test(text)) {
    return { skillId: 'tally', action: 'get_gst_summary', params: { date_from: null, date_to: null }, suggestedReply: null };
  }

  // ageing_analysis: "ageing", "aging", "overdue analysis"
  if (/age?ing|overdue\s*analysis/i.test(text)) {
    const type = /payable|creditor/i.test(text) ? 'payable' : 'receivable';
    return { skillId: 'tally', action: 'get_ageing_analysis', params: { type }, suggestedReply: null };
  }

  // top reports: "top customers", "top suppliers", "top items", "best selling"
  if (/top\s*(customer|client|buyer)/i.test(text)) {
    return { skillId: 'tally', action: 'get_top_customers', params: { date_from: null, date_to: null, limit: 10 }, suggestedReply: null };
  }
  if (/top\s*(supplier|vendor)/i.test(text)) {
    return { skillId: 'tally', action: 'get_top_suppliers', params: { date_from: null, date_to: null, limit: 10 }, suggestedReply: null };
  }
  if (/top\s*(item|product|selling|purchased)/i.test(text) || /best\s*sell/i.test(text)) {
    const type = /purchase/i.test(text) ? 'purchase' : 'sales';
    return { skillId: 'tally', action: 'get_top_items', params: { type, date_from: null, date_to: null, limit: 10 }, suggestedReply: null };
  }

  // inactive reports: "inactive customers", "dormant", "dead stock"
  if (/inactive\s*customer|dormant\s*customer/i.test(text)) {
    const daysMatch = text.match(/(\d+)\s*days?/i);
    return { skillId: 'tally', action: 'get_inactive_customers', params: { days: daysMatch ? parseInt(daysMatch[1], 10) : 30 }, suggestedReply: null };
  }
  if (/inactive\s*supplier|dormant\s*(?:supplier|vendor)/i.test(text)) {
    const daysMatch = text.match(/(\d+)\s*days?/i);
    return { skillId: 'tally', action: 'get_inactive_suppliers', params: { days: daysMatch ? parseInt(daysMatch[1], 10) : 30 }, suggestedReply: null };
  }
  if (/inactive\s*item|dead\s*stock|slow\s*mov/i.test(text)) {
    const daysMatch = text.match(/(\d+)\s*days?/i);
    return { skillId: 'tally', action: 'get_inactive_items', params: { days: daysMatch ? parseInt(daysMatch[1], 10) : 30 }, suggestedReply: null };
  }

  // --- Tally management ---

  // tally_status: "tally status", "is tally running"
  if (/tally\s*status|is\s+tally\s+running|check\s+tally/i.test(text)) {
    return { skillId: 'tally', action: 'tally_status', params: {}, suggestedReply: null };
  }

  // list_companies: "list companies", "which companies"
  if (/list\s*compan|which\s*compan|what\s*compan/i.test(text)) {
    return { skillId: 'tally', action: 'list_companies', params: {}, suggestedReply: null };
  }

  // restart_tally: "restart tally", "reboot tally"
  if (/restart\s*tally|reboot\s*tally|tally\s*(?:not\s+)?respond/i.test(text)) {
    return { skillId: 'tally', action: 'restart_tally', params: {}, suggestedReply: null };
  }

  // start_tally: "start tally", "open tally", "launch tally"
  if (/start\s*tally|launch\s*tally/i.test(text)) {
    return { skillId: 'tally', action: 'start_tally', params: {}, suggestedReply: null };
  }

  // payment_reminders: "payment reminders", "overdue reminders", "collection reminders"
  if (/payment\s*remind|overdue\s*remind|collection\s*remind/i.test(text)) {
    return { skillId: 'tally', action: 'get_payment_reminders', params: {}, suggestedReply: null };
  }

  // sales/purchase orders: "sales orders", "purchase orders"
  if (/sales?\s*order/i.test(text)) {
    return { skillId: 'tally', action: 'get_sales_orders', params: { date_from: null, date_to: null }, suggestedReply: null };
  }
  if (/purchase\s*order/i.test(text)) {
    return { skillId: 'tally', action: 'get_purchase_orders', params: { date_from: null, date_to: null }, suggestedReply: null };
  }
  if (/pending\s*order|unfulfilled\s*order/i.test(text)) {
    const type = /purchase/i.test(text) ? 'purchase' : 'sales';
    return { skillId: 'tally', action: 'get_pending_orders', params: { type, date_from: null, date_to: null }, suggestedReply: null };
  }

  return { skillId: null, action: 'unknown', params: {}, suggestedReply: defaultReply };
}

/**
 * Resolve which LLM provider to use from config.
 */
function getProvider(config) {
  const p = config.llm?.provider || (config.openai ? 'openai' : 'keyword');
  return p;
}

/**
 * Parse user message and return { skillId, action, params, suggestedReply }.
 * Provider is chosen from config.llm.provider: 'openai' | 'ollama' | 'keyword'.
 * @param {string} userMessage
 * @param {object} config
 * @param {string} [apiKey]
 * @param {Array<{role: string, content: string}>} [history] - Recent conversation history
 */
async function parseIntent(userMessage, config, apiKey = process.env.OPENAI_API_KEY, history = []) {
  const provider = getProvider(config);
  // Always try keyword matching first — it's free, fast, and handles common patterns
  const keywordResult = parseWithKeyword(userMessage, config);
  if (keywordResult.skillId != null && keywordResult.action !== 'unknown') {
    return keywordResult;
  }
  if (provider === 'openai') return parseWithOpenAI(userMessage, config, apiKey, history);
  if (provider === 'ollama') return parseWithOllama(userMessage, config, history);
  if (provider === 'keyword') return keywordResult; // already computed above
  throw new Error('Unknown LLM provider: ' + provider + '. Use openai, ollama, or keyword.');
}

function getAvailableCommandsHelp(config) {
  const actions = getActionsForPrompt(config);
  const lines = actions.map((a) => `- ${a.skillId}: ${a.actionId} (${a.parameters.join(', ')})`);
  return 'You can ask for: ' + (lines.length ? lines.join('; ') : 'No actions configured.');
}

module.exports = {
  buildSystemPrompt,
  getCapabilitiesMessage,
  parseIntent,
  getAvailableCommandsHelp,
  getProvider,
};
