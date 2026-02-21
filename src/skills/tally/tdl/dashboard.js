/**
 * Dashboard summary — "How's business?" gives a rich single-message overview.
 * Also includes expense anomaly detection and cash flow forecast.
 */
const { inr } = require('./formatters');

/**
 * Build a rich dashboard message from multiple data sources.
 * @param {object} data - { sales, purchase, cashBank, receivable, payable, topCustomers, topItems, expenses }
 * @returns {string} Formatted WhatsApp message
 */
function buildDashboardMessage(data) {
  const lines = ['📊 *Business Dashboard*', ''];

  // Today's sales & purchase
  if (data.todaySales != null || data.todayPurchase != null) {
    lines.push('*Today:*');
    if (data.todaySales != null) lines.push(`  💰 Sales: ₹${inr(data.todaySales)}`);
    if (data.todayPurchase != null) lines.push(`  🛒 Purchase: ₹${inr(data.todayPurchase)}`);
    lines.push('');
  }

  // MTD vs last month
  if (data.mtdSales != null) {
    lines.push('*Month-to-Date:*');
    lines.push(`  💰 Sales: ₹${inr(data.mtdSales)}`);
    if (data.lastMonthSales != null && data.lastMonthSales > 0) {
      const pct = ((data.mtdSales / data.lastMonthSales) * 100).toFixed(0);
      const arrow = data.mtdSales >= data.lastMonthSales ? '📈' : '📉';
      lines.push(`  ${arrow} vs Last Month: ${pct}% of ₹${inr(data.lastMonthSales)}`);
    }
    lines.push('');
  }

  // Cash position
  if (data.cashBank) {
    lines.push('*Cash Position:*');
    lines.push(`  🏦 Cash: ₹${inr(data.cashBank.cashBalance || 0)}  |  Bank: ₹${inr(data.cashBank.bankBalance || 0)}`);
    lines.push('');
  }

  // Outstanding
  if (data.receivableTotal != null || data.payableTotal != null) {
    lines.push('*Outstanding:*');
    if (data.receivableTotal != null) lines.push(`  📥 Receivable: ₹${inr(data.receivableTotal)}`);
    if (data.payableTotal != null) lines.push(`  📤 Payable: ₹${inr(data.payableTotal)}`);
    const net = (data.receivableTotal || 0) - (data.payableTotal || 0);
    lines.push(`  ${net >= 0 ? '✅' : '⚠️'} Net: ₹${inr(net)}`);
    lines.push('');
  }

  // Top 3 overdue parties
  if (data.topOverdue && data.topOverdue.length > 0) {
    lines.push('*Top Overdue:*');
    data.topOverdue.slice(0, 3).forEach((p, i) => {
      lines.push(`  ${i + 1}. ${p.name} — ₹${inr(p.totalDue)} (${p.maxDaysOverdue}d)`);
    });
    lines.push('');
  }

  // Top selling item
  if (data.topItem) {
    lines.push(`🏆 *Top Item:* ${data.topItem.name} — ₹${inr(data.topItem.value)}`);
    lines.push('');
  }

  lines.push('_Say "compare sales vs last month" or "excel" for details_');
  return lines.join('\n');
}

/**
 * Detect expense anomalies by comparing current month vs 3-month average.
 * @param {Array} currentExpenses - [{ name, amount }] current month
 * @param {Array} avgExpenses - [{ name, amount }] 3-month average
 * @param {number} threshold - % increase to flag (default 50)
 * @returns {{ anomalies: Array, message: string }}
 */
function detectExpenseAnomalies(currentExpenses, avgExpenses, threshold = 50) {
  const avgMap = {};
  for (const e of avgExpenses) {
    avgMap[e.name] = e.amount;
  }

  const anomalies = [];
  for (const e of currentExpenses) {
    const avg = avgMap[e.name] || 0;
    if (avg === 0 && e.amount > 0) {
      anomalies.push({ name: e.name, current: e.amount, average: 0, pctChange: 100, isNew: true });
    } else if (avg > 0) {
      const pct = ((e.amount - avg) / avg) * 100;
      if (pct >= threshold) {
        anomalies.push({ name: e.name, current: e.amount, average: avg, pctChange: pct, isNew: false });
      }
    }
  }

  anomalies.sort((a, b) => b.pctChange - a.pctChange);

  if (anomalies.length === 0) {
    return { anomalies: [], message: '✅ *No unusual expenses this month.* All expense heads are within normal range.' };
  }

  const lines = [`⚠️ *Expense Anomalies Detected* (${anomalies.length})`, ''];
  for (const a of anomalies.slice(0, 10)) {
    const emoji = a.isNew ? '🆕' : '🔴';
    if (a.isNew) {
      lines.push(`${emoji} *${a.name}*: ₹${inr(a.current)} (new expense — no history)`);
    } else {
      lines.push(`${emoji} *${a.name}*: ₹${inr(a.current)} vs avg ₹${inr(a.average)} (+${a.pctChange.toFixed(0)}%)`);
    }
  }
  lines.push('', '_Compared against 3-month average_');

  return { anomalies, message: lines.join('\n') };
}

/**
 * Simple cash flow forecast based on current balances and trends.
 * @param {object} data - { cashBalance, bankBalance, avgDailySales, avgDailyExpenses, receivableTotal, payableTotal, ageingBuckets }
 * @returns {{ forecasts: Array, message: string }}
 */
function buildCashFlowForecast(data) {
  const currentCash = (data.cashBalance || 0) + (data.bankBalance || 0);
  const dailyNet = (data.avgDailySales || 0) - (data.avgDailyExpenses || 0);

  // Expected collections from receivable (rough: 30% in 7d, 50% in 15d, 70% in 30d)
  const recv = data.receivableTotal || 0;
  const pay = data.payableTotal || 0;

  const forecasts = [7, 15, 30].map(days => {
    const collectionRate = days <= 7 ? 0.3 : days <= 15 ? 0.5 : 0.7;
    const paymentRate = days <= 7 ? 0.2 : days <= 15 ? 0.4 : 0.6;
    const expectedCollections = recv * collectionRate;
    const expectedPayments = pay * paymentRate;
    const projected = currentCash + (dailyNet * days) + expectedCollections - expectedPayments;
    return { days, projected, collections: expectedCollections, payments: expectedPayments };
  });

  const lines = ['💰 *Cash Flow Forecast*', ''];
  lines.push(`Current Cash + Bank: ₹${inr(currentCash)}`);
  lines.push(`Avg Daily Net: ₹${inr(dailyNet)}/day`);
  lines.push('');

  for (const f of forecasts) {
    const emoji = f.projected >= 0 ? '✅' : '🔴';
    lines.push(`${emoji} *${f.days} days:* ₹${inr(f.projected)}`);
    lines.push(`   +₹${inr(f.collections)} collections, -₹${inr(f.payments)} payments`);
  }

  lines.push('', '_Estimates based on current trends and outstanding. Actual may vary._');

  return { forecasts, message: lines.join('\n') };
}

module.exports = { buildDashboardMessage, detectExpenseAnomalies, buildCashFlowForecast };
