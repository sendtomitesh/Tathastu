/**
 * Tests for the natural date parser.
 * Run: node src/openai/tests/test-date-parser.js
 */
const { parseDates, extractDatesAndClean } = require('../date-parser');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const now = new Date();
const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
const pad = n => String(n).padStart(2, '0');

console.log('\nDate Parser — Relative Dates:');

test('"today" returns today', () => {
  const r = parseDates('show sales today');
  assert(r, 'should not be null');
  assert(r.date_from === `${y}${pad(m)}${pad(d)}`, `from: ${r.date_from}`);
  assert(r.date_to === r.date_from, 'from === to');
});

test('"yesterday" returns yesterday', () => {
  const r = parseDates('vouchers yesterday');
  assert(r, 'should not be null');
  const yd = new Date(y, m - 1, d - 1);
  const expected = `${yd.getFullYear()}${pad(yd.getMonth() + 1)}${pad(yd.getDate())}`;
  assert(r.date_from === expected, `from: ${r.date_from} expected: ${expected}`);
});

test('"this week" returns Mon-today', () => {
  const r = parseDates('sales this week');
  assert(r, 'should not be null');
  assert(r.date_to === `${y}${pad(m)}${pad(d)}`, `to: ${r.date_to}`);
});

test('"last week" returns previous Mon-Sun', () => {
  const r = parseDates('vouchers last week');
  assert(r, 'should not be null');
  assert(r.date_from && r.date_to, 'should have both dates');
  assert(r.date_from < r.date_to, 'from < to');
});

test('"this month" returns 1st-today', () => {
  const r = parseDates('expenses this month');
  assert(r, 'should not be null');
  assert(r.date_from === `${y}${pad(m)}01`, `from: ${r.date_from}`);
  assert(r.date_to === `${y}${pad(m)}${pad(d)}`, `to: ${r.date_to}`);
});

test('"last month" returns full previous month', () => {
  const r = parseDates('sales last month');
  assert(r, 'should not be null');
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  assert(r.date_from === `${py}${pad(pm)}01`, `from: ${r.date_from}`);
});

test('"last 7 days" returns 7 days ago to today', () => {
  const r = parseDates('vouchers last 7 days');
  assert(r, 'should not be null');
  assert(r.date_to === `${y}${pad(m)}${pad(d)}`, `to: ${r.date_to}`);
});

test('"last 30 days" works', () => {
  const r = parseDates('sales last 30 days');
  assert(r, 'should not be null');
});

console.log('\nDate Parser — Month Names:');

test('"in January" returns Jan of current year', () => {
  const r = parseDates('sales in january');
  assert(r, 'should not be null');
  assert(r.date_from === `${y}0101`, `from: ${r.date_from}`);
  assert(r.date_to === `${y}0131`, `to: ${r.date_to}`);
});

test('"February 2025" returns Feb 2025', () => {
  const r = parseDates('ledger for february 2025');
  assert(r, 'should not be null');
  assert(r.date_from === '20250201', `from: ${r.date_from}`);
  assert(r.date_to === '20250228', `to: ${r.date_to}`);
});

test('"march" returns March current year', () => {
  const r = parseDates('expenses for march');
  assert(r, 'should not be null');
  assert(r.date_from.endsWith('0301'), `from: ${r.date_from}`);
});

console.log('\nDate Parser — Date Ranges:');

test('"from 1st to 15th" returns day range', () => {
  const r = parseDates('vouchers from 1st to 15th');
  assert(r, 'should not be null');
  assert(r.date_from === `${y}${pad(m)}01`, `from: ${r.date_from}`);
  assert(r.date_to === `${y}${pad(m)}15`, `to: ${r.date_to}`);
});

test('"from 5 to 20" works', () => {
  const r = parseDates('sales from 5 to 20');
  assert(r, 'should not be null');
  assert(r.date_from.endsWith('05'), `from: ${r.date_from}`);
  assert(r.date_to.endsWith('20'), `to: ${r.date_to}`);
});

console.log('\nDate Parser — Hindi:');

test('"pichle hafte" = last week', () => {
  const r = parseDates('sales pichle hafte');
  assert(r, 'should not be null');
});

test('"is mahine" = this month', () => {
  const r = parseDates('kharcha is mahine');
  assert(r, 'should not be null');
  assert(r.date_from === `${y}${pad(m)}01`, `from: ${r.date_from}`);
});

test('"pichle 10 din" = last 10 days', () => {
  const r = parseDates('vouchers pichle 10 din');
  assert(r, 'should not be null');
});

console.log('\nDate Parser — No dates:');

test('"show sales" returns null (no dates)', () => {
  const r = parseDates('show sales');
  assert(r === null, 'should be null');
});

test('"ledger for meril" returns null', () => {
  const r = parseDates('ledger for meril');
  assert(r === null, 'should be null');
});

console.log('\nextractDatesAndClean:');

test('extracts dates and cleans text', () => {
  const r = extractDatesAndClean('ledger for meril last month');
  assert(r.dates, 'should have dates');
  assert(r.cleanText.includes('ledger'), 'should keep ledger');
  assert(r.cleanText.includes('meril'), 'should keep meril');
});

// Summary
console.log(`\n${'═'.repeat(40)}`);
console.log(`Date parser tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
