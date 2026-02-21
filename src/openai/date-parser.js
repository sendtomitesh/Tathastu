/**
 * Lightweight natural date parser for Hindi/English date expressions.
 * Extracts date_from and date_to from phrases like:
 *   "last week", "this month", "in January", "from 1st to 15th",
 *   "yesterday", "pichle hafte", "is mahine", "January 2025"
 *
 * Returns { date_from, date_to } in YYYYMMDD format, or null if no dates found.
 */

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(y, m, d) { return `${y}${pad(m)}${pad(d)}`; }

const MONTH_MAP = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const HINDI_MONTH_MAP = {
  // Hindi month names (approximate mappings)
  janvari: 1, farvari: 2, march: 3, april: 4, mai: 5, june: 6,
  july: 7, august: 8, sitambar: 9, september: 9, aktubar: 10, october: 10,
  navambar: 11, november: 11, disambar: 12, december: 12,
};

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Parse natural date expressions from text.
 * @param {string} text - Lowercased user input
 * @returns {{ date_from: string, date_to: string } | null}
 */
function parseDates(text) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-indexed
  const d = now.getDate();

  // "today" / "aaj"
  if (/\b(today|aaj)\b/i.test(text)) {
    const t = fmt(y, m, d);
    return { date_from: t, date_to: t };
  }

  // "yesterday" / "kal" (past context)
  if (/\b(yesterday|kal|parso)\b/i.test(text)) {
    const days = /parso/i.test(text) ? 2 : 1;
    const dt = new Date(y, m - 1, d - days);
    const t = fmt(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    return { date_from: t, date_to: t };
  }

  // "this week" / "is hafte"
  if (/\b(this\s+week|is\s+hafte|current\s+week)\b/i.test(text)) {
    const dow = now.getDay() || 7; // Mon=1
    const mon = new Date(y, m - 1, d - dow + 1);
    return {
      date_from: fmt(mon.getFullYear(), mon.getMonth() + 1, mon.getDate()),
      date_to: fmt(y, m, d),
    };
  }

  // "last week" / "pichle hafte" / "pichhle hafte"
  if (/\b(last\s+week|pich+le\s+hafte|gaya\s+hafta)\b/i.test(text)) {
    const dow = now.getDay() || 7;
    const monThis = new Date(y, m - 1, d - dow + 1);
    const monPrev = new Date(monThis); monPrev.setDate(monPrev.getDate() - 7);
    const sunPrev = new Date(monPrev); sunPrev.setDate(sunPrev.getDate() + 6);
    return {
      date_from: fmt(monPrev.getFullYear(), monPrev.getMonth() + 1, monPrev.getDate()),
      date_to: fmt(sunPrev.getFullYear(), sunPrev.getMonth() + 1, sunPrev.getDate()),
    };
  }

  // "this month" / "is mahine" / "current month"
  if (/\b(this\s+month|is\s+mah[iy]ne|current\s+month)\b/i.test(text)) {
    return { date_from: fmt(y, m, 1), date_to: fmt(y, m, d) };
  }

  // "last month" / "pichle mahine"
  if (/\b(last\s+month|pich+le\s+mah[iy]ne|gaya\s+mahina)\b/i.test(text)) {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    return { date_from: fmt(py, pm, 1), date_to: fmt(py, pm, lastDayOfMonth(py, pm)) };
  }

  // "this quarter" / "this Q"
  if (/\b(this\s+quarter|current\s+quarter)\b/i.test(text)) {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    return { date_from: fmt(y, qStart, 1), date_to: fmt(y, m, d) };
  }

  // "last quarter"
  if (/\b(last\s+quarter|previous\s+quarter)\b/i.test(text)) {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const pqEnd = new Date(y, qStart - 1, 0); // last day of prev quarter
    const pqStart = new Date(pqEnd.getFullYear(), pqEnd.getMonth() - 2, 1);
    return {
      date_from: fmt(pqStart.getFullYear(), pqStart.getMonth() + 1, 1),
      date_to: fmt(pqEnd.getFullYear(), pqEnd.getMonth() + 1, pqEnd.getDate()),
    };
  }

  // "this year" / "is saal" / "current FY"
  if (/\b(this\s+year|is\s+saal|current\s+fy|this\s+fy)\b/i.test(text)) {
    // Indian FY: Apr-Mar
    const fyStart = m >= 4 ? y : y - 1;
    return { date_from: fmt(fyStart, 4, 1), date_to: fmt(y, m, d) };
  }

  // "last year" / "pichle saal" / "last FY"
  if (/\b(last\s+year|pich+le\s+saal|previous\s+fy|last\s+fy)\b/i.test(text)) {
    const fyStart = m >= 4 ? y - 1 : y - 2;
    return { date_from: fmt(fyStart, 4, 1), date_to: fmt(fyStart + 1, 3, 31) };
  }

  // "last N days" / "pichle N din"
  const lastNDays = text.match(/\b(?:last|pich+le|past)\s+(\d+)\s*(?:days?|din)\b/i);
  if (lastNDays) {
    const n = parseInt(lastNDays[1], 10);
    const from = new Date(y, m - 1, d - n);
    return {
      date_from: fmt(from.getFullYear(), from.getMonth() + 1, from.getDate()),
      date_to: fmt(y, m, d),
    };
  }

  // "in January", "for February 2025", "January 2025", "march"
  const monthMatch = text.match(/\b(?:in|for|of)?\s*(jan(?:uary|vari)?|feb(?:ruary|rvari)?|mar(?:ch)?|apr(?:il)?|may|mai|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|tambar)?|oct(?:ober|ubar)?|nov(?:ember|ambar)?|dec(?:ember|isambar)?)\s*(?:(\d{4}))?\b/i);
  if (monthMatch) {
    const monthName = monthMatch[1].toLowerCase();
    const monthNum = MONTH_MAP[monthName] || HINDI_MONTH_MAP[monthName];
    if (monthNum) {
      const yr = monthMatch[2] ? parseInt(monthMatch[2], 10) : y;
      return {
        date_from: fmt(yr, monthNum, 1),
        date_to: fmt(yr, monthNum, lastDayOfMonth(yr, monthNum)),
      };
    }
  }

  // "from 1st to 15th" / "1 se 15 tak" / "from 1 to 15"
  const rangeMatch = text.match(/\b(?:from|se)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(?:to|se|tak|till)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (rangeMatch) {
    const d1 = parseInt(rangeMatch[1], 10);
    const d2 = parseInt(rangeMatch[2], 10);
    if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
      return { date_from: fmt(y, m, d1), date_to: fmt(y, m, d2) };
    }
  }

  // "DD/MM/YYYY" or "DD-MM-YYYY" single date
  const singleDate = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (singleDate) {
    const dd = parseInt(singleDate[1], 10);
    const mm = parseInt(singleDate[2], 10);
    const yyyy = parseInt(singleDate[3], 10);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const t = fmt(yyyy, mm, dd);
      return { date_from: t, date_to: t };
    }
  }

  // "DD/MM/YYYY to DD/MM/YYYY" date range
  const dateRange = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(?:to|se|tak|till)\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dateRange) {
    const from = fmt(parseInt(dateRange[3]), parseInt(dateRange[2]), parseInt(dateRange[1]));
    const to = fmt(parseInt(dateRange[6]), parseInt(dateRange[5]), parseInt(dateRange[4]));
    return { date_from: from, date_to: to };
  }

  return null;
}

