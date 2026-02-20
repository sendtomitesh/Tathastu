const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildGstSummaryTdlXml(companyName, dateFrom, dateTo) {
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

  // Use CHILDOF — avoids complex $GroupOf/UNDER formulas that fail in TallyPrime
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>GSTLedgers</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="GSTLedgers" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <CHILDOF>Duties &amp; Taxes</CHILDOF>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseGstSummaryTdlResponse(xmlString, dateFrom, dateTo) {
  const entries = [];
  const regex = /<LEDGER\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/LEDGER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = decodeXml(m[1].trim());
    const balMatch = block.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/i);
    const closing = balMatch ? parseFloat(balMatch[1].trim()) || 0 : 0;
    if (closing !== 0) entries.push({ name, closingBalance: closing });
  }

  if (entries.length === 0) {
    return { success: true, message: 'No GST/tax entries found for this period.', data: { entries: [], netLiability: 0 } };
  }

  // Negative = tax collected (output), Positive = tax paid (input)
  const output = entries.filter(e => e.closingBalance < 0);
  const input = entries.filter(e => e.closingBalance > 0);
  const totalOutput = output.reduce((s, e) => s + Math.abs(e.closingBalance), 0);
  const totalInput = input.reduce((s, e) => s + e.closingBalance, 0);
  const netLiability = totalOutput - totalInput;

  const fromStr = dateFrom ? formatTallyDate(dateFrom) : '';
  const toStr = dateTo ? formatTallyDate(dateTo) : '';
  const dateRange = fromStr && toStr ? `${fromStr} to ${toStr}` : 'Current month';

  const lines = [`🧾 *GST Summary: ${dateRange}*`, ''];

  if (output.length) {
    lines.push('*Output Tax (Collected):*');
    for (const e of output) lines.push(`  🔴 ${e.name}: ₹${inr(e.closingBalance)}`);
    lines.push(`  *Total: ₹${inr(totalOutput)}*`, '');
  }

  if (input.length) {
    lines.push('*Input Tax (Paid):*');
    for (const e of input) lines.push(`  🟢 ${e.name}: ₹${inr(e.closingBalance)}`);
    lines.push(`  *Total: ₹${inr(totalInput)}*`, '');
  }

  lines.push(SEP);
  const label = netLiability >= 0 ? 'Net GST Payable' : 'Net GST Refundable';
  lines.push(`*${label}: ₹${inr(netLiability)}*`);

  return { success: true, message: lines.join('\n'), data: { entries, totalOutput, totalInput, netLiability } };
}

module.exports = { buildGstSummaryTdlXml, parseGstSummaryTdlResponse };
