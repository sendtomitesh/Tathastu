/**
 * Fetch full ledger object (master only, no entries) to see where GSTIN lives.
 * Uses a Collection with FETCH * to get all fields.
 */
const axios = require('axios');

const partyName = process.argv[2] || 'Meril Life Sciences Pvt Ltd';
const port = 9000;
const companyName = 'SendMe Technologies Pvt Ltd';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LedgerFullDump</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LedgerFullDump" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FETCH>Name, Parent, GSTIN, PartyGSTIN, GSTRegistrationType, LedStateName, LEDGSTREGDETAILS.LIST, CountryOfResidence, LedgerPhone, LedgerContact</FETCH>
            <FILTER>LedgerFullDumpFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="LedgerFullDumpFilter">$Name = "${partyName}"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

(async () => {
  console.log(`Fetching full ledger for "${partyName}"...\n`);
  try {
    const { data } = await axios.post(`http://localhost:${port}`, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 20000,
    });
    const resp = typeof data === 'string' ? data : String(data);
    // Print just the DATA section
    const dataMatch = resp.match(/<DATA>[\s\S]*<\/DATA>/i);
    if (dataMatch) {
      console.log(dataMatch[0]);
    } else {
      console.log(resp.substring(0, 3000));
    }
  } catch (err) {
    console.log('Error:', err.code || err.message);
  }
})();
