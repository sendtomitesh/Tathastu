/**
 * Run the bot with a web UI (QR and status in your browser).
 * Single-tenant: npm run bot (one WhatsApp, one QR).
 * Multi-tenant: add "tenants" to config/skills.json for one page with a QR per employee.
 */
const path = require('path');
const cwd = process.cwd();
require('dotenv').config({ path: path.join(cwd, '.env') });
if (!process.env.OPENAI_API_KEY) {
  require('dotenv').config({ path: path.join(cwd, '.env.example') });
}

const QRCode = require('qrcode');
const { loadConfig } = require('./config/load');
const { createOrchestrator } = require('./bot/orchestrator');
const { createClient, initialize } = require('./whatsapp/client');
const { start: startUi } = require('./ui/server');

async function runSingleTenant(config, ui) {
  const sessionDir = process.env.MPBOT_SESSION_DIR || '.wwebjs_auth';
  const sessionPath = path.isAbsolute(sessionDir) ? sessionDir : path.join(cwd, sessionDir);
  let waClient = null;
  let orchestrator = null;

  async function startClient() {
    waClient = createClient({
      dataPath: sessionPath,
      onQr: async (qr) => {
        try {
          const dataUrl = await QRCode.toDataURL(qr, { width: 260, margin: 1 });
          ui.setQr(dataUrl);
          ui.setStatus('qr', 'Scan this QR with WhatsApp (Linked Devices)');
        } catch (e) {
          ui.setStatus('error', 'QR error: ' + (e.message || e));
        }
      },
      onReady: () => {
        ui.setQr(null);
        ui.setStatus('ready', 'Connected. Send a message to run commands.');
      },
      onMessage: (message) => {
        ui.addLog('Incoming message event');
        orchestrator.handleMessage(message).catch((err) => {
          ui.addLog('Handle error: ' + (err.message || err));
        });
      },
    });
    orchestrator = createOrchestrator({
      config,
      client: waClient,
      onLog: (text) => ui.addLog(text),
      onMessage: (msg) => ui.addMessage(msg),
    });
    await initialize(waClient);
  }

  // Register reset handler: destroy client, clear session, restart
  ui.setResetHandler(async () => {
    ui.addLog('Resetting WhatsApp session…');
    try {
      if (waClient) {
        await waClient.destroy().catch(() => {});
      }
    } catch (e) { /* ignore */ }
    // Kill any lingering Chrome processes
    try {
      require('child_process').execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' });
    } catch (e) { /* ignore - no chrome running */ }
    // Clear session directory
    const fs = require('fs');
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      ui.addLog('Session cleared');
    } catch (e) {
      ui.addLog('Could not clear session: ' + (e.message || e));
    }
    // Wait a moment for cleanup
    await new Promise((r) => setTimeout(r, 2000));
    // Restart client
    ui.setStatus('connecting', 'Starting WhatsApp…');
    ui.setQr(null);
    try {
      await startClient();
    } catch (err) {
      ui.setStatus('error', 'WhatsApp init failed: ' + (err.message || err));
      throw err;
    }
  });

  await startClient().catch((err) => {
    ui.setStatus('error', 'WhatsApp init failed: ' + (err.message || err));
    throw err;
  });
}

async function runMultiTenant(config, ui) {
  const tenantList = config.tenants;
  for (const tenant of tenantList) {
    const sessionDir = path.isAbsolute(tenant.sessionDir) ? tenant.sessionDir : path.join(cwd, tenant.sessionDir);
    const waClient = createClient({
      dataPath: sessionDir,
      onQr: async (qr) => {
        try {
          const dataUrl = await QRCode.toDataURL(qr, { width: 220, margin: 1 });
          ui.setTenantQr(tenant.id, dataUrl);
        } catch (e) {
          ui.setTenantStatus(tenant.id, 'error', 'QR error: ' + (e.message || e));
        }
      },
      onReady: () => {
        ui.setTenantQr(tenant.id, null);
        ui.setTenantStatus(tenant.id, 'ready', 'Connected. Send a message to run commands.');
      },
      onMessage: (message) => {
        ui.addTenantLog(tenant.id, 'Incoming message event');
        orchestrator.handleMessage(message).catch((err) => {
          ui.addTenantLog(tenant.id, 'Handle error: ' + (err.message || err));
        });
      },
    });
    const orchestrator = createOrchestrator({ 
      config, 
      client: waClient, 
      onLog: (text) => ui.addTenantLog(tenant.id, text),
      onMessage: (msg) => ui.addTenantMessage(tenant.id, msg)
    });
    initialize(waClient).catch((err) => {
      ui.setTenantStatus(tenant.id, 'error', 'WhatsApp init failed: ' + (err.message || err));
      console.error('WhatsApp init failed for', tenant.id, err.message);
    });
  }
  // Allow all clients to start (don't block on first failure)
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('Config failed:', err.message);
    process.exit(1);
  }

  const isMulti = Array.isArray(config.tenants) && config.tenants.length > 0;
  const ui = await startUi(isMulti ? { tenants: config.tenants } : {});

  if (isMulti) {
    ui.setStatus('connecting', 'Starting ' + config.tenants.length + ' WhatsApp client(s)…');
  } else {
    ui.setStatus('connecting', 'Starting WhatsApp…');
  }
  ui.openBrowser();

  try {
    if (isMulti) {
      await runMultiTenant(config, ui);
    } else {
      await runSingleTenant(config, ui);
    }
  } catch (err) {
    if (!isMulti) {
      ui.setStatus('error', 'WhatsApp init failed: ' + (err.message || err));
      console.error('WhatsApp init failed:', err.message);
      process.exit(1);
    }
  }
}

main();
