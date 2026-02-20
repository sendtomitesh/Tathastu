const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { inr } = require('./formatters');

/**
 * Build TDL XML to fetch a single voucher by number with full details.
 */
function buildInvoiceDetailTdlXml(voucherNumber, companyName, voucherType) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  const vchType = voucherType || 'Sales';
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>InvoiceDetail</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="InvoiceDetail" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Amount, Narration</FETCH>
          <FETCH>AllLedgerEntries.LedgerName, AllLedgerEntries.Amount, AllLedgerEntries.IsPartyLedger</FETCH>
          <FETCH>AllInventoryEntries.StockItemName, AllInventoryEntries.Rate, AllInventoryEntries.Amount, AllInventoryEntries.BilledQty</FETCH>
          <FILTER>InvNumberFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="InvNumberFilter">$VoucherNumber = "${escapeXml(voucherNumber)}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Build TDL XML to fetch company info (name, address, GSTIN, etc.)
 */
function buildCompanyInfoTdlXml(companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CompanyInfo</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="CompanyInfo" ISMODIFY="No">
          <TYPE>Company</TYPE>
          <FETCH>Name, FormalName, Address.List, StateName, PinCode, PhoneNumber, Email, GSTIN, BasicCompanyMailName, BasicCompanyFormalName</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Build TDL XML to fetch party ledger details (address, GSTIN).
 */
function buildPartyDetailTdlXml(partyName, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PartyDetail</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="PartyDetail" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <FETCH>Name, Parent, Address.List, StateName, PinCode, LedgerPhone, LedgerContact, Email, LedGSTRegDetails.GSTIN</FETCH>
          <FILTER>PartyNameFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="PartyNameFilter">$Name = "${escapeXml(partyName)}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse voucher XML into invoice data object.
 */
function parseInvoiceDetailResponse(xmlString) {
  const vchMatch = xmlString.match(/<VOUCHER\s[^>]*VCHTYPE[^>]*>[\s\S]*?<\/VOUCHER>/i);
  if (!vchMatch) return null;

  const block = vchMatch[0];
  const extract = (tag) => {
    const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return mx ? decodeXml(mx[1].trim()) : null;
  };

  // Ledger entries (non-party)
  const ledgerEntries = [];
  const leRegex = /<LEDGERENTRIES\.LIST>[\s\S]*?<\/LEDGERENTRIES\.LIST>/gi;
  let le;
  while ((le = leRegex.exec(block)) !== null) {
    const leBlock = le[0];
    const leName = leBlock.match(/<LEDGERNAME[^>]*>([^<]*)<\/LEDGERNAME>/i);
    const leAmt = leBlock.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/i);
    const isParty = leBlock.match(/<ISPARTYLEDGER[^>]*>([^<]*)<\/ISPARTYLEDGER>/i);
    if (leName) {
      ledgerEntries.push({
        name: decodeXml(leName[1].trim()),
        amount: parseFloat(leAmt?.[1]) || 0,
        isParty: isParty && isParty[1].trim().toLowerCase() === 'yes',
      });
    }
  }

  // Inventory entries
  const items = [];
  const invRegex = /<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/gi;
  let inv;
  while ((inv = invRegex.exec(block)) !== null) {
    const invBlock = inv[0];
    const itemName = invBlock.match(/<STOCKITEMNAME[^>]*>([^<]*)<\/STOCKITEMNAME>/i);
    const itemAmt = invBlock.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/i);
    const itemRate = invBlock.match(/<RATE[^>]*>([^<]*)<\/RATE>/i);
    const itemQty = invBlock.match(/<BILLEDQTY[^>]*>([^<]*)<\/BILLEDQTY>/i);
    if (itemName && itemName[1].trim()) {
      items.push({
        name: decodeXml(itemName[1].trim()),
        amount: parseFloat(itemAmt?.[1]) || 0,
        rate: parseFloat(itemRate?.[1]) || 0,
        qty: parseFloat(itemQty?.[1]) || 0,
      });
    }
  }

  return {
    date: extract('DATE') || '',
    number: extract('VOUCHERNUMBER') || '',
    type: extract('VOUCHERTYPENAME') || '',
    party: extract('PARTYLEDGERNAME') || '',
    amount: parseFloat(extract('AMOUNT')) || 0,
    narration: extract('NARRATION') || '',
    ledgerEntries,
    items,
  };
}

