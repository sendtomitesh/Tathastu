/**
 * Test: fetch receivable/payable (closing balance) for a party.
 * Uses FETCH with ClosingBalance on a single filtered ledger.
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
    <ID>LedgerBalanceInfo</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LedgerBalanceInfo" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FETCH>Name, Parent, ClosingBalance, OpeningBalance</FETCH>
            <FILTER>LedgerBalFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="LedgerBalFilter">$Name = "${partyName}"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

(async () => {
  console.log(`Fetching balance for "${partyName}"...\n`);
  try {
    const { data } = await axios.post(`http://localhost:${port}`, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 30000,
    });
    const resp = typeof data === 'string' ? data : String(data);
    const dataMatch = resp.match(/<DATA>[\s\S]*<\/DATA>/i);
    console.log(dataMatch ? dataMatch[0] : resp.substring(0, 2000));
  } catch (err) {
    console.log('Error:', err.code || err.message);
  }
})();
