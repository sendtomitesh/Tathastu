const OpenAI = require('openai');
const { getActionsForPrompt } = require('../config/load');

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
  lines.push('IMPORTANT: For get_profit_loss, get_expense_report, and get_gst_summary — ONLY set date_from/date_to if the user EXPLICITLY mentions a date or period (e.g. "last month", "this quarter", "Jan to Mar"). If the user just says "p&l" or "profit loss" or "expenses" without any date, set date_from and date_to to null. Tally will use the company\'s own financial year which is always correct.');
  lines.push('Extract parameter values from the user message. Use null for missing optional params. For dates use YYYY-MM-DD or YYYYMMDD. For limit use a number.');
  lines.push('PAGINATION: When the user says "more", "next", "next page", "page 2", "show more", "aur dikhao", "aage", repeat the SAME action with the same params but add page=N (next page number). Look at conversation history to find which action was last used and what page was shown.');
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
  if (/^(hi|hello|hey|hiya|good morning|good evening|gm|sup)\s*!?\.?$/i.test(text))
    return { skillId: null, action: 'unknown', params: {}, suggestedReply: "Hey! 👋 Welcome to Tathastu.\n\n" + defaultReply };

  // get_ledger: "ledger of X", "get ledger for X", "statement of X"
  const ledgerMatch = text.match(/(?:get\s+)?(?:ledger|statement)\s+(?:of|for)\s+(.+?)(?:\s*\.|$)/i) || text.match(/ledger\s+(.+?)(?:\s*\.|$)/i);
  if (ledgerMatch) {
    const party = ledgerMatch[1].trim().replace(/\s*\.\s*$/, '');
    if (party) return { skillId: 'tally', action: 'get_ledger', params: { party_name: party }, suggestedReply: null };
  }

  // list_ledgers: "list ledgers", "show ledgers", "list ledger"
  if (/list\s+ledgers?|show\s+ledgers?|ledgers?\s+list/i.test(text)) {
    const groupMatch = text.match(/(?:group\s+)?(?:filter\s+)?["']?([^"']+)["']?/);
    return { skillId: 'tally', action: 'list_ledgers', params: { group_filter: groupMatch ? groupMatch[1].trim() : null }, suggestedReply: null };
  }

  // get_vouchers: "vouchers", "get vouchers", "last N vouchers", "sales vouchers"
  if (/voucher|day\s*book|daybook/i.test(text)) {
    const limitMatch = text.match(/(?:last\s+)?(\d+)\s*(?:voucher|sales|purchase)?/i);
    const limit = limitMatch ? parseInt(limitMatch[1], 10) : 10;
    const typeMatch = text.match(/\b(sales|purchase|payment|receipt|contra)\b/i);
    const voucherType = typeMatch ? typeMatch[1] : null;
    const dateFrom = null;
    const dateTo = null;
    return { skillId: 'tally', action: 'get_vouchers', params: { date_from: dateFrom, date_to: dateTo, voucher_type: voucherType, limit }, suggestedReply: null };
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
  if (provider === 'openai') return parseWithOpenAI(userMessage, config, apiKey, history);
  if (provider === 'ollama') return parseWithOllama(userMessage, config, history);
  if (provider === 'keyword') return parseWithKeyword(userMessage, config);
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
