const { loadConfig } = require('../config/load');
const { SkillRegistry } = require('../skills');
const { parseIntent, getAvailableCommandsHelp, getCapabilitiesMessage } = require('../openai/parse');
const { reply, sendDocument } = require('../whatsapp/client');
const { SarvamClient } = require('../translation/sarvam');
const { createResolver } = require('../intent/resolver');
const { createAlertManager } = require('./alerts');
const { createScheduler } = require('./scheduler');

/**
 * Smart follow-ups: suggest next actions based on what the user just did.
 */
function getSmartFollowUp(action, params, result) {
  // Don't suggest if result has suggestions (party disambiguation) — user needs to pick first
  if (result.data?.suggestions) return null;

  const tips = [];
  switch (action) {
    case 'get_outstanding':
      tips.push('💡 _"payment reminders" to send collection reminders_');
      tips.push('💡 _"ageing analysis" to see overdue buckets_');
      tips.push('💡 _"excel for outstanding" to export_');
      break;
    case 'get_party_balance':
      tips.push('💡 _"ledger of ' + (params.party_name || 'party') + '" for full statement_');
      tips.push('💡 _"pending bills of ' + (params.party_name || 'party') + '" for unpaid invoices_');
      break;
    case 'get_ledger':
      tips.push('💡 _"pending bills of ' + (params.party_name || 'party') + '" for unpaid invoices_');
      tips.push('💡 _"invoices for ' + (params.party_name || 'party') + '" for invoice list_');
      break;
    case 'get_sales_report':
    case 'get_profit_loss':
    case 'get_expense_report':
      tips.push('💡 _"compare ' + (action === 'get_sales_report' ? 'sales' : action === 'get_profit_loss' ? 'profit' : 'expenses') + ' vs last month" for comparison_');
      tips.push('💡 _"excel" to export this report_');
      break;
    case 'get_party_invoices':
      tips.push('💡 _"send invoice #NUMBER" to share as PDF_');
      tips.push('💡 _"excel" to export_');
      break;
    case 'get_ageing_analysis':
      tips.push('💡 _"payment reminders" to send collection messages_');
      break;
    case 'get_payment_reminders':
      tips.push('💡 _"send reminder to PARTY" to send a specific reminder_');
      tips.push('💡 _"send reminders to all" to bulk send_');
      break;
    case 'compare_periods':
      tips.push('💡 _"excel" to export this comparison_');
      break;
    case 'get_dashboard':
      tips.push('💡 _"compare sales vs last month" for trends_');
      tips.push('💡 _"cash flow forecast" for projections_');
      break;
    case 'get_expense_anomalies':
      tips.push('💡 _"expenses this month" for full breakdown_');
      break;
    case 'get_cash_flow_forecast':
      tips.push('💡 _"outstanding receivable" to see who owes_');
      tips.push('💡 _"payment reminders" to collect faster_');
      break;
    case 'get_trial_balance':
    case 'get_balance_sheet':
    case 'get_gst_summary':
    case 'get_stock_summary':
    case 'get_cash_bank_balance':
      tips.push('💡 _"excel" to export this report_');
      break;
    default:
      return null;
  }
  return tips.length > 0 ? tips.join('\n') : null;
}

/**
 * Create an orchestrator that handles incoming WhatsApp messages:
 * load config -> parse intent (OpenAI) -> execute skill -> reply.
 * @param {object} options
 * @param {object} [options.config] - Pre-loaded config; otherwise loadConfig() is called
 * @param {SkillRegistry} [options.registry] - Pre-built registry; otherwise built from config
 * @param {function} [options.onLog] - (text: string) => void - optional log for UI/debug
 */
