/**
 * Debug: test the CONTAINS search directly
 */
const axios = require('axios');

const searchTerm = process.argv[2] || 'Meril';
const port = 9000;
const companyName = 'SendMe Technologies Pvt Ltd';

// Try different filter syntaxes
const filters = [
  { label: '$$StringContains', formula: `$$StringContains:$Name:"${searchTerm}"` },
  { label: '$Name CONTAINS', formula: `$Name Contains "${searchTerm}"` },
  { label: '$$InStr', formula: `$$InStr:$Name:"${searchTerm}" > 0` },
];

(async () => {
  for (const f of filters) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LedgerSearch</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LedgerSearch" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <FILTER>SearchFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="SearchFilter">${f.formula}</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

    console.log(`\n--- [${f.label}] "${f.formula}" ---`);
    try {
      const { data } = await axios.post(`http://localhost:${port}`, xml, {
        headers: { 'Content-Type': 'text/xml' },
        timeout: 15000,
      });
      const resp = typeof data === 'string' ? data : String(data);
      const dataMatch = resp.match(/<DATA>[\s\S]*<\/DATA>/i);
      console.log(dataMatch ? dataMatch[0].substring(0, 500) : 'No DATA section');
    } catch (err) {
      console.log('Error:', err.code || err.message);
    }
    // Wait between requests
    await new Promise(r => setTimeout(r, 2000));
  }
})();
