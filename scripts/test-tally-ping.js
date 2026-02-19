/**
 * Minimal Tally connectivity test - list companies
 */
const http = require('http');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>List of Companies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;

const opts = {
  hostname: 'localhost',
  port: 9000,
  method: 'POST',
  headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xml) },
  timeout: 10000,
};

const req = http.request(opts, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response (first 1000 chars):\n', data.substring(0, 1000));
  });
});

req.on('error', (e) => console.log('Error:', e.code || e.message));
req.on('timeout', () => { console.log('Timeout - Tally not responding'); req.destroy(); });
req.write(xml);
req.end();
