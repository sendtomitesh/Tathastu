const OpenAI = require('openai');
const { getActionsForPrompt } = require('../config/load');

/**
 * Build a short hint of what the user can ask (for suggestedReply instruction).
 */
function getCapabilitiesHint(config) {
  const parts = (config.skills || []).map((s) => {
    const actions = (s.actions || []).map((a) => a.id).slice(0, 3);
    return actions.length ? `${s.name}: ${actions.join(', ')}` : s.name;
  });
  return parts.length ? parts.join('; ') : 'connected services';
}

/**
 * Build system prompt from config: list enabled skills and their actions with parameters.
 */
function buildSystemPrompt(config) {
  const actions = getActionsForPrompt(config);
  const capabilitiesHint = getCapabilitiesHint(config);
  const lines = [
    'You are a helpful assistant that runs commands across connected services (e.g. accounting, CRM, tools). The user sends a message.',
    'Return ONLY valid JSON, no markdown or explanation.',
    '',
    'If the message matches one of the actions below, return: {"skillId":"<id>","action":"<action>","params":{...}}',
    'If the message does NOT match any action (greeting, question, unclear, or off-topic), return:',
    '{"skillId":null,"action":"unknown","params":{},"suggestedReply":"Your brief friendly reply here."}',
    '',
    `For suggestedReply: write 1-2 short sentences. Be conversational. If they said hello, greet back. If unclear, politely say what you can do and mention they can ask about: ${capabilitiesHint}. Keep it under 100 words.`,
    '',
    'Available actions (skillId, action, parameters):',
  ];
  for (const a of actions) {
    const paramsStr = a.parameters.length ? a.parameters.join(', ') : 'none';
    lines.push(`- skillId="${a.skillId}", action="${a.actionId}", params: [${paramsStr}]. ${a.description}`);
  }
  lines.push('');
  lines.push('Extract parameter values from the user message. Use null for missing optional params. For dates use YYYY-MM-DD or YYYYMMDD. For limit use a number.');
  return lines.join('\n');
}

function parseJsonResponse(content) {
  const cleaned = (content || '').replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  return {
    skillId: parsed.skillId === undefined || parsed.skillId === null ? null : String(parsed.skillId),
    action: typeof parsed.action === 'string' ? parsed.action : 'unknown',
    params: parsed.params && typeof parsed.params === 'object' ? parsed.params : {},
    suggestedReply: typeof parsed.suggestedReply === 'string' ? parsed.suggestedReply.trim() : null,
  };
}

/** OpenAI (or any OpenAI-compatible API, e.g. Groq). */
async function parseWithOpenAI(userMessage, config, apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (required for provider: openai)');
  const model = config.llm?.model || config.openai?.model || 'gpt-4o-mini';
  const baseURL = config.llm?.baseUrl || undefined;
  const openai = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt(config) },
      { role: 'user', content: userMessage },
    ],
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
async function parseWithOllama(userMessage, config) {
  const model = config.llm?.model || 'llama3.2';
  const baseUrl = (config.llm?.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt(config) },
        { role: 'user', content: userMessage },
      ],
      stream: false,
    }),
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
  const defaultReply = "I can help with: " + getCapabilitiesHint(config) + ". Say something like 'get ledger of ABC' or 'list ledgers'.";

  if (!text) return { skillId: null, action: 'unknown', params: {}, suggestedReply: defaultReply };

  // Greetings
  if (/^(hi|hello|hey|hiya|good morning|good evening|gm|sup)\s*!?\.?$/i.test(text))
    return { skillId: null, action: 'unknown', params: {}, suggestedReply: "Hi! You can ask me for ledgers, vouchers, or to list ledgers. What do you need?" };

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
 */
async function parseIntent(userMessage, config, apiKey = process.env.OPENAI_API_KEY) {
  const provider = getProvider(config);
  if (provider === 'openai') return parseWithOpenAI(userMessage, config, apiKey);
  if (provider === 'ollama') return parseWithOllama(userMessage, config);
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
  getCapabilitiesHint,
  parseIntent,
  getAvailableCommandsHelp,
  getProvider,
};
