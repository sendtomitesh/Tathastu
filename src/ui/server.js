/**
 * Minimal HTTP server that serves the bot UI (QR, status) and admin config UI.
 * Single-tenant: one QR/status. Multi-tenant: one page with a card per employee (each their own QR).
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.MPBOT_UI_PORT || 3750;
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(process.cwd(), 'config', 'skills.json');

function getResolvedConfigPath() {
  return path.isAbsolute(CONFIG_PATH) ? CONFIG_PATH : path.join(process.cwd(), CONFIG_PATH);
}

function readConfigFile() {
  const resolved = getResolvedConfigPath();
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function writeConfigFile(data) {
  const resolved = getResolvedConfigPath();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(data, null, 2), 'utf8');
}

// Single-tenant state (when no tenants list)
let state = {
  mode: 'single',
  status: 'connecting',
  statusText: 'Starting…',
  qrDataUrl: null,
  log: [],
  messages: [], // Conversation messages (self-chat only)
};

// Multi-tenant state: tenants[id] = { name, status, statusText, qrDataUrl, log, messages }
let tenantsState = {};

function setStatus(status, statusText) {
  state.status = status;
  state.statusText = statusText || status;
}

function setQr(dataUrl) {
  state.qrDataUrl = dataUrl;
}

function addLog(text) {
  state.log.push({ t: Date.now(), text });
  if (state.log.length > 50) state.log.shift();
}

function initTenants(tenantList) {
  state.mode = 'multi';
  tenantsState = {};
  for (const t of tenantList) {
    tenantsState[t.id] = {
      name: t.name || t.id,
      status: 'connecting',
      statusText: 'Starting…',
      qrDataUrl: null,
      log: [],
      messages: [],
    };
  }
}

function setTenantStatus(tenantId, status, statusText) {
  if (tenantsState[tenantId]) {
    tenantsState[tenantId].status = status;
    tenantsState[tenantId].statusText = statusText || status;
  }
}

function setTenantQr(tenantId, dataUrl) {
  if (tenantsState[tenantId]) {
    tenantsState[tenantId].qrDataUrl = dataUrl;
    if (dataUrl) {
      tenantsState[tenantId].status = 'qr';
      tenantsState[tenantId].statusText = 'Scan with WhatsApp (Linked Devices)';
    }
  }
}

function addTenantLog(tenantId, text) {
  if (tenantsState[tenantId]) {
    tenantsState[tenantId].log.push({ t: Date.now(), text });
    if (tenantsState[tenantId].log.length > 50) tenantsState[tenantId].log.shift();
  }
}

function addMessage(message) {
  state.messages.push(message);
  if (state.messages.length > 500) state.messages.shift();
}

function addTenantMessage(tenantId, message) {
  if (tenantsState[tenantId]) {
    if (!tenantsState[tenantId].messages) tenantsState[tenantId].messages = [];
    tenantsState[tenantId].messages.push(message);
    if (tenantsState[tenantId].messages.length > 500) tenantsState[tenantId].messages.shift();
  }
}

function getMessages(tenantId = null) {
  if (tenantId && tenantsState[tenantId]) {
    return tenantsState[tenantId].messages || [];
  }
  return state.messages || [];
}

function getApiStatus() {
  if (state.mode === 'multi') {
    return {
      mode: 'multi',
      tenants: Object.entries(tenantsState).map(([id, t]) => ({
        id,
        name: t.name,
        status: t.status,
        statusText: t.statusText,
        qrDataUrl: t.qrDataUrl,
        log: t.log.slice(-20),
      })),
    };
  }
  return {
    mode: 'single',
    status: state.status,
    statusText: state.statusText,
    qrDataUrl: state.qrDataUrl,
    log: state.log.slice(-20),
  };
}

const SINGLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BotBandhu</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #1a1a2e; color: #eee; min-height: 100vh; }
    .container { max-width: 360px; margin: 0 auto; }
    h1 { font-size: 1.25rem; margin: 0 0 12px 0; }
    .status { font-size: 0.9rem; color: #aaa; margin-bottom: 16px; }
    .status.ready { color: #4ade80; }
    .status.error { color: #f87171; }
    .qrcode { text-align: center; margin: 16px 0; min-height: 260px; }
    .qrcode img { max-width: 260px; background: #fff; padding: 12px; border-radius: 8px; }
    .log { font-size: 0.85rem; color: #888; max-height: 400px; overflow-y: auto; border-top: 1px solid #333; padding-top: 12px; padding-bottom: 8px; background: rgba(0,0,0,0.2); border-radius: 6px; padding-left: 12px; padding-right: 12px; margin-top: 12px; }
    .log div { margin-bottom: 6px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="container">
    <h1>BotBandhu</h1>
    <p id="status" class="status">Connecting…</p>
    <div style="margin-bottom:12px;"><a href="/chat" style="color:#60a5fa;text-decoration:none;font-size:0.85rem;">💬 View Conversation</a> | <a href="/admin" style="color:#60a5fa;text-decoration:none;font-size:0.85rem;">⚙️ Admin</a></div>
    <div id="qrcode" class="qrcode"></div>
    <div id="log" class="log"></div>
  </div>
  <script>
    function poll() {
      fetch('/api/status').then(r => r.json()).then(d => {
        if (d.mode !== 'single') return;
        document.getElementById('status').textContent = d.statusText;
        document.getElementById('status').className = 'status ' + (d.status === 'ready' ? 'ready' : d.status === 'error' ? 'error' : '');
        var qr = document.getElementById('qrcode');
        if (d.qrDataUrl) qr.innerHTML = '<img src="' + d.qrDataUrl + '" alt="Scan with WhatsApp">';
        else qr.innerHTML = '';
        var logEl = document.getElementById('log');
        if (d.log && d.log.length) {
          logEl.innerHTML = d.log.map(function (e) { return '<div>' + new Date(e.t).toLocaleTimeString() + ' ' + e.text + '</div>'; }).join('');
          logEl.scrollTop = logEl.scrollHeight;
        }
      }).catch(function () {});
    }
    setInterval(poll, 1500);
    poll();
  </script>
</body>
</html>`;

const MULTI_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BotBandhu – Register WhatsApp</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #1a1a2e; color: #eee; min-height: 100vh; }
    h1 { font-size: 1.25rem; margin: 0 0 16px 0; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; max-width: 900px; }
    .card { background: #16213e; border-radius: 12px; padding: 16px; border: 1px solid #333; }
    .card h2 { font-size: 1rem; margin: 0 0 12px 0; color: #e0e0e0; }
    .card .status { font-size: 0.85rem; color: #aaa; margin-bottom: 12px; }
    .card .status.ready { color: #4ade80; }
    .card .status.error { color: #f87171; }
    .card .qrcode { text-align: center; margin: 12px 0; min-height: 220px; }
    .card .qrcode img { max-width: 220px; background: #fff; padding: 10px; border-radius: 8px; }
    .card .log { font-size: 0.8rem; color: #888; max-height: 250px; overflow-y: auto; border-top: 1px solid #333; padding-top: 12px; padding-bottom: 8px; margin-top: 12px; background: rgba(0,0,0,0.2); border-radius: 6px; padding-left: 12px; padding-right: 12px; }
    .card .log div { margin-bottom: 4px; line-height: 1.4; }
  </style>
</head>
<body>
  <h1>Register your WhatsApp</h1>
  <p style="color:#888;font-size:0.9rem;margin-bottom:20px;">Find your name below and scan the QR with WhatsApp (Linked devices → Link a device).</p>
  <div style="margin-bottom:20px;"><a href="/chat" style="color:#60a5fa;text-decoration:none;font-size:0.9rem;">💬 View Conversation</a> | <a href="/admin" style="color:#60a5fa;text-decoration:none;font-size:0.9rem;">⚙️ Admin</a></div>
  <div id="cards" class="cards"></div>
  <script>
    function poll() {
      fetch('/api/status').then(r => r.json()).then(d => {
        if (d.mode !== 'multi' || !d.tenants) return;
        var html = '';
        d.tenants.forEach(function(t) {
          var qrHtml = t.qrDataUrl ? '<img src="' + t.qrDataUrl + '" alt="Scan with WhatsApp">' : '<span style="color:#666">Waiting for QR…</span>';
          var logHtml = (t.log && t.log.length) ? t.log.map(function(e) { return '<div>' + new Date(e.t).toLocaleTimeString() + ' ' + e.text + '</div>'; }).join('') : '';
          html += '<div class="card" data-id="' + t.id + '"><h2>' + t.name + '</h2><p class="status ' + (t.status === 'ready' ? 'ready' : t.status === 'error' ? 'error' : '') + '">' + t.statusText + '</p><div class="qrcode">' + qrHtml + '</div><div class="log">' + logHtml + '</div></div>';
        });
        document.getElementById('cards').innerHTML = html;
      }).catch(function () {});
    }
    setInterval(poll, 1500);
    poll();
  </script>
</body>
</html>`;

function getAdminHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BotBandhu – Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #e2e8f0; min-height: 100vh; padding: 0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .header { background: rgba(30, 41, 59, 0.8); backdrop-filter: blur(10px); border-bottom: 1px solid rgba(148, 163, 184, 0.1); padding: 20px 24px; margin: -24px -24px 32px -24px; }
    .header h1 { font-size: 1.75rem; font-weight: 600; color: #f1f5f9; margin-bottom: 4px; }
    .header p { color: #94a3b8; font-size: 0.9rem; }
    .header .nav { margin-top: 12px; }
    .header a { color: #60a5fa; text-decoration: none; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 6px; }
    .header a:hover { color: #93c5fd; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px; margin-bottom: 32px; }
    .card { background: rgba(30, 41, 59, 0.6); backdrop-filter: blur(10px); border: 1px solid rgba(148, 163, 184, 0.1); border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3); }
    .card h2 { font-size: 1.1rem; font-weight: 600; color: #cbd5e1; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
    .card h2::before { content: '⚙️'; font-size: 1.2rem; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; font-size: 0.875rem; font-weight: 500; color: #cbd5e1; margin-bottom: 8px; }
    .form-group input[type=text], .form-group input[type=number], .form-group select, .form-group textarea { width: 100%; padding: 10px 12px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; color: #f1f5f9; font-size: 0.9rem; transition: all 0.2s; }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus { outline: none; border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.1); }
    .form-group textarea { resize: vertical; font-family: 'Monaco', 'Menlo', monospace; }
    .checkbox-group { display: flex; align-items: center; gap: 10px; padding: 12px; background: rgba(15, 23, 42, 0.4); border-radius: 8px; margin-bottom: 12px; }
    .checkbox-group input[type=checkbox] { width: 18px; height: 18px; cursor: pointer; accent-color: #6366f1; }
    .checkbox-group label { margin: 0; cursor: pointer; flex: 1; }
    .btn { padding: 10px 20px; border: none; border-radius: 8px; font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; }
    .btn-primary { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4); }
    .btn-secondary { background: rgba(148, 163, 184, 0.2); color: #e2e8f0; }
    .btn-secondary:hover { background: rgba(148, 163, 184, 0.3); }
    .btn-danger { background: #dc2626; color: white; }
    .btn-danger:hover { background: #b91c1c; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .table-container { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 12px; font-size: 0.8rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(148, 163, 184, 0.2); }
    td { padding: 12px; border-bottom: 1px solid rgba(148, 163, 184, 0.1); }
    td input { width: 100%; padding: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 6px; color: #f1f5f9; font-size: 0.875rem; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
    .badge-success { background: rgba(34, 197, 94, 0.2); color: #86efac; }
    .badge-danger { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
    .alert { padding: 14px 16px; border-radius: 8px; margin-top: 20px; display: flex; align-items: center; gap: 10px; font-size: 0.9rem; }
    .alert-success { background: rgba(34, 197, 94, 0.15); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.3); }
    .alert-error { background: rgba(239, 68, 68, 0.15); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3); }
    .alert::before { font-size: 1.2rem; }
    .alert-success::before { content: '✓'; }
    .alert-error::before { content: '✕'; }
    .skill-item { background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(148, 163, 184, 0.1); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .skill-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .skill-header input[type=checkbox] { width: 20px; height: 20px; }
    .skill-header h3 { font-size: 1rem; font-weight: 600; color: #e2e8f0; flex: 1; }
    .loading { opacity: 0.6; pointer-events: none; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } .container { padding: 16px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚙️ Bot Configuration</h1>
      <p>Manage employees, skills, and bot settings</p>
      <div class="nav"><a href="/">← Back to Bot Dashboard</a></div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Language Understanding</h2>
        <div class="form-group">
          <label>Provider</label>
          <select id="llm-provider">
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama (local)</option>
            <option value="keyword">Keyword (no API)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Model</label>
          <input type="text" id="llm-model" placeholder="e.g. gpt-4o-mini or llama3.2">
        </div>
        <div class="form-group">
          <label>Base URL <span style="color:#94a3b8;font-weight:normal;">(optional)</span></label>
          <input type="text" id="llm-baseUrl" placeholder="e.g. http://localhost:11434">
        </div>
      </div>

      <div class="card">
        <h2>WhatsApp Settings</h2>
        <div class="checkbox-group">
          <input type="checkbox" id="whatsapp-onlyFromMe" checked>
          <label for="whatsapp-onlyFromMe">Only respond to messages from you</label>
        </div>
        <div class="checkbox-group">
          <input type="checkbox" id="whatsapp-onlyPrivateChats" checked>
          <label for="whatsapp-onlyPrivateChats">Only in private chats (no groups)</label>
        </div>
        <div class="checkbox-group">
          <input type="checkbox" id="whatsapp-onlySelfChat">
          <label for="whatsapp-onlySelfChat">Only in Saved Messages (self-chat)</label>
        </div>
      </div>

      <div class="card">
        <h2>🌐 Translation (Sarvam AI)</h2>
        <div class="checkbox-group">
          <input type="checkbox" id="translation-enabled">
          <label for="translation-enabled">Enable translation and audio transcription</label>
        </div>
        <div class="form-group">
          <label>API Key</label>
          <input type="password" id="translation-apiKey" placeholder="sk_...">
        </div>
        <div class="form-group">
          <label>Base URL <span style="color:#94a3b8;font-weight:normal;">(optional)</span></label>
          <input type="text" id="translation-baseUrl" placeholder="https://api.sarvam.ai">
        </div>
        <div class="form-group">
          <label>Model</label>
          <select id="translation-model">
            <option value="mayura:v1">mayura:v1 (12 languages, all modes)</option>
            <option value="sarvam-translate:v1">sarvam-translate:v1 (22 languages, formal only)</option>
          </select>
        </div>
        <div class="checkbox-group">
          <input type="checkbox" id="translation-translateReplies">
          <label for="translation-translateReplies">Translate bot replies back to user's language</label>
        </div>
        <p style="color:#94a3b8;font-size:0.85rem;margin-top:12px;">Supports 22+ Indian languages. Audio messages are automatically transcribed and translated to English.</p>
      </div>
    </div>

    <div class="card">
      <h2>👥 Employees</h2>
      <p style="color:#94a3b8;font-size:0.85rem;margin-bottom:16px;">Each employee gets a card on the main page with their own QR code. Use a unique sessionDir per person.</p>
      <div class="table-container">
        <table id="tenants-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Display Name</th>
              <th>Session Directory</th>
              <th style="width:100px;">Actions</th>
            </tr>
          </thead>
          <tbody id="tenants-list"></tbody>
        </table>
      </div>
      <button type="button" id="add-tenant" class="btn btn-secondary" style="margin-top:16px;">+ Add Employee</button>
    </div>

    <div class="card">
      <h2>🔧 Skills</h2>
      <div id="skills-list"></div>
    </div>

    <div style="text-align:center;margin-top:32px;">
      <button type="button" id="save-config" class="btn btn-primary" style="padding:12px 32px;font-size:1rem;">💾 Save Configuration</button>
      <div id="msg" class="alert" style="display:none;margin-top:20px;"></div>
      <p style="color:#94a3b8;font-size:0.85rem;margin-top:12px;">⚠️ Restart the bot after saving for changes to apply</p>
    </div>
  </div>

  <script>
    var config = {};
    function load() {
      document.body.classList.add('loading');
      fetch('/api/config').then(function(r) { return r.json(); }).then(function(data) {
        document.body.classList.remove('loading');
        if (data.error) { showMsg(data.error, true); return; }
        config = data;
        render();
      }).catch(function(e) {
        document.body.classList.remove('loading');
        showMsg(e.message || 'Failed to load config', true);
      });
    }
    function render() {
      var llm = config.llm || { provider: 'openai', model: (config.openai && config.openai.model) || 'gpt-4o-mini' };
      document.getElementById('llm-provider').value = llm.provider || 'openai';
      document.getElementById('llm-model').value = llm.model || '';
      document.getElementById('llm-baseUrl').value = llm.baseUrl || '';
      var wa = config.whatsapp || {};
      document.getElementById('whatsapp-onlyFromMe').checked = wa.onlyFromMe !== false;
      document.getElementById('whatsapp-onlyPrivateChats').checked = wa.onlyPrivateChats !== false;
      document.getElementById('whatsapp-onlySelfChat').checked = !!wa.onlySelfChat;
      var trans = config.translation || {};
      document.getElementById('translation-enabled').checked = !!trans.enabled;
      document.getElementById('translation-apiKey').value = trans.apiKey || '';
      document.getElementById('translation-baseUrl').value = trans.baseUrl || '';
      document.getElementById('translation-model').value = trans.model || 'mayura:v1';
      document.getElementById('translation-translateReplies').checked = !!trans.translateReplies;
      var tenants = config.tenants || [];
      function esc(v) { return String(v || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
      document.getElementById('tenants-list').innerHTML = tenants.length ? tenants.map(function(t, i) {
        return '<tr><td><input type="text" data-tenant-id placeholder="employee_1" value="' + esc(t.id) + '"></td><td><input type="text" data-tenant-name placeholder="Employee Name" value="' + esc(t.name) + '"></td><td><input type="text" data-tenant-dir placeholder=".wwebjs_auth_employee_1" value="' + esc(t.sessionDir) + '"></td><td><button type="button" class="btn btn-danger" data-tenant-remove data-i="' + i + '" style="padding:6px 12px;font-size:0.8rem;">Remove</button></td></tr>';
      }).join('') : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:24px;">No employees added yet. Click "Add Employee" to get started.</td></tr>';
      document.querySelectorAll('[data-tenant-remove]').forEach(function(btn) {
        btn.onclick = function() { config.tenants.splice(parseInt(btn.getAttribute('data-i'), 10), 1); render(); };
      });
      var skills = config.skills || [];
      document.getElementById('skills-list').innerHTML = skills.length ? skills.map(function(s, i) {
        var cfg = s.config || {};
        var cfgBody = Object.keys(cfg).map(function(k) { return k + ': ' + cfg[k]; }).join('\\n');
        return '<div class="skill-item"><div class="skill-header"><input type="checkbox" data-skill-enabled data-i="' + i + '" id="skill-' + i + '" ' + (s.enabled !== false ? 'checked' : '') + '><h3><label for="skill-' + i + '">' + esc(s.name || s.id || '') + '</label></h3><span class="badge ' + (s.enabled !== false ? 'badge-success' : 'badge-danger') + '">' + (s.enabled !== false ? 'Enabled' : 'Disabled') + '</span></div><div class="form-group"><label>Display Name</label><input type="text" data-skill-name data-i="' + i + '" value="' + esc(s.name || s.id || '') + '"></div><div class="form-group"><label>Configuration <span style="color:#94a3b8;font-weight:normal;">(key: value, one per line)</span></label><textarea data-skill-config data-i="' + i + '" rows="3" placeholder="port: 9000\\ncompanyName: My Company">' + esc(cfgBody) + '</textarea></div></div>';
      }).join('') : '<p style="color:#94a3b8;text-align:center;padding:24px;">No skills configured.</p>';
    }
    document.getElementById('add-tenant').onclick = function() {
      config.tenants = config.tenants || [];
      var n = config.tenants.length + 1;
      config.tenants.push({ id: 'employee_' + n, name: 'Employee ' + n, sessionDir: '.wwebjs_auth_employee_' + n });
      render();
    };
    document.getElementById('save-config').onclick = function() {
      var btn = this;
      btn.disabled = true;
      btn.textContent = '⏳ Saving...';
      document.body.classList.add('loading');
      var llm = { provider: document.getElementById('llm-provider').value, model: document.getElementById('llm-model').value || undefined };
      var baseUrl = document.getElementById('llm-baseUrl').value.trim();
      if (baseUrl) llm.baseUrl = baseUrl;
      config.llm = llm;
      config.openai = config.openai || {};
      config.openai.model = llm.model;
      config.whatsapp = {
        onlyFromMe: document.getElementById('whatsapp-onlyFromMe').checked,
        onlyPrivateChats: document.getElementById('whatsapp-onlyPrivateChats').checked,
        onlySelfChat: document.getElementById('whatsapp-onlySelfChat').checked
      };
      var transEnabled = document.getElementById('translation-enabled').checked;
      if (transEnabled) {
        config.translation = {
          enabled: true,
          provider: 'sarvam',
          apiKey: document.getElementById('translation-apiKey').value.trim() || undefined,
          baseUrl: document.getElementById('translation-baseUrl').value.trim() || undefined,
          model: document.getElementById('translation-model').value || 'mayura:v1',
          translateReplies: document.getElementById('translation-translateReplies').checked
        };
        // Remove empty fields
        if (!config.translation.apiKey) delete config.translation.apiKey;
        if (!config.translation.baseUrl) delete config.translation.baseUrl;
      } else {
        config.translation = { enabled: false };
      }
      var rows = document.querySelectorAll('#tenants-list tr');
      config.tenants = [];
      rows.forEach(function(row) {
        var id = (row.querySelector('[data-tenant-id]') || {}).value.trim();
        var name = (row.querySelector('[data-tenant-name]') || {}).value.trim();
        var dir = (row.querySelector('[data-tenant-dir]') || {}).value.trim();
        if (id) config.tenants.push({ id: id, name: name || id, sessionDir: dir || '.wwebjs_auth_' + id });
      });
      var skillBlocks = document.querySelectorAll('#skills-list .skill-item');
      (config.skills || []).forEach(function(s, i) {
        var block = skillBlocks[i];
        if (!block) return;
        s.enabled = block.querySelector('[data-skill-enabled]').checked;
        s.name = (block.querySelector('[data-skill-name]') || {}).value.trim() || s.id;
        var cfgText = (block.querySelector('[data-skill-config]') || {}).value || '';
        var cfg = {};
        cfgText.split(/[\\n,]/).forEach(function(line) {
          var m = line.match(/^\\s*([^:]+):\\s*(.*)$/);
          if (m) cfg[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
        });
        s.config = cfg;
      });
      fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          btn.disabled = false;
          btn.textContent = '💾 Save Configuration';
          document.body.classList.remove('loading');
          showMsg(data.error ? data.error : '✓ Configuration saved successfully! Restart the bot to apply changes.'); 
          if (!data.error) setTimeout(load, 500);
        })
        .catch(function(e) {
          btn.disabled = false;
          btn.textContent = '💾 Save Configuration';
          document.body.classList.remove('loading');
          showMsg(e.message || 'Save failed', true);
        });
    };
    function showMsg(txt, isErr) {
      var el = document.getElementById('msg');
      el.textContent = txt;
      el.className = 'alert ' + (isErr ? 'alert-error' : 'alert-success');
      el.style.display = 'flex';
      setTimeout(function() { el.style.display = 'none'; }, 5000);
    }
    load();
  </script>
</body>
</html>`;
}

function getChatHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BotBandhu – Conversation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; }
    .header { background: rgba(30, 41, 59, 0.9); backdrop-filter: blur(10px); border-bottom: 1px solid rgba(148, 163, 184, 0.1); padding: 16px 24px; }
    .header h1 { font-size: 1.5rem; font-weight: 600; color: #f1f5f9; margin-bottom: 4px; }
    .header .nav { margin-top: 8px; }
    .header a { color: #60a5fa; text-decoration: none; font-size: 0.9rem; }
    .header a:hover { color: #93c5fd; }
    .chat-container { flex: 1; display: flex; flex-direction: column; max-width: 900px; margin: 0 auto; width: 100%; padding: 20px; overflow: hidden; }
    .messages { flex: 1; overflow-y: auto; padding: 20px 0; }
    .message { display: flex; margin-bottom: 16px; animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .message.user { justify-content: flex-end; }
    .message.bot { justify-content: flex-start; }
    .message-bubble { max-width: 70%; padding: 12px 16px; border-radius: 18px; word-wrap: break-word; position: relative; }
    .message.user .message-bubble { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; border-bottom-right-radius: 4px; }
    .message.bot .message-bubble { background: rgba(30, 41, 59, 0.8); color: #e2e8f0; border-bottom-left-radius: 4px; border: 1px solid rgba(148, 163, 184, 0.2); }
    .message-meta { font-size: 0.75rem; color: #94a3b8; margin-top: 4px; display: flex; align-items: center; gap: 8px; }
    .message.user .message-meta { justify-content: flex-end; }
    .message-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 500; }
    .badge-audio { background: rgba(96, 165, 250, 0.2); color: #93c5fd; }
    .badge-lang { background: rgba(34, 197, 94, 0.2); color: #86efac; }
    .empty-state { text-align: center; padding: 60px 20px; color: #94a3b8; }
    .empty-state svg { width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5; }
    .empty-state h2 { font-size: 1.2rem; margin-bottom: 8px; color: #cbd5e1; }
    .empty-state p { font-size: 0.9rem; }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: rgba(15, 23, 42, 0.5); }
    ::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.3); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.5); }
  </style>
</head>
<body>
  <div class="header">
    <h1>💬 Conversation History</h1>
    <p style="color:#94a3b8;font-size:0.85rem;margin-top:4px;">Your self-chat messages with the bot</p>
    <div class="nav"><a href="/">← Back to Dashboard</a> | <a href="/admin">⚙️ Admin</a></div>
  </div>
  <div class="chat-container">
    <div id="messages" class="messages">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <h2>No messages yet</h2>
        <p>Start chatting with the bot in Saved Messages to see your conversation here.</p>
      </div>
    </div>
  </div>
  <script>
    let lastMessageCount = 0;
    let renderedMessageIds = new Set();
    
    function formatTime(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    function renderMessage(msg) {
      const isUser = msg.type === 'user';
      const badges = [];
      if (msg.isAudio) badges.push('<span class="message-badge badge-audio">🎤 Audio</span>');
      if (msg.originalLang) badges.push('<span class="message-badge badge-lang">' + msg.originalLang + '</span>');
      return '<div class="message ' + (isUser ? 'user' : 'bot') + '" data-id="' + escapeHtml(msg.id) + '"><div class="message-bubble">' + 
        escapeHtml(msg.text) + 
        '<div class="message-meta">' + formatTime(msg.timestamp) + (badges.length ? ' ' + badges.join(' ') : '') + '</div>' +
        '</div></div>';
    }
    function renderMessages(messages) {
      const container = document.getElementById('messages');
      if (!messages || messages.length === 0) {
        if (container.querySelector('.empty-state')) return; // Already showing empty state
        container.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><h2>No messages yet</h2><p>Start chatting with the bot in Saved Messages to see your conversation here.</p></div>';
        return;
      }
      
      // Remove empty state if messages exist
      const emptyState = container.querySelector('.empty-state');
      if (emptyState) emptyState.remove();
      
      // Only update if message count changed or new messages detected
      if (messages.length !== lastMessageCount) {
        // Check for new messages
        const newMessages = messages.filter(function(msg) { return !renderedMessageIds.has(msg.id); });
        
        if (newMessages.length > 0) {
          // Append only new messages
          newMessages.forEach(function(msg) {
            container.insertAdjacentHTML('beforeend', renderMessage(msg));
            renderedMessageIds.add(msg.id);
          });
          container.scrollTop = container.scrollHeight;
        } else if (messages.length < lastMessageCount) {
          // Messages were cleared or reduced, re-render all
          container.innerHTML = messages.map(renderMessage).join('');
          renderedMessageIds = new Set(messages.map(function(m) { return m.id; }));
          container.scrollTop = container.scrollHeight;
        }
        
        lastMessageCount = messages.length;
      }
    }
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML.replace(/\\n/g, '<br>');
    }
    function loadMessages() {
      const urlParams = new URLSearchParams(window.location.search);
      const tenantId = urlParams.get('tenantId');
      const url = '/api/messages' + (tenantId ? '?tenantId=' + encodeURIComponent(tenantId) : '');
      fetch(url).then(function(r) { return r.json(); }).then(function(data) {
        renderMessages(data.messages || []);
      }).catch(function(e) {
        console.error('Failed to load messages:', e);
      });
    }
    loadMessages();
    setInterval(loadMessages, 2000); // Refresh every 2 seconds
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(state.mode === 'multi' ? MULTI_HTML : SINGLE_HTML);
    return;
  }
  if (url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getApiStatus()));
    return;
  }
  if (url === '/api/config' && req.method === 'GET') {
    try {
      const config = readConfigFile();
      if (!config) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Config file not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  if (url === '/api/config' && req.method === 'PUT') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!data || typeof data !== 'object') throw new Error('Invalid JSON');
        writeConfigFile(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  if (url === '/admin' || url === '/admin/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getAdminHtml());
    return;
  }
  if (url === '/chat' || url === '/chat/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getChatHtml());
    return;
  }
  if (url.startsWith('/api/messages')) {
    const urlObj = new URL(url, 'http://localhost');
    const tenantId = urlObj.searchParams.get('tenantId');
    const messages = getMessages(tenantId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages }));
    return;
  }
  res.writeHead(404);
  res.end();
});

function start(options = {}) {
  const tenantList = options.tenants || [];
  if (tenantList.length > 0) {
    initTenants(tenantList);
  }
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${PORT}`;
      console.log('BotBandhu UI: open in your browser →', url);
      console.log('Config UI: ' + url + '/admin');
      console.log('Conversation UI: ' + url + '/chat');
      resolve({
        url,
        setStatus,
        setQr,
        addLog,
        setTenantStatus,
        setTenantQr,
        addTenantLog,
        addMessage,
        addTenantMessage,
        openBrowser: () => openBrowser(url),
      });
    });
  });
}

function openBrowser(url) {
  const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  require('child_process').exec(start + ' "' + url + '"', () => {});
}

module.exports = { start, openBrowser, setStatus, setQr, addLog, setTenantStatus, setTenantQr, addTenantLog, initTenants, addMessage, addTenantMessage, getMessages };
module.exports.state = state;
