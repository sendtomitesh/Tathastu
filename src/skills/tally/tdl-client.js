/**
 * TDL-based Tally client - ultra-lightweight Collection requests.
 * 
 * KEY INSIGHT: Tally crashes with memory violations when it tries to compute
 * derived fields like OpeningBalance/ClosingBalance across many ledgers.
 * Those fields require loading voucher data internally.
 *
 * Solution: Only fetch static master fields (Name, GSTIN, Parent, Address, etc.)
 * and use CHILDOF to restrict the collection scope. Never request balance fields
 * in a collection — use a separate targeted request if balances are needed.
 */

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

/** Decode XML entities back to plain text */
function decodeXml(str) {
  if (!str) return str || '';
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Convert various date formats to Tally's YYYYMMDD format */
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

/** Convert YYYYMMDD to Tally date literal for FILTER formulas (e.g. "1-Apr-2025") */
function toTallyFilterDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd || '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const y = yyyymmdd.slice(0, 4);
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return `${d}-${months[m - 1]}-${y}`;
}

/**
 * Build XML to fetch ONLY static master fields for a single ledger by name.
 * No balance computation, no voucher loading — pure master data read.
 */
function buildLedgerMasterTdlXml(ledgerName, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) {
    svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  }

  // Use FETCH to pull nested GST details from LEDGSTREGDETAILS.LIST.
  // NATIVEMETHOD only gets top-level fields; FETCH traverses sub-objects.
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LedgerGSTInfo</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${svParts.join('\n        ')}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LedgerGSTInfo" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FETCH>Name, Parent, LedStateName, CountryOfResidence, LEDGSTREGDETAILS.LIST</FETCH>
            <FILTER>LedgerGSTNameFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="LedgerGSTNameFilter">$Name = "${escapeXml(ledgerName)}"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Build XML to list all ledger names under a specific group (e.g. Sundry Debtors).
 * Only fetches Name — no computed fields.
 */
