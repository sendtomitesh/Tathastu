const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

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
  });

  // Verbose lifecycle logging so we can see what's happening
  const log = (...args) => console.log('[wa]', ...args);

  client.on('qr', (qr) => {
    log('QR code received');
    if (options.onQr) options.onQr(qr);
  });
  client.on('ready', () => {
    log('Client READY');
    if (options.onReady) options.onReady();
  });
  client.on('authenticated', () => log('Authenticated'));
  client.on('auth_failure', (msg) => log('Auth failure:', msg));
  client.on('disconnected', (reason) => log('Disconnected:', reason));
  client.on('loading_screen', (percent, msg) => log('Loading:', percent + '%', msg));
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

module.exports = {
  createClient,
  initialize,
  reply,
  sendDocument,
};
