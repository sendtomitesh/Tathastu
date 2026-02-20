const { escapeXml, decodeXml, toTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

/**
 * Build TDL XML to fetch all vouchers for top customer/supplier/item analysis.
 * We fetch vouchers and aggregate in JS for flexibility.
 */
function buildTopReportTdlXml(companyName, reportType, dateFrom, dateTo) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  // Do NOT set SVFROMDATE/SVTODATE — voucher collections don't respect them reliably.
  // Date filtering is done JS-side in the parser.

  // For top customers/suppliers: fetch vouchers with party + amount
  // For top items: fetch inventory entries
  const vchType = reportType === 'purchase' ? 'Purchase' : 'Sales';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TopReportVouchers</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="TopReportVouchers" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, PartyLedgerName, Amount</FETCH>
          <FETCH>AllInventoryEntries.StockItemName, AllInventoryEntries.Amount, AllInventoryEntries.BilledQty</FETCH>
          <FILTER>TopReportTypeFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="TopReportTypeFilter">$VoucherTypeName = "${vchType}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse voucher XML and aggregate into top customers/suppliers.
 */
function parseTopPartiesResponse(xmlString, reportType, limit, dateFrom, dateTo) {
  const partyMap = {};
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const dateMatch = block.match(/<DATE[^>]*>(\d{8})<\/DATE>/i);
    const date = dateMatch ? dateMatch[1] : '';
    // JS-side date filtering
    if (dateFrom && date < dateFrom) continue;
    if (dateTo && date > dateTo) continue;

    const partyMatch = block.match(/<PARTYLEDGERNAME[^>]*>([^<]*)<\/PARTYLEDGERNAME>/i);
    const amtMatch = block.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/i);
    if (!partyMatch) continue;
    const party = decodeXml(partyMatch[1].trim());
    const amount = Math.abs(parseFloat(amtMatch?.[1]) || 0);
    if (!party || amount === 0) continue;

    if (!partyMap[party]) partyMap[party] = { name: party, total: 0, count: 0 };
    partyMap[party].total += amount;
    partyMap[party].count++;
  }

  const entries = Object.values(partyMap);
  entries.sort((a, b) => b.total - a.total);
  const top = entries.slice(0, limit || 10);

  if (top.length === 0) {
    const label = reportType === 'purchase' ? 'suppliers' : 'customers';
    return { success: true, message: `No ${label} found for this period.`, data: { entries: [], grandTotal: 0 } };
  }

  const label = reportType === 'purchase' ? 'Suppliers (by Purchase)' : 'Customers (by Sales)';
  const emoji = reportType === 'purchase' ? '🟠' : '🟢';
  const grandTotal = entries.reduce((s, e) => s + e.total, 0);

  const lines = [`🏆 *Top ${top.length} ${label}*`, ''];
  top.forEach((e, i) => {
    const pct = grandTotal > 0 ? ((e.total / grandTotal) * 100).toFixed(1) : '0.0';
    lines.push(`${i + 1}. ${emoji} ${e.name}`);
    lines.push(`   ₹${inr(e.total)} (${e.count} txns, ${pct}%)`);
  });
  lines.push('', SEP);
  lines.push(`*Grand Total: ₹${inr(grandTotal)}* (${entries.length} parties)`);

  return { success: true, message: lines.join('\n'), data: { entries: top, grandTotal, totalParties: entries.length } };
}

/**
 * Parse voucher XML and aggregate into top stock items.
 */
function parseTopItemsResponse(xmlString, reportType, limit, dateFrom, dateTo) {
  const itemMap = {};
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const dateMatch = block.match(/<DATE[^>]*>(\d{8})<\/DATE>/i);
    const date = dateMatch ? dateMatch[1] : '';
    if (dateFrom && date < dateFrom) continue;
    if (dateTo && date > dateTo) continue;

    // Extract inventory entries
    const invRegex = /<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/gi;
    let inv;
    while ((inv = invRegex.exec(block)) !== null) {
      const invBlock = inv[0];
      const nameMatch = invBlock.match(/<STOCKITEMNAME[^>]*>([^<]*)<\/STOCKITEMNAME>/i);
      const amtMatch = invBlock.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/i);
      const qtyMatch = invBlock.match(/<BILLEDQTY[^>]*>([^<]*)<\/BILLEDQTY>/i);
      if (!nameMatch || !nameMatch[1].trim()) continue;
      const name = decodeXml(nameMatch[1].trim());
      const amount = Math.abs(parseFloat(amtMatch?.[1]) || 0);
      const qty = Math.abs(parseFloat(qtyMatch?.[1]) || 0);
      if (amount === 0) continue;

      if (!itemMap[name]) itemMap[name] = { name, total: 0, qty: 0, count: 0 };
      itemMap[name].total += amount;
      itemMap[name].qty += qty;
      itemMap[name].count++;
    }
  }

  const entries = Object.values(itemMap);
  entries.sort((a, b) => b.total - a.total);
  const top = entries.slice(0, limit || 10);

  if (top.length === 0) {
    const label = reportType === 'purchase' ? 'purchased' : 'sold';
    return { success: true, message: `No items ${label} in this period.`, data: { entries: [], grandTotal: 0 } };
  }

  const label = reportType === 'purchase' ? 'Purchased Items' : 'Sold Items';
  const emoji = reportType === 'purchase' ? '🟠' : '🟢';
  const grandTotal = entries.reduce((s, e) => s + e.total, 0);

  const lines = [`🏆 *Top ${top.length} ${label}*`, ''];
  top.forEach((e, i) => {
    const pct = grandTotal > 0 ? ((e.total / grandTotal) * 100).toFixed(1) : '0.0';
    const qtyStr = e.qty > 0 ? ` | Qty: ${e.qty}` : '';
    lines.push(`${i + 1}. ${emoji} ${e.name}`);
    lines.push(`   ₹${inr(e.total)} (${e.count} txns, ${pct}%${qtyStr})`);
  });
  lines.push('', SEP);
  lines.push(`*Grand Total: ₹${inr(grandTotal)}* (${entries.length} items)`);

  return { success: true, message: lines.join('\n'), data: { entries: top, grandTotal, totalItems: entries.length } };
}

module.exports = {
  buildTopReportTdlXml,
  parseTopPartiesResponse,
  parseTopItemsResponse,
};
