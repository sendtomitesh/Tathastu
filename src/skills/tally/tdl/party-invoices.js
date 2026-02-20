const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildPartyInvoicesTdlXml(partyName, companyName, dateFrom, dateTo, voucherType) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  if (dateFrom || dateTo) {
    const actualFrom = dateFrom || dateTo;
    const actualTo = dateTo || dateFrom;
    svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
    svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);
  }

  const vchType = voucherType || 'Sales';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PartyInvoices</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="PartyInvoices" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Amount, Narration</FETCH>
          <FETCH>AllLedgerEntries.LedgerName, AllLedgerEntries.Amount, AllLedgerEntries.IsPartyLedger</FETCH>
          <FETCH>AllInventoryEntries.StockItemName, AllInventoryEntries.Rate, AllInventoryEntries.Amount, AllInventoryEntries.BilledQty</FETCH>
          <FILTER>PartyInvFilter</FILTER>
          <FILTER>VchTypeInvFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="PartyInvFilter">$PartyLedgerName = "${escapeXml(partyName)}"</SYSTEM>
        <SYSTEM TYPE="Formulae" NAME="VchTypeInvFilter">$VoucherTypeName = "${escapeXml(vchType)}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parsePartyInvoicesTdlResponse(xmlString, partyName, dateFrom, dateTo) {
  let invoices = [];
  const vchRegex = /<VOUCHER\s[^>]*VCHTYPE[^>]*>[\s\S]*?<\/VOUCHER>/gi;
  let m;

  while ((m = vchRegex.exec(xmlString)) !== null) {
    const block = m[0];
    const extract = (tag) => {
      const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return mx ? mx[1].trim() : null;
    };

    const date = extract('DATE') || '';
    const number = extract('VOUCHERNUMBER') || '';
    const type = extract('VOUCHERTYPENAME') || '';
    const amount = parseFloat(extract('AMOUNT')) || 0;
    const narration = decodeXml(extract('NARRATION'));

    // Extract ledger entries (non-party = income/tax breakup)
    const ledgerEntries = [];
    const leRegex = /<LEDGERENTRIES\.LIST>[\s\S]*?<\/LEDGERENTRIES\.LIST>/gi;
    let le;
    while ((le = leRegex.exec(block)) !== null) {
      const leBlock = le[0];
      const leName = leBlock.match(/<LEDGERNAME[^>]*>([^<]*)<\/LEDGERNAME>/i);
      const leAmt = leBlock.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/i);
      const isParty = leBlock.match(/<ISPARTYLEDGER[^>]*>([^<]*)<\/ISPARTYLEDGER>/i);
      if (leName && isParty && isParty[1].trim().toLowerCase() !== 'yes') {
        ledgerEntries.push({
          name: decodeXml(leName[1].trim()),
          amount: parseFloat(leAmt?.[1]) || 0,
        });
      }
    }

    // Extract inventory entries (items with qty/rate)
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

    invoices.push({ date, number, type, amount, narration, ledgerEntries, items });
  }

  // JS-side date filtering
  if (dateFrom || dateTo) {
    invoices = invoices.filter(v => {
      if (!v.date) return false;
      if (dateFrom && v.date < dateFrom) return false;
      if (dateTo && v.date > dateTo) return false;
      return true;
    });
  }

  // Sort by date descending (newest first)
  invoices.sort((a, b) => b.date.localeCompare(a.date));

  if (invoices.length === 0) {
    return { success: true, message: `No invoices found for *${partyName}*.`, data: { partyName, invoices: [], total: 0 } };
  }

  const total = invoices.reduce((s, v) => s + Math.abs(v.amount), 0);
  const dates = invoices.map(v => v.date).filter(Boolean).sort();
  const fromStr = dates.length ? formatTallyDate(dates[0]) : '';
  const toStr = dates.length ? formatTallyDate(dates[dates.length - 1]) : '';
  const dateRange = fromStr && toStr && fromStr !== toStr ? `${fromStr} to ${toStr}` : (fromStr || 'Current FY');

  const lines = [
    `🧾 *Invoices: ${partyName}*`,
    `📅 ${dateRange} | ${invoices.length} invoices | Total: ₹${inr(total)}`,
    '',
  ];

  invoices.forEach((inv, i) => {
    const dateStr = inv.date ? formatTallyDate(inv.date) : '';
    lines.push(`${i + 1}. *#${inv.number || 'N/A'}* — ${dateStr}`);
    lines.push(`   ₹${inr(Math.abs(inv.amount))}`);

    // Show items if present
    if (inv.items.length > 0) {
      for (const item of inv.items) {
        const qtyStr = item.qty ? `${item.qty} x ₹${inr(item.rate)}` : '';
        lines.push(`   📦 ${item.name}${qtyStr ? ' — ' + qtyStr : ''}`);
      }
    }

    // Show ledger breakup (income heads, taxes)
    if (inv.ledgerEntries.length > 0) {
      for (const le of inv.ledgerEntries) {
        lines.push(`   ↳ ${le.name}: ₹${inr(le.amount)}`);
      }
    }

    if (inv.narration) lines.push(`   _${inv.narration.slice(0, 60)}_`);
    if (i < invoices.length - 1) lines.push('');
  });

  lines.push('', SEP);
  lines.push(`*Total: ₹${inr(total)} (${invoices.length} invoices)*`);

  return { success: true, message: lines.join('\n'), data: { partyName, invoices, total } };
}

module.exports = { buildPartyInvoicesTdlXml, parsePartyInvoicesTdlResponse };
