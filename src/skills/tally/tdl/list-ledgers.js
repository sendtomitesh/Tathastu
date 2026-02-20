const { escapeXml, decodeXml } = require('./helpers');

function buildListLedgerNamesTdlXml(parentGroup, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  const childOf = parentGroup ? `<CHILDOF>${escapeXml(parentGroup)}</CHILDOF>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerNameList</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="LedgerNameList" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <NATIVEMETHOD>Name</NATIVEMETHOD>
          <NATIVEMETHOD>Parent</NATIVEMETHOD>
          ${childOf}
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseListLedgerNamesResponse(xmlString) {
  const names = [];
  const regex = /<LEDGER\b[^>]*>[\s\S]*?<NAME[^>]*>([^<]*)<\/NAME>[\s\S]*?<\/LEDGER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) names.push(m[1].trim());
  if (names.length === 0) {
    const regex2 = /<LEDGER\b[^>]*NAME="([^"]*)"[^>]*>/gi;
    while ((m = regex2.exec(xmlString)) !== null) names.push(m[1]);
  }
  return { success: true, data: names };
}

function buildListLedgersTdlXml(groupFilter, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  const childOf = groupFilter ? `<CHILDOF>${escapeXml(groupFilter)}</CHILDOF>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerList</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="LedgerList" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <NATIVEMETHOD>Name</NATIVEMETHOD>
          <NATIVEMETHOD>Parent</NATIVEMETHOD>
          ${childOf}
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseListLedgersTdlResponse(xmlString) {
  const ledgers = [];
  const regex = /<LEDGER\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/LEDGER>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = decodeXml(m[1].trim());
    const parentMatch = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/i);
    const parent = parentMatch ? parentMatch[1].trim() : null;
    ledgers.push({ name, parent });
  }

  if (ledgers.length === 0) return { success: true, message: 'No ledgers found.', data: [] };

  const lines = [`📒 *Ledgers* (${ledgers.length})`, ''];
  const display = ledgers.slice(0, 30);
  display.forEach((l, i) => {
    lines.push(`${i + 1}. ${l.name}${l.parent ? ' _(' + l.parent + ')_' : ''}`);
  });
  if (ledgers.length > 30) lines.push(`\n... and ${ledgers.length - 30} more`);

  return { success: true, message: lines.join('\n'), data: ledgers };
}

module.exports = { buildListLedgerNamesTdlXml, parseListLedgerNamesResponse, buildListLedgersTdlXml, parseListLedgersTdlResponse };
