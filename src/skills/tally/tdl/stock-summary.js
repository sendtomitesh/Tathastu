const { escapeXml, decodeXml } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildStockSummaryTdlXml(companyName, itemName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  const filter = itemName
    ? `<FILTER>StockNameFilter</FILTER>`
    : '';
  const filterDef = itemName
    ? `<SYSTEM TYPE="Formulae" NAME="StockNameFilter">$Name Contains "${escapeXml(itemName)}"</SYSTEM>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>StockList</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="StockList" ISMODIFY="No">
          <TYPE>StockItem</TYPE>
          <FETCH>Name, Parent, ClosingBalance, ClosingRate, ClosingValue</FETCH>
          ${filter}
        </COLLECTION>
        ${filterDef}
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseStockSummaryTdlResponse(xmlString) {
  const items = [];
  const regex = /<STOCKITEM\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/STOCKITEM>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = decodeXml(m[1].trim());
    const extract = (tag) => {
      const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return mx ? mx[1].trim() : null;
    };
    const parent = extract('PARENT') || '';
    const closingBal = extract('CLOSINGBALANCE') || '';
    const closingRate = extract('CLOSINGRATE') || '';
    const closingValue = parseFloat(extract('CLOSINGVALUE') || '0') || 0;

    // Parse quantity from closing balance (e.g. "100 Nos" or "50.5 Kg")
    const qtyMatch = closingBal.match(/([\d.]+)\s*(.*)/);
    const qty = qtyMatch ? parseFloat(qtyMatch[1]) || 0 : 0;
    const unit = qtyMatch ? qtyMatch[2].trim() : '';

    items.push({ name, parent, qty, unit, closingValue, closingRate });
  }

  if (items.length === 0) {
    return { success: true, message: 'No stock items found.', data: { items: [], totalValue: 0 } };
  }

  items.sort((a, b) => b.closingValue - a.closingValue);
  const totalValue = items.reduce((s, i) => s + i.closingValue, 0);

  const lines = [
    `📦 *Stock Summary* (${items.length} items)`,
    '',
  ];

  const display = items.slice(0, 30);
  display.forEach((item, i) => {
    const qtyStr = item.qty ? `${item.qty} ${item.unit}` : '';
    lines.push(`${i + 1}. *${item.name}*`);
    if (qtyStr) lines.push(`   Qty: ${qtyStr} | Value: ₹${inr(item.closingValue)}`);
    else lines.push(`   Value: ₹${inr(item.closingValue)}`);
  });

  if (items.length > 30) lines.push(`\n... and ${items.length - 30} more items`);

  lines.push('', SEP);
  lines.push(`*Total Stock Value: ₹${inr(totalValue)}*`);

  return { success: true, message: lines.join('\n'), data: { items, totalValue } };
}

module.exports = { buildStockSummaryTdlXml, parseStockSummaryTdlResponse };
