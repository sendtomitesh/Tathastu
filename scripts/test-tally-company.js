/**
 * Lightweight test: fetch Tally company info only (no ledgers/vouchers).
 * Run from project root:
 *   node scripts/test-tally-company.js
 */
const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, '..', 'config', 'skills.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tallySkill = (raw.skills || []).find((s) => s.id === 'tally');
const port = tallySkill?.config?.port || 9000;
const baseUrl = `http://localhost:${port}`;

const axios = require('axios');

function envelope(header, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    ${header}
  </HEADER>
  <BODY>
    ${body}
  </BODY>
</ENVELOPE>`;
}

function buildCompanyInfoXml() {
  const header = [
    '<TALLYREQUEST>Export</TALLYREQUEST>',
    '<TYPE>Collection</TYPE>',
    '<ID>List of Companies</ID>',
  ].join('\n    ');
  const desc = '<DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC>';
  const body = `${desc}
  <DATA>
    <COLLECTION NAME="List of Companies">List of Companies</COLLECTION>
  </DATA>`;
  return envelope(header, body);
}

async function postTally(xml) {
  const { data } = await axios.post(baseUrl, xml, {
    headers: { 'Content-Type': 'text/xml' },
    timeout: 15000,
  });
  return typeof data === 'string' ? data : String(data);
}

function parseCompanyInfoResponse(xmlString) {
  const names = [];
  const nameRegex = /<COMPANY[^>]*>[\s\S]*?<NAME[^>]*>([^<]*)<\/NAME>/g;
  let m;
  while ((m = nameRegex.exec(xmlString)) !== null && names.length < 3) {
    names.push(m[1].trim());
  }
  return names;
}

async function main() {
  console.log('Tally company info test on port', port);
  console.log('Request: List of Companies (company info only)\n');

  const xml = buildCompanyInfoXml();
  try {
    const res = await postTally(xml);
    const companies = parseCompanyInfoResponse(res);
    if (!companies.length) {
      console.log('No companies found in response.');
    } else {
      console.log('Companies (up to 3):');
      companies.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
    }
  } catch (err) {
    console.error('Error talking to Tally:', err.code || err.message);
  }
}

main();

