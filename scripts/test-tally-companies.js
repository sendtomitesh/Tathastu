/**
 * List companies available in Tally
 */
const axios = require('axios');

const port = 9000;

// Method 1: List of Companies (built-in collection)
const xml1 = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
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

// Method 2: CompanyName collection
const xml2 = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CmpName</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CmpName" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>FormalName</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

(async () => {
  console.log('--- Checking companies in Tally ---\n');

  for (const [label, xml] of [['Built-in List of Companies', xml1], ['TDL Company Collection', xml2]]) {
    try {
      const { data } = await axios.post(`http://localhost:${port}`, xml, {
        headers: { 'Content-Type': 'text/xml' },
        timeout: 15000,
      });
      const resp = typeof data === 'string' ? data : String(data);
      console.log(`[${label}] Response (first 2000 chars):\n`, resp.substring(0, 2000), '\n');
    } catch (err) {
      console.log(`[${label}] Error:`, err.code || err.message, '\n');
    }
  }
})();
