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

function envelope(header, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    ${header}
  </HEADER>
  <BODY>
    ${body}
  </BODY>
</ENVELOPE>`;
}

function buildLedgerXml(ledgerName, companyName) {
  const descParts = [
    '<STATICVARIABLES>',
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>',
  ];
  if (companyName) {
    descParts.push('<SVCURRENTCOMPANY>' + escapeXml(companyName) + '</SVCURRENTCOMPANY>');
  }
  descParts.push('</STATICVARIABLES>');
  const desc = '<DESC>' + descParts.join('') + '</DESC>';
  const body = desc + `
  <DATA>
    <TALLYMESSAGE>
      <LEDGER NAME="${escapeXml(ledgerName)}"/>
    </TALLYMESSAGE>
  </DATA>`;
  const header = [
    '<TALLYREQUEST>Export</TALLYREQUEST>',
    '<TYPE>Object</TYPE>',
    '<ID>Ledger</ID>',
  ].join('\n    ');
  return envelope(header, body);
}

function buildDayBookXml(dateFrom, dateTo, voucherType, companyName) {
  const descParts = [
    '<STATICVARIABLES>',
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>',
  ];
  if (companyName) {
    descParts.push('<SVCURRENTCOMPANY>' + escapeXml(companyName) + '</SVCURRENTCOMPANY>');
  }
  const from = toTallyDate(dateFrom) || toTallyDate(new Date());
  const to = toTallyDate(dateTo) || from;
  descParts.push('<SVFROMDATE>' + from + '</SVFROMDATE>');
  descParts.push('<SVTODATE>' + to + '</SVTODATE>');
  descParts.push('</STATICVARIABLES>');
  const desc = '<DESC>' + descParts.join('') + '</DESC>';
  const body = desc + '\n  <DATA><COLLECTION NAME="DayBook">DayBook</COLLECTION></DATA>';
  const header = [
    '<TALLYREQUEST>Export</TALLYREQUEST>',
    '<TYPE>Data</TYPE>',
    '<ID>DayBook</ID>',
  ].join('\n    ');
  return envelope(header, body);
}

function buildListLedgersXml(groupFilter, companyName) {
  const descParts = [
    '<STATICVARIABLES>',
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>',
  ];
  if (companyName) {
    descParts.push('<SVCURRENTCOMPANY>' + escapeXml(companyName) + '</SVCURRENTCOMPANY>');
  }
  descParts.push('</STATICVARIABLES>');
  const desc = '<DESC>' + descParts.join('') + '</DESC>';
  const body = desc + '\n  <DATA><COLLECTION NAME="List of Ledgers">List of Ledgers</COLLECTION></DATA>';
  const header = [
    '<TALLYREQUEST>Export</TALLYREQUEST>',
    '<TYPE>Collection</TYPE>',
    '<ID>List of Ledgers</ID>',
  ].join('\n    ');
  return envelope(header, body);
}

async function postTally(baseUrl, xml) {
  const { data } = await axios.post(baseUrl, xml, {
    headers: { 'Content-Type': 'text/xml' },
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return typeof data === 'string' ? data : (data && data.toString ? data.toString() : String(data));
}

function parseStatus(xmlString) {
  const statusMatch = xmlString.match(/<STATUS[^>]*>([^<]+)<\/STATUS>/);
  const status = statusMatch ? statusMatch[1].trim() : '';
  return status === '1';
}

function parseLedgerResponse(xmlString) {
  const ok = parseStatus(xmlString);
  if (!ok) {
    const errMatch = xmlString.match(/<LINEERROR>([^<]*)<\/LINEERROR>/);
    return { success: false, message: errMatch ? errMatch[1].trim() : 'Request failed.' };
  }
  const nameMatch = xmlString.match(/<NAME[^>]*>([^<]*)<\/NAME>/);
  const openingMatch = xmlString.match(/<OPENINGBALANCE[^>]*>([^<]*)<\/OPENINGBALANCE>/);
  const closingMatch = xmlString.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/);
  const name = nameMatch ? nameMatch[1].trim() : 'Ledger';
  const opening = openingMatch ? openingMatch[1].trim() : '';
  const closing = closingMatch ? closingMatch[1].trim() : '';
  const lines = [];
  const entryRegex = /<LEDGERENTRY>[\s\S]*?<DATE>([^<]*)<\/DATE>[\s\S]*?<LEDGERNAME>([^<]*)<\/LEDGERNAME>[\s\S]*?<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/g;
  let m;
  while ((m = entryRegex.exec(xmlString)) !== null && lines.length < 15) {
    lines.push({ date: m[1], ledger: m[2], amount: m[3] });
  }
  let summary = `Ledger: ${name}. Opening: ${opening || '0'}. Closing: ${closing || '0'}.`;
  if (lines.length) {
    summary += '\nRecent entries: ' + lines.slice(0, 5).map((e) => `${e.date} ${e.ledger} ${e.amount}`).join('; ');
  }
  return { success: true, summary, data: { name, opening, closing, entries: lines } };
}

function parseDayBookResponse(xmlString, limit = 10) {
  const ok = parseStatus(xmlString);
  if (!ok) {
    const errMatch = xmlString.match(/<LINEERROR>([^<]*)<\/LINEERROR>/);
    return { success: false, message: errMatch ? errMatch[1].trim() : 'Request failed.' };
  }
  const vouchers = [];
  const vchRegex = /<VOUCHER[^>]*>[\s\S]*?<DATE>([^<]*)<\/DATE>[\s\S]*?<VOUCHERTYPENAME>([^<]*)<\/VOUCHERTYPENAME>[\s\S]*?<\/VOUCHER>/g;
  let m;
  while ((m = vchRegex.exec(xmlString)) !== null && vouchers.length < limit) {
    const block = m[0];
    const narrMatch = block.match(/<NARRATION>([^<]*)<\/NARRATION>/);
    const amtMatch = block.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/);
    vouchers.push({
      date: m[1],
      type: m[2],
      narration: narrMatch ? narrMatch[1].trim() : '',
      amount: amtMatch ? amtMatch[1].trim() : '',
    });
  }
  const summary = vouchers.length
    ? 'Vouchers: ' + vouchers.map((v) => `${v.date} ${v.type} ${v.amount}`).join('\n')
    : 'No vouchers found for the given period.';
  return { success: true, summary, data: vouchers };
}

function parseListLedgersResponse(xmlString) {
  const ok = parseStatus(xmlString);
  if (!ok) {
    const errMatch = xmlString.match(/<LINEERROR>([^<]*)<\/LINEERROR>/);
    return { success: false, message: errMatch ? errMatch[1].trim() : 'Request failed.' };
  }
  const names = [];
  const nameRegex = /<LEDGER[^>]*>[\s\S]*?<NAME[^>]*>([^<]*)<\/NAME>/g;
  let m;
  while ((m = nameRegex.exec(xmlString)) !== null && names.length < 50) {
    names.push(m[1].trim());
  }
  const summary = names.length ? 'Ledgers: ' + names.slice(0, 20).join(', ') + (names.length > 20 ? '...' : '') : 'No ledgers found.';
  return { success: true, summary, data: names };
}

module.exports = {
  buildLedgerXml,
  buildDayBookXml,
  buildListLedgersXml,
  postTally,
  parseLedgerResponse,
  parseDayBookResponse,
  parseListLedgersResponse,
};
