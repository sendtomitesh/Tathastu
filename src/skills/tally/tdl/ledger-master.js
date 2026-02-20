const { escapeXml } = require('./helpers');

function buildLedgerMasterTdlXml(ledgerName, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerGSTInfo</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="LedgerGSTInfo" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <FETCH>Name, Parent, LedStateName, CountryOfResidence, LEDGSTREGDETAILS.LIST</FETCH>
          <FILTER>LedgerGSTNameFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="LedgerGSTNameFilter">$Name = "${escapeXml(ledgerName)}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseLedgerMasterTdlResponse(xmlString) {
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
  const nameInner = block.match(/<NAME\.LIST[^>]*>\s*<NAME>([^<]*)<\/NAME>/i);
  const name = (nameAttr ? nameAttr[1].trim() : null) || (nameInner ? nameInner[1].trim() : null) || extract('NAME') || 'Unknown';
  const gstin = extract('GSTIN') || extract('PARTYGSTIN') || null;
  const parent = extract('PARENT') || null;
  const gstType = extract('GSTREGISTRATIONTYPE') || null;
  const state = extract('LEDSTATENAME') || null;

  let message;
  if (gstin) {
    message = `GSTIN for ${name}: ${gstin}`;
    if (gstType) message += ` (${gstType})`;
    if (state) message += `, State: ${state}`;
  } else {
    message = `No GSTIN found for ${name}.`;
    if (state) message += ` State: ${state}, Group: ${parent || 'N/A'}.`;
    message += ' The party may not have GSTIN set in Tally.';
  }

  return { success: true, message, data: { name, gstin, parent, gstType, state } };
}

module.exports = { buildLedgerMasterTdlXml, parseLedgerMasterTdlResponse };
