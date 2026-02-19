/**
 * Lightweight test: get ledger summary for "Atul Singh" with a very small date range.
 * This uses the same minimal ledger export (limited to today) to avoid overloading Tally.
 *
 * Run from project root:
 *   node scripts/test-tally-ledger-atul.js
 */
const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, '..', 'config', 'skills.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tallySkill = (raw.skills || []).find((s) => s.id === 'tally');
const port = tallySkill?.config?.port || 9000;
const baseUrl = `http://localhost:${port}`;

const {
  buildLedgerMasterXml,
  postTally,
  parseLedgerResponse,
} = require('../src/skills/tally/client');

async function main() {
  const partyName = 'Atul Singh';
  console.log('Tally ledger test on port', port);
  console.log('Request: get ledger (summary) for "%s" with minimal date range\n', partyName);

  // Small delay to be gentle
  await new Promise((r) => setTimeout(r, 1000));

  try {
    // Use minimal ledger export (limited to today) without forcing company name
    const xml = buildLedgerMasterXml(partyName, null);
    const response = await postTally(baseUrl, xml);
    const parsed = parseLedgerResponse(response);
    if (!parsed.success) {
      console.log('Failed:', parsed.message || 'Unknown error');
      return;
    }
    console.log('Summary:\n', parsed.summary);
  } catch (err) {
    console.error('Error talking to Tally:', err.code || err.message);
  }
}

main();

