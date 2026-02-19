/**
 * Test TDL-based ledger query for "Atul Singh" - memory-efficient approach.
 * Run: node scripts/test-tally-tdl-atul.js
 */
const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, '..', 'config', 'skills.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tallySkill = (raw.skills || []).find((s) => s.id === 'tally');
const port = tallySkill?.config?.port || 9000;
const baseUrl = `http://localhost:${port}`;

const {
  buildLedgerMasterTdlXml,
  postTally,
  parseLedgerMasterTdlResponse,
} = require('../src/skills/tally/tdl-client');

async function main() {
  const ledgerName = 'Atul Singh';
  console.log('TDL-based ledger query test on port', port);
  console.log('Request: LedgerMasterInfo TDL script for "%s"\n', ledgerName);
  
  await new Promise((r) => setTimeout(r, 1000));
  
  try {
    const xml = buildLedgerMasterTdlXml(ledgerName, null);
    console.log('XML request (first 800 chars):');
    console.log(xml.substring(0, 800) + '...\n');
    
    const response = await postTally(baseUrl, xml);
    console.log('Response received! Length:', response.length);
    console.log('Response (first 1000 chars):');
    console.log(response.substring(0, 1000) + '...\n');
    
    const parsed = parseLedgerMasterTdlResponse(response);
    if (parsed.success) {
      console.log('Success!');
      console.log('Summary:', parsed.summary);
      console.log('Data:', parsed.data);
    } else {
      console.log('Failed:', parsed.message);
    }
  } catch (err) {
    console.error('Error:', err.code || err.message);
    if (err.response) {
      console.error('Response status:', err.response.status);
      console.error('Response data (first 500 chars):', String(err.response.data || '').substring(0, 500));
    }
  }
}

main();
