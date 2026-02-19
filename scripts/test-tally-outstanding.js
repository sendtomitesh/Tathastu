/**
 * Test: fetch outstanding balances for a group (Sundry Debtors / Sundry Creditors).
 * Usage: node scripts/test-tally-outstanding.js "Sundry Creditors"
 */
const axios = require('axios');

const group = process.argv[2] || 'Sundry Creditors';
const port = 9000;
const companyName = 'SendMe Technologies Pvt Ltd';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>OutstandingLedgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="OutstandingLedgers" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <CHILDOF>${group}</CHILDOF>
            <FETCH>Name, Parent, ClosingBalance</FETCH>
            <FILTER>NonZeroBalance</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="NonZeroBalance">$ClosingBalance != 0</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

(async () => {
  console.log(`Fetching outstanding for "${group}"...\n`);
  try {
    const { data } = await axios.post(`http://localhost:${port}`, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 30000,
    });
    const resp = typeof data === 'string' ? data : String(data);
    const dataMatch = resp.match(/<DATA>[\s\S]*<\/DATA>/i);
    console.log(dataMatch ? dataMatch[0] : resp.substring(0, 3000));
  } catch (err) {
    console.log('Error:', err.code || err.message);
  }
})();
