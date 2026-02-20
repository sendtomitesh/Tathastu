const { escapeXml, decodeXml, toTallyDate, formatTallyDate } = require('./helpers');
const { inr } = require('./formatters');

/**
 * Build TDL XML to create a voucher in Tally via XML import.
 * Supports: Sales, Purchase, Receipt, Payment voucher types.
 *
 * @param {object} voucherData
 * @param {string} voucherData.type - 'Sales'|'Purchase'|'Receipt'|'Payment'
 * @param {string} voucherData.party - Party ledger name
 * @param {number} voucherData.amount - Total amount (positive)
 * @param {string} [voucherData.date] - YYYYMMDD or YYYY-MM-DD (defaults to today)
 * @param {string} [voucherData.narration] - Narration/description
 * @param {Array} [voucherData.items] - For Sales/Purchase: [{name, qty, rate, amount}]
 * @param {string} [voucherData.salesLedger] - Sales/Purchase account ledger (default: 'Sales Account' or 'Purchase Account')
 * @param {string} companyName
 * @returns {string} XML for Tally import
 */
function buildCreateVoucherXml(voucherData, companyName) {
  const type = voucherData.type || 'Sales';
  const date = toTallyDate(voucherData.date) || todayStr();
  const party = voucherData.party;
  const amount = Math.abs(voucherData.amount);
  const narration = voucherData.narration || '';

  // Determine ledger names based on voucher type
  let defaultLedger;
  if (type === 'Sales') defaultLedger = 'Sales Account';
  else if (type === 'Purchase') defaultLedger = 'Purchase Account';
  else if (type === 'Receipt') defaultLedger = 'Cash';
  else if (type === 'Payment') defaultLedger = 'Cash';
  else defaultLedger = 'Sales Account';

  const salesLedger = voucherData.salesLedger || defaultLedger;

  // For Receipt/Payment: party pays/receives, cash/bank is the other side
  const isReceiptPayment = type === 'Receipt' || type === 'Payment';
  const cashLedger = voucherData.cashLedger || (isReceiptPayment ? 'Cash' : null);

  // Build inventory entries for Sales/Purchase with items
  let inventoryXml = '';
  if (voucherData.items && voucherData.items.length > 0 && !isReceiptPayment) {
    for (const item of voucherData.items) {
      const itemAmt = item.amount || (item.qty * item.rate) || 0;
      inventoryXml += `
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>${escapeXml(item.name)}</STOCKITEMNAME>
          <RATE>${item.rate || 0}</RATE>
          <AMOUNT>${type === 'Sales' ? itemAmt : -itemAmt}</AMOUNT>
          <BILLEDQTY>${item.qty || 0}</BILLEDQTY>
          <ACTUALQTY>${item.qty || 0}</ACTUALQTY>
        </ALLINVENTORYENTRIES.LIST>`;
    }
  }

  // Build ledger entries
  let ledgerXml = '';
  if (type === 'Sales') {
    // Party: debit (negative in Tally = debit for party)
    ledgerXml += `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(party)}</LEDGERNAME>
          <AMOUNT>-${amount}</AMOUNT>
          <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(salesLedger)}</LEDGERNAME>
          <AMOUNT>${amount}</AMOUNT>
          <ISPARTYLEDGER>No</ISPARTYLEDGER>
        </ALLLEDGERENTRIES.LIST>`;
  } else if (type === 'Purchase') {
    ledgerXml += `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(party)}</LEDGERNAME>
          <AMOUNT>${amount}</AMOUNT>
          <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(salesLedger)}</LEDGERNAME>
          <AMOUNT>-${amount}</AMOUNT>
          <ISPARTYLEDGER>No</ISPARTYLEDGER>
        </ALLLEDGERENTRIES.LIST>`;
  } else if (type === 'Receipt') {
    // Receipt: Cash/Bank debit, Party credit
    ledgerXml += `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(cashLedger)}</LEDGERNAME>
          <AMOUNT>-${amount}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(party)}</LEDGERNAME>
          <AMOUNT>${amount}</AMOUNT>
          <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
        </ALLLEDGERENTRIES.LIST>`;
  } else if (type === 'Payment') {
    // Payment: Party debit, Cash/Bank credit
    ledgerXml += `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(party)}</LEDGERNAME>
          <AMOUNT>-${amount}</AMOUNT>
          <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(cashLedger)}</LEDGERNAME>
          <AMOUNT>${amount}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`;
  }

  // Format date as DD-Mon-YYYY for Tally import
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tallyDate = `${parseInt(date.slice(6,8))}-${months[parseInt(date.slice(4,6))-1]}-${date.slice(0,4)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="${escapeXml(type)}" ACTION="Create">
          <DATE>${tallyDate}</DATE>
          <VOUCHERTYPENAME>${escapeXml(type)}</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${escapeXml(party)}</PARTYLEDGERNAME>
          <NARRATION>${escapeXml(narration)}</NARRATION>
          ${inventoryXml}
          ${ledgerXml}
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse Tally's import response to check if voucher was created successfully.
 */
function parseCreateVoucherResponse(xmlString) {
  // Tally returns CREATED in either attribute or tag format
  const createdMatch = xmlString.match(/CREATED\s*=\s*"(\d+)"/i) ||
                       xmlString.match(/<CREATED[^>]*>(\d+)<\/CREATED>/i);
  const created = createdMatch ? parseInt(createdMatch[1]) : 0;

  // Check for errors
  const errorMatch = xmlString.match(/<LINEERROR[^>]*>([^<]*)<\/LINEERROR>/i);
  const error = errorMatch ? decodeXml(errorMatch[1].trim()) : null;

  // Also check for ERRORS tag
  const errorsMatch = xmlString.match(/ERRORS\s*=\s*"(\d+)"/i) ||
                      xmlString.match(/<ERRORS[^>]*>(\d+)<\/ERRORS>/i);
  const errors = errorsMatch ? parseInt(errorsMatch[1]) : 0;

  if (created > 0 && errors === 0) {
    // Try to extract voucher number
    const vchNumMatch = xmlString.match(/VCHNO\s*=\s*"([^"]*)"/i) ||
                        xmlString.match(/<VOUCHERNUMBER[^>]*>([^<]*)<\/VOUCHERNUMBER>/i);
    const voucherNumber = vchNumMatch ? decodeXml(vchNumMatch[1]) : null;
    return { success: true, voucherNumber, message: null };
  }

  return { success: false, voucherNumber: null, message: error || 'Voucher creation failed. Check ledger names and amounts.' };
}

/**
 * Validate voucher data before sending to Tally.
 */
function validateVoucherData(data) {
  const errors = [];
  if (!data.type || !['Sales', 'Purchase', 'Receipt', 'Payment'].includes(data.type)) {
    errors.push('Invalid voucher type. Use: Sales, Purchase, Receipt, or Payment.');
  }
  if (!data.party || typeof data.party !== 'string' || data.party.trim().length === 0) {
    errors.push('Party name is required.');
  }
  if (!data.amount || isNaN(data.amount) || data.amount <= 0) {
    errors.push('Amount must be a positive number.');
  }
  if (data.items && data.items.length > 0) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (!item.name) errors.push(`Item ${i + 1}: name is required.`);
      if (!item.qty || item.qty <= 0) errors.push(`Item ${i + 1}: qty must be positive.`);
      if (!item.rate || item.rate <= 0) errors.push(`Item ${i + 1}: rate must be positive.`);
    }
  }
  return errors;
}

/**
 * Format a confirmation message after successful voucher creation.
 */
function formatVoucherConfirmation(data, voucherNumber) {
  const date = data.date ? formatTallyDate(toTallyDate(data.date)) : formatTallyDate(todayStr());
  const lines = [
    `✅ *${data.type} Voucher Created*`,
    '',
    `📅 Date: ${date}`,
    `👤 Party: ${data.party}`,
    `💰 Amount: ₹${inr(data.amount)}`,
  ];
  if (voucherNumber) lines.push(`🔢 Voucher No: ${voucherNumber}`);
  if (data.narration) lines.push(`📝 Narration: ${data.narration}`);
  if (data.items && data.items.length > 0) {
    lines.push('', '*Items:*');
    data.items.forEach((item, i) => {
      lines.push(`  ${i + 1}. ${item.name} — ${item.qty} x ₹${inr(item.rate)} = ₹${inr(item.qty * item.rate)}`);
    });
  }
  return lines.join('\n');
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

module.exports = {
  buildCreateVoucherXml,
  parseCreateVoucherResponse,
  validateVoucherData,
  formatVoucherConfirmation,
};