function createOrchestrator(options = {}) {
  const config = options.config || loadConfig();
  const registry = options.registry || new SkillRegistry(config);
  // Only reply to messages YOU sent (from your phone/linked device). Ignore all other chats.
  const onlyFromMe = config.whatsapp?.onlyFromMe !== false;
  const onLog = options.onLog || (() => {});
  const client = options.client || null; // WhatsApp client (for getting user's own number)
  
  // Conversation history for LLM context (user + assistant pairs)
  const conversationHistory = [];
  const MAX_HISTORY = 10; // Keep last 10 turns (5 user + 5 bot)
  
  // Last report data for Excel export
  let lastReportData = null;
  let lastReportName = '';
  
  // Track last paginated action for "more"/"next" navigation
  let lastAction = null;
  let lastParams = null;
  let lastSkillId = null;
  let lastPage = 1;
  
  // Track last suggestions for number-based selection
  let lastSuggestions = null; // array of { name, ... }
  
  // Initialize alert manager if enabled
  let alertManager = null;
  if (config.alerts?.enabled !== false && client) {
    try {
      alertManager = createAlertManager({ registry, config, client, onLog });
      // Start checking after WhatsApp is ready (client.info available)
      // We'll start it lazily on first message when client.info is available
      onLog('[alerts] Alert manager initialized');
    } catch (err) {
      onLog('[alerts] Failed to initialize: ' + (err.message || err));
    }
  }

  // Initialize scheduler if enabled
  let scheduler = null;
  if (config.scheduler?.enabled && client) {
    try {
      scheduler = createScheduler({ registry, config, client, onLog });
      onLog('[scheduler] Scheduler initialized');
    } catch (err) {
      onLog('[scheduler] Failed to initialize: ' + (err.message || err));
    }
  }

  // Flag to start background services once client is ready
  let backgroundStarted = false;

  // Credit limits (in-memory, reset on restart)
  let creditLimits = {};

  // Scheduled reports (in-memory)
  let scheduledReports = [];
  let scheduleNextId = 0;
  
  // Initialize Sarvam translation client if enabled
  let sarvamClient = null;
  if (config.translation?.enabled && config.translation?.apiKey) {
    try {
      sarvamClient = new SarvamClient(
        config.translation.apiKey,
        config.translation.baseUrl || undefined // Pass undefined instead of null to use default
      );
      onLog('[translation] Sarvam client initialized');
    } catch (err) {
      onLog('[translation] Failed to initialize: ' + (err.message || err));
    }
  }

  // Initialize local intent resolver if enabled
  let resolver = null;
  if (config.resolver?.enabled) {
    try {
      resolver = createResolver(config, onLog);
      onLog('[resolver] Local intent resolver initialized');
    } catch (err) {
      onLog('[resolver] Failed to initialize: ' + (err.message || err));
    }
  }

  // Bot reply prefix — every bot message starts with this so we can identify echoes instantly
  const BOT_PREFIX = '*Tathastu:*\n';

  // Track last *user* message to avoid processing duplicates (e.g. from multiple linked devices)
  let lastUserText = null;
  let lastUserAt = 0;
  const DUPLICATE_USER_MS = 5000; // ignore duplicate user messages with same text within 5s
  let myNumber = null; // Cache user's own number

  /**
   * Handle one incoming message. Call this from client.on('message', ...).
   * @param {import('whatsapp-web.js').Message} message
   */
  function normalizeId(id) {
    if (id == null) return '';
    const s = String(id._serialized || id);
    const at = s.indexOf('@');
    return at >= 0 ? s.slice(0, at) : s;
  }

  async function handleMessage(message) {
    const body = (message.body || '').trim();
    
    // Debug: log all incoming messages
    onLog('Incoming: fromMe=' + message.fromMe + ' type=' + (message.type || 'unknown') + ' hasMedia=' + (message.hasMedia || false) + ' from=' + (message.from || 'null') + ' to=' + (message.to || 'null') + ' body=' + (body.slice(0, 20) || 'empty'));

    // 1) Only respond to messages from you – ignore everyone else (other chats)
    if (onlyFromMe && !message.fromMe) {
      onLog('Skip: not from you (fromMe=' + message.fromMe + ')');
      return;
    }

    // 2) Ignore bot echoes: our replies start with BOT_PREFIX, so skip them instantly
    const messageBody = (message.body || '').trim();
    if (message.fromMe && messageBody.startsWith('*Tathastu:*')) {
      onLog('Skip: bot echo (has Tathastu prefix)');
      return;
    }
    // Also skip document/media messages sent by the bot (PDF, Excel attachments)
    if (message.fromMe && (message.type === 'document' || message.type === 'image')) {
      onLog('Skip: bot attachment echo (type=' + message.type + ')');
      return;
    }

    // 3) Get chat early (needed for self-chat check and group check)
    const chat = await message.getChat();
    
    // 4) Only respond in Saved Messages (self-chat) when onlySelfChat is set - STRICT CHECK
    if (config.whatsapp?.onlySelfChat) {
      const fromNorm = normalizeId(message.from);
      const toNorm = normalizeId(message.to);
      const chatIdNorm = normalizeId(chat.id);
      const chatIdStr = String(chat.id?._serialized || chat.id || '');
      
      // Get user's own number: prefer message.from when fromMe (most reliable)
      if (message.fromMe && message.from && !myNumber) {
        myNumber = normalizeId(message.from);
        onLog('My number: ' + myNumber + ' (from message.from)');
      } else if (!myNumber) {
        // Try client.info as fallback
        const msgClient = message.client || client;
        if (msgClient) {
          try {
            const info = msgClient.info;
            if (info && info.wid) {
              myNumber = normalizeId(info.wid);
              onLog('My number: ' + myNumber + ' (from client.info)');
            }
          } catch (e) {
            // Ignore
          }
        }
      }
      
      // STRICT: Saved Messages detection - only allow when chat is definitely with yourself
      // In Saved Messages: message.from === message.to (both are your IDs)
      // OR chat.id matches your phone number
      // OR for fromMe messages: if chat.id is a linked device ID, check if chat contact is you
      let selfChat = false;
      
      // Primary: message.from === message.to (you messaging yourself - most reliable)
      if (fromNorm && toNorm && fromNorm === toNorm) {
        selfChat = true;
        onLog('Self-chat: from === to');
      }
      // Secondary: chat.id matches your phone number (Saved Messages)
      else if (myNumber && chatIdNorm && chatIdNorm === myNumber) {
        selfChat = true;
        onLog('Self-chat: chat.id === myNumber');
      }
      // Tertiary: chat.id matches message.from (for fromMe, chat.id should be your number/device)
      else if (message.fromMe && fromNorm && chatIdNorm && chatIdNorm === fromNorm) {
        selfChat = true;
        onLog('Self-chat: chat.id === message.from');
      }
      // Quaternary: For fromMe messages where from is your phone and chat.id is @lid,
      // check if chat contact matches your number (Saved Messages with linked device)
      else if (message.fromMe && myNumber && fromNorm === myNumber) {
        try {
          const contact = await chat.getContact();
          const contactIdNorm = normalizeId(contact.id);
          if (contactIdNorm === myNumber) {
            selfChat = true;
            onLog('Self-chat: chat contact === myNumber');
          } else {
            onLog('Self-chat: chat contact=' + contactIdNorm + ' != myNumber=' + myNumber);
          }
        } catch (e) {
          onLog('Self-chat: could not get contact: ' + (e.message || e));
        }
      }
      
      onLog('Self-chat check: fromNorm=' + fromNorm + ' toNorm=' + toNorm + ' chatIdNorm=' + chatIdNorm + ' myNumber=' + (myNumber || 'unknown') + ' fromMe=' + message.fromMe + ' match=' + selfChat);
      if (!selfChat) {
        onLog('Skip: not Saved Messages (chatId=' + chatIdStr + ')');
        return;
      }
      onLog('✓ Processing: Saved Messages chat');
    }

    // 5) Only respond in private (1:1) chats – ignore groups when onlyPrivateChats is set
    //    UNLESS group chat mode is enabled with a trigger prefix (e.g. "@tathastu")
    const groupTrigger = (config.whatsapp?.groupTrigger || '').toLowerCase(); // e.g. "@tathastu"
    if (config.whatsapp?.onlyPrivateChats) {
      const chatIdStr = (chat.id && (chat.id._serialized || chat.id)) || '';
      const isGroup = chat.isGroup === true || String(chatIdStr).endsWith('@g.us');
      if (isGroup) {
        if (groupTrigger && body.toLowerCase().startsWith(groupTrigger)) {
          // Group chat mode: strip the trigger prefix and process
          onLog('Group chat: trigger matched, processing');
          // body will be cleaned below after audio handling
        } else {
          onLog('Skip: group chat' + (groupTrigger ? ' (no trigger prefix)' : ''));
          return;
        }
      }
    }

    // Handle audio messages if translation is enabled
    let userText = body;
    let userLang = 'en-IN'; // Default language
    
    // Check if this is an audio/voice message
    // WhatsApp voice notes are typically type 'ptt' (push-to-talk)
    // Audio files can be type 'audio' or have hasMedia=true with audio mimetype
    const msgType = message.type || '';
    const isAudioType = msgType === 'ptt' || msgType === 'audio';
    const hasMedia = message.hasMedia === true;
    
    // Also check if media exists and might be audio (even if type isn't set correctly)
    let isAudioMessage = isAudioType;
    let downloadedMedia = null;
    
    if (!isAudioMessage && hasMedia && sarvamClient) {
      // Try to detect audio by checking if we can download media and it's audio
      try {
        downloadedMedia = await message.downloadMedia();
        if (downloadedMedia && downloadedMedia.mimetype && downloadedMedia.mimetype.startsWith('audio/')) {
          isAudioMessage = true;
          onLog('[translation] Detected audio via mimetype: ' + downloadedMedia.mimetype);
        }
      } catch (e) {
        onLog('[translation] Error checking media type: ' + (e.message || e));
      }
    }
    
    if (isAudioMessage && sarvamClient) {
      try {
        onLog('[translation] Processing audio message (type: ' + msgType + ', hasMedia: ' + hasMedia + ')...');
        // Reuse downloaded media if we already downloaded it, otherwise download now
        const media = downloadedMedia || await message.downloadMedia();
        if (media && media.data) {
          onLog('[translation] Media downloaded: mimetype=' + (media.mimetype || 'unknown') + ', size=' + (media.data.length || 0));
          const result = await sarvamClient.transcribeAudio({
            data: media.data,
            mimeType: media.mimetype || 'audio/ogg; codecs=opus',
            translateToEnglish: true, // Always translate audio to English for processing
          });
          userText = result.text;
          userLang = result.lang || 'en-IN';
          onLog('[translation] Audio transcribed: "' + (userText.slice(0, 50) + (userText.length > 50 ? '...' : '')) + '" (lang: ' + userLang + ')');
        } else {
          onLog('[translation] Media download returned no data');
        }
      } catch (err) {
        onLog('[translation] Audio transcription failed: ' + (err.message || err));
        // Fallback: try to get text from caption/body
        userText = message.body || '';
        if (!userText) {
          onLog('[translation] No fallback text available, skipping message');
          return;
        }
      }
    } else if (isAudioMessage && !sarvamClient) {
      onLog('[translation] Audio message detected but Sarvam client not initialized (enabled=' + config.translation?.enabled + ', apiKey=' + (config.translation?.apiKey ? 'set' : 'missing') + ')');
    }
    
    if (!userText) {
      onLog('Skip: no text content to process');
      return;
    }

    // 2b) Ignore duplicate user messages (same text within a short window).
    // This can happen when the same self message is seen from multiple linked devices.
    if (message.fromMe) {
      const now = Date.now();
      if (lastUserText && userText === lastUserText && (now - lastUserAt) < DUPLICATE_USER_MS) {
        onLog('Skip: duplicate user message "' + (userText.slice(0, 30) + (userText.length > 30 ? '...' : '')) + '"');
        return;
      }
      lastUserText = userText;
      lastUserAt = now;
    }

    // Check if this is a self-chat message (for storing)
    let isSelfChat = false;
    if (config.whatsapp?.onlySelfChat) {
      const fromNorm = normalizeId(message.from);
      const toNorm = normalizeId(message.to);
      const chatIdNorm = normalizeId(chat.id);
      
      if (fromNorm && toNorm && fromNorm === toNorm) {
        isSelfChat = true;
      } else if (myNumber && chatIdNorm && chatIdNorm === myNumber) {
        isSelfChat = true;
      } else if (message.fromMe && fromNorm && chatIdNorm && chatIdNorm === fromNorm) {
        isSelfChat = true;
      } else if (message.fromMe && myNumber && fromNorm === myNumber) {
        try {
          const contact = await chat.getContact();
          const contactIdNorm = normalizeId(contact.id);
          if (contactIdNorm === myNumber) {
            isSelfChat = true;
          }
        } catch (e) {
          // Ignore
        }
      }
    } else {
      // If onlySelfChat is not enabled, consider it self-chat if fromMe and private
      isSelfChat = message.fromMe && !chat.isGroup;
    }

    onLog('Msg: "' + (userText.slice(0, 25) + (userText.length > 25 ? '…' : '')) + '" fromMe=' + message.fromMe);

    // Start background services (alerts, scheduler) once client is confirmed ready
    if (!backgroundStarted && client && client.info) {
      backgroundStarted = true;
      if (alertManager) alertManager.start();
      if (scheduler) scheduler.start();
    }

    // Skip Sarvam for text messages — OpenAI handles English/Hindi/Gujarati text fine.
    // Sarvam is only used for audio transcription (handled above).
    // For audio messages, userLang was already set by the transcription step.
    let textForProcessing = userText;
    const SUPPORTED_LANGS = ['en-IN', 'en', 'hi-IN', 'gu-IN'];

    // Strip group trigger prefix if present (e.g. "@tathastu show sales")
    if (groupTrigger && textForProcessing.toLowerCase().startsWith(groupTrigger)) {
      textForProcessing = textForProcessing.slice(groupTrigger.length).trim();
    }

    let responseText;
    let attachment = null;
    let _debugAction = null, _debugParams = null, _debugTier = null;
    try {
      // Check for confirmation of pending actions (e.g. bulk reminders)
      const isConfirmation = /^(yes|y|haan|ha|send|bhejo|ok)$/i.test(textForProcessing.trim());
      
      // Check for pagination commands ("more", "next", "page 2", etc.)
      const paginationMatch = textForProcessing.match(/^(?:more|next|next page|aur|aur dikhao|aage|vadhu|aagal|page\s*(\d+))$/i);
      let skillId, action, params, suggestedReply;
      
      if (isConfirmation && lastAction === 'send_reminders_bulk' && lastSkillId) {
        skillId = lastSkillId;
        action = 'send_reminders_bulk';
        params = { confirmed: true };
        suggestedReply = null;
        _debugTier = 'confirmation';
      } else if (paginationMatch && lastAction && lastSkillId) {
        const requestedPage = paginationMatch[1] ? parseInt(paginationMatch[1], 10) : lastPage + 1;
        skillId = lastSkillId;
        action = lastAction;
        params = Object.assign({}, lastParams, { page: requestedPage });
        suggestedReply = null;
        _debugTier = 'pagination';
        lastPage = requestedPage;
      } else if (/^\d{1,2}$/.test(textForProcessing.trim()) && lastSuggestions && lastAction && lastSkillId) {
        // User replied with a number — pick from last suggestions list
        const idx = parseInt(textForProcessing.trim(), 10) - 1;
        if (idx >= 0 && idx < lastSuggestions.length) {
          const picked = lastSuggestions[idx].name;
          skillId = lastSkillId;
          action = lastAction;
          params = Object.assign({}, lastParams, { party_name: picked });
          suggestedReply = null;
          _debugTier = 'selection';
          lastSuggestions = null; // clear after use
        } else {
          skillId = null;
          action = 'unknown';
          params = {};
          suggestedReply = `Please pick a number between 1 and ${lastSuggestions.length}.`;
          _debugTier = 'selection';
        }
      } else if (resolver) {
        const result = await resolver.resolveIntent(textForProcessing, config, process.env.OPENAI_API_KEY, conversationHistory);
        skillId = result.skillId;
        action = result.action;
        params = result.params;
        suggestedReply = result.suggestedReply;
        _debugTier = result._tier || null;
      } else {
        const result = await parseIntent(textForProcessing, config, process.env.OPENAI_API_KEY, conversationHistory);
        skillId = result.skillId;
        action = result.action;
        params = result.params;
        suggestedReply = result.suggestedReply;
        _debugTier = 'openai';
      }
      _debugAction = action;
      _debugParams = params;
      onLog('[debug] Intent: skillId=' + skillId + ' action=' + action + ' params=' + JSON.stringify(params));
      if (skillId == null || action === 'unknown') {
        // For greetings, always use our curated capabilities message
        const isGreeting = /^(hi|hello|hey|hiya|good\s*morning|good\s*evening|good\s*afternoon|gm|sup|namaste|namaskar)\b/i.test(textForProcessing.trim());
        if (isGreeting) {
          responseText = "Hey! 👋 Welcome to *Tathastu*.\n\n" + getCapabilitiesMessage();
        } else {
          responseText = (suggestedReply && suggestedReply.length > 0)
            ? suggestedReply
            : "I didn't quite get that. Here's what I can help with:\n\n" + getCapabilitiesMessage();
        }
      } else {
        // Handle special orchestrator-level actions (alerts, scheduler, multi-company)
        if (action === 'set_alert') {
          if (alertManager) {
            const res = alertManager.addAlert({ type: params.alert_type, threshold: params.threshold });
            responseText = res.message;
          } else {
            responseText = '⚠️ Alerts are not enabled. Add `"alerts": {"enabled": true}` to config.';
          }
          _debugAction = action; _debugParams = params;
        } else if (action === 'list_alerts') {
          if (alertManager) {
            const res = alertManager.listAlerts();
            responseText = res.message;
          } else {
            responseText = '📭 No alerts system active.';
          }
          _debugAction = action; _debugParams = params;
        } else if (action === 'remove_alert') {
          if (alertManager) {
            const res = alertManager.removeAlert(params.alert_id);
            responseText = res.message;
          } else {
            responseText = '⚠️ Alerts are not enabled.';
          }
          _debugAction = action; _debugParams = params;
        } else if (action === 'send_daily_summary') {
          if (scheduler) {
            try {
              const res = await scheduler.sendNow();
              responseText = res.success ? '✅ Daily summary sent to your chat.' : res.message;
            } catch (e) {
              responseText = '❌ Failed to send summary: ' + (e.message || e);
            }
          } else {
            responseText = '⚠️ Scheduler is not enabled. Add `"scheduler": {"enabled": true}` to config.';
          }
          _debugAction = action; _debugParams = params;
        } else if (action === 'switch_company') {
          // Multi-company: temporarily switch company for the next query
          // Store the company name preference — the skill handler will use it
          if (params.company_name) {
            // Execute open_company to switch Tally's active company
            try {
              const switchResult = await registry.execute(skillId, 'open_company', { company_name: params.company_name });
              responseText = switchResult.success
                ? switchResult.message
                : (switchResult.message || 'Failed to switch company.');
            } catch (e) {
              responseText = '❌ Company switch failed: ' + (e.message || e);
            }
          } else {
            responseText = 'Please specify a company name. Example: "switch to Afflink"';
          }
          _debugAction = action; _debugParams = params;
        } else if (action === 'send_reminders_bulk') {
          // Bulk payment reminders — send to all overdue parties
          if (!client) {
            responseText = '⚠️ WhatsApp client not available for sending.';
          } else if (params.confirmed === true || params.confirmed === 'true' || /^(yes|y|haan|ha|send)$/i.test(textForProcessing.trim())) {
            // Actually send reminders
            try {
              const { sendToNumber } = require('../whatsapp/client');
              const reminderResult = await registry.execute(skillId, 'get_payment_reminders', {});
              if (!reminderResult.success || !reminderResult.data?.reminders) {
                responseText = reminderResult.message || 'No overdue parties found.';
              } else {
                const reminders = reminderResult.data.reminders;
                const compName = reminderResult.data._companyName || '';
                let sent = 0, failed = 0, noPhone = 0;
                const lines = ['📨 *Sending Bulk Reminders…*', ''];
                for (const r of reminders) {
                  if (!r.phone) { noPhone++; continue; }
                  const partyData = { name: r.party, totalDue: r.totalDue, bills: r.bills, maxDaysOverdue: r.maxDaysOverdue };
                  const { generateReminderMessage } = require('../skills/tally/tdl/payment-reminders');
                  const msg = generateReminderMessage(compName, partyData);
                  const result = await sendToNumber(client, r.phone, msg);
                  if (result.success) {
                    sent++;
                    lines.push(`✅ ${r.party} — sent`);
                  } else {
                    failed++;
                    lines.push(`❌ ${r.party} — failed: ${result.error}`);
                  }
                  // Rate limit: 3 second delay between sends
                  await new Promise(resolve => setTimeout(resolve, 3000));
                }
                lines.push('', `*Summary:* ${sent} sent, ${failed} failed, ${noPhone} no phone number`);
                responseText = lines.join('\n');
              }
            } catch (e) {
              responseText = '❌ Bulk send failed: ' + (e.message || e);
            }
          } else {
            // Show preview first, ask for confirmation
            try {
              const reminderResult = await registry.execute(skillId, 'get_payment_reminders', {});
              responseText = (reminderResult.message || 'No overdue parties.') + '\n\n⚠️ *Reply "yes" or "send" to actually send these reminders via WhatsApp.*';
              // Store action so "yes" triggers the send
              lastAction = 'send_reminders_bulk';
              lastParams = { confirmed: true };
              lastSkillId = skillId;
            } catch (e) {
              responseText = '❌ Failed to fetch reminders: ' + (e.message || e);
            }
          }
          _debugAction = action; _debugParams = params;
        } else if (action === 'set_credit_limit') {
          // Credit limit tracking (in-memory)
          if (!creditLimits) creditLimits = {};
          const party = params.party_name;
          const limit = parseFloat(params.limit);
          if (!party) {
            responseText = 'Please specify a party name. Example: "set credit limit for Meril at 5L"';
          } else if (isNaN(limit) || limit <= 0) {
            responseText = 'Please specify a valid limit amount.';
          } else {
            creditLimits[party.toLowerCase()] = { party, limit, setAt: new Date() };
            responseText = `✅ Credit limit set: *${party}* — ₹${limit.toLocaleString('en-IN')}`;
          }
          _debugAction = action; _debugParams = params;
        } else if (action === 'check_credit_limits') {
          if (!creditLimits || Object.keys(creditLimits).length === 0) {
            responseText = '📭 No credit limits set. Try: "set credit limit for Meril at 5L"';
          } else {
            // Check each party's outstanding vs limit
            const lines = ['📊 *Credit Limit Report*', ''];
            let breached = 0;
            for (const [key, cl] of Object.entries(creditLimits)) {
              try {
                const balResult = await registry.execute(skillId, 'get_party_balance', { party_name: cl.party });
                const balance = balResult.data?.balance || 0;
                const absBalance = Math.abs(balance);
                const pct = ((absBalance / cl.limit) * 100).toFixed(0);
                const emoji = absBalance > cl.limit ? '🔴' : absBalance > cl.limit * 0.8 ? '🟡' : '🟢';
                if (absBalance > cl.limit) breached++;
                lines.push(`${emoji} *${cl.party}*: ₹${absBalance.toLocaleString('en-IN')} / ₹${cl.limit.toLocaleString('en-IN')} (${pct}%)`);
              } catch (_) {
                lines.push(`⚠️ *${cl.party}*: Could not fetch balance`);
              }
            }
            lines.push('', breached > 0 ? `⚠️ *${breached} parties exceeded their credit limit*` : '✅ All parties within limits');
            responseText = lines.join('\n');
          }
          _debugAction = action; _debugParams = params;
        } else if (action === 'schedule_report') {
          // Scheduled reports (in-memory)
          if (!scheduledReports) scheduledReports = [];
          const reportAction = params.report_action || '';
          const scheduleTime = params.schedule_time || '09:00';
          const scheduleDays = params.schedule_days || 'daily';
          const id = ++scheduleNextId;
          scheduledReports.push({ id, reportAction, scheduleTime, scheduleDays, createdAt: new Date() });
          responseText = `✅ Scheduled: "${reportAction}" — ${scheduleDays} at ${scheduleTime}\n\n_Say "show scheduled reports" to see all._`;
          _debugAction = action; _debugParams = params;
        } else if (action === 'list_scheduled_reports') {
          if (!scheduledReports || scheduledReports.length === 0) {
            responseText = '📭 No scheduled reports. Try: "schedule sales report daily at 9 AM"';
          } else {
            const lines = ['📅 *Scheduled Reports:*', ''];
            for (const s of scheduledReports) {
              lines.push(`${s.id}. "${s.reportAction}" — ${s.scheduleDays} at ${s.scheduleTime}`);
            }
            lines.push('', '_Say "remove schedule 1" to delete._');
            responseText = lines.join('\n');
          }
          _debugAction = action; _debugParams = params;
        } else if (action === 'remove_scheduled_report') {
          if (!scheduledReports) scheduledReports = [];
          const idx = scheduledReports.findIndex(s => s.id === parseInt(params.schedule_id, 10));
          if (idx === -1) {
            responseText = `Schedule #${params.schedule_id} not found.`;
          } else {
            const removed = scheduledReports.splice(idx, 1)[0];
            responseText = `🗑️ Removed: "${removed.reportAction}" — ${removed.scheduleDays} at ${removed.scheduleTime}`;
          }
          _debugAction = action; _debugParams = params;
        } else {
        // For export_excel, inject last report data or auto-fetch if needed
        if (action === 'export_excel' && !params._showHelp) {
          // Determine if user is asking for a specific report type
          const txt = textForProcessing.toLowerCase();
          let autoAction = null, autoParams = {};
          if (/voucher|payment|receipt|journal|contra/i.test(txt)) {
            autoAction = 'get_vouchers';
            const typeMatch = txt.match(/\b(sales|purchase|payment|receipt|contra|journal|credit note|debit note)\b/i);
            autoParams = { voucher_type: typeMatch ? typeMatch[1] : null, limit: 0 };
          } else if (/ledger/i.test(txt)) {
            autoAction = 'list_ledgers';
            autoParams = {};
          } else if (/trial\s*bal/i.test(txt)) {
            autoAction = 'get_trial_balance';
            autoParams = {};
          } else if (/balance\s*sheet/i.test(txt)) {
            autoAction = 'get_balance_sheet';
            autoParams = {};
          } else if (/p\s*[&n]\s*l|profit/i.test(txt)) {
            autoAction = 'get_profit_loss';
            autoParams = {};
          } else if (/gst|tax/i.test(txt)) {
            autoAction = 'get_gst_summary';
            autoParams = {};
          } else if (/sales/i.test(txt)) {
            autoAction = 'get_sales_report';
            autoParams = { type: 'sales' };
          } else if (/purchase/i.test(txt)) {
            autoAction = 'get_sales_report';
            autoParams = { type: 'purchase' };
          } else if (/outstanding|receivable|payable/i.test(txt)) {
            autoAction = 'get_outstanding';
            autoParams = { type: /payable|creditor/i.test(txt) ? 'payable' : 'receivable' };
          } else if (/expense/i.test(txt)) {
            autoAction = 'get_expense_report';
            autoParams = {};
          } else if (/stock|inventory/i.test(txt)) {
            autoAction = 'get_stock_summary';
            autoParams = {};
          } else if (/age?ing|overdue/i.test(txt)) {
            autoAction = 'get_ageing_analysis';
            autoParams = { type: /payable|creditor/i.test(txt) ? 'payable' : 'receivable' };
          }

          if (autoAction) {
            // User asked for a specific report — always auto-fetch fresh data
            try {
              const autoResult = await registry.execute(skillId, autoAction, autoParams);
              if (autoResult.success && autoResult.data) {
                params._reportData = autoResult.data;
                params.report_name = params.report_name || autoAction.replace(/^get_/, '').replace(/_/g, ' ');
                lastReportData = autoResult.data;
                lastReportName = params.report_name;
              }
            } catch (e) { /* auto-fetch failed */ }
          } else if (lastReportData) {
            // No specific report detected in text — use last report data
            params._reportData = lastReportData;
            if (!params.report_name) params.report_name = lastReportName;
          }
        }
        const result = await registry.execute(skillId, action, params);
        responseText = result.success
          ? (result.message || 'Done.')
          : (result.message || 'Action failed.');
        if (result.attachment) attachment = result.attachment;

        // Smart follow-ups: append contextual suggestions based on action type
        if (result.success && action !== 'export_excel') {
          const followUp = getSmartFollowUp(action, params, result);
          if (followUp) responseText += '\n\n' + followUp;
        }
        // Store last action for pagination
        if (result.success && action !== 'export_excel') {
          lastSkillId = skillId;
          lastAction = action;
          lastParams = Object.assign({}, params);
          delete lastParams.page; // store without page so we can set it on "more"
          lastPage = parseInt(params.page, 10) || 1;
        }
        // Store suggestions for number-based selection
        if (result.data && result.data.suggestions && Array.isArray(result.data.suggestions)) {
          lastSuggestions = result.data.suggestions;
        } else if (result.success && action !== 'export_excel') {
          lastSuggestions = null; // clear old suggestions on successful non-suggestion result
        }
        // Store report data for potential Excel export
        if (result.success && result.data && action !== 'export_excel') {
          lastReportData = result.data;
          lastReportName = action.replace(/^get_/, '').replace(/_/g, ' ');
        }
        } // close inner else (normal skill execution)
      }
    } catch (err) {
      responseText = 'Error: ' + (err.message || String(err));
      onLog('Error: ' + (err.message || err));
    }

    // Append debug info if debug mode is enabled
    if (config.debug && _debugAction) {
      const cleanParams = Object.assign({}, _debugParams);
      delete cleanParams._reportData; // don't dump large report data
      const paramStr = Object.keys(cleanParams).length > 0
        ? Object.entries(cleanParams).map(([k, v]) => v != null ? k + '=' + v : null).filter(Boolean).join(', ')
        : 'none';
      const tierStr = _debugTier ? ' tier=' + _debugTier : '';
      responseText += '\n\n_(debug: ' + _debugAction + '(' + paramStr + ')' + tierStr + ')_';
    }

    // Update conversation history for context in future messages
    conversationHistory.push({ role: 'user', content: textForProcessing });
    conversationHistory.push({ role: 'assistant', content: responseText });
    while (conversationHistory.length > MAX_HISTORY) {
      conversationHistory.shift();
    }

    // Translate reply back to user's language if enabled (only for supported languages)
    let finalResponseText = responseText;
    if (sarvamClient && config.translation?.translateReplies && userLang !== 'en-IN' && userLang !== 'en' && SUPPORTED_LANGS.includes(userLang)) {
      try {
        finalResponseText = await sarvamClient.translate(responseText, {
          from: 'en-IN',
          to: userLang,
          model: config.translation?.model || 'mayura:v1',
        });
        onLog('[translation] Reply translated to ' + userLang);
      } catch (err) {
        onLog('[translation] Reply translation error: ' + (err.message || err));
        // Use English reply as fallback
      }
    }

    // Add bot prefix to the final response so echoes are identifiable
    const prefixedResponse = BOT_PREFIX + finalResponseText;
    
    try {
      await reply(message, prefixedResponse);
      onLog('Replied ok');
      
      // Send attachment (PDF, etc.) if present
      if (attachment && attachment.buffer) {
        try {
          await sendDocument(message, attachment.buffer, attachment.filename, attachment.caption || '');
          onLog('Attachment sent: ' + attachment.filename);
        } catch (attErr) {
          onLog('Attachment send failed: ' + (attErr.message || attErr));
        }
      }
    } catch (err) {
      onLog('Reply failed: ' + (err.message || err));
    }
  }

  return {
    handleMessage,
    getConfig: () => config,
    getRegistry: () => registry,
    getResolver: () => resolver,
    getAlertManager: () => alertManager,
    getScheduler: () => scheduler,
  };
}

module.exports = { createOrchestrator };
