const { loadConfig } = require('../config/load');
const { SkillRegistry } = require('../skills');
const { parseIntent, getAvailableCommandsHelp, getCapabilitiesMessage } = require('../openai/parse');
const { reply, sendDocument } = require('../whatsapp/client');
const { SarvamClient } = require('../translation/sarvam');
const { createResolver } = require('../intent/resolver');

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
    if (config.whatsapp?.onlyPrivateChats) {
      const chatIdStr = (chat.id && (chat.id._serialized || chat.id)) || '';
      const isGroup = chat.isGroup === true || String(chatIdStr).endsWith('@g.us');
      if (isGroup) {
        onLog('Skip: group chat');
        return;
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

    // Skip Sarvam for text messages — OpenAI handles English/Hindi/Gujarati text fine.
    // Sarvam is only used for audio transcription (handled above).
    // For audio messages, userLang was already set by the transcription step.
    let textForProcessing = userText;
    const SUPPORTED_LANGS = ['en-IN', 'en', 'hi-IN', 'gu-IN'];

    let responseText;
    let attachment = null;
    let _debugAction = null, _debugParams = null, _debugTier = null;
    try {
      // Check for pagination commands ("more", "next", "page 2", etc.)
      const paginationMatch = textForProcessing.match(/^(?:more|next|next page|aur|aur dikhao|aage|vadhu|aagal|page\s*(\d+))$/i);
      let skillId, action, params, suggestedReply;
      if (paginationMatch && lastAction && lastSkillId) {
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
        // For export_excel, inject last report data or auto-fetch if needed
        if (action === 'export_excel') {
          if (lastReportData) {
            params._reportData = lastReportData;
            if (!params.report_name) params.report_name = lastReportName;
          } else {
            // No previous report — try to auto-fetch based on what user asked for
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
              try {
                const autoResult = await registry.execute(skillId, autoAction, autoParams);
                if (autoResult.success && autoResult.data) {
                  params._reportData = autoResult.data;
                  params.report_name = params.report_name || autoAction.replace(/^get_/, '').replace(/_/g, ' ');
                  lastReportData = autoResult.data;
                  lastReportName = params.report_name;
                }
              } catch (e) { /* auto-fetch failed, will show "no report data" message */ }
            }
          }
        }
        const result = await registry.execute(skillId, action, params);
        responseText = result.success
          ? (result.message || 'Done.')
          : (result.message || 'Action failed.');
        if (result.attachment) attachment = result.attachment;
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
  };
}

module.exports = { createOrchestrator };
