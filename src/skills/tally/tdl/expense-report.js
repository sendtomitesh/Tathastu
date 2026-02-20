const { escapeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildExpenseReportTdlXml(companyName, dateFrom, dateTo) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  // Only set SVFROMDATE/SVTODATE when user provides explicit dates.
  // When omitted, Tally uses the company's own FY range which is always correct.
  if (dateFrom || dateTo) {
    const actualFrom = dateFrom || dateTo;
    const actualTo = dateTo || dateFrom;
    svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
    svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);
  }

  // Use CHILDOF union — avoids complex $$GroupOf/UNDER formulas that fail in TallyPrime
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ExpenseLedgers</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="ExpenseLedgers" ISMODIFY="No">
          <COLLECTION>IndirectExpLedgers, DirectExpLedgers</COLLECTION>
        </COLLECTION>
        <COLLECTION NAME="IndirectExpLedgers" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <CHILDOF>Indirect Expenses</CHILDOF>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
        </COLLECTION>
        <COLLECTION NAME="DirectExpLedgers" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <CHILDOF>Direct Expenses</CHILDOF>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}


function parseExpenseReportTdlResponse(xmlString, dateFrom, dateTo) {
  const { decodeXml } = require('./helpers');
  const entries = [];
  const regex = /<LEDGER\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/LEDGER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = decodeXml(m[1].trim());
    const parentMatch = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/i);
    const parent = parentMatch ? parentMatch[1].trim() : '';
    const balMatch = block.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/i);
    const closing = balMatch ? parseFloat(balMatch[1].trim()) || 0 : 0;
    if (closing > 0) entries.push({ name, parent, amount: closing });
  }

  if (entries.length === 0) {
    return { success: true, message: 'No expenses found for this period.', data: { entries: [], total: 0 } };
  }

  entries.sort((a, b) => b.amount - a.amount);
  const total = entries.reduce((s, e) => s + e.amount, 0);

  const fromStr = dateFrom ? formatTallyDate(dateFrom) : '';
  const toStr = dateTo ? formatTallyDate(dateTo) : '';
  const dateRange = fromStr && toStr ? `${fromStr} to ${toStr}` : 'Current month';

  const lines = [
    `💸 *Expense Report: ${dateRange}*`,
    `${entries.length} heads | Total: ₹${inr(total)}`,
    '',
  ];

  entries.forEach((e, i) => {
    lines.push(`${i + 1}. ${e.name} — ₹${inr(e.amount)}`);
    if (e.parent) lines.push(`   _${e.parent}_`);
  });

  lines.push('', SEP);
  lines.push(`*Total Expenses: ₹${inr(total)}*`);

  return { success: true, message: lines.join('\n'), data: { entries, total } };
}

module.exports = { buildExpenseReportTdlXml, parseExpenseReportTdlResponse };
