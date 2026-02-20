/**
 * Minimal HTTP server that serves the bot UI (QR, status) and admin config UI.
 * Single-tenant: one QR/status. Multi-tenant: one page with a card per employee (each their own QR).
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.MPBOT_UI_PORT || 3750;
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(process.cwd(), 'config', 'skills.json');

// Reset session callback — set by cli.js
let onResetSession = null;
function setResetHandler(handler) {
  onResetSession = handler;
}

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
};

// Multi-tenant state: tenants[id] = { name, status, statusText, qrDataUrl, log }
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tathastu — WhatsApp Bot</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',system-ui,sans-serif;min-height:100vh;background:#06060e;color:#e2e8f0;overflow-x:hidden}
    .bg{position:fixed;inset:0;z-index:0;overflow:hidden}
    .bg .orb{position:absolute;border-radius:50%;filter:blur(80px);opacity:.35;animation:float 12s ease-in-out infinite}
    .bg .orb.o1{width:420px;height:420px;background:radial-gradient(circle,#6366f1,#4f46e5);top:-80px;left:-100px;animation-delay:0s}
    .bg .orb.o2{width:350px;height:350px;background:radial-gradient(circle,#8b5cf6,#7c3aed);bottom:-60px;right:-80px;animation-delay:-4s}
    .bg .orb.o3{width:250px;height:250px;background:radial-gradient(circle,#06b6d4,#0891b2);top:40%;left:60%;animation-delay:-8s}
    @keyframes float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-30px) scale(1.05)}}
    .bg .grid-overlay{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);background-size:60px 60px}
    .page{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px 60px}
    .nav-bar{width:100%;max-width:800px;display:flex;align-items:center;justify-content:space-between;margin-bottom:48px}
    .logo{display:flex;align-items:center;gap:12px;text-decoration:none}
    .logo svg{width:36px;height:36px}
    .logo span{font-size:1.35rem;font-weight:700;background:linear-gradient(135deg,#c7d2fe,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .nav-links{display:flex;gap:8px}
    .nav-links a,.nav-links button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#94a3b8;padding:8px 16px;border-radius:10px;font-size:.82rem;text-decoration:none;cursor:pointer;transition:all .2s;font-family:inherit}
    .nav-links a:hover,.nav-links button:hover{background:rgba(255,255,255,.1);color:#e2e8f0}
    .nav-links button.danger{color:#f87171;border-color:rgba(248,113,113,.2)}
    .nav-links button.danger:hover{background:rgba(248,113,113,.1)}
    .hero{text-align:center;margin-bottom:40px}
    .hero h1{font-size:2.2rem;font-weight:700;line-height:1.2;margin-bottom:12px;background:linear-gradient(135deg,#f1f5f9 0%,#94a3b8 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .hero p{color:#64748b;font-size:1rem;max-width:420px;margin:0 auto;line-height:1.6}
    .status-pill{display:inline-flex;align-items:center;gap:8px;padding:8px 20px;border-radius:50px;font-size:.85rem;font-weight:500;margin-bottom:32px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);backdrop-filter:blur(10px);transition:all .4s}
    .status-pill .dot{width:8px;height:8px;border-radius:50%;background:#64748b;transition:background .4s}
    .status-pill.ready{border-color:rgba(74,222,128,.25);background:rgba(74,222,128,.06)}
    .status-pill.ready .dot{background:#4ade80;box-shadow:0 0 8px rgba(74,222,128,.5)}
    .status-pill.error{border-color:rgba(248,113,113,.25);background:rgba(248,113,113,.06)}
    .status-pill.error .dot{background:#f87171;box-shadow:0 0 8px rgba(248,113,113,.5)}
    .status-pill.qr{border-color:rgba(129,140,248,.25);background:rgba(129,140,248,.06)}
    .status-pill.qr .dot{background:#818cf8;box-shadow:0 0 8px rgba(129,140,248,.5);animation:pulse 1.5s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .main-card{background:rgba(255,255,255,.04);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:40px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)}
    .qr-area{min-height:280px;display:flex;align-items:center;justify-content:center;margin-bottom:24px;position:relative}
    .qr-area img{max-width:280px;width:100%;background:#fff;padding:16px;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.2)}
    .qr-placeholder{display:flex;flex-direction:column;align-items:center;gap:16px;color:#475569}
    .qr-placeholder .spinner{width:48px;height:48px;border:3px solid rgba(129,140,248,.15);border-top-color:#818cf8;border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .qr-placeholder span{font-size:.9rem}
    .connected-badge{display:flex;flex-direction:column;align-items:center;gap:12px;color:#4ade80}
    .connected-badge svg{width:56px;height:56px;animation:scaleIn .4s ease}
    @keyframes scaleIn{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
    .connected-badge span{font-size:1rem;font-weight:600}
    .steps{display:flex;flex-direction:column;gap:12px}
    .step{display:flex;align-items:flex-start;gap:14px;padding:12px 16px;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);transition:all .2s}
    .step:hover{background:rgba(255,255,255,.06)}
    .step-num{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;color:#fff;flex-shrink:0}
    .step-text{font-size:.88rem;color:#94a3b8;line-height:1.5}
    .step-text strong{color:#e2e8f0;font-weight:600}
    .log-section{max-width:440px;width:100%;margin-top:32px}
    .log-toggle{width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:#64748b;padding:10px 16px;border-radius:12px;font-size:.82rem;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:space-between;transition:all .2s}
    .log-toggle:hover{background:rgba(255,255,255,.06);color:#94a3b8}
    .log-toggle .arrow{transition:transform .2s}
    .log-toggle.open .arrow{transform:rotate(180deg)}
    .log-box{max-height:0;overflow:hidden;transition:max-height .3s ease}
    .log-box.open{max-height:400px}
    .log-inner{padding:12px 16px;font-size:.8rem;color:#475569;background:rgba(0,0,0,.2);border-radius:0 0 12px 12px;border:1px solid rgba(255,255,255,.04);border-top:0;max-height:300px;overflow-y:auto;font-family:'SF Mono',Monaco,Consolas,monospace}
    .log-inner div{margin-bottom:4px;line-height:1.5}
    .log-inner .time{color:#6366f1;margin-right:8px}
    .footer{margin-top:48px;text-align:center;color:#334155;font-size:.78rem}
    .footer a{color:#4f46e5;text-decoration:none}
    @media(max-width:480px){.page{padding:24px 16px 40px}.hero h1{font-size:1.6rem}.main-card{padding:28px 20px}.nav-bar{flex-direction:column;gap:16px}.nav-links{flex-wrap:wrap;justify-content:center}}
  </style>
</head>
<body>
  <div class="bg"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div><div class="grid-overlay"></div></div>
  <div class="page">
    <nav class="nav-bar">
      <a href="/" class="logo">
        <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="36" height="36" rx="10" fill="url(#lg)"/>
          <path d="M10 18.5L14.5 23L26 13" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <defs><linearGradient id="lg" x1="0" y1="0" x2="36" y2="36"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
        </svg>
        <span>Tathastu</span>
      </a>
      <div class="nav-links">
        <a href="/admin">⚙️ Admin</a>
        <button class="danger" id="resetBtn" onclick="resetSession()">↻ Reset</button>
      </div>
    </nav>

    <div class="hero">
      <h1>Your Tally on WhatsApp</h1>
      <p>Connect your WhatsApp to access Tally data — vouchers, ledgers, reports and more — right from your chat.</p>
    </div>

    <div id="statusPill" class="status-pill">
      <span class="dot"></span>
      <span id="statusText">Connecting…</span>
    </div>

    <div class="main-card">
      <div id="qrcode" class="qr-area">
        <div class="qr-placeholder">
          <div class="spinner"></div>
          <span>Waiting for QR code…</span>
        </div>
      </div>
      <div class="steps">
        <div class="step"><div class="step-num">1</div><div class="step-text">Open <strong>WhatsApp</strong> on your phone</div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text">Go to <strong>Settings → Linked Devices</strong></div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text">Tap <strong>Link a Device</strong> and scan the QR code above</div></div>
      </div>
    </div>

    <div class="log-section">
      <button class="log-toggle" id="logToggle" onclick="toggleLog()">
        <span>Activity Log</span>
        <span class="arrow">▼</span>
      </button>
      <div class="log-box" id="logBox">
        <div class="log-inner" id="log"></div>
      </div>
    </div>

    <div class="footer">Powered by <a href="#">Tathastu</a> — Tally + WhatsApp</div>
  </div>
  <script>
    function toggleLog(){
      document.getElementById('logToggle').classList.toggle('open');
      document.getElementById('logBox').classList.toggle('open');
    }
    function resetSession(){
      if(!confirm('This will clear the WhatsApp session and show a new QR code. Continue?'))return;
      var btn=document.getElementById('resetBtn');
      btn.disabled=true;btn.textContent='Resetting…';
      document.getElementById('statusText').textContent='Resetting session…';
      fetch('/api/reset-session',{method:'POST'}).then(function(r){return r.json()}).then(function(d){
        btn.disabled=false;btn.textContent='↻ Reset';
        if(d.error)alert('Reset failed: '+d.error);
      }).catch(function(e){btn.disabled=false;btn.textContent='↻ Reset';alert('Reset failed: '+e)});
    }
    function poll(){
      fetch('/api/status').then(function(r){return r.json()}).then(function(d){
        if(d.mode!=='single')return;
        document.getElementById('statusText').textContent=d.statusText;
        var pill=document.getElementById('statusPill');
        pill.className='status-pill'+(d.status==='ready'?' ready':d.status==='error'?' error':d.qrDataUrl?' qr':'');
        var qr=document.getElementById('qrcode');
        if(d.status==='ready'){
          qr.innerHTML='<div class="connected-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>Connected</span></div>';
        }else if(d.qrDataUrl){
          qr.innerHTML='<img src="'+d.qrDataUrl+'" alt="Scan with WhatsApp">';
        }else{
          qr.innerHTML='<div class="qr-placeholder"><div class="spinner"></div><span>Waiting for QR code…</span></div>';
        }
        var logEl=document.getElementById('log');
        if(d.log&&d.log.length){
          logEl.innerHTML=d.log.map(function(e){return '<div><span class="time">'+new Date(e.t).toLocaleTimeString()+'</span>'+e.text+'</div>'}).join('');
          logEl.scrollTop=logEl.scrollHeight;
        }
      }).catch(function(){});
    }
    setInterval(poll,1500);poll();
  </script>
</body>
</html>`;

const MULTI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tathastu — Register WhatsApp</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',system-ui,sans-serif;min-height:100vh;background:#06060e;color:#e2e8f0;overflow-x:hidden}
    .bg{position:fixed;inset:0;z-index:0;overflow:hidden}
    .bg .orb{position:absolute;border-radius:50%;filter:blur(80px);opacity:.35;animation:float 12s ease-in-out infinite}
    .bg .orb.o1{width:420px;height:420px;background:radial-gradient(circle,#6366f1,#4f46e5);top:-80px;left:-100px;animation-delay:0s}
    .bg .orb.o2{width:350px;height:350px;background:radial-gradient(circle,#8b5cf6,#7c3aed);bottom:-60px;right:-80px;animation-delay:-4s}
    .bg .orb.o3{width:250px;height:250px;background:radial-gradient(circle,#06b6d4,#0891b2);top:40%;left:60%;animation-delay:-8s}
    @keyframes float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-30px) scale(1.05)}}
    .bg .grid-overlay{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);background-size:60px 60px}
    .page{position:relative;z-index:1;min-height:100vh;padding:40px 20px 60px}
    .nav-bar{max-width:1100px;margin:0 auto 40px;display:flex;align-items:center;justify-content:space-between}
    .logo{display:flex;align-items:center;gap:12px;text-decoration:none}
    .logo svg{width:36px;height:36px}
    .logo span{font-size:1.35rem;font-weight:700;background:linear-gradient(135deg,#c7d2fe,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .nav-links{display:flex;gap:8px}
    .nav-links a{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#94a3b8;padding:8px 16px;border-radius:10px;font-size:.82rem;text-decoration:none;transition:all .2s}
    .nav-links a:hover{background:rgba(255,255,255,.1);color:#e2e8f0}
    .hero{text-align:center;max-width:600px;margin:0 auto 40px}
    .hero h1{font-size:2rem;font-weight:700;margin-bottom:10px;background:linear-gradient(135deg,#f1f5f9,#94a3b8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .hero p{color:#64748b;font-size:.95rem;line-height:1.6}
    .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:24px;max-width:1100px;margin:0 auto}
    .card{background:rgba(255,255,255,.04);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.25);transition:transform .2s,box-shadow .2s}
    .card:hover{transform:translateY(-2px);box-shadow:0 16px 50px rgba(0,0,0,.35)}
    .card-header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
    .card-avatar{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:#fff}
    .card-name{font-size:1.05rem;font-weight:600;color:#e2e8f0}
    .card-status{font-size:.82rem;padding:4px 12px;border-radius:50px;display:inline-flex;align-items:center;gap:6px;margin-bottom:16px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03)}
    .card-status .dot{width:6px;height:6px;border-radius:50%;background:#64748b}
    .card-status.ready{border-color:rgba(74,222,128,.2);color:#4ade80}
    .card-status.ready .dot{background:#4ade80;box-shadow:0 0 6px rgba(74,222,128,.5)}
    .card-status.error{border-color:rgba(248,113,113,.2);color:#f87171}
    .card-status.error .dot{background:#f87171}
    .card-status.qr{border-color:rgba(129,140,248,.2);color:#818cf8}
    .card-status.qr .dot{background:#818cf8;animation:pulse 1.5s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .card .qr-area{min-height:220px;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
    .card .qr-area img{max-width:220px;width:100%;background:#fff;padding:12px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.2)}
    .card .qr-placeholder{display:flex;flex-direction:column;align-items:center;gap:12px;color:#475569}
    .card .qr-placeholder .spinner{width:40px;height:40px;border:3px solid rgba(129,140,248,.15);border-top-color:#818cf8;border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .card .qr-placeholder span{font-size:.85rem}
    .card .log{font-size:.78rem;color:#475569;max-height:180px;overflow-y:auto;border-top:1px solid rgba(255,255,255,.05);padding-top:10px;margin-top:12px;font-family:'SF Mono',Monaco,Consolas,monospace}
    .card .log div{margin-bottom:3px;line-height:1.4}
    .card .log .time{color:#6366f1;margin-right:6px}
    .footer{margin-top:48px;text-align:center;color:#334155;font-size:.78rem}
    .footer a{color:#4f46e5;text-decoration:none}
    @media(max-width:480px){.page{padding:24px 16px 40px}.hero h1{font-size:1.5rem}.cards{grid-template-columns:1fr}.nav-bar{flex-direction:column;gap:16px}}
  </style>
</head>
<body>
  <div class="bg"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div><div class="grid-overlay"></div></div>
  <div class="page">
    <nav class="nav-bar">
      <a href="/" class="logo">
        <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="36" height="36" rx="10" fill="url(#lg)"/>
          <path d="M10 18.5L14.5 23L26 13" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <defs><linearGradient id="lg" x1="0" y1="0" x2="36" y2="36"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
        </svg>
        <span>Tathastu</span>
      </a>
      <div class="nav-links">
        <a href="/admin">⚙️ Admin</a>
      </div>
    </nav>
    <div class="hero">
      <h1>Register Your WhatsApp</h1>
      <p>Find your name below and scan the QR code with WhatsApp → Settings → Linked Devices → Link a Device</p>
    </div>
    <div id="cards" class="cards"></div>
    <div class="footer">Powered by <a href="#">Tathastu</a> — Tally + WhatsApp</div>
  </div>
  <script>
    function poll(){
      fetch('/api/status').then(function(r){return r.json()}).then(function(d){
        if(d.mode!=='multi'||!d.tenants)return;
        var html='';
        d.tenants.forEach(function(t){
          var initials=t.name.split(' ').map(function(w){return w[0]}).join('').substring(0,2).toUpperCase();
          var statusCls=t.status==='ready'?'ready':t.status==='error'?'error':t.qrDataUrl?'qr':'';
          var qrHtml=t.status==='ready'?'<div style="display:flex;flex-direction:column;align-items:center;gap:10px;color:#4ade80"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span style="font-weight:600">Connected</span></div>':t.qrDataUrl?'<img src="'+t.qrDataUrl+'" alt="Scan QR">':'<div class="qr-placeholder"><div class="spinner"></div><span>Waiting for QR…</span></div>';
          var logHtml=(t.log&&t.log.length)?t.log.map(function(e){return '<div><span class="time">'+new Date(e.t).toLocaleTimeString()+'</span>'+e.text+'</div>'}).join(''):'';
          html+='<div class="card"><div class="card-header"><div class="card-avatar">'+initials+'</div><div class="card-name">'+t.name+'</div></div><div class="card-status '+statusCls+'"><span class="dot"></span>'+t.statusText+'</div><div class="qr-area">'+qrHtml+'</div>'+(logHtml?'<div class="log">'+logHtml+'</div>':'')+'</div>';
        });
        document.getElementById('cards').innerHTML=html;
      }).catch(function(){});
    }
    setInterval(poll,1500);poll();
  </script>
</body>
</html>`;

function getAdminHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tathastu — Admin</title>
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
  if (url === '/api/reset-session' && req.method === 'POST') {
    if (!onResetSession) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Reset handler not registered' }));
      return;
    }
    setStatus('connecting', 'Resetting session…');
    setQr(null);
    onResetSession()
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || String(err) }));
      });
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
      console.log('Tathastu UI: open in your browser →', url);
      console.log('Config UI: ' + url + '/admin');
      resolve({
        url,
        setStatus,
        setQr,
        addLog,
        setTenantStatus,
        setTenantQr,
        addTenantLog,
        setResetHandler,
        openBrowser: () => openBrowser(url),
      });
    });
  });
}

function openBrowser(url) {
  const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  require('child_process').exec(start + ' "' + url + '"', () => {});
}

module.exports = { start, openBrowser, setStatus, setQr, addLog, setTenantStatus, setTenantQr, addTenantLog, initTenants, setResetHandler };
module.exports.state = state;
