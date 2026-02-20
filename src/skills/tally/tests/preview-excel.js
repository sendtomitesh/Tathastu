/**
 * Generate sample Excel files to disk for visual inspection.
 * Run: node src/skills/tally/tests/preview-excel.js
 * Output: src/skills/tally/tests/excel-samples/*.xlsx
 */
const fs = require('fs');
const path = require('path');
const { reportToExcel } = require('../tdl/excel-export');

const outDir = path.join(__dirname, 'excel-samples');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function generate(name, reportName, data) {
  const result = await reportToExcel(reportName, data);
  if (!result) { console.log(`  ✗ ${name}: null result`); return; }
  const fp = path.join(outDir, result.filename);
  fs.writeFileSync(fp, result.buffer);
  console.log(`  ✓ ${name} → ${fp} (${result.buffer.length} bytes)`);
}

async function main() {
  console.log('\nGenerating sample Excel files...\n');

  // Trial Balance
  await generate('Trial Balance', 'Trial Balance', {
    groups: [
      { name: 'Capital Account', opening: 0, closing: -1500000 },
      { name: 'Current Liabilities', opening: 0, closing: -350000 },
      { name: 'Loans (Liability)', opening: 0, closing: -800000 },
      { name: 'Current Assets', opening: 0, closing: 1200000 },
      { name: 'Fixed Assets', opening: 0, closing: 950000 },
      { name: 'Sales Accounts', opening: 0, closing: -2500000 },
      { name: 'Purchase Accounts', opening: 0, closing: 1800000 },
      { name: 'Direct Expenses', opening: 0, closing: 150000 },
      { name: 'Indirect Expenses', opening: 0, closing: 450000 },
      { name: 'Indirect Income', opening: 0, closing: -50000 },
    ],
    totalDebit: 4550000, totalCredit: 5200000
  });

  // Balance Sheet
  await generate('Balance Sheet', 'Balance Sheet', {
    liabilities: [
      { name: 'Capital Account', closing: -1500000 },
      { name: 'Loans (Liability)', closing: -800000 },
      { name: 'Current Liabilities', closing: -350000 },
      { name: 'Sundry Creditors', closing: -200000 },
    ],
    assets: [
      { name: 'Fixed Assets', closing: 950000 },
      { name: 'Current Assets', closing: 1200000 },
      { name: 'Sundry Debtors', closing: 500000 },
      { name: 'Bank Accounts', closing: 200000 },
    ],
    totalLiabilities: 2850000, totalAssets: 2850000
  });

  // Profit & Loss
  await generate('Profit Loss', 'Profit and Loss', {
    groups: [
      { name: 'Sales Accounts', closingBalance: -2500000 },
      { name: 'Direct Incomes', closingBalance: -150000 },
      { name: 'Indirect Income', closingBalance: -50000 },
      { name: 'Purchase Accounts', closingBalance: 1800000 },
      { name: 'Direct Expenses', closingBalance: 150000 },
      { name: 'Indirect Expenses', closingBalance: 450000 },
    ],
    totalIncome: 2700000, totalExpense: 2400000, netProfit: 300000
  });

  // Sales Report
  await generate('Sales Report', 'Sales Report', {
    type: 'Sales',
    entries: [
      { date: '20260215', number: 'INV-001', amount: -150000, party: 'Meril Life Sciences Pvt Ltd' },
      { date: '20260216', number: 'INV-002', amount: -85000, party: 'Bhavesh Traders' },
      { date: '20260217', number: 'INV-003', amount: -220000, party: 'Afflink FZCO' },
      { date: '20260218', number: 'INV-004', amount: -45000, party: null },
      { date: '20260219', number: 'INV-005', amount: -310000, party: 'Meril Life Sciences Pvt Ltd' },
    ],
    byParty: {
      'Meril Life Sciences Pvt Ltd': { count: 2, total: 460000 },
      'Bhavesh Traders': { count: 1, total: 85000 },
      'Afflink FZCO': { count: 1, total: 220000 },
    },
    total: 810000
  });

  // Outstanding Receivable
  await generate('Outstanding Receivable', 'Outstanding Receivable', {
    entries: [
      { name: 'Meril Life Sciences Pvt Ltd', closingBalance: -350000 },
      { name: 'Bhavesh Traders', closingBalance: -125000 },
      { name: 'Afflink FZCO', closingBalance: -85000 },
      { name: 'Adithya Shetty', closingBalance: -42000 },
    ]
  });

  // Expenses
  await generate('Expenses', 'Expense Report', {
    entries: [
      { name: 'Rent', parent: 'Indirect Expenses', amount: 120000 },
      { name: 'Salary', parent: 'Indirect Expenses', amount: 450000 },
      { name: 'Electricity', parent: 'Indirect Expenses', amount: 35000 },
      { name: 'Internet', parent: 'Indirect Expenses', amount: 12000 },
      { name: 'Freight', parent: 'Direct Expenses', amount: 85000 },
    ]
  });

  // Stock Summary
  await generate('Stock Summary', 'Stock Summary', {
    items: [
      { name: 'USB Cable Type-C', qty: 5000, unit: 'Nos', rate: 45, closingValue: 225000 },
      { name: 'HDMI Cable 2m', qty: 2000, unit: 'Nos', rate: 120, closingValue: 240000 },
      { name: '2 BNC Connector', qty: 10000, unit: 'Nos', rate: 15, closingValue: 150000 },
    ]
  });

  // Vouchers (daybook)
  await generate('Vouchers', 'Daybook', [
    { date: '20260219', type: 'Sales', number: 'S001', party: 'Meril Life Sciences', amount: -150000, narration: 'Invoice for cables' },
    { date: '20260219', type: 'Payment', number: 'P001', party: 'Landlord', amount: 50000, narration: 'Office rent Feb' },
    { date: '20260219', type: 'Receipt', number: 'R001', party: 'Bhavesh Traders', amount: -85000, narration: 'Payment received' },
    { date: '20260219', type: 'Journal', number: 'J001', party: '', amount: 12000, narration: 'Depreciation entry' },
  ]);

  // Ledger List
  await generate('Ledger List', 'All Ledgers', [
    { name: 'HDFC Bank', parent: 'Bank Accounts' },
    { name: 'SBI', parent: 'Bank Accounts' },
    { name: 'Cash', parent: 'Cash-in-Hand' },
    { name: 'Meril Life Sciences Pvt Ltd', parent: 'Sundry Debtors' },
    { name: 'Bhavesh Traders', parent: 'Sundry Debtors' },
    { name: 'Rent', parent: 'Indirect Expenses' },
    { name: 'Salary', parent: 'Indirect Expenses' },
  ]);

  // Ledger Statement
  await generate('Ledger Statement', 'Ledger Statement - Meril', {
    entries: [
      { date: '20260201', type: 'Sales', number: 'INV-001', narration: 'Cable supply', amount: -150000 },
      { date: '20260205', type: 'Receipt', number: 'REC-001', narration: 'Payment received', amount: 100000 },
      { date: '20260210', type: 'Sales', number: 'INV-005', narration: 'Connector supply', amount: -85000 },
      { date: '20260215', type: 'Credit Note', number: 'CN-001', narration: 'Return', amount: 15000 },
    ]
  });

  // GST Summary
  await generate('GST Summary', 'GST Summary', {
    entries: [
      { name: 'CGST Output', closingBalance: -125000 },
      { name: 'SGST Output', closingBalance: -125000 },
      { name: 'IGST Output', closingBalance: -50000 },
      { name: 'CGST Input', closingBalance: 80000 },
      { name: 'SGST Input', closingBalance: 80000 },
    ]
  });

  console.log(`\nDone! Check: ${outDir}`);
}

main().catch(console.error);
