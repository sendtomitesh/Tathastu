const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildLedgerStatementTdlXml(ledgerName, companyName, dateFrom, dateTo, limit) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  svParts.push(`<SVLEDGERNAME>${escapeXml(ledgerName)}</SVLEDGERNAME>`);

  let actualFrom, actualTo;
  if (dateFrom || dateTo) {
    actualFrom = dateFrom;
    actualTo = dateTo || dateFrom;
  } else {
    const now = new Date();
    actualFrom = now.getMonth() >= 3 ? `${now.getFullYear()}0401` : `${now.getFullYear() - 1}0401`;
    actualTo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }
  svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
  svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerVchList</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="LedgerVchList" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, VoucherNumber, Narration, Amount, PartyLedgerName</FETCH>
          <FILTER>LedgerVchFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="LedgerVchFilter">$PartyLedgerName = "${escapeXml(ledgerName)}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseLedgerStatementTdlResponse(xmlString, ledgerName, limit = 20) {
  const entries = [];
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  const maxEntries = limit > 0 ? limit : Infinity;
  let m;
  while ((m = regex.exec(xmlString)) !== null && entries.length < maxEntries) {
    const block = m[0];
    const extract = (tag) => {
      const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return mx ? mx[1].trim() : null;
    };
    entries.push({
      date: extract('DATE') || '',
      type: extract('VOUCHERTYPENAME') || '',
      number: extract('VOUCHERNUMBER') || '',
      narration: decodeXml(extract('NARRATION')),
      amount: parseFloat(extract('AMOUNT')) || 0,
    });
  }

  if (entries.length === 0) {
    return { success: true, message: `No transactions found for *${ledgerName}* in this financial year.`, data: { ledgerName, entries: [] } };
  }

  const dates = entries.map(e => e.date).filter(Boolean).sort();
  const fromDate = dates.length ? formatTallyDate(dates[0]) : '';
  const toDate = dates.length ? formatTallyDate(dates[dates.length - 1]) : '';
  const totalDr = entries.filter(e => e.amount >= 0).reduce((s, e) => s + e.amount, 0);
  const totalCr = entries.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
  const net = totalDr - totalCr;
  const netLabel = net >= 0 ? 'Receivable' : 'Payable';

  const lines = [
    `📒 *Ledger: ${ledgerName}*`,
    `📅 ${fromDate} to ${toDate} | ${entries.length} entries`,
    '',
  ];

  entries.forEach((e, i) => {
    const drCr = e.amount >= 0 ? 'Dr 🟢' : 'Cr 🔴';
    const dateStr = e.date ? formatTallyDate(e.date) : '';
    lines.push(`${i + 1}. ${dateStr} | ${e.type}${e.number ? ' #' + e.number : ''}`);
    lines.push(`   ₹${inr(e.amount)} ${drCr}`);
    if (e.narration) lines.push(`   _${e.narration.slice(0, 50)}_`);
  });

  lines.push(SEP);
  lines.push(`💰 Total Dr: ₹${inr(totalDr)}`);
  lines.push(`💰 Total Cr: ₹${inr(totalCr)}`);
  lines.push(`📊 *Net: ₹${inr(net)} ${netLabel}*`);

  return { success: true, message: lines.join('\n'), data: { ledgerName, entries, totalDr, totalCr, net, fromDate, toDate } };
}

module.exports = { buildLedgerStatementTdlXml, parseLedgerStatementTdlResponse };
