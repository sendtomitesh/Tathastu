const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

/**
 * Build TDL XML to fetch all Sales/Purchase vouchers for inactive analysis.
 * We fetch all vouchers and find parties/items with no recent activity.
 */
function buildInactiveReportTdlXml(companyName, reportType) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  const vchType = reportType === 'purchase' ? 'Purchase' : 'Sales';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>InactiveReportVouchers</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="InactiveReportVouchers" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, PartyLedgerName, Amount</FETCH>
          <FETCH>AllInventoryEntries.StockItemName, AllInventoryEntries.Amount</FETCH>
          <FILTER>InactiveTypeFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="InactiveTypeFilter">$VoucherTypeName = "${vchType}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse voucher XML and find inactive customers/suppliers.
 * @param {string} xmlString - Tally XML response
 * @param {string} reportType - 'sales' or 'purchase'
 * @param {number} inactiveDays - Number of days without activity to be considered inactive (default 30)
 */
function parseInactivePartiesResponse(xmlString, reportType, inactiveDays) {
  const days = inactiveDays || 30;
  const partyMap = {};
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;

  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const dateMatch = block.match(/<DATE[^>]*>(\d{8})<\/DATE>/i);
    const partyMatch = block.match(/<PARTYLEDGERNAME[^>]*>([^<]*)<\/PARTYLEDGERNAME>/i);
    const amtMatch = block.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/i);
    if (!partyMatch || !dateMatch) continue;

    const party = decodeXml(partyMatch[1].trim());
    const date = dateMatch[1];
    const amount = Math.abs(parseFloat(amtMatch?.[1]) || 0);
    if (!party) continue;

    if (!partyMap[party]) partyMap[party] = { name: party, lastDate: '', totalAmount: 0, txnCount: 0 };
    if (date > partyMap[party].lastDate) partyMap[party].lastDate = date;
    partyMap[party].totalAmount += amount;
    partyMap[party].txnCount++;
  }

  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = `${cutoffDate.getFullYear()}${String(cutoffDate.getMonth() + 1).padStart(2, '0')}${String(cutoffDate.getDate()).padStart(2, '0')}`;

  // Inactive = last transaction date is before cutoff
  const inactive = Object.values(partyMap)
    .filter(p => p.lastDate && p.lastDate < cutoffStr)
    .sort((a, b) => a.lastDate.localeCompare(b.lastDate)); // oldest first

  const label = reportType === 'purchase' ? 'Suppliers' : 'Customers';
  if (inactive.length === 0) {
    return { success: true, message: `All ${label.toLowerCase()} have been active in the last ${days} days. 👍`, data: { entries: [], inactiveDays: days } };
  }

  const lines = [`😴 *Inactive ${label}* (no activity in ${days}+ days)`, ''];
  inactive.forEach((p, i) => {
    const daysAgo = Math.floor((today.getTime() - new Date(
      parseInt(p.lastDate.slice(0, 4)),
      parseInt(p.lastDate.slice(4, 6)) - 1,
      parseInt(p.lastDate.slice(6, 8))
    ).getTime()) / 86400000);
    lines.push(`${i + 1}. ${p.name}`);
    lines.push(`   Last: ${formatTallyDate(p.lastDate)} (${daysAgo}d ago) | ₹${inr(p.totalAmount)} total`);
  });
  lines.push('', SEP);
  lines.push(`*${inactive.length} inactive ${label.toLowerCase()}* out of ${Object.keys(partyMap).length} total`);

  return { success: true, message: lines.join('\n'), data: { entries: inactive, inactiveDays: days, totalParties: Object.keys(partyMap).length } };
}

/**
 * Parse voucher XML and find inactive stock items.
 */
function parseInactiveItemsResponse(xmlString, reportType, inactiveDays) {
  const days = inactiveDays || 30;
  const itemMap = {};
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;

  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const dateMatch = block.match(/<DATE[^>]*>(\d{8})<\/DATE>/i);
    if (!dateMatch) continue;
    const date = dateMatch[1];

    const invRegex = /<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/gi;
    let inv;
    while ((inv = invRegex.exec(block)) !== null) {
      const invBlock = inv[0];
      const nameMatch = invBlock.match(/<STOCKITEMNAME[^>]*>([^<]*)<\/STOCKITEMNAME>/i);
      const amtMatch = invBlock.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/i);
      if (!nameMatch || !nameMatch[1].trim()) continue;
      const name = decodeXml(nameMatch[1].trim());
      const amount = Math.abs(parseFloat(amtMatch?.[1]) || 0);

      if (!itemMap[name]) itemMap[name] = { name, lastDate: '', totalAmount: 0, txnCount: 0 };
      if (date > itemMap[name].lastDate) itemMap[name].lastDate = date;
      itemMap[name].totalAmount += amount;
      itemMap[name].txnCount++;
    }
  }

  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = `${cutoffDate.getFullYear()}${String(cutoffDate.getMonth() + 1).padStart(2, '0')}${String(cutoffDate.getDate()).padStart(2, '0')}`;

  const inactive = Object.values(itemMap)
    .filter(p => p.lastDate && p.lastDate < cutoffStr)
    .sort((a, b) => a.lastDate.localeCompare(b.lastDate));

  const label = reportType === 'purchase' ? 'purchased' : 'sold';
  if (inactive.length === 0) {
    return { success: true, message: `All items have been ${label} in the last ${days} days. 👍`, data: { entries: [], inactiveDays: days } };
  }

  const lines = [`😴 *Inactive Items* (not ${label} in ${days}+ days)`, ''];
  inactive.forEach((p, i) => {
    const daysAgo = Math.floor((today.getTime() - new Date(
      parseInt(p.lastDate.slice(0, 4)),
      parseInt(p.lastDate.slice(4, 6)) - 1,
      parseInt(p.lastDate.slice(6, 8))
    ).getTime()) / 86400000);
    lines.push(`${i + 1}. ${p.name}`);
    lines.push(`   Last: ${formatTallyDate(p.lastDate)} (${daysAgo}d ago) | ₹${inr(p.totalAmount)} total`);
  });
  lines.push('', SEP);
  lines.push(`*${inactive.length} inactive items* out of ${Object.keys(itemMap).length} total`);

  return { success: true, message: lines.join('\n'), data: { entries: inactive, inactiveDays: days, totalItems: Object.keys(itemMap).length } };
}

module.exports = {
  buildInactiveReportTdlXml,
  parseInactivePartiesResponse,
  parseInactiveItemsResponse,
};
