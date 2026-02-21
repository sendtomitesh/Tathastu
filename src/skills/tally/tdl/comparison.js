/**
 * Comparison report helpers — compare two periods of sales, P&L, expenses, etc.
 * Used by the compare_periods action.
 */
const { inr } = require('./formatters');

/**
 * Compare two sets of numeric data and compute deltas.
 * @param {object} current - { label, total, entries?, ... }
 * @param {object} previous - { label, total, entries?, ... }
 * @param {string} metricName - e.g. 'Sales', 'Profit', 'Expenses'
 * @returns {object} { message, data }
 */
function buildComparisonMessage(current, previous, metricName, currentLabel, previousLabel) {
  const curTotal = current.total || 0;
  const prevTotal = previous.total || 0;
  const delta = curTotal - prevTotal;
  const pctChange = prevTotal !== 0 ? ((delta / Math.abs(prevTotal)) * 100) : (curTotal > 0 ? 100 : 0);
  const arrow = delta > 0 ? '📈' : delta < 0 ? '📉' : '➡️';
  const sign = delta >= 0 ? '+' : '';
  const changeStr = `${sign}₹${inr(delta)} (${sign}${pctChange.toFixed(1)}%)`;

  const lines = [
    `${arrow} *${metricName} Comparison*`,
    '',
    `📅 *${currentLabel}:* ₹${inr(curTotal)}`,
    `📅 *${previousLabel}:* ₹${inr(prevTotal)}`,
    `📊 *Change:* ${changeStr}`,
  ];

  // If both have entries (party-wise or head-wise), show top movers
  if (current.entries && previous.entries && current.entries.length > 0) {
    const curMap = {};
    const prevMap = {};
    for (const e of current.entries) {
      const key = e.party || e.name || e.group || 'Unknown';
      curMap[key] = (curMap[key] || 0) + Math.abs(e.amount || e.total || e.closingBalance || 0);
    }
    for (const e of previous.entries) {
      const key = e.party || e.name || e.group || 'Unknown';
      prevMap[key] = (prevMap[key] || 0) + Math.abs(e.amount || e.total || e.closingBalance || 0);
    }
    // Compute deltas per entity
    const allKeys = new Set([...Object.keys(curMap), ...Object.keys(prevMap)]);
    const movers = [];
    for (const key of allKeys) {
      const cur = curMap[key] || 0;
      const prev = prevMap[key] || 0;
      const d = cur - prev;
      if (d !== 0) movers.push({ name: key, cur, prev, delta: d });
    }
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    if (movers.length > 0) {
      lines.push('', '*Top changes:*');
      const top5 = movers.slice(0, 5);
      for (const m of top5) {
        const s = m.delta >= 0 ? '+' : '';
        const emoji = m.delta > 0 ? '🟢' : '🔴';
        lines.push(`${emoji} ${m.name}: ₹${inr(m.prev)} → ₹${inr(m.cur)} (${s}₹${inr(m.delta)})`);
      }
    }
  }

  return {
    message: lines.join('\n'),
    data: {
      current: { label: currentLabel, total: curTotal },
      previous: { label: previousLabel, total: prevTotal },
      delta, pctChange,
    },
  };
}

/**
 * Get date ranges for common comparison periods.
 * @param {string} period - 'month', 'quarter', 'year', 'week'
 * @returns {{ current: {from, to, label}, previous: {from, to, label} }}
 */
function getComparisonDates(period) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  const d = now.getDate();

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (yr, mo, dy) => `${yr}${pad(mo)}${pad(dy)}`;

  if (period === 'week') {
    // Current week (Mon-today) vs previous week
    const dayOfWeek = now.getDay() || 7; // Mon=1, Sun=7
    const monThis = new Date(y, m, d - dayOfWeek + 1);
    const monPrev = new Date(monThis); monPrev.setDate(monPrev.getDate() - 7);
    const sunPrev = new Date(monPrev); sunPrev.setDate(sunPrev.getDate() + 6);
    return {
      current: { from: fmt(monThis.getFullYear(), monThis.getMonth() + 1, monThis.getDate()), to: fmt(y, m + 1, d), label: 'This week' },
      previous: { from: fmt(monPrev.getFullYear(), monPrev.getMonth() + 1, monPrev.getDate()), to: fmt(sunPrev.getFullYear(), sunPrev.getMonth() + 1, sunPrev.getDate()), label: 'Last week' },
    };
  }

  if (period === 'month' || !period) {
    // Current month vs previous month
    const curFrom = fmt(y, m + 1, 1);
    const curTo = fmt(y, m + 1, d);
    const prevMonth = m === 0 ? 12 : m;
    const prevYear = m === 0 ? y - 1 : y;
    const lastDay = new Date(prevYear, prevMonth, 0).getDate();
    const prevFrom = fmt(prevYear, prevMonth, 1);
    const prevTo = fmt(prevYear, prevMonth, lastDay);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      current: { from: curFrom, to: curTo, label: monthNames[m] + ' ' + y },
      previous: { from: prevFrom, to: prevTo, label: monthNames[prevMonth - 1] + ' ' + prevYear },
    };
  }

  if (period === 'quarter') {
    const curQ = Math.floor(m / 3);
    const curQStart = new Date(y, curQ * 3, 1);
    const prevQStart = new Date(y, (curQ - 1) * 3, 1);
    const prevQEnd = new Date(curQStart); prevQEnd.setDate(prevQEnd.getDate() - 1);
    if (curQ === 0) { prevQStart.setFullYear(y - 1); prevQStart.setMonth(9); }
    return {
      current: { from: fmt(curQStart.getFullYear(), curQStart.getMonth() + 1, 1), to: fmt(y, m + 1, d), label: 'Q' + (curQ + 1) + ' ' + y },
      previous: { from: fmt(prevQStart.getFullYear(), prevQStart.getMonth() + 1, 1), to: fmt(prevQEnd.getFullYear(), prevQEnd.getMonth() + 1, prevQEnd.getDate()), label: 'Q' + (curQ === 0 ? 4 : curQ) + ' ' + (curQ === 0 ? y - 1 : y) },
    };
  }

  if (period === 'year') {
    // Indian FY: Apr-Mar. Current FY vs previous FY.
    const fyStartMonth = 4; // April
    const curFYStart = m >= 3 ? y : y - 1; // FY starts in April
    const prevFYStart = curFYStart - 1;
    return {
      current: { from: fmt(curFYStart, fyStartMonth, 1), to: fmt(y, m + 1, d), label: 'FY ' + curFYStart + '-' + String(curFYStart + 1).slice(2) },
      previous: { from: fmt(prevFYStart, fyStartMonth, 1), to: fmt(prevFYStart + 1, 3, 31), label: 'FY ' + prevFYStart + '-' + String(prevFYStart + 1).slice(2) },
    };
  }

  // Default: month
  return getComparisonDates('month');
}

module.exports = { buildComparisonMessage, getComparisonDates };
