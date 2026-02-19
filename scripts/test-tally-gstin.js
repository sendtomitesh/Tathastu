/**
 * Test: fetch GSTIN using ultra-light TDL Collection (no balance fields).
 * Usage: node scripts/test-tally-gstin.js "Atul singh"
 */
require('dotenv').config();
const { buildLedgerMasterTdlXml, postTally, parseLedgerMasterTdlResponse } = require('../src/skills/tally/tdl-client');

const partyName = process.argv[2] || 'Atul singh';
const port = 9000;
const companyName = 'SendMe Technologies Pvt Ltd';
const baseUrl = `http://localhost:${port}`;

(async () => {
  console.log(`\n--- Fetching GSTIN for "${partyName}" from "${companyName}" ---\n`);

  const xml = buildLedgerMasterTdlXml(partyName, companyName);
  console.log('Request XML:\n', xml, '\n');

  try {
    const responseXml = await postTally(baseUrl, xml);
    console.log('Raw response (first 2000 chars):\n', responseXml.substring(0, 2000), '\n');

    const parsed = parseLedgerMasterTdlResponse(responseXml);
    console.log('Result:', JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.log('Error:', err.code || err.message);
    if (err.code === 'ECONNREFUSED') {
      console.log('>> Tally is not running. Please restart TallyPrime.');
    }
  }

  console.log('\n--- Done ---');
})();
