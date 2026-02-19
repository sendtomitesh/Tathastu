/**
 * List all ledger names from Tally to find exact party name.
 * Usage: node scripts/test-tally-list.js [optional-search-term]
 */
require('dotenv').config();
const axios = require('axios');

const searchTerm = (process.argv[2] || 'atul').toLowerCase();
const port = 9000;
const companyName = 'Mobibox softech pvt. ltd.';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllLedgerNames</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllLedgerNames" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

(async () => {
  console.log(`\n--- Listing ledgers, filtering for "${searchTerm}" ---\n`);
  try {
    const { data } = await axios.post(`http://localhost:${port}`, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 15000,
    });
    const resp = typeof data === 'string' ? data : String(data);

    // Extract all ledger names
    const names = [];
    const regex = /<LEDGER\b[^>]*NAME="([^"]*)"[^>]*>/gi;
    let m;
    while ((m = regex.exec(resp)) !== null) {
      names.push(m[1]);
    }

    // Also try <NAME> inside <LEDGER> blocks
    const regex2 = /<LEDGER[^>]*>[\s\S]*?<NAME[^>]*>([^<]*)<\/NAME>/gi;
    while ((m = regex2.exec(resp)) !== null) {
      if (!names.includes(m[1].trim())) names.push(m[1].trim());
    }

    console.log(`Total ledgers found: ${names.length}`);
    const matches = names.filter(n => n.toLowerCase().includes(searchTerm));
    if (matches.length) {
      console.log(`\nMatches for "${searchTerm}":`);
      matches.forEach(n => console.log(`  - "${n}"`));
    } else {
      console.log(`\nNo matches for "${searchTerm}". Showing first 30 ledgers:`);
      names.slice(0, 30).forEach(n => console.log(`  - "${n}"`));
    }

    // Also dump a small portion of raw XML for debugging if no names found
    if (names.length === 0) {
      console.log('\nRaw response (first 2000 chars):\n', resp.substring(0, 2000));
    }
  } catch (err) {
    console.log('Error:', err.code || err.message);
  }
  console.log('\n--- Done ---');
})();
