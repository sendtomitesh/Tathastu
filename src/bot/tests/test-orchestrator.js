/**
 * Tests for src/bot/orchestrator.js createOrchestrator().
 * Mocks: SkillRegistry, parseIntent, reply, sendDocument.
 * 
 * Run: node src/bot/tests/test-orchestrator.js
 */

let pass = 0, fail = 0;
function test(name, fn) {
  return fn().then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch(e => { fail++; console.log(`  ✗ ${name}: ${e.message}`); });
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ── Mock infrastructure ──

// We need to mock several modules before loading orchestrator.
// Strategy: patch require.cache entries.

const path = require('path');

// Track all reply/sendDocument calls
const replyCalls = [];
const sendDocCalls = [];
let mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: null };
let mockExecuteResult = { success: true, message: 'Done.', data: null };

// Mock config
const mockConfig = {
  debug: true,
  openai: { model: 'gpt-4o-mini' },
  whatsapp: { onlyFromMe: true },
  llm: { provider: 'openai', model: 'gpt-4o-mini' },
  skills: [{
    id: 'tally',
    name: 'Tally',
    config: { port: 9000 },
    actions: [
      { id: 'get_ledger', description: 'Get ledger', parameters: ['party_name'] },
      { id: 'get_vouchers', description: 'Get vouchers', parameters: ['date_from', 'date_to', 'voucher_type', 'limit', 'page'] },
      { id: 'list_ledgers', description: 'List ledgers', parameters: ['group_filter', 'page'] },
      { id: 'export_excel', description: 'Export excel', parameters: ['report_name'] },
      { id: 'get_trial_balance', description: 'Trial balance', parameters: ['date_from', 'date_to'] },
    ]
  }],
  tenants: [],
  translation: { enabled: false },
  resolver: null,
};

// Mock registry
class MockRegistry {
  constructor() { this.executeCalls = []; }
  async execute(skillId, action, params) {
    this.executeCalls.push({ skillId, action, params });
    if (typeof mockExecuteResult === 'function') return mockExecuteResult(skillId, action, params);
    return mockExecuteResult;
  }
}

function injectMocks() {
  // Mock config/load
  const loadPath = require.resolve('../../config/load');
  require.cache[loadPath] = {
    id: loadPath, filename: loadPath, loaded: true,
    exports: {
      loadConfig: () => mockConfig,
      getEnabledSkills: (c) => c.skills,
      getActionsForPrompt: (c) => {
        const out = [];
        for (const s of c.skills) for (const a of s.actions) out.push({ skillId: s.id, actionId: a.id, description: a.description, parameters: a.parameters });
        return out;
      }
    }
  };

  // Mock skills/index
  const skillsPath = require.resolve('../../skills');
  require.cache[skillsPath] = {
    id: skillsPath, filename: skillsPath, loaded: true,
    exports: { SkillRegistry: MockRegistry }
  };

  // Mock openai/parse
  const parsePath = require.resolve('../../openai/parse');
  require.cache[parsePath] = {
    id: parsePath, filename: parsePath, loaded: true,
    exports: {
      parseIntent: async () => mockParseResult,
      getAvailableCommandsHelp: () => 'Available commands...',
      getCapabilitiesMessage: () => 'Here is what I can do...',
      getProvider: () => 'openai',
    }
  };

  // Mock whatsapp/client
  const clientPath = require.resolve('../../whatsapp/client');
  require.cache[clientPath] = {
    id: clientPath, filename: clientPath, loaded: true,
    exports: {
      reply: async (msg, text) => { replyCalls.push({ msg, text }); },
      sendDocument: async (msg, buffer, filename, caption) => { sendDocCalls.push({ msg, buffer, filename, caption }); },
    }
  };

  // Mock translation/sarvam
  const sarvamPath = require.resolve('../../translation/sarvam');
  require.cache[sarvamPath] = {
    id: sarvamPath, filename: sarvamPath, loaded: true,
    exports: { SarvamClient: class { constructor() {} } }
  };

  // Mock intent/resolver
  const resolverPath = require.resolve('../../intent/resolver');
  require.cache[resolverPath] = {
    id: resolverPath, filename: resolverPath, loaded: true,
    exports: { createResolver: () => null }
  };
}

function loadOrchestrator() {
  const orchPath = require.resolve('../orchestrator');
  delete require.cache[orchPath];
  return require('../orchestrator');
}

function reset() {
  replyCalls.length = 0;
  sendDocCalls.length = 0;
  mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: null };
  mockExecuteResult = { success: true, message: 'Done.', data: null };
}

