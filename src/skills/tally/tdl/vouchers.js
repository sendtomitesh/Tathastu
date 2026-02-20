const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr, vchEmoji } = require('./formatters');

function buildVouchersTdlXml(companyName, dateFrom, dateTo, voucherType) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  // Only set date range if explicitly provided — otherwise Tally returns all vouchers
  if (dateFrom || dateTo) {
    const actualFrom = dateFrom || dateTo;
    const actualTo = dateTo || dateFrom;
    svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
    svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);
  }

  const filters = [];
  const filterDefs = [];
  if (voucherType) {
    filters.push('<FILTER>VchTypeFilter</FILTER>');
    filterDefs.push(`<SYSTEM TYPE="Formulae" NAME="VchTypeFilter">$VoucherTypeName = "${escapeXml(voucherType)}"</SYSTEM>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VoucherList</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="VoucherList" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, VoucherNumber, Narration, Amount, PartyLedgerName</FETCH>
          ${filters.join('\n          ')}
        </COLLECTION>
        ${filterDefs.join('\n        ')}
      </TDLMESSAGE></TDL>
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

  const dates = vouchers.map(v => v.date).filter(Boolean).sort();
  const fromDate = dates.length ? formatTallyDate(dates[0]) : '';
  const toDate = dates.length ? formatTallyDate(dates[dates.length - 1]) : '';
  const isSingleDay = dates.length && dates[0] === dates[dates.length - 1];

  const header = isSingleDay
    ? `📋 *Day Book: ${fromDate}* (${vouchers.length} entries)`
    : `📋 *Vouchers: ${fromDate} to ${toDate}* (${vouchers.length} entries)`;
  const lines = [header, ''];

  for (const v of vouchers) {
    const dateStr = !isSingleDay && v.date ? formatTallyDate(v.date) + ' | ' : '';
    const narr = v.narration ? ` _${v.narration.slice(0, 30)}_` : '';
    lines.push(`${vchEmoji(v.type)} ${dateStr}${v.type}${v.number ? ' #' + v.number : ''} — ₹${inr(v.amount)}${v.party ? ' — ' + v.party : ''}${narr}`);
  }

  // Type-wise summary
  const byType = {};
  for (const v of vouchers) {
    const t = v.type || 'Other';
    if (!byType[t]) byType[t] = { count: 0, total: 0 };
    byType[t].count++;
    byType[t].total += Math.abs(v.amount);
  }

  lines.push('', SEP);
  for (const [type, info] of Object.entries(byType)) {
    const label = info.count === 1 ? 'entry' : 'entries';
    lines.push(`${vchEmoji(type)} ${type}: ${info.count} ${label}, ₹${inr(info.total)}`);
  }

  return { success: true, message: lines.join('\n'), data: vouchers };
}

module.exports = { buildVouchersTdlXml, parseVouchersTdlResponse };
