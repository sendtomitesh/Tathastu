const { escapeXml, decodeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

/**
 * Build TDL XML to fetch overdue bills with party contact details.
 * Fetches bills from Sundry Debtors (receivable) with due dates.
 */
function buildOverdueBillsTdlXml(companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OverdueBills</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="OverdueBills" ISMODIFY="No">
          <TYPE>Bill</TYPE>
          <BELONGSTO>Yes</BELONGSTO>
          <FETCH>Name, Parent, ClosingBalance, FinalDueDate</FETCH>
          <FILTER>OverdueNonZeroFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="OverdueNonZeroFilter">$ClosingBalance != 0</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Build TDL XML to fetch party ledger contact details (phone, email).
 */
function buildPartyContactsTdlXml(companyName) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PartyContacts</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="PartyContacts" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <CHILDOF>Sundry Debtors</CHILDOF>
          <FETCH>Name, LedgerPhone, LedgerContact, Email, LedgerMobile, ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse overdue bills and aggregate by party.
 */
function parseOverdueBillsResponse(xmlString) {
  const bills = [];
  const regex = /<BILL\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/BILL>/gi;
  let m;

  const today = new Date();
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

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
    // Only overdue bills (due date before today)
    if (!dueDate || dueDate >= todayStr) continue;

    const dueMs = new Date(
      parseInt(dueDate.slice(0, 4)),
      parseInt(dueDate.slice(4, 6)) - 1,
      parseInt(dueDate.slice(6, 8))
    ).getTime();
    const daysOverdue = Math.floor((today.getTime() - dueMs) / 86400000);

    bills.push({ billName: name, party: parent, amount: closing, dueDate, daysOverdue });
  }

  // Aggregate by party
  const partyMap = {};
  for (const bill of bills) {
    if (!partyMap[bill.party]) partyMap[bill.party] = { name: bill.party, totalDue: 0, bills: [], maxDaysOverdue: 0 };
    partyMap[bill.party].totalDue += Math.abs(bill.amount);
    partyMap[bill.party].bills.push(bill);
    if (bill.daysOverdue > partyMap[bill.party].maxDaysOverdue) {
      partyMap[bill.party].maxDaysOverdue = bill.daysOverdue;
    }
  }

  const parties = Object.values(partyMap);
  parties.sort((a, b) => b.totalDue - a.totalDue);

  return { bills, parties };
}

/**
 * Parse party contacts XML into a map of party name → phone/email.
 */
function parsePartyContactsResponse(xmlString) {
  const contacts = {};
  const regex = /<LEDGER\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/LEDGER>/gi;
  let m;

  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = decodeXml(m[1].trim());
    const extract = (tag) => {
      const mx = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return mx ? decodeXml(mx[1].trim()) : '';
    };
    const phone = extract('LEDGERMOBILE') || extract('LEDGERPHONE') || '';
    const email = extract('EMAIL') || '';
    const contact = extract('LEDGERCONTACT') || '';
    contacts[name] = { phone, email, contact };
  }

  return contacts;
}

/**
 * Generate a payment reminder message for a party.
 * @param {string} companyName - Your company name
 * @param {object} partyData - { name, totalDue, bills, maxDaysOverdue }
 * @returns {string} WhatsApp-formatted reminder message
 */
function generateReminderMessage(companyName, partyData) {
  const lines = [
    `Dear ${partyData.name},`,
    '',
    `This is a friendly reminder from *${companyName}* regarding your outstanding payment.`,
    '',
    `*Outstanding Amount: ₹${inr(partyData.totalDue)}*`,
    '',
    'Pending bills:',
  ];

  partyData.bills.forEach((b, i) => {
    lines.push(`${i + 1}. ${b.billName} — ₹${inr(Math.abs(b.amount))} (due: ${formatTallyDate(b.dueDate)}, ${b.daysOverdue} days overdue)`);
  });

  lines.push('');
  lines.push('Kindly arrange the payment at the earliest. If already paid, please ignore this message.');
  lines.push('');
  lines.push(`Thank you,`);
  lines.push(`*${companyName}*`);

  return lines.join('\n');
}

/**
 * Format the reminder preview/summary for the user.
 */
function formatReminderSummary(parties, contacts) {
  if (parties.length === 0) {
    return { success: true, message: 'No overdue bills found. All payments are on time! ✅', data: { reminders: [] } };
  }

  const reminders = [];
  const lines = [`📨 *Payment Reminders Ready*`, `${parties.length} parties with overdue bills`, ''];

  parties.forEach((p, i) => {
    const contact = contacts[p.name] || {};
    const phoneStr = contact.phone ? `📱 ${contact.phone}` : '❌ No phone';
    const canSend = !!contact.phone;
    lines.push(`${i + 1}. *${p.name}*`);
    lines.push(`   ₹${inr(p.totalDue)} | ${p.bills.length} bills | ${p.maxDaysOverdue}d overdue | ${phoneStr}`);
    reminders.push({
      party: p.name,
      totalDue: p.totalDue,
      billCount: p.bills.length,
      maxDaysOverdue: p.maxDaysOverdue,
      phone: contact.phone || null,
      email: contact.email || null,
      canSend,
      bills: p.bills,
    });
  });

  const totalDue = parties.reduce((s, p) => s + p.totalDue, 0);
  const canSendCount = reminders.filter(r => r.canSend).length;
  lines.push('', SEP);
  lines.push(`*Total Overdue: ₹${inr(totalDue)}*`);
  lines.push(`${canSendCount} of ${parties.length} parties have phone numbers.`);
  lines.push('');
  lines.push('Say *"send reminders"* to send WhatsApp messages to all parties with phone numbers.');
  lines.push('Or say *"send reminder to [party name]"* for a specific party.');

  return { success: true, message: lines.join('\n'), data: { reminders, totalDue } };
}

module.exports = {
  buildOverdueBillsTdlXml,
  buildPartyContactsTdlXml,
  parseOverdueBillsResponse,
  parsePartyContactsResponse,
  generateReminderMessage,
  formatReminderSummary,
};
