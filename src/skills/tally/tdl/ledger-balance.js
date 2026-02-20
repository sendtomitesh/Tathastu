const { escapeXml } = require('./helpers');

function buildLedgerBalanceTdlXml(ledgerName, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerBalanceInfo</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="LedgerBalanceInfo" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <FETCH>Name, Parent, ClosingBalance, OpeningBalance</FETCH>
          <FILTER>LedgerBalFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="LedgerBalFilter">$Name = "${escapeXml(ledgerName)}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseLedgerBalanceTdlResponse(xmlString) {
  const ledgerMatch = xmlString.match(/<LEDGER\s+NAME="[^"]*"[^>]*>[\s\S]*?<\/LEDGER>/i);
  if (!ledgerMatch) {
    const errMatch = xmlString.match(/<LINEERROR>([^<]*)<\/LINEERROR>/);
    if (errMatch) return { success: false, message: errMatch[1].trim() };
    return { success: false, message: 'Ledger not found in Tally.' };
  }

  const block = ledgerMatch[0];
  const extract = (tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  };

  const nameAttr = block.match(/<LEDGER\b[^>]*\bNAME="([^"]*)"[^>]*>/i);
  const name = nameAttr ? nameAttr[1].trim() : extract('NAME') || 'Unknown';
  const parent = extract('PARENT') || null;
  const closing = parseFloat(extract('CLOSINGBALANCE') || '0') || 0;
  const opening = parseFloat(extract('OPENINGBALANCE') || '0') || 0;

  const isPayable = closing < 0;
  const absClosing = Math.abs(closing).toFixed(2);
  const balanceType = isPayable ? 'Payable' : 'Receivable';

  let message = `${name} (${parent || 'N/A'}): ₹${absClosing} ${balanceType}`;
  if (opening !== 0) message += `. Opening: ₹${Math.abs(opening).toFixed(2)}`;

  return { success: true, message, data: { name, parent, closingBalance: closing, openingBalance: opening, balanceType } };
}

module.exports = { buildLedgerBalanceTdlXml, parseLedgerBalanceTdlResponse };
