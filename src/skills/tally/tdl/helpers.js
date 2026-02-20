const axios = require('axios');

function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(str) {
  if (!str) return str || '';
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function toTallyDate(d) {
  if (!d) return null;
  const s = String(d).replace(/-/g, '');
  if (/^\d{8}$/.test(s)) return s;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return '' + y + m + day;
}

function toTallyFilterDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd || '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const y = yyyymmdd.slice(0, 4);
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return `${d}-${months[m - 1]}-${y}`;
}

function formatTallyDate(d) {
  if (!d || d.length < 8) return d || '';
  return d.slice(6, 8) + '-' + d.slice(4, 6) + '-' + d.slice(0, 4);
}

const MIN_REQUEST_GAP_MS = 1500;
let lastTallyRequestAt = 0;

async function postTally(baseUrl, xml) {
  const now = Date.now();
  const elapsed = now - lastTallyRequestAt;
  if (elapsed < MIN_REQUEST_GAP_MS && lastTallyRequestAt > 0) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - elapsed));
  }
  lastTallyRequestAt = Date.now();
  const { data } = await axios.post(baseUrl, xml, {
    headers: { 'Content-Type': 'text/xml' },
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return typeof data === 'string' ? data : String(data);
}

/**
 * Split a YYYYMMDD date range into weekly chunks to avoid Tally memory violations.
 * Each chunk is { from: 'YYYYMMDD', to: 'YYYYMMDD' }.
 * @param {string} fromDate - YYYYMMDD
 * @param {string} toDate - YYYYMMDD
 * @param {number} [chunkDays=7] - Days per chunk
 * @returns {Array<{from: string, to: string}>}
 */
function splitDateRange(fromDate, toDate, chunkDays = 7) {
  if (!fromDate || !toDate) return [{ from: fromDate, to: toDate }];
  const parseD = (s) => new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8));
  const fmtD = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const start = parseD(fromDate);
  const end = parseD(toDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return [{ from: fromDate, to: toDate }];
  }
  const chunks = [];
  let cur = new Date(start);
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push({ from: fmtD(cur), to: fmtD(chunkEnd) });
    cur = new Date(chunkEnd);
    cur.setDate(cur.getDate() + 1);
  }
  return chunks;
}

module.exports = { escapeXml, decodeXml, toTallyDate, toTallyFilterDate, formatTallyDate, postTally, splitDateRange };