/**
 * Parse company info XML.
 */
function parseCompanyInfoResponse(xmlString) {
  const match = xmlString.match(/<COMPANY\s+NAME="[^"]*"[^>]*>[\s\S]*?<\/COMPANY>/i);
  if (!match) return { name: '', address: [], email: '', state: '', pincode: '', gstin: '' };
  const block = match[0];
  const extract = (tag) => {
    const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return mx ? decodeXml(mx[1].trim()) : '';
  };
  // Address lines
  const address = [];
  const addrRegex = /<ADDRESS\s+TYPE="String">([^<]*)<\/ADDRESS>/gi;
  let am;
  while ((am = addrRegex.exec(block)) !== null) {
    const line = decodeXml(am[1].trim());
    if (line) address.push(line);
  }
  return {
    name: extract('BASICCOMPANYFORMALNAME') || extract('NAME') || '',
    address,
    email: extract('EMAIL') || '',
    state: extract('STATENAME') || '',
    pincode: extract('PINCODE') || '',
    gstin: extract('GSTIN') || '',
    phone: extract('PHONENUMBER') || '',
  };
}

/**
 * Parse party ledger detail XML.
 */
function parsePartyDetailResponse(xmlString) {
  const match = xmlString.match(/<LEDGER\s+NAME="[^"]*"[^>]*>[\s\S]*?<\/LEDGER>/i);
  if (!match) return { name: '', address: [], gstin: '', state: '', phone: '', email: '' };
  const block = match[0];
  const extract = (tag) => {
    const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return mx ? decodeXml(mx[1].trim()) : '';
  };
  const address = [];
  const addrRegex = /<ADDRESS\s+TYPE="String">([^<]*)<\/ADDRESS>/gi;
  let am;
  while ((am = addrRegex.exec(block)) !== null) {
    const line = decodeXml(am[1].trim());
    if (line) address.push(line);
  }
  // Get GSTIN (may have multiple registration periods, take the latest non-empty one)
  let gstin = '';
  const gstinRegex = /<GSTIN[^>]*>([^<]+)<\/GSTIN>/gi;
  let gm;
  while ((gm = gstinRegex.exec(block)) !== null) {
    const val = gm[1].trim();
    if (val && val.length >= 15) gstin = val;
  }
  return {
    name: extract('NAME') || '',
    address,
    gstin,
    state: extract('STATENAME') || extract('STATE') || '',
    phone: extract('LEDGERPHONE') || '',
    email: extract('EMAIL') || '',
  };
}

/**
 * Generate invoice HTML from parsed data.
 */
