/**
 * Test fuzzy party name resolution.
 * Usage: node scripts/test-tally-fuzzy.js "meril science"
 */
require('dotenv').config();
const { execute } = require('../src/skills/tally/index');

const partyName = process.argv[2] || 'meril science';
const action = process.argv[3] || 'get_party_gstin';
const skillConfig = { port: 9000, companyName: 'SendMe Technologies Pvt Ltd' };

(async () => {
  console.log(`\n--- Testing "${action}" for "${partyName}" (fuzzy) ---\n`);
  const result = await execute('tally', action, { party_name: partyName }, skillConfig);
  console.log(JSON.stringify(result, null, 2));
  console.log('\n--- Done ---');
})();
