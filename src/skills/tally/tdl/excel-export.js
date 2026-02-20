const ExcelJS = require('exceljs');

/**
 * Generate an Excel buffer from tabular data.
 * @param {string} title - Sheet name / report title
 * @param {string[]} columns - Column headers
 * @param {Array<Array>} rows - Array of row arrays
 * @param {object} [options] - { totalsRow: [...values] }
 * @returns {Promise<Buffer>} Excel file as Buffer
 */
async function generateExcelBuffer(title, columns, rows, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tathastu';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title.slice(0, 31)); // Excel max 31 chars

  // Header row
  const headerRow = sheet.addRow(columns);
  headerRow.font = { bold: true, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
  headerRow.alignment = { horizontal: 'center' };

  // Data rows
  for (const row of rows) {
    sheet.addRow(row);
  }

  // Totals row if provided
  if (options.totalsRow) {
    const totRow = sheet.addRow(options.totalsRow);
    totRow.font = { bold: true, size: 11 };
    totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  }

  // Auto-width columns
  sheet.columns.forEach((col, i) => {
    let maxLen = columns[i] ? columns[i].length : 10;
    for (const row of rows) {
      const val = row[i] != null ? String(row[i]) : '';
      if (val.length > maxLen) maxLen = val.length;
    }
    col.width = Math.min(maxLen + 4, 50);
  });

  // Format number columns (detect by checking if most values are numbers)
  for (let ci = 0; ci < columns.length; ci++) {
    const numCount = rows.filter(r => typeof r[ci] === 'number').length;
    if (numCount > rows.length * 0.5) {
      // Apply Indian number format
      sheet.getColumn(ci + 1).numFmt = '#,##,##0.00';
      sheet.getColumn(ci + 1).alignment = { horizontal: 'right' };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Convert a parsed report result into Excel.
 * Supports various report types by detecting data shape.
 * @param {string} reportName - Name for the file/sheet
 * @param {object} data - Parsed data from any report
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
async function reportToExcel(reportName, data) {
  const safeName = reportName.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40);

  // Outstanding entries
  if (data.entries && data.entries[0] && 'closingBalance' in data.entries[0]) {
    const cols = ['#', 'Name', 'Balance (₹)'];
    const rows = data.entries.map((e, i) => [i + 1, e.name, Math.abs(e.closingBalance)]);
    const total = data.entries.reduce((s, e) => s + Math.abs(e.closingBalance), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', 'Total', total] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Expense entries (has .amount)
  if (data.entries && data.entries[0] && 'amount' in data.entries[0]) {
    const cols = ['#', 'Name', 'Amount (₹)'];
    const hasParent = data.entries[0].parent !== undefined;
    if (hasParent) cols.push('Group');
    const rows = data.entries.map((e, i) => {
      const row = [i + 1, e.name, Math.abs(e.amount)];
      if (hasParent) row.push(e.parent || '');
      return row;
    });
    const total = data.entries.reduce((s, e) => s + Math.abs(e.amount), 0);
    const totRow = ['', 'Total', total];
    if (hasParent) totRow.push('');
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: totRow });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Stock items
  if (data.items && data.items[0] && 'closingValue' in data.items[0]) {
    const cols = ['#', 'Item', 'Qty', 'Unit', 'Rate (₹)', 'Value (₹)'];
    const rows = data.items.map((item, i) => [i + 1, item.name, item.qty || 0, item.unit || '', item.rate || 0, item.closingValue]);
    const total = data.items.reduce((s, item) => s + item.closingValue, 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', 'Total', '', '', '', total] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // P&L / Trial Balance groups
  if (data.groups && data.groups[0] && 'closing' in data.groups[0]) {
    const cols = ['#', 'Group', 'Closing Balance (₹)'];
    const rows = data.groups.map((g, i) => [i + 1, g.name, g.closing]);
    const buf = await generateExcelBuffer(safeName, cols, rows);
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // P&L groups (closingBalance)
  if (data.groups && data.groups[0] && 'closingBalance' in data.groups[0]) {
    const cols = ['#', 'Group', 'Closing Balance (₹)'];
    const rows = data.groups.map((g, i) => [i + 1, g.name, g.closingBalance]);
    const buf = await generateExcelBuffer(safeName, cols, rows);
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Voucher entries (sales/purchase report)
  if (data.entries && data.entries[0] && 'number' in data.entries[0]) {
    const cols = ['#', 'Date', 'Voucher No', 'Party', 'Amount (₹)'];
    const rows = data.entries.map((v, i) => [i + 1, v.date || '', v.number || '', v.party || '', Math.abs(v.amount)]);
    const total = data.entries.reduce((s, v) => s + Math.abs(v.amount), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', '', '', 'Total', total] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Bills
  if (data.bills && data.bills[0]) {
    const cols = ['#', 'Bill Name', 'Balance (₹)', 'Due Date'];
    const rows = data.bills.map((b, i) => [i + 1, b.name, Math.abs(b.closingBalance), b.dueDate || '']);
    const total = data.bills.reduce((s, b) => s + Math.abs(b.closingBalance), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', 'Total', total, ''] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Invoices
  if (data.invoices && data.invoices[0]) {
    const cols = ['#', 'Date', 'Invoice No', 'Amount (₹)', 'Narration'];
    const rows = data.invoices.map((inv, i) => [i + 1, inv.date || '', inv.number || '', Math.abs(inv.amount), inv.narration || '']);
    const total = data.invoices.reduce((s, inv) => s + Math.abs(inv.amount), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', '', 'Total', total, ''] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Ageing buckets
  if (data.buckets && data.buckets[0]) {
    const cols = ['Age Bucket', 'Amount (₹)', 'Bills', 'Percentage'];
    const totalAmt = data.totalOutstanding || data.buckets.reduce((s, b) => s + b.amount, 0);
    const rows = data.buckets.map(b => [b.label, b.amount, b.count, totalAmt > 0 ? ((b.amount / totalAmt) * 100).toFixed(1) + '%' : '0%']);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['Total', totalAmt, data.totalBills || '', '100%'] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Ledger statement entries
  if (data.entries && data.entries[0] && 'type' in data.entries[0]) {
    const cols = ['#', 'Date', 'Type', 'Voucher No', 'Narration', 'Amount (₹)'];
    const rows = data.entries.map((e, i) => [i + 1, e.date || '', e.type || '', e.number || '', e.narration || '', e.amount]);
    const buf = await generateExcelBuffer(safeName, cols, rows);
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Ledger list (from list_ledgers — array of { name, parent })
  if (Array.isArray(data) && data.length > 0 && data[0].name !== undefined && data[0].parent !== undefined && !('amount' in data[0])) {
    const cols = ['#', 'Ledger Name', 'Group'];
    const rows = data.map((l, i) => [i + 1, l.name, l.parent || '']);
    const buf = await generateExcelBuffer(safeName, cols, rows);
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Flat voucher array (from get_vouchers — data is an array directly)
  if (Array.isArray(data) && data.length > 0 && data[0].date !== undefined && data[0].type !== undefined) {
    const cols = ['#', 'Date', 'Type', 'Voucher No', 'Party', 'Amount (₹)', 'Narration'];
    const rows = data.map((v, i) => [i + 1, v.date || '', v.type || '', v.number || '', v.party || '', Math.abs(v.amount), v.narration || '']);
    const total = data.reduce((s, v) => s + Math.abs(v.amount), 0);
    const buf = await generateExcelBuffer(safeName, cols, rows, { totalsRow: ['', '', '', '', 'Total', total, ''] });
    return { buffer: buf, filename: `${safeName}.xlsx` };
  }

  // Fallback: can't determine shape
  return null;
}

module.exports = { generateExcelBuffer, reportToExcel };
