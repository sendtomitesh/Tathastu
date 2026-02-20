const { escapeXml } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildCashBankBalanceTdlXml(companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  // Use separate CHILDOF collections for each group, then union them.
  // This avoids complex $$GroupOf/UNDER/OR formulas that cause TDL syntax errors.
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CashBankList</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="CashBankList" ISMODIFY="No">
          <COLLECTION>BankLedgers, CashLedgers, BankODLedgers</COLLECTION>
        </COLLECTION>
        <COLLECTION NAME="BankLedgers" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <CHILDOF>Bank Accounts</CHILDOF>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
        </COLLECTION>
        <COLLECTION NAME="CashLedgers" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <CHILDOF>Cash-in-Hand</CHILDOF>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
        </COLLECTION>
        <COLLECTION NAME="BankODLedgers" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <CHILDOF>Bank OD A/c</CHILDOF>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseCashBankBalanceTdlResponse(xmlString) {
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
    // Only include cash/bank groups
    const p = parent.toLowerCase();
    if (p.includes('bank') || p.includes('cash') || p === 'bank od a/c') {
      entries.push({ name, parent, closingBalance: closing });
    }
  }

  if (entries.length === 0) {
    return { success: true, message: 'No cash or bank accounts found.', data: { entries: [], total: 0 } };
  }

  entries.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance));
  const total = entries.reduce((sum, e) => sum + e.closingBalance, 0);

  const lines = [`🏦 *Cash & Bank Balances*`, ''];
  entries.forEach((e, i) => {
    const emoji = e.parent.toLowerCase().includes('cash') ? '💵' : '🏦';
    // Tally: negative = credit = money available in bank
    const abs = inr(e.closingBalance);
    const label = e.closingBalance < 0 ? '' : ' (OD)';
    lines.push(`${emoji} ${e.name}: ₹${abs}${label}`);
  });

  lines.push('', SEP);
  lines.push(`*Total: ₹${inr(total)}*`);

  return { success: true, message: lines.join('\n'), data: { entries, total } };
}

module.exports = { buildCashBankBalanceTdlXml, parseCashBankBalanceTdlResponse };
