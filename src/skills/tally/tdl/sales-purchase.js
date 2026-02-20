const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildSalesPurchaseReportTdlXml(companyName, reportType, dateFrom, dateTo) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  // Only set date range if explicitly provided — otherwise Tally returns all matching vouchers
  if (dateFrom || dateTo) {
    const actualFrom = dateFrom || dateTo;
    const actualTo = dateTo || dateFrom;
    svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
    svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);
  }

  const vchType = reportType === 'purchase' ? 'Purchase' : 'Sales';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SalesPurchaseReport</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="SalesPurchaseReport" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, VoucherNumber, Amount, PartyLedgerName, Narration</FETCH>
          <FILTER>SPReportFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="SPReportFilter">$VoucherTypeName = "${vchType}"</SYSTEM>
      </TDLMESSAGE></TDL>
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

  const dates = vouchers.map(v => v.date).filter(Boolean).sort();
  const fromDate = dates.length ? formatTallyDate(dates[0]) : '';
  const toDate = dates.length ? formatTallyDate(dates[dates.length - 1]) : '';

  const byParty = {};
  let grandTotal = 0;
  for (const v of vouchers) {
    const party = v.party || 'Unknown';
    if (!byParty[party]) byParty[party] = { count: 0, total: 0 };
    byParty[party].count++;
    byParty[party].total += Math.abs(v.amount);
    grandTotal += Math.abs(v.amount);
  }

  const sorted = Object.entries(byParty).sort((a, b) => b[1].total - a[1].total);

  const lines = [
    `📊 *${label} Report: ${fromDate} to ${toDate}*`,
    `🧾 ${vouchers.length} invoices | Total: ₹${inr(grandTotal)}`,
    '',
  ];

  sorted.forEach(([party, info], i) => {
    lines.push(`${i + 1}. ${party} — ₹${inr(info.total)} (${info.count})`);
  });

  return { success: true, message: lines.join('\n'), data: { type: label, entries: vouchers, byParty, total: grandTotal, fromDate, toDate } };
}

module.exports = { buildSalesPurchaseReportTdlXml, parseSalesPurchaseReportTdlResponse };
