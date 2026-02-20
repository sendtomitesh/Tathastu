/**
 * WhatsApp-friendly formatting helpers.
 * WhatsApp supports: *bold*, _italic_, ~strike~, ```monospace```
 */

const SEP = '━━━━━━━━━━━━━━━';

const PAGE_SIZE = 20;

/** Format number as Indian currency string */
function inr(n) {
  return Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Emoji for voucher type */
function vchEmoji(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('sales')) return '🟢';
  if (t.includes('purchase')) return '🟠';
  if (t.includes('receipt')) return '🔵';
  if (t.includes('payment')) return '🔴';
  if (t.includes('journal')) return '📝';
  if (t.includes('contra')) return '🔄';
  return '⚪';
}

module.exports = { SEP, PAGE_SIZE, inr, vchEmoji };
