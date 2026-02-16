const path = require('path');
const electron = require('electron');
const app = (electron && typeof electron === 'object' && electron.app) ? electron.app : undefined;
const BrowserWindow = (electron && typeof electron === 'object' && electron.BrowserWindow) ? electron.BrowserWindow : undefined;

if (!app || !BrowserWindow) {
  console.error('BotBandhu: Electron UI is not available on this setup.');
  console.error('Run the bot with: npm run bot   (QR will show in the terminal)');
  process.exit(1);
}

const cwd = process.cwd();
require('dotenv').config({ path: path.join(cwd, '.env') });
if (!process.env.OPENAI_API_KEY) {
  require('dotenv').config({ path: path.join(cwd, '.env.example') });
}

let mainWindow = null;
let waClient = null;
let orchestrator = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 520,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

app.whenReady().then(() => {
  // Re-require so rest of app runs after window is ready
  const { loadConfig } = require('../config/load');
  const { createOrchestrator } = require('../bot/orchestrator');
  const { createClient, initialize } = require('../whatsapp/client');
  const QRCode = require('qrcode');

  createWindow();

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    sendToRenderer('status', 'error', 'Config failed: ' + (err.message || err));
    return;
  }

  orchestrator = createOrchestrator({ config });
  waClient = createClient({
    onQr: async (qr) => {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 });
        sendToRenderer('qr', dataUrl);
        sendToRenderer('status', 'qr', 'Scan QR with WhatsApp (Linked Devices)');
      } catch (e) {
        sendToRenderer('status', 'error', 'QR generate failed');
      }
    },
    onReady: () => {
      sendToRenderer('qr', null);
      sendToRenderer('status', 'ready', 'Connected');
    },
    onMessage: (message) => {
      orchestrator.handleMessage(message).catch((err) => {
        sendToRenderer('log', 'Handle error: ' + (err.message || err));
      });
    },
  });

  initialize(waClient).catch((err) => {
    sendToRenderer('status', 'error', 'WhatsApp init failed: ' + (err.message || err));
  });
});

app.on('window-all-closed', () => {
  if (waClient) {
    waClient.destroy().catch(() => {});
  }
  app.quit();
});
