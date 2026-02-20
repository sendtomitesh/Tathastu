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
          <FETCH>Name, FormalName, Address.List, StateName, PinCode, PhoneNumber, Email, GSTIN, BasicCompanyMailName, BasicCompanyFormalName, BankDetails.List, BankName, AccountNumber, IFSCCode, BankBranchName</FETCH>
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
  // Extract bank details
  const bankName = extract('BANKNAME') || '';
  const accountNumber = extract('ACCOUNTNUMBER') || '';
  const ifscCode = extract('IFSCCODE') || '';
  const bankBranch = extract('BANKBRANCHNAME') || '';

  return {
    name: extract('BASICCOMPANYFORMALNAME') || extract('NAME') || '',
    address,
    email: extract('EMAIL') || '',
    state: extract('STATENAME') || '',
    pincode: extract('PINCODE') || '',
    gstin: extract('GSTIN') || '',
    phone: extract('PHONENUMBER') || '',
    bankName,
    accountNumber,
    ifscCode,
    bankBranch,
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
 * Convert number to Indian words (e.g. 1,23,456 → "One Lakh Twenty Three Thousand Four Hundred Fifty Six")
 */
function amountInWords(num) {
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function twoDigit(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  }
  function threeDigit(n) {
    if (n === 0) return '';
    if (n < 100) return twoDigit(n);
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigit(n % 100) : '');
  }
  const abs = Math.abs(Math.round(num));
  const crore = Math.floor(abs / 10000000);
  const lakh = Math.floor((abs % 10000000) / 100000);
  const thousand = Math.floor((abs % 100000) / 1000);
  const rest = abs % 1000;
  const parts = [];
  if (crore) parts.push(threeDigit(crore) + ' Crore');
  if (lakh) parts.push(twoDigit(lakh) + ' Lakh');
  if (thousand) parts.push(twoDigit(thousand) + ' Thousand');
  if (rest) parts.push(threeDigit(rest));
  const rupees = parts.join(' ');
  // Paise
  const paise = Math.round((Math.abs(num) - Math.floor(Math.abs(num))) * 100);
  if (paise > 0) return rupees + ' Rupees and ' + twoDigit(paise) + ' Paise Only';
  return rupees + ' Rupees Only';
}