function buildListLedgerNamesTdlXml(parentGroup, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) {
    svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  }

  const childOfClause = parentGroup
    ? `<CHILDOF>${escapeXml(parentGroup)}</CHILDOF>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LedgerNameList</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${svParts.join('\n        ')}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LedgerNameList" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            ${childOfClause}
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
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

function parseLedgerMasterTdlResponse(xmlString) {
  // Match <LEDGER NAME="..."> specifically — skip <LEDGER>0</LEDGER> counters in CMPINFO
  const ledgerMatch = xmlString.match(/<LEDGER\s+NAME="[^"]*"[^>]*>[\s\S]*?<\/LEDGER>/i);
  if (!ledgerMatch) {
    const errMatch = xmlString.match(/<LINEERROR>([^<]*)<\/LINEERROR>/);
    if (errMatch) return { success: false, message: errMatch[1].trim() };
    return { success: false, message: 'Ledger not found in Tally.' };
  }

  const block = ledgerMatch[0];
  const extract = (tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  };

  // Name can be in NAME attribute on LEDGER tag, or inside LANGUAGENAME.LIST > NAME.LIST > NAME
  const nameAttr = block.match(/<LEDGER\b[^>]*\bNAME="([^"]*)"[^>]*>/i);
  const nameInner = block.match(/<NAME\.LIST[^>]*>\s*<NAME>([^<]*)<\/NAME>/i);
  const name = (nameAttr ? nameAttr[1].trim() : null)
    || (nameInner ? nameInner[1].trim() : null)
    || extract('NAME')
    || 'Unknown';

  const gstin = extract('GSTIN') || extract('PARTYGSTIN') || null;
  const parent = extract('PARENT') || null;
  // GSTRegistrationType lives inside LEDGSTREGDETAILS.LIST
  const gstType = extract('GSTREGISTRATIONTYPE') || null;
  const state = extract('LEDSTATENAME') || null;

  let message;
  if (gstin) {
    message = `GSTIN for ${name}: ${gstin}`;
    if (gstType) message += ` (${gstType})`;
    if (state) message += `, State: ${state}`;
  } else {
    message = `No GSTIN found for ${name}.`;
    if (state) message += ` State: ${state}, Group: ${parent || 'N/A'}.`;
    message += ' The party may not have GSTIN set in Tally.';
  }

  return {
    success: true,
    message,
    data: { name, gstin, parent, gstType, state },
  };
}


function parseListLedgerNamesResponse(xmlString) {
  const names = [];
  const regex = /<LEDGER\b[^>]*>[\s\S]*?<NAME[^>]*>([^<]*)<\/NAME>[\s\S]*?<\/LEDGER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    names.push(m[1].trim());
  }
  // Fallback: try NAME attribute
  if (names.length === 0) {
    const regex2 = /<LEDGER\b[^>]*NAME="([^"]*)"[^>]*>/gi;
    while ((m = regex2.exec(xmlString)) !== null) {
      names.push(m[1]);
    }
  }
  return { success: true, data: names };
}

/**
 * Build XML to fetch closing/opening balance for a single ledger.
 * Safe because the FILTER ensures only one ledger's balance is computed.
 */
function buildLedgerBalanceTdlXml(ledgerName, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) {
    svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LedgerBalanceInfo</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${svParts.join('\n        ')}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LedgerBalanceInfo" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FETCH>Name, Parent, ClosingBalance, OpeningBalance</FETCH>
            <FILTER>LedgerBalFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="LedgerBalFilter">$Name = "${escapeXml(ledgerName)}"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseLedgerBalanceTdlResponse(xmlString) {
  const ledgerMatch = xmlString.match(/<LEDGER\s+NAME="[^"]*"[^>]*>[\s\S]*?<\/LEDGER>/i);
  if (!ledgerMatch) {
    const errMatch = xmlString.match(/<LINEERROR>([^<]*)<\/LINEERROR>/);
    if (errMatch) return { success: false, message: errMatch[1].trim() };
    return { success: false, message: 'Ledger not found in Tally.' };
  }

  const block = ledgerMatch[0];
  const extract = (tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  };

  const nameAttr = block.match(/<LEDGER\b[^>]*\bNAME="([^"]*)"[^>]*>/i);
  const name = nameAttr ? nameAttr[1].trim() : extract('NAME') || 'Unknown';
  const parent = extract('PARENT') || null;
  const closingRaw = extract('CLOSINGBALANCE') || '0';
  const openingRaw = extract('OPENINGBALANCE') || '0';

  const closing = parseFloat(closingRaw) || 0;
  const opening = parseFloat(openingRaw) || 0;

  // In Tally: negative closing = credit balance (payable), positive = debit (receivable)
  const isPayable = closing < 0;
  const absClosing = Math.abs(closing).toFixed(2);
  const balanceType = isPayable ? 'Payable' : 'Receivable';

  let message = `${name} (${parent || 'N/A'}): ₹${absClosing} ${balanceType}`;
  if (opening !== 0) {
    const absOpening = Math.abs(opening).toFixed(2);
    message += `. Opening: ₹${absOpening}`;
  }

  return {
    success: true,
    message,
    data: { name, parent, closingBalance: closing, openingBalance: opening, balanceType },
  };
}

/**
 * Build XML to search ledgers by partial name match (CONTAINS).
 * Returns only Name and Parent — lightweight, no balance computation.
 * Used for fuzzy matching when exact name doesn't match.
 */
function buildSearchLedgersTdlXml(searchTerm, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) {
    svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LedgerSearch</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${svParts.join('\n        ')}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LedgerSearch" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <FILTER>LedgerSearchFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="LedgerSearchFilter">$Name Contains "${escapeXml(searchTerm)}"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseSearchLedgersResponse(xmlString) {
  const results = [];
  const regex = /<LEDGER\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/LEDGER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = m[1].trim();
    const parentMatch = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/i);
    const parent = parentMatch ? parentMatch[1].trim() : null;
    results.push({ name, parent });
  }
  return { success: true, data: results };
}

/**
 * Build XML to fetch outstanding (non-zero balance) ledgers for a group.
 * Uses CHILDOF to scope to a specific group (e.g. Sundry Debtors, Sundry Creditors).
 * Filters out zero-balance ledgers to keep the response lean.
 */
function buildOutstandingTdlXml(groupName, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) {
    svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>OutstandingLedgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${svParts.join('\n        ')}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="OutstandingLedgers" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <CHILDOF>${escapeXml(groupName)}</CHILDOF>
            <FETCH>Name, Parent, ClosingBalance</FETCH>
            <FILTER>NonZeroBalFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="NonZeroBalFilter">$ClosingBalance != 0</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Build XML to fetch ledger statement (transactions) for a single party.
 * Uses FETCH on Voucher collection filtered by ledger name involvement.
 * Safe: scoped to one ledger, with optional date range and limit.
 */
function buildLedgerStatementTdlXml(ledgerName, companyName, dateFrom, dateTo, limit) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) {
    svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  }
  svParts.push(`<SVLEDGERNAME>${escapeXml(ledgerName)}</SVLEDGERNAME>`);

  // Compute actual date range
  let actualFrom, actualTo;
  if (dateFrom || dateTo) {
    actualFrom = dateFrom;
    actualTo = dateTo || dateFrom;
  } else {
    // Default to current financial year (Apr 1 to today)
    const now = new Date();
    const fyStart = now.getMonth() >= 3
      ? `${now.getFullYear()}0401`
      : `${now.getFullYear() - 1}0401`;
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    actualFrom = fyStart;
    actualTo = today;
  }
  svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
  svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);

  // Filter by PartyLedgerName (exact match) + date range via TDL FILTER formulas
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LedgerVchList</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${svParts.join('\n        ')}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LedgerVchList" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FETCH>Date, VoucherTypeName, VoucherNumber, Narration, Amount, PartyLedgerName</FETCH>
            <FILTER>LedgerVchFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="LedgerVchFilter">$PartyLedgerName = "${escapeXml(ledgerName)}"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}


function parseLedgerStatementTdlResponse(xmlString, ledgerName, limit = 20) {
  const entries = [];
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null && entries.length < limit) {
    const block = m[0];
    const extract = (tag) => {
      const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return mx ? mx[1].trim() : null;
    };
    const date = extract('DATE');
    const type = extract('VOUCHERTYPENAME');
    const number = extract('VOUCHERNUMBER');
    const narration = decodeXml(extract('NARRATION'));
    const amount = parseFloat(extract('AMOUNT')) || 0;

    entries.push({
      date: date || '',
      type: type || '',
      number: number || '',
      narration,
      amount,
    });
  }

  if (entries.length === 0) {
    return { success: true, message: `No transactions found for ${ledgerName} in this financial year.`, data: { ledgerName, entries: [] } };
  }

  // Format WhatsApp-friendly summary
  const lines = [`📒 Ledger: ${ledgerName} (${entries.length} entries)`];
  lines.push('');
  for (const e of entries) {
    const absAmt = Math.abs(e.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const drCr = e.amount >= 0 ? 'Dr' : 'Cr';
    const dateStr = e.date ? formatTallyDate(e.date) : '';
    lines.push(`${dateStr} ${e.type} ${e.number ? '#' + e.number : ''} ₹${absAmt} ${drCr}${e.narration ? ' - ' + e.narration.slice(0, 40) : ''}`);
  }

  // Summary: date range, totals, net balance
  const dates = entries.map(e => e.date).filter(Boolean).sort();
  const fromDate = dates.length ? formatTallyDate(dates[0]) : '';
  const toDate = dates.length ? formatTallyDate(dates[dates.length - 1]) : '';
  const totalDr = entries.filter(e => e.amount >= 0).reduce((s, e) => s + e.amount, 0);
  const totalCr = entries.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
  const net = totalDr - totalCr;
  const netLabel = net >= 0 ? 'Receivable' : 'Payable';

  lines.push('');
  lines.push(`📅 ${fromDate} to ${toDate}`);
  lines.push(`Total Dr: ₹${totalDr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Cr: ₹${totalCr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push(`Net: ₹${Math.abs(net).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${netLabel}`);

  return {
    success: true,
    message: lines.join('\n'),
    data: { ledgerName, entries, totalDr, totalCr, net, fromDate, toDate },
  };
}

/**
 * Build XML to fetch vouchers (daybook) with optional date range and type filter.
 * Uses Collection on Voucher type with date static variables.
 */
function buildVouchersTdlXml(companyName, dateFrom, dateTo, voucherType) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) {
    svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  }
  // Default to today if no dates specified
  let actualFrom, actualTo;
  if (!dateFrom && !dateTo) {
    const now = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    actualFrom = today;
    actualTo = today;
  } else {
    actualFrom = dateFrom;
    actualTo = dateTo || dateFrom;
  }
  svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
  svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);

  // Build FILTER clauses
  const filters = [];
  const filterDefs = [];

  if (voucherType) {
    filters.push('<FILTER>VchTypeFilter</FILTER>');
    filterDefs.push(`<SYSTEM TYPE="Formulae" NAME="VchTypeFilter">$VoucherTypeName = "${escapeXml(voucherType)}"</SYSTEM>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>VoucherList</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${svParts.join('\n        ')}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="VoucherList" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FETCH>Date, VoucherTypeName, VoucherNumber, Narration, Amount, PartyLedgerName</FETCH>
            ${filters.join('\n            ')}
          </COLLECTION>
          ${filterDefs.join('\n          ')}
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseVouchersTdlResponse(xmlString, limit = 50, dateFrom = null, dateTo = null) {
  let vouchers = [];
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const extract = (tag) => {
      const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return mx ? mx[1].trim() : null;
    };
    vouchers.push({
      date: extract('DATE') || '',
      type: extract('VOUCHERTYPENAME') || '',
      number: extract('VOUCHERNUMBER') || '',
      narration: decodeXml(extract('NARRATION')),
      amount: parseFloat(extract('AMOUNT')) || 0,
      party: decodeXml(extract('PARTYLEDGERNAME')),
    });
  }

  // JS-side date filtering (SVFROMDATE/SVTODATE don't work with custom TDL collections)
  if (dateFrom || dateTo) {
    vouchers = vouchers.filter(v => {
      if (!v.date) return false;
      if (dateFrom && v.date < dateFrom) return false;
      if (dateTo && v.date > dateTo) return false;
      return true;
    });
  }

  if (limit) vouchers = vouchers.slice(0, limit);

  if (vouchers.length === 0) {
    return { success: true, message: 'No vouchers found for the given period.', data: [] };
  }

  // Date range from actual data
  const dates = vouchers.map(v => v.date).filter(Boolean).sort();
  const fromDate = dates.length ? formatTallyDate(dates[0]) : '';
  const toDate = dates.length ? formatTallyDate(dates[dates.length - 1]) : '';
  const isSingleDay = dates.length && dates[0] === dates[dates.length - 1];

  const header = isSingleDay
    ? `📋 Day Book: ${fromDate} (${vouchers.length} entries)`
    : `📋 Vouchers: ${fromDate} to ${toDate} (${vouchers.length} entries)`;

  const lines = [header, ''];

  for (const v of vouchers) {
    const absAmt = Math.abs(v.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dateStr = !isSingleDay && v.date ? formatTallyDate(v.date) + ' ' : '';
    lines.push(`${dateStr}${v.type} ${v.number ? '#' + v.number : ''} ₹${absAmt}${v.party ? ' - ' + v.party : ''}${v.narration ? ' (' + v.narration.slice(0, 30) + ')' : ''}`);
  }

  // Summary by voucher type
  const byType = {};
  for (const v of vouchers) {
    const t = v.type || 'Other';
    if (!byType[t]) byType[t] = { count: 0, total: 0 };
    byType[t].count++;
    byType[t].total += Math.abs(v.amount);
  }

  lines.push('');
  lines.push('Summary:');
  for (const [type, info] of Object.entries(byType)) {
    lines.push(`${type}: ${info.count} entries, ₹${info.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  return {
    success: true,
    message: lines.join('\n'),
    data: vouchers,
  };
}

/**
 * Build XML to list ledger names, optionally filtered by group.
 * Uses CHILDOF for group scoping, NATIVEMETHOD for lightweight fetch.
 */
function buildListLedgersTdlXml(groupFilter, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) {
    svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  }

  const childOfClause = groupFilter
    ? `<CHILDOF>${escapeXml(groupFilter)}</CHILDOF>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LedgerList</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${svParts.join('\n        ')}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LedgerList" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            ${childOfClause}
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseListLedgersTdlResponse(xmlString) {
  const ledgers = [];
  const regex = /<LEDGER\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/LEDGER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    const parentMatch = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/i);
    const parent = parentMatch ? parentMatch[1].trim() : null;
    ledgers.push({ name, parent });
  }

  if (ledgers.length === 0) {
    return { success: true, message: 'No ledgers found.', data: [] };
  }

  // Group by parent for a cleaner display
  const lines = [`📒 Ledgers (${ledgers.length}):`];
  lines.push('');
  // Show first 30 to keep WhatsApp message manageable
  const display = ledgers.slice(0, 30);
  for (const l of display) {
    lines.push(`• ${l.name}${l.parent ? ' (' + l.parent + ')' : ''}`);
  }
  if (ledgers.length > 30) {
    lines.push(`\n... and ${ledgers.length - 30} more`);
  }

  return {
    success: true,
    message: lines.join('\n'),
    data: ledgers,
  };
}

/**
 * Build XML to fetch sales or purchase summary by party for a date range.
 * Filters vouchers by VoucherTypeName (Sales/Purchase) and groups by PartyLedgerName.
 */
function buildSalesPurchaseReportTdlXml(companyName, reportType, dateFrom, dateTo) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) {
    svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  }
  // Compute actual date range — default to current month
  let actualFrom, actualTo;
  if (!dateFrom && !dateTo) {
    const now = new Date();
    const monthStart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}01`;
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    actualFrom = monthStart;
    actualTo = today;
  } else {
    actualFrom = dateFrom;
    actualTo = dateTo || dateFrom;
  }
  svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
  svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);

  const vchType = reportType === 'purchase' ? 'Purchase' : 'Sales';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>SalesPurchaseReport</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${svParts.join('\n        ')}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="SalesPurchaseReport" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FETCH>Date, VoucherTypeName, VoucherNumber, Amount, PartyLedgerName, Narration</FETCH>
            <FILTER>SPReportFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="SPReportFilter">$VoucherTypeName = "${vchType}"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseSalesPurchaseReportTdlResponse(xmlString, reportType, dateFrom = null, dateTo = null) {
  let vouchers = [];
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const extract = (tag) => {
      const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return mx ? mx[1].trim() : null;
    };
    vouchers.push({
      date: extract('DATE') || '',
      number: extract('VOUCHERNUMBER') || '',
      amount: parseFloat(extract('AMOUNT')) || 0,
      party: decodeXml(extract('PARTYLEDGERNAME')),
    });
  }

  // JS-side date filtering
  if (dateFrom || dateTo) {
    vouchers = vouchers.filter(v => {
      if (!v.date) return false;
      if (dateFrom && v.date < dateFrom) return false;
      if (dateTo && v.date > dateTo) return false;
      return true;
    });
  }

  const label = reportType === 'purchase' ? 'Purchase' : 'Sales';

  if (vouchers.length === 0) {
    return { success: true, message: `No ${label.toLowerCase()} found for the given period.`, data: { type: label, entries: [], byParty: {}, total: 0 } };
  }

  // Date range
  const dates = vouchers.map(v => v.date).filter(Boolean).sort();
  const fromDate = dates.length ? formatTallyDate(dates[0]) : '';
  const toDate = dates.length ? formatTallyDate(dates[dates.length - 1]) : '';

  // Group by party
  const byParty = {};
  let grandTotal = 0;
  for (const v of vouchers) {
    const party = v.party || 'Unknown';
    if (!byParty[party]) byParty[party] = { count: 0, total: 0 };
    byParty[party].count++;
    byParty[party].total += Math.abs(v.amount);
    grandTotal += Math.abs(v.amount);
  }

  // Sort by total descending
  const sorted = Object.entries(byParty).sort((a, b) => b[1].total - a[1].total);

  const lines = [`📊 ${label} Report: ${fromDate} to ${toDate}`];
  lines.push(`${vouchers.length} invoices, Total: ₹${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push('');

  // Party-wise breakdown
  for (const [party, info] of sorted) {
    const amt = info.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    lines.push(`• ${party}: ₹${amt} (${info.count})`);
  }

  return {
    success: true,
    message: lines.join('\n'),
    data: { type: label, entries: vouchers, byParty, total: grandTotal, fromDate, toDate },
  };
}

/** Format Tally date (YYYYMMDD) to DD-MM-YYYY */
function formatTallyDate(d) {
  if (!d || d.length < 8) return d || '';
  return d.slice(6, 8) + '-' + d.slice(4, 6) + '-' + d.slice(0, 4);
}


function parseOutstandingTdlResponse(xmlString, groupName) {
  const entries = [];
  const regex = /<LEDGER\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/LEDGER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    const balMatch = block.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/i);
    const closing = balMatch ? parseFloat(balMatch[1].trim()) || 0 : 0;
    if (closing !== 0) {
      entries.push({ name, closingBalance: closing });
    }
  }

  if (entries.length === 0) {
    return { success: true, message: `No outstanding balances in ${groupName}.`, data: { group: groupName, entries: [], total: 0 } };
  }

  // Sort by absolute amount descending (biggest outstanding first)
  entries.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance));

  const total = entries.reduce((sum, e) => sum + e.closingBalance, 0);
  const isPayable = groupName.toLowerCase().includes('creditor');
  const label = isPayable ? 'Payable' : 'Receivable';

  const lines = [`📊 ${groupName} — ${label} Outstanding:`];
  lines.push('');
  for (const e of entries) {
    const abs = Math.abs(e.closingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    lines.push(`• ${e.name}: ₹${abs}`);
  }
  lines.push('');
  const absTotal = Math.abs(total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  lines.push(`Total: ₹${absTotal} (${entries.length} parties)`);

  return {
    success: true,
    message: lines.join('\n'),
    data: { group: groupName, entries, total, count: entries.length },
  };
}

module.exports = {
  buildLedgerMasterTdlXml,
  buildLedgerBalanceTdlXml,
  buildLedgerStatementTdlXml,
  buildVouchersTdlXml,
  buildListLedgersTdlXml,
  buildListLedgerNamesTdlXml,
  buildSearchLedgersTdlXml,
  buildOutstandingTdlXml,
  postTally,
  parseLedgerMasterTdlResponse,
  parseLedgerBalanceTdlResponse,
  parseLedgerStatementTdlResponse,
  parseVouchersTdlResponse,
  parseListLedgersTdlResponse,
  parseListLedgerNamesResponse,
  parseSearchLedgersResponse,
  parseOutstandingTdlResponse,
  buildSalesPurchaseReportTdlXml,
  parseSalesPurchaseReportTdlResponse,
  formatTallyDate,
  toTallyDate,
};
