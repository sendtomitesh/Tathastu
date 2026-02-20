const { loadConfig } = require('../config/load');
const { SkillRegistry } = require('../skills');
const { parseIntent, getAvailableCommandsHelp, getCapabilitiesMessage } = require('../openai/parse');
const { reply, sendDocument } = require('../whatsapp/client');
const { SarvamClient } = require('../translation/sarvam');

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
  const onMessage = options.onMessage || null; // Callback to store messages: (message) => void
  
  // Message storage for conversation UI (only self-chat messages)
  const messages = [];
  const MAX_MESSAGES = 500; // Keep last 500 messages
  
  // Conversation history for LLM context (user + assistant pairs)
  const conversationHistory = [];
  const MAX_HISTORY = 10; // Keep last 10 turns (5 user + 5 bot)
  
  // Last report data for Excel export
  let lastReportData = null;
  let lastReportName = '';
  
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

    // Store user message if it's a self-chat
    if (isSelfChat) {
      const userMessage = {
        id: 'user_' + Date.now(),
        type: 'user',
        text: userText,
        timestamp: message.timestamp * 1000 || Date.now(), // WhatsApp timestamp is in seconds
        isAudio: isAudioMessage,
        originalLang: userLang !== 'en-IN' && userLang !== 'en' ? userLang : null,
      };
      messages.push(userMessage);
      if (messages.length > MAX_MESSAGES) messages.shift();
      if (onMessage) onMessage(userMessage);
    }

    onLog('Msg: "' + (userText.slice(0, 25) + (userText.length > 25 ? '…' : '')) + '" fromMe=' + message.fromMe);

    // Skip Sarvam for text messages — OpenAI handles English/Hindi/Gujarati text fine.
    // Sarvam is only used for audio transcription (handled above).
    // For audio messages, userLang was already set by the transcription step.
    let textForProcessing = userText;
    const SUPPORTED_LANGS = ['en-IN', 'en', 'hi-IN', 'gu-IN'];

    let responseText;
    let attachment = null;
    try {
      const { skillId, action, params, suggestedReply } = await parseIntent(textForProcessing, config, process.env.OPENAI_API_KEY, conversationHistory);
      if (skillId == null || action === 'unknown') {
        // For greetings, always use our curated capabilities message
        const isGreeting = /^(hi|hello|hey|hiya|good\s*morning|good\s*evening|good\s*afternoon|gm|sup|namaste|namaskar)\b/i.test(textForProcessing.trim());
        if (isGreeting) {
          responseText = "Hey! 👋 Welcome to *Tathastu*.\n\n" + getCapabilitiesMessage();
        } else {
          responseText = (suggestedReply && suggestedReply.length > 0)
            ? suggestedReply
            : "I didn't understand. " + getAvailableCommandsHelp(config);
        }
      } else {
        // For export_excel, inject last report data
        if (action === 'export_excel' && lastReportData) {
          params._reportData = lastReportData;
          if (!params.report_name) params.report_name = lastReportName;
        }
        const result = await registry.execute(skillId, action, params);
        responseText = result.success
          ? (result.message || 'Done.')
          : (result.message || 'Action failed.');
        if (result.attachment) attachment = result.attachment;
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
      
      // Store bot reply message (without prefix for clean display)
      const botMessage = {
        id: 'bot_' + Date.now(),
        type: 'bot',
        text: finalResponseText,
        timestamp: Date.now(),
        originalLang: userLang !== 'en-IN' && userLang !== 'en' ? userLang : null,
      };
      messages.push(botMessage);
      if (messages.length > MAX_MESSAGES) messages.shift();
      if (onMessage) onMessage(botMessage);
    } catch (err) {
      onLog('Reply failed: ' + (err.message || err));
    }
  }

  return {
    handleMessage,
    getConfig: () => config,
    getRegistry: () => registry,
    getMessages: () => [...messages], // Return copy of messages
  };
}

module.exports = { createOrchestrator };
