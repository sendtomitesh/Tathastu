const statusEl = document.getElementById('status');
const qrcodeEl = document.getElementById('qrcode');
const logEl = document.getElementById('log');

function setStatus(kind, text) {
  statusEl.textContent = text;
  statusEl.className = 'status ' + (kind === 'ready' ? 'ready' : kind === 'error' ? 'error' : '');
}

function setQr(dataUrl) {
  if (!dataUrl) {
    qrcodeEl.innerHTML = '';
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
  div.textContent = new Date().toLocaleTimeString() + ' ' + text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

if (window.mpbot) {
  window.mpbot.onQr(setQr);
  window.mpbot.onStatus(setStatus);
  window.mpbot.onLog(addLog);
} else {
  setStatus('error', 'Preload not available');
}
