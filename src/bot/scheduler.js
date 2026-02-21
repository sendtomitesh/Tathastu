/**
 * Daily/Weekly auto-summary scheduler.
 * Sends a morning WhatsApp message with yesterday's business summary.
 *
 * Config (in config/skills.json):
 *   "scheduler": {
 *     "enabled": true,
 *     "summaryTime": "08:00",   // 24h format, when to send
 *     "summaryDays": [1,2,3,4,5,6]  // 0=Sun, 1=Mon, ... 6=Sat
 *   }
 */
const { sendToSelf } = require('../whatsapp/client');

function createScheduler({ registry, config, client, onLog }) {
  const log = onLog || (() => {});
  let intervalHandle = null;
  let lastSentDate = null; // track to avoid duplicate sends

  const schedConfig = config.scheduler || {};
  const summaryTime = schedConfig.summaryTime || '08:00';
  const summaryDays = schedConfig.summaryDays || [1, 2, 3, 4, 5, 6]; // Mon-Sat default
  const [targetHour, targetMin] = summaryTime.split(':').map(Number);

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatDate(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  async function buildDailySummary() {
    const skillId = 'tally';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = formatDate(yesterday);
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][yesterday.getDay()];
    const dateLabel = `${pad(yesterday.getDate())}/${pad(yesterday.getMonth() + 1)}/${yesterday.getFullYear()} (${dayName})`;

    const lines = ['📊 *Daily Summary — ' + dateLabel + '*', ''];

    // 1. Daybook summary (yesterday's entries)
    try {
      const daybook = await registry.execute(skillId, 'get_daybook', { date_from: yStr, date_to: yStr });
      if (daybook.success && daybook.data) {
        const d = daybook.data;
        lines.push(`📋 *Entries:* ${d.totalCount || d.entries?.length || 0} vouchers`);
        if (d.typeSummary) {
          const types = Object.entries(d.typeSummary).map(([t, v]) => `${t}: ${v.count}`).join(', ');
          lines.push(`   ${types}`);
        }
      }
    } catch (e) { log('[scheduler] Daybook fetch error: ' + e.message); }

    // 2. Sales total
    try {
      const sales = await registry.execute(skillId, 'get_sales_report', { type: 'sales', date_from: yStr, date_to: yStr });
      if (sales.success && sales.data) {
        lines.push(`💰 *Sales:* ₹${(sales.data.total || 0).toLocaleString('en-IN')}`);
      }
    } catch (e) { log('[scheduler] Sales fetch error: ' + e.message); }

    // 3. Purchase total
    try {
      const purchase = await registry.execute(skillId, 'get_sales_report', { type: 'purchase', date_from: yStr, date_to: yStr });
      if (purchase.success && purchase.data) {
        lines.push(`🛒 *Purchase:* ₹${(purchase.data.total || 0).toLocaleString('en-IN')}`);
      }
    } catch (e) { log('[scheduler] Purchase fetch error: ' + e.message); }

    // 4. Cash & Bank balance (current)
    try {
      const cashBank = await registry.execute(skillId, 'get_cash_bank_balance', {});
      if (cashBank.success && cashBank.data) {
        const cb = cashBank.data;
        lines.push(`🏦 *Cash:* ₹${(cb.cashBalance || 0).toLocaleString('en-IN')}  |  *Bank:* ₹${(cb.bankBalance || 0).toLocaleString('en-IN')}`);
      }
    } catch (e) { log('[scheduler] Cash/Bank fetch error: ' + e.message); }

    // 5. Outstanding totals
    try {
      const recv = await registry.execute(skillId, 'get_outstanding', { type: 'receivable' });
      const pay = await registry.execute(skillId, 'get_outstanding', { type: 'payable' });
      const recvTotal = recv.success && recv.data ? (recv.data.total || 0) : 0;
      const payTotal = pay.success && pay.data ? (pay.data.total || 0) : 0;
      lines.push(`📥 *Receivable:* ₹${recvTotal.toLocaleString('en-IN')}  |  📤 *Payable:* ₹${payTotal.toLocaleString('en-IN')}`);
    } catch (e) { log('[scheduler] Outstanding fetch error: ' + e.message); }

    lines.push('', '_Powered by Tathastu_');
    return lines.join('\n');
  }

  async function checkAndSend() {
    const now = new Date();
    const todayStr = formatDate(now);

    // Already sent today?
    if (lastSentDate === todayStr) return;

    // Is it the right day of week?
    if (!summaryDays.includes(now.getDay())) return;

    // Is it past the target time?
    if (now.getHours() < targetHour) return;
    if (now.getHours() === targetHour && now.getMinutes() < targetMin) return;

    // Client ready?
    if (!client || !client.info) return;

    // Send it
    lastSentDate = todayStr;
    log('[scheduler] Sending daily summary…');
    try {
      const summary = await buildDailySummary();
      await sendToSelf(client, '*Tathastu:*\n' + summary);
      log('[scheduler] Daily summary sent');
    } catch (err) {
      log('[scheduler] Send failed: ' + (err.message || err));
      lastSentDate = null; // retry next check
    }
  }

  function start() {
    if (intervalHandle) return;
    // Check every 5 minutes
    intervalHandle = setInterval(() => checkAndSend().catch(e => log('[scheduler] Error: ' + e.message)), 5 * 60 * 1000);
    log(`[scheduler] Started — summary at ${summaryTime} on days [${summaryDays.join(',')}]`);
    // Also check immediately in case we're past the time
    checkAndSend().catch(e => log('[scheduler] Initial check error: ' + e.message));
  }

  function stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
      log('[scheduler] Stopped');
    }
  }

  // Allow manual trigger for testing
  async function sendNow() {
    if (!client || !client.info) return { success: false, message: 'WhatsApp client not ready.' };
    const summary = await buildDailySummary();
    await sendToSelf(client, '*Tathastu:*\n' + summary);
    return { success: true, message: summary };
  }

  return { start, stop, sendNow, checkAndSend };
}

module.exports = { createScheduler };
