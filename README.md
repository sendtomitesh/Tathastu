# Tathastu — WhatsApp Bot for TallyPrime

A WhatsApp bot that connects to TallyPrime accounting software, letting you query ledgers, vouchers, reports, and more — all from your phone.

## Features

- **Ledger & Statements** — Query any party's ledger, transactions, balance
- **Vouchers & Daybook** — View vouchers by date, type, with pagination
- **Financial Reports** — P&L, Trial Balance, Balance Sheet, Expense Report
- **Outstanding & Ageing** — Receivable/Payable outstanding with ageing buckets
- **Sales & Purchase** — Party-wise sales/purchase reports
- **Cash & Bank** — Bank balances, cash in hand
- **Stock & Inventory** — Stock summary with item-level detail
- **GST Summary** — Input/Output tax and net liability
- **Top Reports** — Top customers, suppliers, selling items
- **Inactive Reports** — Dormant customers, suppliers, slow-moving items
- **Order Tracking** — Sales/Purchase orders, pending orders
- **Payment Reminders** — Overdue party reminders with contact info
- **Voucher Creation** — Create Sales, Purchase, Receipt, Payment vouchers
- **Excel Export** — Export any report as formatted Excel file
- **Tally Control** — Status check, restart, start, switch companies
- **Voice Notes** — Transcribes audio via Sarvam AI (Hindi, Gujarati, English)
- **Multi-language** — Understands Hindi, Hinglish, Gujarati, English text

## Prerequisites

- **Node.js** 18+
- **TallyPrime** running with HTTP server enabled (port 9000)
- **OpenAI API key** (for intent parsing)
- **WhatsApp** account (scanned via QR code)

## Setup

1. Clone the repo:
```bash
git clone <repo-url>
cd tathastu
npm install
```

2. Copy `.env.example` to `.env` and fill in your keys:

```bash
copy .env.example .env
```

```env
OPENAI_API_KEY=sk-...
SARVAM_API_KEY=...          # Optional: for voice note transcription
```

3. Configure `config/skills.json`:
   - Set `skills[0].config.port` to your Tally HTTP port (default: `9000`)
   - Set `whatsapp.onlySelfChat: true` to only respond in Saved Messages (recommended for testing)
   - Set `debug: true` to see action/param info in bot replies

4. Start the bot:

```bash
node src/cli.js
```

5. Scan the QR code shown in terminal (or open `http://localhost:3000` for the web UI)

6. Send a message in your WhatsApp Saved Messages chat:
   - "hi" — see what the bot can do
   - "ledger for Meril" — get a party's ledger
   - "show today's vouchers" — today's daybook
   - "export trial balance to excel" — get an Excel file

## Architecture

```
src/
├── bot/
│   └── orchestrator.js      # Message handler: parse → execute → reply
├── config/
│   ├── load.js              # Config loader (skills.json)
│   └── validate.js          # Config validation utility
├── openai/
│   └── parse.js             # Intent parser (keyword + OpenAI fallback)
├── skills/
│   ├── index.js             # SkillRegistry (auto-discovers skills)
│   └── tally/
│       ├── index.js          # Tally skill: execute() handler for all actions
│       ├── manifest.json     # Skill metadata (for future plugin system)
│       └── tdl/              # TDL XML builders & parsers for each report
├── translation/
│   └── sarvam.js            # Sarvam AI client (audio transcription)
├── ui/
│   └── server.js            # Web UI server (QR code page)
├── whatsapp/
│   └── client.js            # WhatsApp Web.js client wrapper
└── cli.js                   # Entry point
```

### How it works

1. User sends a WhatsApp message (text or voice note)
2. Voice notes are transcribed via Sarvam AI
3. Intent is parsed: keyword matching first (free, fast), then OpenAI fallback
4. SkillRegistry routes to the Tally skill's `execute()` function
5. Tally skill builds TDL XML, sends to TallyPrime via HTTP, parses response
6. Formatted result is sent back as WhatsApp reply (with Excel attachment if requested)

### Intent Parsing

The bot uses a two-tier intent parsing system:

1. **Keyword matching** (`parseWithKeyword`) — Regex patterns for common phrases in English, Hindi, Hinglish, and Gujarati. Free, instant, no API calls.
2. **OpenAI fallback** — For complex queries, date extraction, and context-dependent messages. Uses conversation history for pronoun resolution.

### Pagination

- Reports with many items are paginated (20 items per page)
- Say "more", "next", "page 3" to navigate
- Max 200 items displayed; Excel export suggested for larger datasets

### Excel Export

Say "export [report] to excel" or "excel" after viewing any report. Supported:
- Vouchers, Sales, Purchase, Outstanding, Ledger list
- Trial Balance, Balance Sheet, P&L, Expenses
- Stock, GST, Cash & Bank, Ageing

## Testing

```bash
# All TDL builder/parser tests (199 tests)
node src/skills/tally/tests/test-all.js

# Skill execute() tests (76 tests)
node src/skills/tally/tests/test-execute.js

# Party not found handler tests (10 tests)
node src/skills/tally/tests/test-party-not-found.js

# Excel export tests (12 tests)
node src/skills/tally/tests/test-excel-all-exports.js

# Export keyword tests (11 tests)
node src/skills/tally/tests/test-excel-export.js

# Orchestrator tests (27 tests)
node src/bot/tests/test-orchestrator.js

# Hindi/Hinglish keyword tests (32 tests)
node src/openai/tests/test-hindi-keywords.js

# Config validation tests (12 tests)
node src/config/tests/test-validate.js
```

## Config Validation

Run the config validator to check for issues:

```bash
node src/config/validate.js
```

## Tally Setup

1. Open TallyPrime
2. Go to **F12 → Advanced Configuration**
3. Set **Enable ODBC Server** to **Yes**
4. Set **Port** to **9000** (or match your `config/skills.json`)
5. Ensure the company you want to query is open/active

## License

MIT
