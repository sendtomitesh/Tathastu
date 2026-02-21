const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

/**
 * After the client is ready, use CDP to throttle CPU so WhatsApp's background
 * sync doesn't spike to 100%. We only need real-time message events.
 */
async function throttleAfterReady(client, log) {
  try {
    const page = client.pupPage;
    if (!page) return;
    const cdp = await page.target().createCDPSession();
    // Emulation.setCPUThrottlingRate: rate=4 means CPU runs at 1/4 speed
    // This dramatically reduces sync CPU usage while still allowing messages through
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    log('CPU throttle applied (4x slowdown for background sync)');
    // After 2 min, reduce to 2x (sync should be mostly done) — keep permanently
    // Normal Chrome throttles background tabs automatically; headless doesn't,
    // so we keep a permanent 2x throttle to prevent CPU spikes
    setTimeout(async () => {
      try {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
        log('CPU throttle reduced to 2x (permanent)');
      } catch (_) { /* page may be closed */ }
    }, 120000);
  } catch (err) {
    log('CPU throttle failed (non-critical): ' + (err.message || err));
  }
}

/**
 * Create and return a WhatsApp client with LocalAuth (session persisted in dataPath).
 * @param {object} options
 * @param {string} [options.dataPath] - Directory for session (default: .wwebjs_auth)
 * @param {function} [options.onQr] - (qr: string) => void - called when QR is ready to display
 * @param {function} [options.onReady] - () => void
 * @param {function} [options.onMessage] - (message) => void - for incoming messages
 */
function createClient(options = {}) {
  const dataPath = options.dataPath || path.join(process.cwd(), '.wwebjs_auth');
  const puppeteerOpts = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-default-browser-check',
      '--password-store=basic',
      // Reduce memory usage during initial sync
      '--js-flags=--max-old-space-size=512',
      '--disable-features=TranslateUI',
      '--disable-logging',
      '--disable-notifications',
      '--disable-offer-store-unmasked-wallet-cards',
      '--disable-speech-api',
      '--hide-scrollbars',
      '--mute-audio',
      '--single-process',
    ],
  };
  // Use system Chrome when PUPPETEER_SKIP_DOWNLOAD was used (e.g. Windows)
  const exePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (exePath) {
    puppeteerOpts.executablePath = exePath;
  }
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath }),
    puppeteer: puppeteerOpts,
    // Use cached WhatsApp Web version to skip version check on startup
    webVersionCache: { type: 'local' },
    // Don't pre-fetch messages for all chats — dramatically speeds up first login
    // We only need real-time message events, not historical data
    syncFullHistory: false,
  });

  // Verbose lifecycle logging so we can see what's happening
  const log = (...args) => console.log('[wa]', ...args);
  const startTime = Date.now();

  client.on('qr', (qr) => {
    log('QR code received (' + ((Date.now() - startTime) / 1000).toFixed(1) + 's)');
    if (options.onQr) options.onQr(qr);
  });
  client.on('ready', () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Client READY (${elapsed}s from start)`);
    // Throttle CPU after ready — WhatsApp's background sync hammers the CPU
    // We only need real-time message events, not full chat sync
    throttleAfterReady(client, log);
    if (options.onReady) options.onReady();
  });
  client.on('authenticated', () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Authenticated (${elapsed}s)`);
    if (options.onAuthenticated) options.onAuthenticated();
  });
  client.on('auth_failure', (msg) => log('Auth failure:', msg));
  client.on('disconnected', (reason) => log('Disconnected:', reason));
  client.on('loading_screen', (percent, msg) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Loading: ${percent}% ${msg} (${elapsed}s)`);
    if (options.onLoadingScreen) options.onLoadingScreen(percent, msg);
  });
  client.on('change_state', (state) => log('State:', state));

  if (options.onMessage) {
    // 'message' only fires for messages FROM OTHERS (library skips fromMe). Use 'message_create' to get your own messages too.
    client.on('message_create', options.onMessage);
  }

  return client;
}

/**
 * Initialize the client (must be called after creating to start connection).
 * @param {import('whatsapp-web.js').Client} client
 */
function initialize(client) {
  return client.initialize();
}

/**
 * Send a text reply to the same chat. Uses chat.sendMessage for reliability.
 * @param {import('whatsapp-web.js').Message} message - Original message to reply to
 * @param {string} text
 */
async function reply(message, text) {
  try {
    const chat = await message.getChat();
    return await chat.sendMessage(text);
  } catch (err) {
    try {
      return await message.reply(text);
    } catch (err2) {
      throw err2;
    }
  }
}

/**
 * Send a document/file to the same chat.
 * @param {import('whatsapp-web.js').Message} message - Original message (to get chat)
 * @param {Buffer} buffer - File content as Buffer
 * @param {string} filename - Filename with extension (e.g. 'invoice.pdf')
 * @param {string} [caption] - Optional caption text
 */
async function sendDocument(message, buffer, filename, caption) {
  const { MessageMedia } = require('whatsapp-web.js');
  // Ensure proper Node.js Buffer (Puppeteer may return Uint8Array)
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const base64 = buf.toString('base64');
  // Determine mimetype from extension
  const ext = filename.split('.').pop().toLowerCase();
  const mimeMap = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const mimetype = mimeMap[ext] || 'application/octet-stream';
  const media = new MessageMedia(mimetype, base64, filename);
  const chat = await message.getChat();
  return await chat.sendMessage(media, { caption: caption || '', sendMediaAsDocument: true });
}

/**
 * Send a message to the user's own Saved Messages (self-chat).
 * Used by scheduler and alerts to push messages without a user prompt.
 * @param {import('whatsapp-web.js').Client} client - WhatsApp client
 * @param {string} text - Message text
 */
async function sendToSelf(client, text) {
  try {
    const info = client.info;
    if (!info || !info.wid) throw new Error('Client not ready — no wid');
    const selfId = info.wid._serialized;
    await client.sendMessage(selfId, text);
  } catch (err) {
    console.error('[wa] sendToSelf failed:', err.message || err);
    throw err;
  }
}

/**
 * Send a document/file to the user's own Saved Messages (self-chat).
 * @param {import('whatsapp-web.js').Client} client - WhatsApp client
 * @param {Buffer} buffer - File content
 * @param {string} filename - Filename with extension
 * @param {string} [caption] - Optional caption
 */
async function sendDocumentToSelf(client, buffer, filename, caption) {
  const { MessageMedia } = require('whatsapp-web.js');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const base64 = buf.toString('base64');
  const ext = filename.split('.').pop().toLowerCase();
  const mimeMap = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const mimetype = mimeMap[ext] || 'application/octet-stream';
  const media = new MessageMedia(mimetype, base64, filename);
  const info = client.info;
  if (!info || !info.wid) throw new Error('Client not ready — no wid');
  const selfId = info.wid._serialized;
  await client.sendMessage(selfId, media, { caption: caption || '', sendMediaAsDocument: true });
}

module.exports = {
  createClient,
  initialize,
  reply,
  sendDocument,
  sendToSelf,
  sendDocumentToSelf,
};
