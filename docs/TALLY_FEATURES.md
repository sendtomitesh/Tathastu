# Tally Features for WhatsApp Bot

## Current Features ✅
1. **Get Ledger** - Get ledger statement for a party
2. **Get Vouchers** - Fetch vouchers by date range and type
3. **List Ledgers** - List all ledgers, optionally filtered by group

---

## Proposed Features (Priority Order)

### 🔴 High Priority - Core Accounting Operations

#### 1. **GST Reports & Information**
- **Get GST Summary** - Get GST summary for a party (GSTIN, tax liability, input/output tax)
  - Parameters: `party_name`, `date_from`, `date_to`
  - Example: "Get GST for ABC Company", "Show GST summary for XYZ party for last month"
  
- **Get GST Sales Report** - Get sales with GST details
  - Parameters: `party_name` (optional), `date_from`, `date_to`
  - Example: "Show GST sales for January 2025"
  
- **Get GST Purchase Report** - Get purchases with GST details
  - Parameters: `party_name` (optional), `date_from`, `date_to`
  - Example: "Get GST purchases for last quarter"

- **Get Party GSTIN** - Get GSTIN number for a party
  - Parameters: `party_name`
  - Example: "What is the GSTIN for ABC Company?"

#### 2. **Outstanding Reports**
- **Get Outstanding Receivables** - Get amount receivable from customers
  - Parameters: `party_name` (optional), `as_on_date` (optional)
  - Example: "Show outstanding receivables", "How much does ABC owe us?"
  
- **Get Outstanding Payables** - Get amount payable to suppliers
  - Parameters: `party_name` (optional), `as_on_date` (optional)
  - Example: "Show outstanding payables", "How much do we owe XYZ?"

- **Get Age-wise Outstanding** - Get outstanding broken down by age (0-30, 31-60, 61-90, 90+ days)
  - Parameters: `party_name` (optional), `as_on_date` (optional)
  - Example: "Show age-wise outstanding for ABC party"

#### 3. **Financial Reports**
- **Get Profit & Loss** - Get P&L statement
  - Parameters: `date_from`, `date_to`, `period` (optional: monthly, quarterly, yearly)
  - Example: "Show profit and loss for last month", "Get P&L for Q1 2025"
  
- **Get Balance Sheet** - Get balance sheet
  - Parameters: `as_on_date` (optional)
  - Example: "Show balance sheet", "Get balance sheet as on 31st March 2025"
  
- **Get Cash Flow** - Get cash flow statement
  - Parameters: `date_from`, `date_to`
  - Example: "Show cash flow for last quarter"

#### 4. **Enhanced Ledger Operations**
- **Get Ledger with Balance** - Enhanced ledger with opening/closing balance and summary
  - Parameters: `party_name`, `date_from`, `date_to`
  - Example: "Get ledger for ABC with balance from Jan to March"
  
- **Get Ledger Summary** - Quick summary (opening, closing, total debit, total credit)
  - Parameters: `party_name`, `date_from`, `date_to`
  - Example: "Show summary for XYZ party"

---

### 🟡 Medium Priority - Inventory & Stock

#### 5. **Stock & Inventory**
- **Get Stock Summary** - Get stock summary for items
  - Parameters: `item_name` (optional), `godown` (optional), `as_on_date` (optional)
  - Example: "Show stock summary", "What is the stock of Product X?"
  
- **Get Stock Valuation** - Get stock value
  - Parameters: `item_name` (optional), `godown` (optional), `as_on_date` (optional)
  - Example: "Show stock valuation", "What is the value of Product Y stock?"
  
- **Get Low Stock Items** - Get items below reorder level
  - Parameters: `threshold` (optional)
  - Example: "Show low stock items", "Which items need restocking?"
  
- **Get Stock Movement** - Get stock in/out movements
  - Parameters: `item_name` (optional), `date_from`, `date_to`
  - Example: "Show stock movement for Product X in January"

#### 6. **Item & Product Information**
- **Get Item Details** - Get details of a stock item
  - Parameters: `item_name`
  - Example: "Get details for Product ABC"
  
