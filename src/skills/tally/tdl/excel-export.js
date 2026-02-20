const ExcelJS = require('exceljs');
const { formatTallyDate } = require('./helpers');

const INR_FMT = '#,##,##0.00';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
const HEADER_FONT = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const TOTAL_FONT = { bold: true, size: 11 };

/**
 * Create a workbook with standard Tathastu styling.
 */
function createWorkbook(sheetName) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tathastu';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  return { wb, ws };
}

/** Add a styled header row */
function addHeader(ws, cols) {
  const row = ws.addRow(cols);
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { horizontal: 'center' };
  return row;
}

/** Add a section label row spanning all columns */
function addSection(ws, label, colCount) {
  const row = ws.addRow([label]);
  ws.mergeCells(row.number, 1, row.number, colCount);
  row.font = { bold: true, size: 11 };
  row.fill = SECTION_FILL;
  return row;
}

/** Add a totals row */
function addTotal(ws, values) {
  const row = ws.addRow(values);
  row.font = TOTAL_FONT;
  row.fill = TOTAL_FILL;
  return row;
}

/** Auto-fit column widths and apply INR format to number columns */
function autoFit(ws, cols, rows) {
  ws.columns.forEach((col, i) => {
    let maxLen = cols[i] ? cols[i].length : 10;
    for (const r of rows) {
      const val = r[i] != null ? String(r[i]) : '';
      if (val.length > maxLen) maxLen = val.length;
    }
    col.width = Math.min(maxLen + 4, 50);
  });
  for (let ci = 0; ci < cols.length; ci++) {
    const numCount = rows.filter(r => typeof r[ci] === 'number').length;
    if (numCount > rows.length * 0.5) {
      ws.getColumn(ci + 1).numFmt = INR_FMT;
      ws.getColumn(ci + 1).alignment = { horizontal: 'right' };
    }
  }
}

/** Format Tally date (YYYYMMDD) to DD-MM-YYYY */
function fmtDate(d) { return formatTallyDate(d); }

/**
 * Generate a basic Excel buffer (used by simple report types).
 */
async function generateExcelBuffer(title, columns, rows, options = {}) {
  const { wb, ws } = createWorkbook(title);
  addHeader(ws, columns);
  for (const row of rows) ws.addRow(row);
  if (options.totalsRow) addTotal(ws, options.totalsRow);
  autoFit(ws, columns, rows);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ═══════════════════════════════════════════════════════════
// Trial Balance — Tally standard: Particulars | Debit | Credit
// ═══════════════════════════════════════════════════════════
async function trialBalanceToExcel(safeName, data) {
  const { wb, ws } = createWorkbook(safeName);
  const cols = ['Particulars', 'Debit (₹)', 'Credit (₹)'];
  addHeader(ws, cols);

  const groups = data.groups || [];
  const rows = [];
  for (const g of groups) {
    const debit = g.closing > 0 ? g.closing : 0;
    const credit = g.closing < 0 ? Math.abs(g.closing) : 0;
    rows.push([g.name, debit || '', credit || '']);
    ws.addRow([g.name, debit || '', credit || '']);
  }

  const totalDebit = data.totalDebit || groups.filter(g => g.closing > 0).reduce((s, g) => s + g.closing, 0);
  const totalCredit = data.totalCredit || groups.filter(g => g.closing < 0).reduce((s, g) => s + Math.abs(g.closing), 0);
  addTotal(ws, ['Total', totalDebit, totalCredit]);

  const diff = Math.abs(totalDebit - totalCredit);
  if (diff < 1) {
    ws.addRow([]);
    ws.addRow(['✅ Balanced (Debit = Credit)']);
  } else {
    ws.addRow([]);
    ws.addRow([`⚠️ Difference: ₹${diff.toFixed(2)}`]);
  }

  autoFit(ws, cols, rows);
  ws.getColumn(2).numFmt = INR_FMT;
  ws.getColumn(3).numFmt = INR_FMT;
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), filename: `${safeName}.xlsx` };
}

