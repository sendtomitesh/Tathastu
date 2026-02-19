/**
 * Minimal WhatsApp connection test with verbose logging.
 */
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const dataPath = path.join(process.cwd(), '.wwebjs_auth');

console.log('Creating client...');
console.log('Session dir:', dataPath);

const client = new Client({
  authStrategy: new LocalAuth({ dataPath }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => console.log('QR received (scan needed)'));
client.on('ready', () => console.log('WhatsApp READY'));
client.on('authenticated', () => console.log('Authenticated'));
client.on('auth_failure', (msg) => console.log('Auth failure:', msg));
client.on('disconnected', (reason) => console.log('Disconnected:', reason));
client.on('loading_screen', (percent, msg) => console.log('Loading:', percent + '%', msg));
client.on('change_state', (state) => console.log('State changed:', state));

console.log('Calling initialize()...');
client.initialize()
  .then(() => console.log('initialize() resolved'))
  .catch((err) => console.log('initialize() ERROR:', err.message));

// Timeout safety
setTimeout(() => {
  console.log('60s timeout — still no connection. Exiting.');
  process.exit(1);
}, 60000);
