const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mpbot', {
  onQr: (cb) => {
    ipcRenderer.on('qr', (_, dataUrl) => cb(dataUrl));
  },
  onStatus: (cb) => {
    ipcRenderer.on('status', (_, kind, text) => cb(kind, text));
  },
  onLog: (cb) => {
    ipcRenderer.on('log', (_, text) => cb(text));
  },
});