// ═══════════════════════════════════════════════════════════
// Balance Sheet — Tally standard: Liabilities & Assets sections
// ═══════════════════════════════════════════════════════════
async function balanceSheetToExcel(safeName, data) {
  const { wb, ws } = createWorkbook(safeName);
  const cols = ['Particulars', 'Amount (₹)'];
  addHeader(ws, cols);

  const rows = [];

  // Liabilities section
  if (data.liabilities && data.liabilities.length) {
    addSection(ws, 'LIABILITIES & CAPITAL', 2);
    for (const g of data.liabilities) {
      const amt = Math.abs(g.closing);
      rows.push([g.name, amt]);
      ws.addRow([g.name, amt]);
    }
    addTotal(ws, ['Total Liabilities', data.totalLiabilities || 0]);
    ws.addRow([]);
  }

  // Assets section
  if (data.assets && data.assets.length) {
    addSection(ws, 'ASSETS', 2);
    for (const g of data.assets) {
      const amt = Math.abs(g.closing);
      rows.push([g.name, amt]);
      ws.addRow([g.name, amt]);
    }
    addTotal(ws, ['Total Assets', data.totalAssets || 0]);
  }

  const diff = Math.abs((data.totalAssets || 0) - (data.totalLiabilities || 0));
  ws.addRow([]);
  if (diff < 1) {
    ws.addRow(['✅ Balanced (Assets = Liabilities)']);
  } else {
    ws.addRow([`⚠️ Difference: ₹${diff.toFixed(2)}`]);
  }

  autoFit(ws, cols, rows);
  ws.getColumn(2).numFmt = INR_FMT;
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), filename: `${safeName}.xlsx` };
}

// ═══════════════════════════════════════════════════════════
// Profit & Loss — Tally standard: Income section, Expense section, Net Profit
// ═══════════════════════════════════════════════════════════
async function profitLossToExcel(safeName, data) {
  const { wb, ws } = createWorkbook(safeName);
  const cols = ['Particulars', 'Amount (₹)'];
  addHeader(ws, cols);

  const incomeNames = new Set(['sales accounts', 'direct incomes', 'direct income', 'indirect incomes', 'indirect income']);
  const expenseNames = new Set(['purchase accounts', 'direct expenses', 'indirect expenses']);

  const groups = data.groups || [];
  const income = groups.filter(g => incomeNames.has(g.name.toLowerCase()));
  const expense = groups.filter(g => expenseNames.has(g.name.toLowerCase()));

  const rows = [];

  // Income section
  addSection(ws, 'INCOME', 2);
  income.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance));
  for (const g of income) {
    const amt = Math.abs(g.closingBalance);
    rows.push([g.name, amt]);
    ws.addRow([g.name, amt]);
  }
  const totalIncome = data.totalIncome || income.reduce((s, g) => s + Math.abs(g.closingBalance), 0);
  addTotal(ws, ['Total Income', totalIncome]);
  ws.addRow([]);

  // Expense section
  addSection(ws, 'EXPENSES', 2);
  expense.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance));
  for (const g of expense) {
    const amt = Math.abs(g.closingBalance);
    rows.push([g.name, amt]);
    ws.addRow([g.name, amt]);
  }
  const totalExpense = data.totalExpense || expense.reduce((s, g) => s + Math.abs(g.closingBalance), 0);
  addTotal(ws, ['Total Expenses', totalExpense]);
  ws.addRow([]);

  // Net Profit/Loss
  const netProfit = data.netProfit != null ? data.netProfit : (totalIncome - totalExpense);
  const label = netProfit >= 0 ? 'Net Profit' : 'Net Loss';
  const row = ws.addRow([label, Math.abs(netProfit)]);
  row.font = { bold: true, size: 12 };
  row.fill = netProfit >= 0
    ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }
    : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };

  autoFit(ws, cols, rows);
  ws.getColumn(2).numFmt = INR_FMT;
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), filename: `${safeName}.xlsx` };
}

