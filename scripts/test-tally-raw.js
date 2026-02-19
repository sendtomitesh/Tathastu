/**
 * Raw TCP probe to see what Tally responds with
 */
const net = require('net');

const client = new net.Socket();
client.setTimeout(5000);

client.connect(9000, 'localhost', () => {
  console.log('Connected to port 9000');
  // Send a simple HTTP POST header + XML
  const xml = `<?xml version="1.0"?><ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`;
  const httpReq = `POST / HTTP/1.1\r\nHost: localhost:9000\r\nContent-Type: text/xml\r\nContent-Length: ${xml.length}\r\n\r\n${xml}`;
  client.write(httpReq);
});

client.on('data', (data) => {
  console.log('Received:', data.toString().substring(0, 500));
  client.destroy();
});

client.on('timeout', () => {
  console.log('Socket timeout - no data received');
  // Try sending just raw XML without HTTP headers
  const xml2 = `<?xml version="1.0"?><ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`;
  console.log('Trying raw XML without HTTP headers...');
  client.write(xml2);
  setTimeout(() => { console.log('Still no response. Closing.'); client.destroy(); }, 3000);
});

client.on('error', (e) => console.log('Error:', e.message));
client.on('close', () => console.log('Connection closed'));
