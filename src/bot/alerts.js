/**
 * Alert manager — lets users set threshold-based alerts that are checked periodically.
 * Alerts are stored in memory (reset on restart). Persistent storage can be added later.
 *
 * Supported alert types:
 *   - cash_below: "alert me when cash drops below 50K"
 *   - receivable_above: "alert when receivable goes above 10L"
 *   - payable_above: "alert when payable goes above 5L"
 *
 * Usage:
 *   const alertMgr = createAlertManager({ registry, config, client, onLog });
 *   alertMgr.start(); // begins periodic checks
 *   alertMgr.addAlert({ type: 'cash_below', threshold: 50000 });
 *   alertMgr.listAlerts();
 *   alertMgr.removeAlert(id);
 *   alertMgr.stop();
 */
const { sendToSelf } = require('../whatsapp/client');

const ALERT_TYPES = {
  cash_below: { label: 'Cash balance below', metric: 'cash', direction: 'below' },
  bank_below: { label: 'Bank balance below', metric: 'bank', direction: 'below' },
  receivable_above: { label: 'Total receivable above', metric: 'receivable', direction: 'above' },
  payable_above: { label: 'Total payable above', metric: 'payable', direction: 'above' },
};

function createAlertManager({ registry, config, client, onLog }) {
  const log = onLog || (() => {});
  const alerts = []; // { id, type, threshold, createdAt, lastTriggered }
  let nextId = 1;
  let intervalHandle = null;
  const CHECK_INTERVAL_MS = 10 * 60 * 1000; // check every 10 minutes

  function addAlert({ type, threshold }) {
    if (!ALERT_TYPES[type]) {
      return { success: false, message: `Unknown alert type "${type}". Supported: ${Object.keys(ALERT_TYPES).join(', ')}` };
    }
    const t = parseFloat(threshold);
    if (isNaN(t) || t <= 0) {
      return { success: false, message: 'Threshold must be a positive number.' };
    }
    const alert = { id: nextId++, type, threshold: t, createdAt: new Date(), lastTriggered: null };
    alerts.push(alert);
    log(`[alerts] Added: ${ALERT_TYPES[type].label} ₹${t.toLocaleString('en-IN')}`);
    return { success: true, message: `✅ Alert set: ${ALERT_TYPES[type].label} ₹${t.toLocaleString('en-IN')}`, data: alert };
  }

  function listAlerts() {
    if (alerts.length === 0) {
      return { success: true, message: '📭 No alerts set. Try: "alert me when cash drops below 50000"', data: [] };
    }
    const lines = ['🔔 *Your Alerts:*', ''];
    for (const a of alerts) {
      const info = ALERT_TYPES[a.type] || { label: a.type };
      const triggered = a.lastTriggered ? ` (last triggered: ${a.lastTriggered.toLocaleString()})` : '';
      lines.push(`${a.id}. ${info.label} ₹${a.threshold.toLocaleString('en-IN')}${triggered}`);
    }
    lines.push('', '_Reply "remove alert 1" to delete an alert._');
    return { success: true, message: lines.join('\n'), data: alerts };
  }

  function removeAlert(id) {
    const idx = alerts.findIndex(a => a.id === parseInt(id, 10));
    if (idx === -1) return { success: false, message: `Alert #${id} not found.` };
    const removed = alerts.splice(idx, 1)[0];
    const info = ALERT_TYPES[removed.type] || { label: removed.type };
    return { success: true, message: `🗑️ Removed alert: ${info.label} ₹${removed.threshold.toLocaleString('en-IN')}` };
  }

  async function checkAlerts() {
    if (alerts.length === 0) return;
    if (!client || !client.info) return; // client not ready

    log('[alerts] Checking ' + alerts.length + ' alert(s)…');
    const skillId = 'tally';

    for (const alert of alerts) {
      try {
        const info = ALERT_TYPES[alert.type];
        if (!info) continue;

        let currentValue = null;
        let label = '';

        if (info.metric === 'cash' || info.metric === 'bank') {
          const result = await registry.execute(skillId, 'get_cash_bank_balance', {});
          if (!result.success || !result.data) continue;
          if (info.metric === 'cash') {
            currentValue = result.data.cashBalance || 0;
            label = 'Cash balance';
          } else {
            currentValue = result.data.bankBalance || 0;
            label = 'Bank balance';
          }
        } else if (info.metric === 'receivable') {
          const result = await registry.execute(skillId, 'get_outstanding', { type: 'receivable' });
          if (!result.success || !result.data) continue;
          currentValue = result.data.total || 0;
          label = 'Total receivable';
        } else if (info.metric === 'payable') {
          const result = await registry.execute(skillId, 'get_outstanding', { type: 'payable' });
          if (!result.success || !result.data) continue;
          currentValue = result.data.total || 0;
          label = 'Total payable';
        }

        if (currentValue === null) continue;

        let triggered = false;
        if (info.direction === 'below' && currentValue < alert.threshold) triggered = true;
        if (info.direction === 'above' && currentValue > alert.threshold) triggered = true;

        if (triggered) {
          // Don't spam — only trigger once per hour
          const now = new Date();
          if (alert.lastTriggered && (now - alert.lastTriggered) < 60 * 60 * 1000) continue;
          alert.lastTriggered = now;

          const emoji = info.direction === 'below' ? '🔴' : '🟡';
          const msg = `${emoji} *Alert Triggered*\n\n${label}: ₹${Math.abs(currentValue).toLocaleString('en-IN')}\nThreshold: ${info.direction} ₹${alert.threshold.toLocaleString('en-IN')}\n\n_Check your Tally data for details._`;
          await sendToSelf(client, '*Tathastu:*\n' + msg);
          log('[alerts] TRIGGERED: ' + info.label + ' — current: ₹' + currentValue.toLocaleString('en-IN'));
        }
      } catch (err) {
        log('[alerts] Check error for alert #' + alert.id + ': ' + (err.message || err));
      }
    }
  }

  function start() {
    if (intervalHandle) return;
    intervalHandle = setInterval(() => checkAlerts().catch(e => log('[alerts] Error: ' + e.message)), CHECK_INTERVAL_MS);
    log('[alerts] Started — checking every ' + (CHECK_INTERVAL_MS / 60000) + ' min');
  }

  function stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
      log('[alerts] Stopped');
    }
  }

  return { addAlert, listAlerts, removeAlert, checkAlerts, start, stop, getAlerts: () => alerts };
}

module.exports = { createAlertManager, ALERT_TYPES };