// ═══════════════════════════════════════════════════════════
// Sales/Purchase Report — with proper party names and date formatting
// ═══════════════════════════════════════════════════════════
async function salesPurchaseToExcel(safeName, data) {
  const { wb, ws } = createWorkbook(safeName);
  const entries = data.entries || [];
  const cols = ['#', 'Date', 'Voucher No', 'Party Name', 'Amount (₹)'];
  addHeader(ws, cols);

  const rows = [];
  for (let i = 0; i < entries.length; i++) {
    const v = entries[i];
    const row = [i + 1, fmtDate(v.date), v.number || '', v.party || 'N/A', Math.abs(v.amount)];
    rows.push(row);
    ws.addRow(row);
  }

  const total = entries.reduce((s, v) => s + Math.abs(v.amount), 0);
  addTotal(ws, ['', '', '', 'Total', total]);

  // Party-wise summary below
  if (data.byParty && Object.keys(data.byParty).length > 0) {
    ws.addRow([]);
    addSection(ws, 'PARTY-WISE SUMMARY', 5);
    addHeader(ws, ['#', 'Party Name', 'Invoices', 'Total Amount (₹)', '']);
    const sorted = Object.entries(data.byParty).sort((a, b) => b[1].total - a[1].total);
    sorted.forEach(([party, info], i) => {
      ws.addRow([i + 1, party || 'N/A', info.count, info.total, '']);
    });
  }

  autoFit(ws, cols, rows);
  ws.getColumn(5).numFmt = INR_FMT;
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), filename: `${safeName}.xlsx` };
}