function generateInvoiceHtml(invoice, company, party) {
  const date = invoice.date ? formatTallyDate(invoice.date) : '';
  const totalAmount = Math.abs(invoice.amount);
  const nonPartyEntries = invoice.ledgerEntries.filter(e => !e.isParty);
  const partyName = party.name || invoice.party || '';

  // Separate income/service entries from tax entries
  const taxKeywords = ['cgst', 'sgst', 'igst', 'cess', 'tds', 'tcs', 'tax', 'duty', 'gst'];
  const taxEntries = nonPartyEntries.filter(e => taxKeywords.some(k => e.name.toLowerCase().includes(k)));
  const incomeEntries = nonPartyEntries.filter(e => !taxKeywords.some(k => e.name.toLowerCase().includes(k)));

  const subtotal = incomeEntries.reduce((s, e) => s + Math.abs(e.amount), 0);
  const taxTotal = taxEntries.reduce((s, e) => s + Math.abs(e.amount), 0);

  let itemRows = '';
  if (invoice.items.length > 0) {
    invoice.items.forEach((item, i) => {
      itemRows += `<tr>
        <td>${i + 1}</td><td>${esc(item.name)}</td>
        <td class="r">${item.qty || ''}</td><td class="r">${item.rate ? '₹' + inr(item.rate) : ''}</td>
        <td class="r">₹${inr(Math.abs(item.amount))}</td>
      </tr>`;
    });
  } else {
    incomeEntries.forEach((entry, i) => {
      itemRows += `<tr>
        <td>${i + 1}</td><td>${esc(entry.name)}</td>
        <td class="r">-</td><td class="r">-</td>
        <td class="r">₹${inr(Math.abs(entry.amount))}</td>
      </tr>`;
    });
  }

  let taxRows = '';
  taxEntries.forEach(entry => {
    taxRows += `<tr><td colspan="4" class="r">${esc(entry.name)}</td><td class="r">₹${inr(Math.abs(entry.amount))}</td></tr>`;
  });

  const companyAddr = company.address.length ? company.address.join('<br>') : '';
  const partyAddr = party.address.length ? party.address.join('<br>') : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #333; padding: 30px; }
  .inv { max-width: 800px; margin: 0 auto; border: 1px solid #ccc; padding: 30px; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #2a67b1; padding-bottom: 15px; margin-bottom: 20px; }
  .company { font-size: 18px; font-weight: bold; color: #2a67b1; }
  .company-detail { font-size: 11px; color: #666; margin-top: 4px; }
  .inv-title { text-align: right; }
  .inv-title h2 { color: #2a67b1; font-size: 22px; margin-bottom: 5px; }
  .inv-title .num { font-size: 14px; font-weight: bold; }
  .inv-title .date { font-size: 12px; color: #666; }
  .parties { display: flex; justify-content: space-between; margin-bottom: 20px; }
  .party-box { width: 48%; }
  .party-box .label { font-size: 10px; text-transform: uppercase; color: #999; font-weight: bold; margin-bottom: 4px; }
  .party-box .name { font-weight: bold; font-size: 14px; }
  .party-box .addr { font-size: 11px; color: #666; margin-top: 2px; }
  .party-box .gstin { font-size: 11px; color: #444; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
  th { background: #2a67b1; color: white; padding: 8px 10px; text-align: left; font-size: 12px; }
  td { padding: 6px 10px; border-bottom: 1px solid #eee; font-size: 12px; }
  .r { text-align: right; }
  .total-row td { font-weight: bold; border-top: 2px solid #2a67b1; font-size: 14px; }
  .narration { font-size: 11px; color: #666; margin-top: 10px; font-style: italic; }
  .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 10px; }
</style></head><body>
<div class="inv">
  <div class="header">
    <div>
      <div class="company">${esc(company.name)}</div>
      <div class="company-detail">${companyAddr}</div>
      ${company.state ? `<div class="company-detail">${esc(company.state)}${company.pincode ? ' - ' + esc(company.pincode) : ''}</div>` : ''}
      ${company.gstin ? `<div class="company-detail">GSTIN: ${esc(company.gstin)}</div>` : ''}
      ${company.phone ? `<div class="company-detail">Ph: ${esc(company.phone)}</div>` : ''}
    </div>
    <div class="inv-title">
      <h2>${esc(invoice.type)}</h2>
      <div class="num">#${esc(invoice.number)}</div>
      <div class="date">${date}</div>
    </div>
  </div>
  <div class="parties">
    <div class="party-box">
      <div class="label">Bill To</div>
      <div class="name">${esc(partyName)}</div>
      ${partyAddr ? `<div class="addr">${partyAddr}</div>` : ''}
      ${party.gstin ? `<div class="gstin">GSTIN: ${esc(party.gstin)}</div>` : ''}
    </div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>
      ${itemRows}
      <tr><td colspan="4" class="r"><strong>Subtotal</strong></td><td class="r"><strong>₹${inr(subtotal)}</strong></td></tr>
      ${taxRows}
      <tr class="total-row"><td colspan="4" class="r">Total</td><td class="r">₹${inr(totalAmount)}</td></tr>
    </tbody>
  </table>
  ${invoice.narration ? `<div class="narration">Note: ${esc(invoice.narration)}</div>` : ''}
  <div class="footer">Generated from TallyPrime via Tathastu</div>
</div>
</body></html>`;
}

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/**
 * Convert HTML to PDF buffer using Puppeteer.
 * Uses the system Chrome (same as WhatsApp client).
 */
async function htmlToPdfBuffer(html) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

module.exports = {
  buildInvoiceDetailTdlXml,
  buildCompanyInfoTdlXml,
  buildPartyDetailTdlXml,
  parseInvoiceDetailResponse,
  parseCompanyInfoResponse,
  parsePartyDetailResponse,
  generateInvoiceHtml,
  htmlToPdfBuffer,
};