- **List Stock Items** - List all stock items
  - Parameters: `group_filter` (optional: e.g., "Raw Materials", "Finished Goods")
  - Example: "List all stock items", "Show finished goods items"

---

### 🟢 Lower Priority - Additional Features

#### 7. **Banking & Cash**
- **Get Bank Balance** - Get balance for bank accounts
  - Parameters: `bank_name` (optional), `as_on_date` (optional)
  - Example: "Show bank balance", "What is HDFC bank balance?"
  
- **Get Cash Balance** - Get cash balance
  - Parameters: `as_on_date` (optional)
  - Example: "Show cash balance"
  
- **Get Bank Statement** - Get bank statement
  - Parameters: `bank_name`, `date_from`, `date_to`
  - Example: "Get HDFC bank statement for January"

#### 8. **Voucher Operations** (Enhanced)
- **Get Voucher Details** - Get detailed information about a specific voucher
  - Parameters: `voucher_number`, `voucher_type` (optional)
  - Example: "Get details of voucher number 123"
  
- **Get Vouchers by Party** - Get vouchers for a specific party
  - Parameters: `party_name`, `date_from`, `date_to`, `voucher_type` (optional)
  - Example: "Show all vouchers for ABC party in January"

#### 9. **Masters & Lists**
- **List Parties** - List all parties (customers/suppliers)
  - Parameters: `party_type` (optional: "Sundry Debtors", "Sundry Creditors"), `group_filter` (optional)
  - Example: "List all customers", "Show all suppliers"
  
- **Get Party Details** - Get complete details of a party
  - Parameters: `party_name`
  - Example: "Get details for ABC Company"
  
- **List Groups** - List all groups
  - Parameters: `parent_group` (optional)
  - Example: "List all groups", "Show groups under Assets"

#### 10. **Sales & Purchase Reports**
- **Get Sales Summary** - Get sales summary
  - Parameters: `party_name` (optional), `date_from`, `date_to`
  - Example: "Show sales for last month", "Get sales for ABC party"
  
- **Get Purchase Summary** - Get purchase summary
  - Parameters: `party_name` (optional), `date_from`, `date_to`
  - Example: "Show purchases for last quarter"

#### 11. **Cost & Pricing**
- **Get Item Price** - Get selling/purchase price of an item
  - Parameters: `item_name`, `price_type` (optional: "selling", "purchase")
  - Example: "What is the price of Product X?", "Get purchase price for Item Y"

---

## Implementation Notes

### Tally XML API Collections Available:
- **Reports**: Profit & Loss, Balance Sheet, Cash Flow, Stock Summary, Stock Valuation
- **Outstanding Reports**: Receivables, Payables, Age-wise Outstanding
- **GST Reports**: GSTR-1, GSTR-2, GST Summary, GST Sales/Purchase
- **Masters**: List of Ledgers, List of Stock Items, List of Groups, List of Parties
- **Transactions**: Day Book, Vouchers, Ledger Entries
- **Inventory**: Stock Summary, Stock Valuation, Stock Movement

### Natural Language Examples:
- "Get GST for ABC Company"
- "Show outstanding receivables"
- "What is the profit and loss for last month?"
- "Get stock summary for Product X"
- "Show bank balance"
- "List all customers"
- "Get ledger for XYZ party from Jan to March"

### Response Format Considerations:
- **Summaries**: Keep responses concise for WhatsApp (2-3 lines summary + key numbers)
- **Detailed Data**: For complex reports, provide summary first, then offer to send details
- **Tables**: Format as simple text tables or bullet points
- **Dates**: Support natural language dates ("last month", "Q1 2025", "January 2025")

---

## Priority Implementation Order

**Phase 1 (Immediate):**
1. Get GST Summary for Party
2. Get Outstanding Receivables/Payables
3. Get Profit & Loss
4. Get Balance Sheet

**Phase 2 (Next):**
5. Get Stock Summary
6. Get Bank Balance
7. Enhanced Ledger with Balance
8. Get Party GSTIN

**Phase 3 (Later):**
9. Age-wise Outstanding
10. Stock Valuation
11. Cash Flow
12. List Parties/Items