// ═══════════════════════════════════════════════════════════
// Main dispatcher — detect data shape and route to proper formatter
// ═══════════════════════════════════════════════════════════
async function reportToExcel(reportName, data) {
  const safeName = reportName.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40);

  // Trial Balance (groups with .closing + totalDebit/totalCredit)
  if (data.groups && data.totalDebit !== undefined && data.totalCredit !== undefined) {
    return trialBalanceToExcel(safeName, data);
  }

  // P&L (groups with .closingBalance + netProfit)
  if (data.groups && data.netProfit !== undefined) {
    return profitLossToExcel(safeName, data);
  }

  // Balance Sheet (assets + liabilities)
  if (data.assets && data.liabilities) {
    return balanceSheetToExcel(safeName, data);
  }

  // Sales/Purchase report (entries with .party + byParty summary)
  if (data.entries && data.byParty) {
    return salesPurchaseToExcel(safeName, data);
  }

  // Outstanding entries (entries with .closingBalance)
  if (data.entries && data.entries[0] && 'closingBalance' in data.entries[0]) {
    const cols = ['#', 'Party Name', 'Balance (₹)'];
    const rows = data.entries.map((e, i) => [i + 1, e.name, Math.abs(e.closingBalance)]);
    const total = data.entries.reduce((s, e) => s + Math.abs(e.closingBalance), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', 'Total', total] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Expense entries (entries with .amount + .parent)
  if (data.entries && data.entries[0] && 'amount' in data.entries[0] && 'parent' in data.entries[0]) {
    const cols = ['#', 'Expense Head', 'Group', 'Amount (₹)'];
    const rows = data.entries.map((e, i) => [i + 1, e.name, e.parent || '', Math.abs(e.amount)]);
    const total = data.entries.reduce((s, e) => s + Math.abs(e.amount), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', '', 'Total', total] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Cash/Bank entries (entries with .amount, no .parent)
  if (data.entries && data.entries[0] && 'amount' in data.entries[0]) {
    const cols = ['#', 'Account', 'Balance (₹)'];
    const rows = data.entries.map((e, i) => [i + 1, e.name, Math.abs(e.amount)]);
    const total = data.entries.reduce((s, e) => s + Math.abs(e.amount), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', 'Total', total] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Stock items
  if (data.items && data.items[0] && 'closingValue' in data.items[0]) {
    const cols = ['#', 'Item Name', 'Qty', 'Unit', 'Rate (₹)', 'Value (₹)'];
    const rows = data.items.map((item, i) => [i + 1, item.name, item.qty || 0, item.unit || '', item.rate || 0, item.closingValue]);
    const total = data.items.reduce((s, item) => s + item.closingValue, 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', 'Total', '', '', '', total] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // P&L groups fallback (closingBalance without netProfit)
  if (data.groups && data.groups[0] && 'closingBalance' in data.groups[0]) {
    const cols = ['#', 'Group', 'Closing Balance (₹)'];
    const rows = data.groups.map((g, i) => [i + 1, g.name, g.closingBalance]);
    const buf = await generateExcelBuffer(safeName, cols, rows);
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Trial Balance groups fallback (closing without totalDebit)
  if (data.groups && data.groups[0] && 'closing' in data.groups[0]) {
    const cols = ['Particulars', 'Debit (₹)', 'Credit (₹)'];
    const rows = data.groups.map(g => [g.name, g.closing > 0 ? g.closing : '', g.closing < 0 ? Math.abs(g.closing) : '']);
    const buf = await generateExcelBuffer(safeName, cols, rows);
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Bills
  if (data.bills && data.bills[0]) {
    const cols = ['#', 'Bill Name', 'Amount (₹)', 'Due Date', 'Overdue Days'];
    const now = new Date();
    const rows = data.bills.map((b, i) => {
      const due = b.dueDate ? fmtDate(b.dueDate) : '';
      let overdue = '';
      if (b.dueDate && b.dueDate.length === 8) {
        const dueD = new Date(b.dueDate.slice(0, 4) + '-' + b.dueDate.slice(4, 6) + '-' + b.dueDate.slice(6, 8));
        const days = Math.floor((now - dueD) / 86400000);
        if (days > 0) overdue = days;
      }
      return [i + 1, b.name, Math.abs(b.closingBalance), due, overdue];
    });
    const total = data.bills.reduce((s, b) => s + Math.abs(b.closingBalance), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', 'Total', total, '', ''] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Invoices
  if (data.invoices && data.invoices[0]) {
    const cols = ['#', 'Date', 'Invoice No', 'Amount (₹)', 'Narration'];
    const rows = data.invoices.map((inv, i) => [i + 1, fmtDate(inv.date), inv.number || '', Math.abs(inv.amount), inv.narration || '']);
    const total = data.invoices.reduce((s, inv) => s + Math.abs(inv.amount), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', '', 'Total', total, ''] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Ageing buckets
  if (data.buckets && data.buckets[0]) {
    const cols = ['Age Bucket', 'Amount (₹)', 'No. of Bills', 'Percentage'];
    const totalAmt = data.totalOutstanding || data.buckets.reduce((s, b) => s + b.amount, 0);
    const rows = data.buckets.map(b => [b.label, b.amount, b.count, totalAmt > 0 ? ((b.amount / totalAmt) * 100).toFixed(1) + '%' : '0%']);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['Total', totalAmt, data.totalBills || '', '100%'] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Ledger statement entries
  if (data.entries && data.entries[0] && 'type' in data.entries[0]) {
    const cols = ['#', 'Date', 'Voucher Type', 'Voucher No', 'Narration', 'Debit (₹)', 'Credit (₹)'];
    const rows = data.entries.map((e, i) => {
      const debit = e.amount > 0 ? e.amount : '';
      const credit = e.amount < 0 ? Math.abs(e.amount) : '';
      return [i + 1, fmtDate(e.date), e.type || '', e.number || '', e.narration || '', debit, credit];
    });
    const buf = await generateExcelBuffer(safeName, cols, rows);
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Ledger list (array of { name, parent })
  if (Array.isArray(data) && data.length > 0 && data[0].name !== undefined && data[0].parent !== undefined && !('amount' in data[0])) {
    const cols = ['#', 'Ledger Name', 'Group'];
    const rows = data.map((l, i) => [i + 1, l.name, l.parent || '']);
    const buf = await generateExcelBuffer(safeName, cols, rows);
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Flat voucher array (from get_vouchers)
  if (Array.isArray(data) && data.length > 0 && data[0].date !== undefined && data[0].type !== undefined) {
    const cols = ['#', 'Date', 'Voucher Type', 'Voucher No', 'Party Name', 'Amount (₹)', 'Narration'];
    const rows = data.map((v, i) => [i + 1, fmtDate(v.date), v.type || '', v.number || '', v.party || 'N/A', Math.abs(v.amount), v.narration || '']);
    const total = data.reduce((s, v) => s + Math.abs(v.amount), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', '', '', '', 'Total', total, ''] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  return null;
}

module.exports = { generateExcelBuffer, reportToExcel };
