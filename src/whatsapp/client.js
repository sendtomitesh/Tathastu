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

module.exports = {
  createClient,
  initialize,
  reply,
};
