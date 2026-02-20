# Tathastu Knowledge Base
# This file is loaded into the AI system prompt at startup.
# Edit this file to improve how the bot understands user queries.
# Changes take effect on next bot restart (node src/cli.js).

## Language & Phrasing

### Hindi Phrases → Actions
- "khata" / "खाता" = ledger (get_ledger)
- "baki" / "बाकी" / "udhar" / "उधार" = outstanding/balance (get_party_balance or get_outstanding)
- "bikri" / "बिक्री" = sales (get_sales_report)
- "kharid" / "खरीद" = purchase (get_purchase_report)
- "nafa nuksan" / "नफा नुकसान" = profit & loss (get_profit_loss)
- "kharcha" / "खर्चा" / "खर्च" = expenses (get_expense_report)
- "maal" / "माल" / "stock" = stock/inventory (get_stock_summary)
- "bill" / "बिल" = invoice or bill outstanding
- "paisa" / "पैसा" / "cash" = cash & bank balance (get_cash_bank_balance)
- "hisab" / "हिसाब" = account/ledger
- "lena" / "लेना" = receivable (type=receivable)
- "dena" / "देना" = payable (type=payable)
- "kitna dena hai" / "कितना देना है" = outstanding payable
- "kitna lena hai" / "कितना लेना है" = outstanding receivable
- "aaj ka" / "आज का" = today's (daybook/vouchers)
- "mahina" / "महीना" = month
- "saal" / "साल" = year
- "pichla" / "पिछला" = last/previous
- "agla" / "अगला" = next
- "bhejo" / "भेजो" = send (invoice PDF, reminder)
- "yaad dilao" / "याद दिलाओ" = remind (payment reminder)

### Gujarati Phrases → Actions
- "khatu" / "ખાતું" = ledger (get_ledger)
- "baki" / "બાકી" = outstanding/balance
- "vechan" / "વેચાણ" = sales
- "kharid" / "ખરીદ" = purchase
- "nafa tota" / "નફા તોટા" = profit & loss
- "kharcho" / "ખર્ચો" = expenses
- "mal" / "માલ" = stock
- "paisa" / "પૈસા" = cash
- "levano" / "લેવાનો" = receivable
- "devanu" / "દેવાનું" = payable
- "aaj nu" / "આજ નું" = today's
- "moklo" / "મોકલો" = send

### Common Abbreviations
- "TB" = Trial Balance (get_trial_balance)
- "BS" = Balance Sheet (get_balance_sheet)
- "P&L" / "PnL" / "PL" = Profit & Loss (get_profit_loss)
- "GST" = GST Summary (get_gst_summary)
- "SO" = Sales Order (get_sales_orders)
- "PO" = Purchase Order (get_purchase_orders)
- "OS" / "O/S" = Outstanding (get_outstanding)
- "CB" = Cash & Bank (get_cash_bank_balance)

## Accounting Concepts

### Tally Voucher Types
- Sales = Sales invoice (outgoing goods/services)
- Purchase = Purchase invoice (incoming goods/services)
- Receipt = Money received from a party
- Payment = Money paid to a party
- Journal = Adjustment entry (no cash movement)
- Contra = Transfer between cash/bank accounts
- Credit Note = Return/discount given to customer
- Debit Note = Return/discount received from supplier
- Sales Order = Order received from customer (not yet invoiced)
- Purchase Order = Order placed with supplier (not yet invoiced)

### Tally Groups (Hierarchy)
- Sundry Debtors = Customers who owe us money (receivable)
- Sundry Creditors = Suppliers we owe money to (payable)
- Bank Accounts = All bank ledgers (HDFC, SBI, etc.)
- Cash-in-Hand = Physical cash
- Sales Accounts = Revenue from sales
- Purchase Accounts = Cost of purchases
- Direct Expenses = Expenses directly related to production
- Indirect Expenses = Overhead expenses (rent, salary, etc.)
- Direct Incomes = Income directly from business
- Indirect Incomes = Other income (interest, commission, etc.)
- Duties & Taxes = GST, TDS, etc.
- Current Assets = Short-term assets
- Current Liabilities = Short-term liabilities
- Fixed Assets = Long-term assets (property, equipment)
- Capital Account = Owner's equity

### GST Basics
- CGST = Central GST (goes to central government)
- SGST = State GST (goes to state government)
- IGST = Integrated GST (interstate transactions)
- Input Tax = GST paid on purchases (credit)
- Output Tax = GST collected on sales (liability)
- Net Liability = Output Tax - Input Tax (what you owe the government)
- GSTIN = 15-digit GST Identification Number

### Financial Year
- Indian FY runs April 1 to March 31
- "This year" / "current FY" = April of current year to March of next year
- "Last year" / "previous FY" = April of previous year to March of current year
- When user says "this year" in Jan-Mar, they likely mean the FY that started last April

## Business Rules

### Party Name Resolution
- Users often type partial names or nicknames
- "Meril" could mean "Meril Life Sciences Pvt Ltd"
- Always try fuzzy matching — the bot will show suggestions if multiple matches
- If user replies with a number after seeing suggestions, pick that option

### Report Defaults
- Sales/Purchase report: defaults to current month if no date given
- Daybook/Vouchers: defaults to today if no date given
- P&L, Trial Balance, Balance Sheet: use full FY (no date) unless user specifies
- Expenses, GST: use full FY unless user specifies
- Top reports: show full FY data unless user specifies dates

### Common User Intents
- "How is business?" → get_profit_loss (no dates)
- "Are we making money?" → get_profit_loss (no dates)
- "Who owes us?" → get_outstanding type=receivable
- "What do we owe?" → get_outstanding type=payable
- "Send bill to X" → get_invoice_pdf (need invoice number)
- "Remind X about payment" → send_reminder party_name=X
- "Export this" / "Excel" → export_excel (uses last report)
- "Open X company" → open_company company_name=X
- "Switch to X" → open_company company_name=X