// Create a fake WhatsApp message
function fakeMsg(body, opts = {}) {
  return {
    body,
    fromMe: opts.fromMe !== undefined ? opts.fromMe : true,
    from: opts.from || '919999999999@c.us',
    to: opts.to || '919999999999@c.us',
    type: opts.type || 'chat',
    hasMedia: opts.hasMedia || false,
    getChat: async () => ({
      id: { _serialized: opts.chatId || '919999999999@c.us' },
      isGroup: opts.isGroup || false,
      getContact: async () => ({ id: { _serialized: opts.from || '919999999999@c.us' } }),
    }),
    client: { info: { wid: { _serialized: '919999999999@c.us' } } },
  };
}


// ── Tests ──
async function runTests() {
  injectMocks();
  const { createOrchestrator } = loadOrchestrator();

  // ═══════════════════════════════════════════════
  console.log('\nOrchestrator Creation:');
  // ═══════════════════════════════════════════════

  await test('creates orchestrator with default config', async () => {
    reset();
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    assert(orch.handleMessage, 'should have handleMessage');
    assert(orch.getConfig, 'should have getConfig');
    assert(orch.getRegistry, 'should have getRegistry');
    assert(orch.getConfig() === mockConfig, 'should return config');
  });

  // ═══════════════════════════════════════════════
  console.log('\nGreeting Handling:');
  // ═══════════════════════════════════════════════

  await test('greeting returns capabilities message', async () => {
    reset();
    mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: null };
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('hi'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(replyCalls[0].text.includes('Tathastu'), 'should include Tathastu branding');
    assert(replyCalls[0].text.includes('Here is what I can do'), 'should include capabilities');
  });

  await test('hello greeting also works', async () => {
    reset();
    mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: null };
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('hello'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(replyCalls[0].text.includes('Welcome'), 'should welcome user');
  });

  await test('namaste greeting works', async () => {
    reset();
    mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: null };
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('namaste'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(replyCalls[0].text.includes('Tathastu'), 'should include Tathastu');
  });

  // ═══════════════════════════════════════════════
  console.log('\nUnknown Intent:');
  // ═══════════════════════════════════════════════

  await test('unknown intent with suggestedReply uses it', async () => {
    reset();
    mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: 'I can help with accounting queries.' };
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('what is the weather'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(replyCalls[0].text.includes('I can help with accounting'), 'should use suggestedReply');
  });

  await test('unknown intent without suggestedReply shows capabilities', async () => {
    reset();
    mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: null };
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('asdfghjkl'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(replyCalls[0].text.includes("didn't quite get that"), 'should say did not understand');
  });

  // ═══════════════════════════════════════════════
  console.log('\nSkill Execution:');
  // ═══════════════════════════════════════════════

  await test('successful skill execution replies with message', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'get_ledger', params: { party_name: 'Meril' }, suggestedReply: null };
    mockExecuteResult = { success: true, message: '📒 Ledger for Meril: 5 entries', data: { entries: [] } };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('ledger for meril'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(replyCalls[0].text.includes('Ledger for Meril'), 'should include result message');
    assert(registry.executeCalls.length === 1, 'should execute once');
    assert(registry.executeCalls[0].action === 'get_ledger', 'should execute get_ledger');
  });

  await test('failed skill execution replies with error', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'get_ledger', params: { party_name: 'ZZZ' }, suggestedReply: null };
    mockExecuteResult = { success: false, message: 'Party "ZZZ" not found.' };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('ledger for ZZZ'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(replyCalls[0].text.includes('not found'), 'should include error message');
  });

  await test('skill execution with attachment sends document', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'export_excel', params: { report_name: 'vouchers', _showHelp: true }, suggestedReply: null };
    mockExecuteResult = {
      success: true,
      message: 'Excel exported.',
      data: null,
      attachment: { buffer: Buffer.from('fake'), filename: 'report.xlsx', caption: 'Report' }
    };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('export excel'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(sendDocCalls.length === 1, 'should send document');
    assert(sendDocCalls[0].filename === 'report.xlsx', 'should have correct filename');
  });

  // ═══════════════════════════════════════════════
  console.log('\nDebug Mode:');
  // ═══════════════════════════════════════════════

  await test('debug mode appends debug info to reply', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'get_vouchers', params: { limit: 50 }, suggestedReply: null };
    mockExecuteResult = { success: true, message: 'Found 10 vouchers.', data: [] };
    const debugConfig = Object.assign({}, mockConfig, { debug: true });
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: debugConfig, registry });
    await orch.handleMessage(fakeMsg('show vouchers'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(replyCalls[0].text.includes('debug:'), 'should include debug info');
    assert(replyCalls[0].text.includes('get_vouchers'), 'should include action name');
  });

  await test('debug mode disabled does not append debug info', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'get_vouchers', params: {}, suggestedReply: null };
    mockExecuteResult = { success: true, message: 'Found 10 vouchers.', data: [] };
    const noDebugConfig = Object.assign({}, mockConfig, { debug: false });
    const registry = new MockRegistry();
    // Need to reload orchestrator with new config
    const orch = createOrchestrator({ config: noDebugConfig, registry });
    await orch.handleMessage(fakeMsg('show vouchers'));
    assert(replyCalls.length === 1, 'should reply once');
    assert(!replyCalls[0].text.includes('debug:'), 'should NOT include debug info');
  });

  // ═══════════════════════════════════════════════
  console.log('\nBot Echo Skipping:');
  // ═══════════════════════════════════════════════

  await test('skips messages with Tathastu prefix (bot echo)', async () => {
    reset();
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('*Tathastu:*\nHello there'));
    assert(replyCalls.length === 0, 'should NOT reply to bot echo');
  });

  await test('skips document messages from bot', async () => {
    reset();
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('', { type: 'document', fromMe: true }));
    assert(replyCalls.length === 0, 'should NOT reply to document echo');
  });

  await test('skips image messages from bot', async () => {
    reset();
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('', { type: 'image', fromMe: true }));
    assert(replyCalls.length === 0, 'should NOT reply to image echo');
  });

  // ═══════════════════════════════════════════════
  console.log('\nMessage Filtering:');
  // ═══════════════════════════════════════════════

  await test('skips messages not from me when onlyFromMe=true', async () => {
    reset();
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('hello', { fromMe: false }));
    assert(replyCalls.length === 0, 'should NOT reply to others');
  });

  await test('skips empty messages', async () => {
    reset();
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg(''));
    assert(replyCalls.length === 0, 'should NOT reply to empty');
  });

  await test('skips duplicate messages within 5s window', async () => {
    reset();
    mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: 'Hi' };
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('test message'));
    assert(replyCalls.length === 1, 'first message should get reply');
    await orch.handleMessage(fakeMsg('test message'));
    assert(replyCalls.length === 1, 'duplicate should be skipped');
  });

  // ═══════════════════════════════════════════════
  console.log('\nPagination Flow:');
  // ═══════════════════════════════════════════════

  await test('"more" triggers pagination with next page', async () => {
    reset();
    // First: a normal action that stores lastAction
    mockParseResult = { skillId: 'tally', action: 'get_vouchers', params: { limit: 50 }, suggestedReply: null };
    mockExecuteResult = { success: true, message: 'Page 1 of vouchers', data: [{ id: 1 }] };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('show vouchers'));
    assert(registry.executeCalls.length === 1, 'first call');

    // Now say "more"
    reset();
    registry.executeCalls.length = 0;
    mockExecuteResult = { success: true, message: 'Page 2 of vouchers', data: [{ id: 2 }] };
    await orch.handleMessage(fakeMsg('more'));
    assert(registry.executeCalls.length === 1, 'should execute again');
    assert(registry.executeCalls[0].params.page === 2, 'should request page 2');
    assert(registry.executeCalls[0].action === 'get_vouchers', 'should repeat same action');
  });

  await test('"next page" triggers pagination', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'list_ledgers', params: {}, suggestedReply: null };
    mockExecuteResult = { success: true, message: 'Ledgers page 1', data: [{ name: 'A' }] };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('list ledgers'));

    reset();
    registry.executeCalls.length = 0;
    mockExecuteResult = { success: true, message: 'Ledgers page 2', data: [{ name: 'B' }] };
    await orch.handleMessage(fakeMsg('next page'));
    assert(registry.executeCalls.length === 1, 'should execute');
    assert(registry.executeCalls[0].params.page === 2, 'should be page 2');
  });

  await test('"page 3" jumps to specific page', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'get_vouchers', params: { limit: 50 }, suggestedReply: null };
    mockExecuteResult = { success: true, message: 'Vouchers', data: [] };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('show vouchers'));

    reset();
    registry.executeCalls.length = 0;
    await orch.handleMessage(fakeMsg('page 3'));
    assert(registry.executeCalls.length === 1, 'should execute');
    assert(registry.executeCalls[0].params.page === 3, 'should be page 3');
  });

  // ═══════════════════════════════════════════════
  console.log('\nNumber-Based Selection:');
  // ═══════════════════════════════════════════════

  await test('number selects from last suggestions', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'get_ledger', params: { party_name: 'Meril' }, suggestedReply: null };
    mockExecuteResult = {
      success: true,
      message: 'Did you mean:\n1. Meril Life Sciences\n2. Meril Pharma',
      data: { suggestions: [{ name: 'Meril Life Sciences' }, { name: 'Meril Pharma' }] }
    };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('ledger for meril'));

    // Now pick number 2
    reset();
    registry.executeCalls.length = 0;
    mockExecuteResult = { success: true, message: '📒 Ledger for Meril Pharma', data: { entries: [] } };
    await orch.handleMessage(fakeMsg('2'));
    assert(registry.executeCalls.length === 1, 'should execute');
    assert(registry.executeCalls[0].params.party_name === 'Meril Pharma', 'should pick Meril Pharma');
    assert(registry.executeCalls[0].action === 'get_ledger', 'should repeat get_ledger');
  });

  await test('invalid number shows range error', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'get_ledger', params: { party_name: 'Test' }, suggestedReply: null };
    mockExecuteResult = {
      success: true,
      message: 'Did you mean:\n1. Test A\n2. Test B',
      data: { suggestions: [{ name: 'Test A' }, { name: 'Test B' }] }
    };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('ledger for test'));

    // Pick invalid number
    reset();
    registry.executeCalls.length = 0;
    await orch.handleMessage(fakeMsg('5'));
    assert(replyCalls.length === 1, 'should reply');
    assert(replyCalls[0].text.includes('between 1 and 2'), 'should show valid range');
    assert(registry.executeCalls.length === 0, 'should NOT execute skill');
  });

  // ═══════════════════════════════════════════════
  console.log('\nExcel Auto-Fetch:');
  // ═══════════════════════════════════════════════

  await test('export excel with voucher keyword auto-fetches vouchers', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'export_excel', params: { report_name: 'voucher' }, suggestedReply: null };
    let fetchedAction = null;
    mockExecuteResult = (skillId, action, params) => {
      if (action !== 'export_excel') {
        fetchedAction = action;
        return { success: true, message: 'Fetched', data: [{ id: 1 }] };
      }
      return { success: true, message: 'Excel exported.', data: null, attachment: { buffer: Buffer.from('x'), filename: 'r.xlsx' } };
    };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('export vouchers to excel'));
    assert(fetchedAction === 'get_vouchers', 'should auto-fetch vouchers');
  });

  await test('export excel with trial balance keyword auto-fetches TB', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'export_excel', params: { report_name: 'trial balance' }, suggestedReply: null };
    let fetchedAction = null;
    mockExecuteResult = (skillId, action, params) => {
      if (action !== 'export_excel') {
        fetchedAction = action;
        return { success: true, message: 'Fetched', data: { groups: [] } };
      }
      return { success: true, message: 'Excel exported.', data: null };
    };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('export trial balance to excel'));
    assert(fetchedAction === 'get_trial_balance', 'should auto-fetch trial balance');
  });

  // ═══════════════════════════════════════════════
  console.log('\nConversation History:');
  // ═══════════════════════════════════════════════

  await test('conversation history is maintained across messages', async () => {
    reset();
    mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: 'Hello!' };
    const registry = new MockRegistry();
    const orch = createOrchestrator({ config: mockConfig, registry });
    
    // Send multiple messages
    await orch.handleMessage(fakeMsg('hi'));
    // Change text slightly to avoid duplicate detection
    await new Promise(r => setTimeout(r, 10));
    mockParseResult = { skillId: 'tally', action: 'get_ledger', params: { party_name: 'Meril' }, suggestedReply: null };
    mockExecuteResult = { success: true, message: 'Ledger data', data: {} };
    await orch.handleMessage(fakeMsg('ledger for meril'));
    
    // Both messages should have been processed
    assert(replyCalls.length === 2, `should have 2 replies, got ${replyCalls.length}`);
  });

  // ═══════════════════════════════════════════════
  console.log('\nBot Prefix:');
  // ═══════════════════════════════════════════════

  await test('all replies start with *Tathastu:* prefix', async () => {
    reset();
    mockParseResult = { skillId: null, action: 'unknown', params: {}, suggestedReply: 'Test reply' };
    const orch = createOrchestrator({ config: mockConfig, registry: new MockRegistry() });
    await orch.handleMessage(fakeMsg('anything'));
    assert(replyCalls.length === 1, 'should reply');
    assert(replyCalls[0].text.startsWith('*Tathastu:*\n'), 'reply should start with bot prefix');
  });

  // ═══════════════════════════════════════════════
  console.log('\nError Handling:');
  // ═══════════════════════════════════════════════

  await test('skill execution error is caught and reported', async () => {
    reset();
    mockParseResult = { skillId: 'tally', action: 'get_ledger', params: { party_name: 'X' }, suggestedReply: null };
    const registry = new MockRegistry();
    registry.execute = async () => { throw new Error('Tally connection refused'); };
    const orch = createOrchestrator({ config: mockConfig, registry });
    await orch.handleMessage(fakeMsg('ledger for X'));
    assert(replyCalls.length === 1, 'should reply');
    assert(replyCalls[0].text.includes('Tally connection refused'), 'should include error message');
  });

  // ═══════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════
  console.log(`\n${'═'.repeat(40)}`);
  console.log(`Orchestrator tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests().catch(e => { console.error('Fatal:', e); process.exit(1); });
