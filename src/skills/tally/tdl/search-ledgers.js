const { escapeXml } = require('./helpers');

function buildSearchLedgersTdlXml(searchTerm, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerSearch</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="LedgerSearch" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <NATIVEMETHOD>Name</NATIVEMETHOD>
          <NATIVEMETHOD>Parent</NATIVEMETHOD>
          <FILTER>LedgerSearchFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="LedgerSearchFilter">$Name Contains "${escapeXml(searchTerm)}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseSearchLedgersResponse(xmlString) {
  const results = [];
  const regex = /<LEDGER\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/LEDGER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = m[1].trim();
    const parentMatch = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/i);
    results.push({ name, parent: parentMatch ? parentMatch[1].trim() : null });
  }
  return { success: true, data: results };
}

module.exports = { buildSearchLedgersTdlXml, parseSearchLedgersResponse };
