const { escapeXml, formatTallyDate } = require('./helpers');
const { SEP, inr } = require('./formatters');

/**
 * Build TDL XML to fetch all groups for Balance Sheet.
 * Same query as Trial Balance — we filter in JS.
 */
function buildBalanceSheetTdlXml(companyName, dateFrom, dateTo) {
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
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BSGroups</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${svParts.join('\n        ')}</STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="BSGroups" ISMODIFY="No">
          <TYPE>Group</TYPE>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Parse group XML into Balance Sheet format.
 * Balance Sheet groups = everything EXCEPT P&L groups.
 * Assets (debit balance): Current Assets, Fixed Assets, Investments, Misc. Expenses, etc.
 * Liabilities (credit balance): Capital Account, Loans, Current Liabilities, etc.
 */
function parseBalanceSheetTdlResponse(xmlString, dateFrom, dateTo) {
  const groups = [];
  const regex = /<GROUP\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/GROUP>/gi;
  let m;

  // P&L group names to EXCLUDE from Balance Sheet
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
    const parentMatch = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/i);
    const parent = parentMatch ? parentMatch[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim() : '';

    // Only top-level groups
    if (parent && parent !== 'Primary' && !parent.match(/^\s*Primary\s*$/)) continue;
    // Exclude P&L groups
    if (plGroupNames.has(name.toLowerCase())) continue;

    const closeMatch = block.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/i);
    const closing = closeMatch ? parseFloat(closeMatch[1].trim()) || 0 : 0;
    if (closing === 0) continue;

    groups.push({ name, closing });
  }

  if (groups.length === 0) {
    return { success: true, message: 'No Balance Sheet data found.', data: { assets: [], liabilities: [], totalAssets: 0, totalLiabilities: 0 } };
  }

  // Known asset group names in Tally
  const assetNames = new Set([
    'current assets', 'fixed assets', 'investments',
    'misc. expenses (asset)', 'miscellaneous expenses (asset)',
    'stock-in-hand', 'deposits (asset)', 'deposits',
    'loans & advances (asset)', 'loans (asset)',
    'bank accounts', 'cash-in-hand',
    'sundry debtors', 'bank od a/c',
  ]);

  // Known liability group names
  const liabilityNames = new Set([
    'capital account', 'reserves & surplus',
    'current liabilities', 'loans (liability)',
    'secured loans', 'unsecured loans',
    'sundry creditors', 'duties & taxes',
    'provisions', 'suspense a/c',
    'branch / divisions',
  ]);

  // Categorize: positive balance = debit (typically asset), negative = credit (typically liability)
  // But use known names for accuracy
  const assets = [];
  const liabilities = [];

  for (const g of groups) {
    const lower = g.name.toLowerCase();
    if (assetNames.has(lower)) {
      assets.push(g);
    } else if (liabilityNames.has(lower)) {
      liabilities.push(g);
    } else {
      // Fallback: positive = asset, negative = liability
      if (g.closing > 0) assets.push(g);
      else liabilities.push(g);
    }
  }

  const totalAssets = assets.reduce((s, g) => s + Math.abs(g.closing), 0);
  const totalLiabilities = liabilities.reduce((s, g) => s + Math.abs(g.closing), 0);

  assets.sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
  liabilities.sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));

  const toStr = dateTo ? formatTallyDate(dateTo) : '';
  const dateLabel = toStr ? `as on ${toStr}` : 'Current FY';

  const lines = [`🏦 *Balance Sheet: ${dateLabel}*`, ''];

  if (liabilities.length) {
    lines.push('*Liabilities & Capital:*');
    for (const g of liabilities) {
      lines.push(`  📗 ${g.name}: ₹${inr(Math.abs(g.closing))}`);
    }
    lines.push(`  *Total: ₹${inr(totalLiabilities)}*`);
    lines.push('');
  }

  if (assets.length) {
    lines.push('*Assets:*');
    for (const g of assets) {
      lines.push(`  📕 ${g.name}: ₹${inr(Math.abs(g.closing))}`);
    }
    lines.push(`  *Total: ₹${inr(totalAssets)}*`);
    lines.push('');
  }

  lines.push(SEP);
  const diff = Math.abs(totalAssets - totalLiabilities);
  if (diff < 1) {
    lines.push('✅ *Balanced* (Assets = Liabilities)');
  } else {
    lines.push(`⚠️ *Difference: ₹${inr(diff)}*`);
  }

  return { success: true, message: lines.join('\n'), data: { assets, liabilities, totalAssets, totalLiabilities, difference: totalAssets - totalLiabilities } };
}

module.exports = { buildBalanceSheetTdlXml, parseBalanceSheetTdlResponse };
