const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

/**
 * Build TDL XML to fetch voucher type counts (how many vouchers of each type exist).
 */
function buildVoucherTypeCountsTdlXml(companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VchTypeCounts</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="VchTypeCounts" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>VoucherTypeName</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse voucher type counts from XML response.
 * Returns array of { name, count } sorted by count desc.
 */
function parseVoucherTypeCountsResponse(xmlString) {
  const counts = {};
  const regex = /<VOUCHERTYPENAME[^>]*>([^<]*)<\/VOUCHERTYPENAME>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const name = decodeXml(m[1].trim());
    if (name) counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Build TDL XML to fetch vouchers of a specific type (any voucher type name).
 */
function buildOrderTrackingTdlXml(companyName, orderType, dateFrom, dateTo) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  // Do NOT set SVFROMDATE/SVTODATE — voucher collections don't respect them reliably.
  // Date filtering is done JS-side in the parser.

  // Accept any voucher type name — not just "Sales Order"/"Purchase Order"
  let vchType;
  if (typeof orderType === 'string' && !['sales', 'purchase'].includes(orderType.toLowerCase())) {
    // Custom voucher type name passed directly
    vchType = orderType;
  } else {
    vchType = orderType === 'purchase' ? 'Purchase Order' : 'Sales Order';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OrderTrackingVouchers</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="OrderTrackingVouchers" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Amount, Narration</FETCH>
          <FETCH>AllInventoryEntries.StockItemName, AllInventoryEntries.Rate, AllInventoryEntries.Amount, AllInventoryEntries.BilledQty</FETCH>
          <FILTER>OrderTypeFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="OrderTypeFilter">$VoucherTypeName = "${vchType}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Build TDL XML to fetch fulfilled invoices (Sales/Purchase) for matching against orders.
 */
function buildOrderFulfillmentTdlXml(companyName, orderType, dateFrom, dateTo) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  // Do NOT set SVFROMDATE/SVTODATE — voucher collections don't respect them reliably.
  // Date filtering is done JS-side in the parser.

  const vchType = orderType === 'purchase' ? 'Purchase' : 'Sales';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OrderFulfillmentVouchers</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="OrderFulfillmentVouchers" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Amount</FETCH>
          <FILTER>FulfillmentTypeFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="FulfillmentTypeFilter">$VoucherTypeName = "${vchType}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse order vouchers XML.
 */
function parseOrderTrackingResponse(xmlString, orderType, dateFrom, dateTo) {
  const orders = [];
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;

  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const extract = (tag) => {
      const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return mx ? decodeXml(mx[1].trim()) : null;
    };

    const date = extract('DATE') || '';
    if (dateFrom && date < dateFrom) continue;
    if (dateTo && date > dateTo) continue;

    // Extract inventory entries
    const items = [];
    const invRegex = /<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/gi;
    let inv;
    while ((inv = invRegex.exec(block)) !== null) {
      const invBlock = inv[0];
      const itemName = invBlock.match(/<STOCKITEMNAME[^>]*>([^<]*)<\/STOCKITEMNAME>/i);
      const itemAmt = invBlock.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/i);
      const itemRate = invBlock.match(/<RATE[^>]*>([^<]*)<\/RATE>/i);
      const itemQty = invBlock.match(/<BILLEDQTY[^>]*>([^<]*)<\/BILLEDQTY>/i);
      if (itemName && itemName[1].trim()) {
        items.push({
          name: decodeXml(itemName[1].trim()),
          amount: Math.abs(parseFloat(itemAmt?.[1]) || 0),
          rate: parseFloat(itemRate?.[1]) || 0,
          qty: Math.abs(parseFloat(itemQty?.[1]) || 0),
        });
      }
    }

    orders.push({
      date,
      number: extract('VOUCHERNUMBER') || '',
      party: extract('PARTYLEDGERNAME') || '',
      amount: parseFloat(extract('AMOUNT')) || 0,
      narration: extract('NARRATION') || '',
      items,
    });
  }

  const label = orderType === 'purchase' ? 'Purchase Orders'
    : orderType === 'sales' ? 'Sales Orders'
    : orderType; // custom voucher type name
  if (orders.length === 0) {
    return { success: true, message: `No ${label.toLowerCase()} found for this period.`, data: { orders: [], total: 0 } };
  }

  orders.sort((a, b) => b.date.localeCompare(a.date)); // newest first
  const total = orders.reduce((s, o) => s + Math.abs(o.amount), 0);

  // Group by party
  const byParty = {};
  for (const o of orders) {
    const p = o.party || 'Unknown';
    if (!byParty[p]) byParty[p] = { count: 0, total: 0 };
    byParty[p].count++;
    byParty[p].total += Math.abs(o.amount);
  }

  const lines = [`📋 *${label}* (${orders.length} orders)`, ''];

  // Show recent orders (max 15)
  const shown = orders.slice(0, 15);
  shown.forEach((o, i) => {
    const dateStr = o.date ? formatTallyDate(o.date) : '';
    let line = `${i + 1}. *#${o.number}* — ${dateStr} — ${o.party}`;
    line += `\n   ₹${inr(Math.abs(o.amount))}`;
    if (o.items.length > 0) {
      const itemStr = o.items.map(it => `${it.name} x${it.qty}`).join(', ');
      line += ` | ${itemStr}`;
    }
    lines.push(line);
  });

  if (orders.length > 15) {
    lines.push(`\n... and ${orders.length - 15} more orders`);
  }

  lines.push('', SEP);
  lines.push(`*Total: ₹${inr(total)}* | ${Object.keys(byParty).length} parties`);

  return { success: true, message: lines.join('\n'), data: { orders, total, byParty } };
}

/**
 * Compute pending orders by comparing orders vs invoices per party.
 * Simple approach: total order amount per party - total invoice amount per party.
 */
function computePendingOrders(ordersData, invoicesXml, orderType, dateFrom, dateTo) {
  if (!ordersData.orders || ordersData.orders.length === 0) {
    const label = orderType === 'purchase' ? 'purchase orders'
      : orderType === 'sales' ? 'sales orders'
      : orderType.toLowerCase();
    return { success: true, message: `No pending ${label}.`, data: { pending: [], totalPending: 0 } };
  }

  // Parse invoices
  const invoiceByParty = {};
  const regex = /<VOUCHER\s[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;
  while ((m = regex.exec(invoicesXml)) !== null) {
    const block = m[0];
    const dateMatch = block.match(/<DATE[^>]*>(\d{8})<\/DATE>/i);
    const date = dateMatch ? dateMatch[1] : '';
    if (dateFrom && date < dateFrom) continue;
    if (dateTo && date > dateTo) continue;
    const partyMatch = block.match(/<PARTYLEDGERNAME[^>]*>([^<]*)<\/PARTYLEDGERNAME>/i);
    const amtMatch = block.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/i);
    if (!partyMatch) continue;
    const party = decodeXml(partyMatch[1].trim());
    const amount = Math.abs(parseFloat(amtMatch?.[1]) || 0);
    if (!invoiceByParty[party]) invoiceByParty[party] = 0;
    invoiceByParty[party] += amount;
  }

  // Compare
  const pending = [];
  for (const [party, info] of Object.entries(ordersData.byParty)) {
    const ordered = info.total;
    const invoiced = invoiceByParty[party] || 0;
    const pendingAmt = ordered - invoiced;
    if (pendingAmt > 1) { // threshold to avoid floating point noise
      pending.push({ party, ordered, invoiced, pending: pendingAmt, orderCount: info.count });
    }
  }

  pending.sort((a, b) => b.pending - a.pending);
  const totalPending = pending.reduce((s, p) => s + p.pending, 0);

  const label = orderType === 'purchase' ? 'Purchase'
    : orderType === 'sales' ? 'Sales'
    : orderType;
  if (pending.length === 0) {
    return { success: true, message: `All ${label.toLowerCase()} orders are fully fulfilled. ✅`, data: { pending: [], totalPending: 0 } };
  }

  const lines = [`📦 *Pending ${label} Orders*`, ''];
  pending.forEach((p, i) => {
    const pct = p.ordered > 0 ? ((p.invoiced / p.ordered) * 100).toFixed(0) : '0';
    lines.push(`${i + 1}. ${p.party}`);
    lines.push(`   Ordered: ₹${inr(p.ordered)} | Invoiced: ₹${inr(p.invoiced)} | *Pending: ₹${inr(p.pending)}* (${pct}% done)`);
  });
  lines.push('', SEP);
  lines.push(`*Total Pending: ₹${inr(totalPending)}* (${pending.length} parties)`);

  return { success: true, message: lines.join('\n'), data: { pending, totalPending } };
}

module.exports = {
  buildVoucherTypeCountsTdlXml,
  parseVoucherTypeCountsResponse,
  buildOrderTrackingTdlXml,
  buildOrderFulfillmentTdlXml,
  parseOrderTrackingResponse,
  computePendingOrders,
};
