const { escapeXml } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildOutstandingTdlXml(groupName, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OutstandingLedgers</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="OutstandingLedgers" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <CHILDOF>${escapeXml(groupName)}</CHILDOF>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
          <FILTER>NonZeroBalFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="NonZeroBalFilter">$ClosingBalance != 0</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseOutstandingTdlResponse(xmlString, groupName) {
  const { decodeXml } = require('./helpers');
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
    return { success: true, message: `No outstanding balances in *${groupName}*.`, data: { group: groupName, entries: [], total: 0 } };
  }

  entries.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance));
  const total = entries.reduce((sum, e) => sum + e.closingBalance, 0);
  const isPayable = groupName.toLowerCase().includes('creditor');
  const label = isPayable ? 'Payable' : 'Receivable';

  const lines = [
    `📊 *${groupName} — ${label}*`,
    '',
  ];

  entries.forEach((e, i) => {
    lines.push(`${i + 1}. ${e.name} — ₹${inr(e.closingBalance)}`);
  });

  lines.push('', SEP);
  lines.push(`*Total: ₹${inr(total)}* (${entries.length} parties)`);

  return { success: true, message: lines.join('\n'), data: { group: groupName, entries, total, count: entries.length } };
}

module.exports = { buildOutstandingTdlXml, parseOutstandingTdlResponse };
