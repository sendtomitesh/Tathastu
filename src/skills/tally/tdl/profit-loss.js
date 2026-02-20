const { escapeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

function buildProfitLossTdlXml(companyName, dateFrom, dateTo) {
  const svParts = ['<SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>'];
  if (companyName) svParts.push(`<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`);

  // Only set SVFROMDATE/SVTODATE when user provides explicit dates.
  // When omitted, Tally uses the company's own FY range which is always correct.
  if (dateFrom || dateTo) {
    const actualFrom = dateFrom || dateTo;
    const actualTo = dateTo || dateFrom;
    svParts.push(`<SVFROMDATE>${escapeXml(actualFrom)}</SVFROMDATE>`);
    svParts.push(`<SVTODATE>${escapeXml(actualTo)}</SVTODATE>`);
  }

  // Fetch ALL groups and filter P&L-related ones in JS.
  // Cannot use CHILDOF "Profit & Loss A/c" because TallyPrime uses
  // a control-char parent ("&#4; Primary") for top-level groups.
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PLGroups</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="PLGroups" ISMODIFY="No">
          <TYPE>Group</TYPE>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseProfitLossTdlResponse(xmlString, dateFrom, dateTo) {
  const groups = [];
  const regex = /<GROUP\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/GROUP>/gi;
  let m;

  // Known P&L group names in Tally (case-insensitive match)
  const plGroupNames = new Set([
    'sales accounts', 'purchase accounts',
    'direct incomes', 'direct income',
    'direct expenses',
    'indirect incomes', 'indirect income',
    'indirect expenses',
  ]);

  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = m[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim();
    const balMatch = block.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/i);
    const closing = balMatch ? parseFloat(balMatch[1].trim()) || 0 : 0;
    // Include only P&L-related groups with non-zero balance
    if (plGroupNames.has(name.toLowerCase()) && closing !== 0) {
      groups.push({ name, closingBalance: closing });
    }
  }

  if (groups.length === 0) {
    return { success: true, message: 'No P&L data found for this period.', data: { groups: [], netProfit: 0 } };
  }

  // Categorize by group NAME, not by sign (signs vary across companies)
  const incomeNames = new Set(['sales accounts', 'direct incomes', 'direct income', 'indirect incomes', 'indirect income']);
  const expenseNames = new Set(['purchase accounts', 'direct expenses', 'indirect expenses']);

  const income = groups.filter(g => incomeNames.has(g.name.toLowerCase()));
  const expense = groups.filter(g => expenseNames.has(g.name.toLowerCase()));
  const totalIncome = income.reduce((s, g) => s + Math.abs(g.closingBalance), 0);
  const totalExpense = expense.reduce((s, g) => s + Math.abs(g.closingBalance), 0);
  const netProfit = totalIncome - totalExpense;

  const fromStr = dateFrom ? formatTallyDate(dateFrom) : '';
  const toStr = dateTo ? formatTallyDate(dateTo) : '';
  const dateRange = fromStr && toStr ? `${fromStr} to ${toStr}` : 'Current FY';

  const lines = [`📊 *Profit & Loss: ${dateRange}*`, ''];

  if (income.length) {
    lines.push('*Income:*');
    income.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance));
    for (const g of income) lines.push(`  🟢 ${g.name}: ₹${inr(Math.abs(g.closingBalance))}`);
    lines.push(`  *Total Income: ₹${inr(totalIncome)}*`);
    lines.push('');
  }

  if (expense.length) {
    lines.push('*Expenses:*');
    expense.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance));
    for (const g of expense) lines.push(`  🔴 ${g.name}: ₹${inr(Math.abs(g.closingBalance))}`);
    lines.push(`  *Total Expense: ₹${inr(totalExpense)}*`);
    lines.push('');
  }

  lines.push(SEP);
  const profitLabel = netProfit >= 0 ? 'Net Profit' : 'Net Loss';
  const profitEmoji = netProfit >= 0 ? '✅' : '❌';
  lines.push(`${profitEmoji} *${profitLabel}: ₹${inr(netProfit)}*`);

  return { success: true, message: lines.join('\n'), data: { groups, totalIncome, totalExpense, netProfit } };
}

module.exports = { buildProfitLossTdlXml, parseProfitLossTdlResponse };