/**
 * Generate invoice HTML from parsed data — professional GST Tax Invoice format.
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

  // Build item rows
  let itemRows = '';
  if (invoice.items.length > 0) {
    invoice.items.forEach((item, i) => {
      itemRows += `<tr>
        <td class="c">${i + 1}</td><td>${esc(item.name)}</td>
        <td class="r">${item.qty || '-'}</td><td class="r">${item.rate ? inr(item.rate) : '-'}</td>
        <td class="r">${inr(Math.abs(item.amount))}</td>
      </tr>`;
    });
  } else {
    incomeEntries.forEach((entry, i) => {
      itemRows += `<tr>
        <td class="c">${i + 1}</td><td>${esc(entry.name)}</td>
        <td class="r">-</td><td class="r">-</td>
        <td class="r">${inr(Math.abs(entry.amount))}</td>
      </tr>`;
    });
  }

  // Tax rows
  let taxRows = '';
  taxEntries.forEach(entry => {
    taxRows += `<tr class="tax-row"><td colspan="4" class="r">${esc(entry.name)}</td><td class="r">${inr(Math.abs(entry.amount))}</td></tr>`;
  });

  const companyAddr = company.address.length ? company.address.join(', ') : '';
  const partyAddr = party.address.length ? party.address.join('<br>') : '';
  const companyState = company.state ? company.state + (company.pincode ? ' - ' + company.pincode : '') : '';
  const partyState = party.state || '';

  // Determine invoice title based on voucher type
  const vchType = (invoice.type || 'Sales').toLowerCase();
  let invoiceTitle = 'Tax Invoice';
  if (vchType.includes('purchase')) invoiceTitle = 'Purchase Invoice';
  else if (vchType.includes('credit')) invoiceTitle = 'Credit Note';
  else if (vchType.includes('debit')) invoiceTitle = 'Debit Note';
  else if (vchType.includes('receipt')) invoiceTitle = 'Receipt';
  else if (vchType.includes('payment')) invoiceTitle = 'Payment Voucher';

  // Bank details section
  let bankHtml = '';
  if (company.bankName || company.accountNumber) {
    const bankLines = [];
    if (company.bankName) bankLines.push(`Bank: ${esc(company.bankName)}`);
    if (company.accountNumber) bankLines.push(`A/c No: ${esc(company.accountNumber)}`);
    if (company.ifscCode) bankLines.push(`IFSC: ${esc(company.ifscCode)}`);
    if (company.bankBranch) bankLines.push(`Branch: ${esc(company.bankBranch)}`);
    bankHtml = `<div style="margin-top:6px;"><label>Bank Details</label><div class="val">${bankLines.join('<br>')}</div></div>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; }
  .page { max-width: 780px; margin: 0 auto; border: 2px solid #000; }
  /* Header */
  .hdr { border-bottom: 2px solid #000; padding: 12px 16px; text-align: center; }
  .hdr .co-name { font-size: 18px; font-weight: bold; text-transform: uppercase; }
  .hdr .co-addr { font-size: 10px; color: #333; margin-top: 2px; }
  .hdr .co-gstin { font-size: 11px; font-weight: bold; margin-top: 4px; }
  .hdr .inv-type { font-size: 14px; font-weight: bold; margin-top: 6px; text-decoration: underline; }
  /* Info grid */
  .info { display: table; width: 100%; border-bottom: 1px solid #000; }
  .info-row { display: table-row; }
  .info-left, .info-right { display: table-cell; width: 50%; padding: 8px 16px; vertical-align: top; }
  .info-right { border-left: 1px solid #000; }
  .info label { font-weight: bold; font-size: 10px; text-transform: uppercase; color: #555; }
  .info .val { font-size: 11px; margin-top: 1px; }
  .info .party-name { font-size: 13px; font-weight: bold; }
  .info .gstin-val { font-weight: bold; }
  /* Items table */
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { background: #f0f0f0; border-bottom: 2px solid #000; border-top: 1px solid #000; padding: 6px 8px; font-size: 10px; text-transform: uppercase; font-weight: bold; }
  table.items td { padding: 5px 8px; border-bottom: 1px solid #ddd; font-size: 11px; }
  table.items tr:last-child td { border-bottom: none; }
  .r { text-align: right; }
  .c { text-align: center; }
  .tax-row td { border-bottom: 1px solid #ddd; font-size: 10px; color: #444; }
  /* Subtotal / Total */
  .sub-row td { border-top: 1px solid #999; font-weight: bold; }
  .total-section { border-top: 2px solid #000; padding: 8px 16px; }
  .total-line { display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; }
  .words { font-size: 10px; color: #333; margin-top: 4px; font-style: italic; }
  /* Footer */
  .foot { border-top: 1px solid #000; display: table; width: 100%; }
  .foot-left, .foot-right { display: table-cell; width: 50%; padding: 10px 16px; vertical-align: top; }
  .foot-right { border-left: 1px solid #000; text-align: right; }
  .foot .narr { font-size: 10px; color: #555; font-style: italic; }
  .foot .sign-label { font-size: 10px; color: #555; margin-top: 30px; }
  .foot .sign-name { font-size: 11px; font-weight: bold; }
  .powered { text-align: center; font-size: 9px; color: #999; padding: 4px; border-top: 1px solid #ddd; }
</style></head><body>
<div class="page">
  <div class="hdr">
    <div class="co-name">${esc(company.name)}</div>
    ${companyAddr ? `<div class="co-addr">${esc(companyAddr)}</div>` : ''}
    ${companyState ? `<div class="co-addr">${esc(companyState)}</div>` : ''}
    ${company.phone ? `<div class="co-addr">Ph: ${esc(company.phone)}${company.email ? ' | ' + esc(company.email) : ''}</div>` : ''}
    ${company.gstin ? `<div class="co-gstin">GSTIN: ${esc(company.gstin)}</div>` : ''}
    <div class="inv-type">${esc(invoiceTitle)}</div>
  </div>
  <div class="info">
    <div class="info-row">
      <div class="info-left">
        <label>Bill To</label>
        <div class="val party-name">${esc(partyName)}</div>
        ${partyAddr ? `<div class="val">${partyAddr}</div>` : ''}
        ${partyState ? `<div class="val">${esc(partyState)}</div>` : ''}
        ${party.gstin ? `<div class="val gstin-val">GSTIN: ${esc(party.gstin)}</div>` : ''}
        ${party.phone ? `<div class="val">Ph: ${esc(party.phone)}</div>` : ''}
      </div>
      <div class="info-right">
        <label>Invoice No.</label>
        <div class="val" style="font-weight:bold;font-size:13px;">${esc(invoice.number)}</div>
        <div style="margin-top:8px;"><label>Date</label></div>
        <div class="val">${date}</div>
        <div style="margin-top:8px;"><label>Voucher Type</label></div>
        <div class="val">${esc(invoice.type)}</div>
      </div>
    </div>
  </div>
  <table class="items">
    <thead><tr><th class="c" style="width:40px">#</th><th>Particulars</th><th class="r" style="width:70px">Qty</th><th class="r" style="width:90px">Rate (₹)</th><th class="r" style="width:100px">Amount (₹)</th></tr></thead>
    <tbody>
      ${itemRows}
      <tr class="sub-row"><td colspan="4" class="r">Subtotal</td><td class="r">${inr(subtotal)}</td></tr>
      ${taxRows}
    </tbody>
  </table>
  <div class="total-section">
    <div class="total-line"><span>Total</span><span>₹ ${inr(totalAmount)}</span></div>
    <div class="words">${amountInWords(totalAmount)}</div>
  </div>
  <div class="foot">
    <div class="foot-left">
      ${invoice.narration ? `<div class="narr">Narration: ${esc(invoice.narration)}</div>` : '<div class="narr">&nbsp;</div>'}
      ${bankHtml}
    </div>
    <div class="foot-right">
      <div class="sign-label">For ${esc(company.name)}</div>
      <div class="sign-label" style="margin-top:24px;">Authorised Signatory</div>
    </div>
  </div>
  <div class="powered">Generated from TallyPrime</div>
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
    const pdfUint8 = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    // Puppeteer returns Uint8Array — convert to proper Node.js Buffer for base64 encoding
    return Buffer.from(pdfUint8);
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
  amountInWords,
};
