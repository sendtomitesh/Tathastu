const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildBillOutstandingTdlXml(ledgerName, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BillList</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="BillList" ISMODIFY="No">
          <TYPE>Bill</TYPE>
          <CHILDOF>${escapeXml(ledgerName)}</CHILDOF>
          <FETCH>Name, Parent, ClosingBalance, FinalDueDate</FETCH>
          <FILTER>PendingBillFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="PendingBillFilter">$ClosingBalance != 0</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseBillOutstandingTdlResponse(xmlString, ledgerName) {
  const bills = [];
  const regex = /<BILL\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/BILL>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = decodeXml(m[1].trim());
    const extract = (tag) => {
      const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return mx ? mx[1].trim() : null;
    };
    const closing = parseFloat(extract('CLOSINGBALANCE') || '0') || 0;
    const dueDate = extract('FINALDUEDATE') || '';
    if (closing !== 0) bills.push({ name, closingBalance: closing, dueDate });
  }

  if (bills.length === 0) {
    return { success: true, message: `No pending bills for *${ledgerName}*.`, data: { ledgerName, bills: [], total: 0 } };
  }

  bills.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance));
  const total = bills.reduce((s, b) => s + b.closingBalance, 0);
  const isPayable = total < 0;
  const label = isPayable ? 'Payable' : 'Receivable';

  const today = new Date();
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  const lines = [
    `📄 *Pending Bills: ${ledgerName}*`,
    `${bills.length} bills | ${label}`,
    '',
  ];

  bills.forEach((b, i) => {
    const overdue = b.dueDate && b.dueDate < todayStr ? ' ⚠️ _overdue_' : '';
    const dueDateStr = b.dueDate ? ` | Due: ${formatTallyDate(b.dueDate)}` : '';
    lines.push(`${i + 1}. ${b.name}`);
    lines.push(`   ₹${inr(b.closingBalance)}${dueDateStr}${overdue}`);
  });

  lines.push('', SEP);
  lines.push(`*Total: ₹${inr(total)} ${label}*`);

  return { success: true, message: lines.join('\n'), data: { ledgerName, bills, total } };
}

module.exports = { buildBillOutstandingTdlXml, parseBillOutstandingTdlResponse };
