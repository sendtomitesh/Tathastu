const { escapeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

/**
 * Build TDL XML to fetch all ledger groups for Trial Balance.
 * Fetches top-level groups with opening + closing balances.
 */
function buildTrialBalanceTdlXml(companyName, dateFrom, dateTo) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);
  if (dateFrom || dateTo) {
    const actualFrom = dateFrom || dateTo;
    const actualTo = dateTo || dateFrom;
    svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
    svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TrialBalGroups</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="TrialBalGroups" ISMODIFY="No">
          <TYPE>Group</TYPE>
          <FETCH>Name, Parent, OpeningBalance, ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse group XML into Trial Balance format.
 * Only includes top-level groups (parent is &#4; Primary or empty).
 */
function parseTrialBalanceTdlResponse(xmlString, dateFrom, dateTo) {
  const groups = [];
  const regex = /<GROUP\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/GROUP>/gi;
  let m;

  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = m[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim();
    const parentMatch = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/i);
    const parent = parentMatch ? parentMatch[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim() : '';

    // Only top-level groups (parent is control-char Primary or empty)
    if (parent && parent !== 'Primary' && !parent.match(/^\s*Primary\s*$/)) continue;

    const openMatch = block.match(/<OPENINGBALANCE[^>]*>([^<]*)<\/OPENINGBALANCE>/i);
    const closeMatch = block.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/i);
    const opening = openMatch ? parseFloat(openMatch[1].trim()) || 0 : 0;
    const closing = closeMatch ? parseFloat(closeMatch[1].trim()) || 0 : 0;

    if (opening === 0 && closing === 0) continue;

    groups.push({ name, opening, closing });
  }

  if (groups.length === 0) {
    return { success: true, message: 'No Trial Balance data found.', data: { groups: [], totalDebit: 0, totalCredit: 0 } };
  }

  // In Tally: positive = debit, negative = credit
  let totalDebit = 0;
  let totalCredit = 0;
  for (const g of groups) {
    if (g.closing >= 0) totalDebit += g.closing;
    else totalCredit += Math.abs(g.closing);
  }

  groups.sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));

  const fromStr = dateFrom ? formatTallyDate(dateFrom) : '';
  const toStr = dateTo ? formatTallyDate(dateTo) : '';
  const dateRange = fromStr && toStr ? `${fromStr} to ${toStr}` : 'Current FY';

  const lines = [`📋 *Trial Balance: ${dateRange}*`, ''];

  // Debit side
  const debitGroups = groups.filter(g => g.closing > 0);
  const creditGroups = groups.filter(g => g.closing < 0);

  if (debitGroups.length) {
    lines.push('*Debit:*');
    for (const g of debitGroups) {
      lines.push(`  📕 ${g.name}: ₹${inr(g.closing)}`);
    }
    lines.push(`  *Total Debit: ₹${inr(totalDebit)}*`);
    lines.push('');
  }

  if (creditGroups.length) {
    lines.push('*Credit:*');
    for (const g of creditGroups) {
      lines.push(`  📗 ${g.name}: ₹${inr(Math.abs(g.closing))}`);
    }
    lines.push(`  *Total Credit: ₹${inr(totalCredit)}*`);
    lines.push('');
  }

  lines.push(SEP);
  const diff = Math.abs(totalDebit - totalCredit);
  if (diff < 1) {
    lines.push('✅ *Balanced* (Debit = Credit)');
  } else {
    lines.push(`⚠️ *Difference: ₹${inr(diff)}*`);
  }

  return { success: true, message: lines.join('\n'), data: { groups, totalDebit, totalCredit, difference: totalDebit - totalCredit } };
}

module.exports = { buildTrialBalanceTdlXml, parseTrialBalanceTdlResponse };
