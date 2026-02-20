const statusEl = document.getElementById('status');
const qrcodeEl = document.getElementById('qrcode');
const logEl = document.getElementById('log');
const logBar = document.querySelector('.log-bar');
const logToggle = document.getElementById('log-toggle');

// Navigation
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const viewId = link.dataset.view;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + viewId);
    if (target) target.classList.add('active');
  });
});

// Log toggle
if (logToggle) {
  logToggle.addEventListener('click', () => {
    logBar.classList.toggle('collapsed');
  });
}

function setStatus(kind, text) {
  const dot = statusEl.querySelector('.status-dot');
  const textEl = statusEl.querySelector('.status-text');
  textEl.textContent = text;
  statusEl.className = 'status-badge ' + (kind === 'ready' ? 'ready' : kind === 'error' ? 'error' : '');

  // When connected, replace QR with connected state
  if (kind === 'ready') {
    qrcodeEl.innerHTML = `
      <div class="connected-info">
        <div class="connected-icon">✅</div>
        <h3>Connected</h3>
        <p>${text}</p>
      </div>
    `;
  }
}

function setQr(dataUrl) {
  if (!dataUrl) {
    qrcodeEl.innerHTML = `
      <div class="qr-placeholder">
        <div class="qr-spinner"></div>
        <p>Waiting for QR code…</p>
      </div>
    `;
    return;
  }
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Scan with WhatsApp';
  qrcodeEl.innerHTML = '';
  qrcodeEl.appendChild(img);
}

function addLog(text) {
  const div = document.createElement('div');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  div.textContent = time + '  ' + text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  // Keep log manageable
  while (logEl.children.length > 200) {
    logEl.removeChild(logEl.firstChild);
  }
}

if (window.mpbot) {
  window.mpbot.onQr(setQr);
  window.mpbot.onStatus(setStatus);
  window.mpbot.onLog(addLog);
} else {
  setStatus('error', 'Preload not available');
}
