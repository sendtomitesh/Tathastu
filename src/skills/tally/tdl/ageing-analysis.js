const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

/**
 * Build TDL XML to fetch bills for ageing analysis.
 * Fetches all pending bills across a group (Sundry Debtors or Sundry Creditors).
 */
function buildAgeingAnalysisTdlXml(groupName, companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  // First fetch all ledgers in the group with their closing balances
  // Then we'll fetch bills for each non-zero ledger
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AgeingBills</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="AgeingBills" ISMODIFY="No">
          <TYPE>Bill</TYPE>
          <BELONGSTO>Yes</BELONGSTO>
          <FETCH>Name, Parent, ClosingBalance, FinalDueDate</FETCH>
          <FILTER>AgeingNonZeroFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="AgeingNonZeroFilter">$ClosingBalance != 0</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse bill XML into ageing buckets.
 * Buckets: 0-30 days, 31-60 days, 61-90 days, 90+ days
 */
function parseAgeingAnalysisTdlResponse(xmlString, groupName) {
  const bills = [];
  const regex = /<BILL\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/BILL>/gi;
  let m;

  // Determine which group's ledgers to include
  const isReceivable = groupName.toLowerCase().includes('debtor');

  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = decodeXml(m[1].trim());
    const parentMatch = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/i);
    const parent = parentMatch ? decodeXml(parentMatch[1].trim()) : '';
    const balMatch = block.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/i);
    const closing = balMatch ? parseFloat(balMatch[1].trim()) || 0 : 0;
    const dueDateMatch = block.match(/<FINALDUEDATE[^>]*>([^<]*)<\/FINALDUEDATE>/i);
    const dueDate = dueDateMatch ? dueDateMatch[1].trim() : '';

    if (closing === 0) continue;
    bills.push({ billName: name, party: parent, amount: closing, dueDate });
  }

  if (bills.length === 0) {
    return { success: true, message: `No pending bills found for ageing analysis.`, data: { buckets: [], parties: [], totalOutstanding: 0 } };
  }

  // Calculate ageing based on due date (or today if no due date)
  const today = new Date();
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  const buckets = [
    { label: '0-30 days', min: 0, max: 30, amount: 0, count: 0 },
    { label: '31-60 days', min: 31, max: 60, amount: 0, count: 0 },
    { label: '61-90 days', min: 61, max: 90, amount: 0, count: 0 },
    { label: '90+ days', min: 91, max: Infinity, amount: 0, count: 0 },
  ];

  // Also aggregate by party
  const partyMap = {};

  for (const bill of bills) {
    let daysOld = 0;
    if (bill.dueDate && bill.dueDate.length === 8) {
      const dueMs = new Date(
        parseInt(bill.dueDate.slice(0, 4)),
        parseInt(bill.dueDate.slice(4, 6)) - 1,
        parseInt(bill.dueDate.slice(6, 8))
      ).getTime();
      daysOld = Math.max(0, Math.floor((today.getTime() - dueMs) / 86400000));
    }

    const absAmount = Math.abs(bill.amount);
    for (const bucket of buckets) {
      if (daysOld >= bucket.min && daysOld <= bucket.max) {
        bucket.amount += absAmount;
        bucket.count++;
        break;
      }
    }

    if (!partyMap[bill.party]) partyMap[bill.party] = { name: bill.party, total: 0, billCount: 0, oldestDays: 0 };
    partyMap[bill.party].total += absAmount;
    partyMap[bill.party].billCount++;
    if (daysOld > partyMap[bill.party].oldestDays) partyMap[bill.party].oldestDays = daysOld;
  }

  const totalOutstanding = bills.reduce((s, b) => s + Math.abs(b.amount), 0);
  const parties = Object.values(partyMap);
  parties.sort((a, b) => b.total - a.total);

  const label = isReceivable ? 'Receivable' : 'Payable';
  const lines = [`📊 *Ageing Analysis — ${label}*`, ''];

  // Bucket summary
  lines.push('*By Age:*');
  const bucketEmojis = ['🟢', '🟡', '🟠', '🔴'];
  buckets.forEach((b, i) => {
    if (b.amount > 0) {
      const pct = totalOutstanding > 0 ? ((b.amount / totalOutstanding) * 100).toFixed(1) : '0.0';
      lines.push(`  ${bucketEmojis[i]} ${b.label}: ₹${inr(b.amount)} (${b.count} bills, ${pct}%)`);
    }
  });
  lines.push('');

  // Top parties with oldest dues
  const topParties = parties.slice(0, 10);
  if (topParties.length) {
    lines.push('*Top Parties:*');
    topParties.forEach((p, i) => {
      const ageLabel = p.oldestDays > 90 ? ' ⚠️' : '';
      lines.push(`${i + 1}. ${p.name}: ₹${inr(p.total)} (${p.billCount} bills, oldest: ${p.oldestDays}d${ageLabel})`);
    });
    lines.push('');
  }

  lines.push(SEP);
  lines.push(`*Total Outstanding: ₹${inr(totalOutstanding)}* (${bills.length} bills, ${parties.length} parties)`);

  return { success: true, message: lines.join('\n'), data: { buckets, parties: topParties, totalOutstanding, totalBills: bills.length } };
}

module.exports = { buildAgeingAnalysisTdlXml, parseAgeingAnalysisTdlResponse };