/**
 * Extract date expressions from text and return the remaining text (with dates removed).
 * Useful for extracting party name + dates from a single phrase.
 */
function extractDatesAndClean(text) {
  const dates = parseDates(text);
  if (!dates) return { dates: null, cleanText: text };

  // Remove the date portion from text
  let clean = text
    .replace(/\b(?:from|se)\s+\d{1,2}(?:st|nd|rd|th)?\s+(?:to|se|tak|till)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi, '')
    .replace(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\s+(?:to|se|tak|till)\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/gi, '')
    .replace(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/gi, '')
    .replace(/\b(?:in|for|of)?\s*(?:jan(?:uary|vari)?|feb(?:ruary|rvari)?|mar(?:ch)?|apr(?:il)?|may|mai|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|tambar)?|oct(?:ober|ubar)?|nov(?:ember|ambar)?|dec(?:ember|isambar)?)\s*(?:\d{4})?\b/gi, '')
    .replace(/\b(?:today|yesterday|aaj|kal|parso)\b/gi, '')
    .replace(/\b(?:this|last|current|previous|pich+le|gaya|is)\s+(?:week|month|quarter|year|fy|hafte|mah[iy]ne|saal|din)\b/gi, '')
    .replace(/\b(?:last|pich+le|past)\s+\d+\s*(?:days?|din)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { dates, cleanText: clean };
}

module.exports = { parseDates, extractDatesAndClean };
