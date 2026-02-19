/**
 * Simple test: try to connect to Tally without company name filter.
 */
const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, '..', 'config', 'skills.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tallySkill = (raw.skills || []).find((s) => s.id === 'tally');
const port = tallySkill?.config?.port || 9000;
const baseUrl = `http://localhost:${port}`;

const { buildLedgerXml, postTally, parseLedgerGstinResponse } = require('../src/skills/tally/client');

async function main() {
  console.log('Testing Tally connection on port', port);
  console.log('Trying ledger "Cash" WITHOUT company name filter...\n');
  
  await new Promise((r) => setTimeout(r, 2000)); // Wait 2s
  
  try {
    // Try without company name
    const xml = buildLedgerXml('Cash', null);
    console.log('Request XML (first 500 chars):');
    console.log(xml.substring(0, 500) + '...\n');
    
    const response = await postTally(baseUrl, xml);
    console.log('Response received! Length:', response.length);
    console.log('Response (first 1000 chars):');
    console.log(response.substring(0, 1000) + '...\n');
    
    const parsed = parseLedgerGstinResponse(response);
    console.log('Parsed result:', parsed);
  } catch (err) {
    console.error('Error:', err.code || err.message);
    if (err.response) {
      console.error('Response status:', err.response.status);
      console.error('Response data (first 500 chars):', String(err.response.data || '').substring(0, 500));
    }
  }
}

main();
