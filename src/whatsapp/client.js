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
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  if (options.onQr) {
    client.on('qr', options.onQr);
  }
  if (options.onReady) {
    client.on('ready', options.onReady);
  }
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
