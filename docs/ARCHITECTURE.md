# Architecture: Multi-Service Integration

The bot is built to scale to **many integrations** (Tally, CRM, ticketing, APIs, etc.) without changing core code. Integrations are **configuration-driven** and **auto-discovered**.

## High-level flow

```
User message (WhatsApp Saved Messages)
  → Orchestrator (filter: fromMe, self-chat, echo suppression, duplicate detection)
  → [If audio] Download & transcribe audio → text (Sarvam AI)
  → [If translation enabled] Detect language → translate to English (Sarvam AI)
  → Store user message in conversation history
  → OpenAI parseIntent(config) → { skillId, action, params }
  → SkillRegistry.execute(skillId, action, params)
  → Skill module (e.g. tally, future: slack, jira)
  → [If translation enabled] Translate reply back to user's language (Sarvam AI)
  → Store bot reply in conversation history
  → Reply sent back to same chat
```

- **Config** (`config/skills.json`): defines which skills are enabled, their actions, and parameters. OpenAI’s system prompt is built from this, so the model only sees enabled actions.
- **Skills** (`src/skills/<id>/`): each integration is a folder with `index.js` exporting `execute(skillId, action, params, skillConfig)`. Skills are **auto-discovered** from the filesystem; no central registry edit needed.
- **Orchestrator**: applies WhatsApp rules (only you, self-chat, echo suppression, duplicate detection), stores messages for conversation UI, calls OpenAI, then the registry.
- **Message Storage**: Self-chat messages (user and bot) are stored in memory and exposed via `/api/messages` for the conversation UI.
- **Echo Suppression**: Prevents bot's own replies from being processed as user input using text matching and timing windows.

## Config shape

- **`openai`**: (legacy) model, etc. Still used if `llm` is not set.
- **`llm`**: language-understanding provider. Optional. If set, overrides use of `openai` for intent parsing.
  - **`provider`**: `"openai"` (default) | `"ollama"` | `"keyword"`.
  - **`model`**: model name (e.g. `gpt-4o-mini` for OpenAI, `llama3.2` for Ollama). Ignored for `keyword`.
  - **`baseUrl`**: optional. For OpenAI: use an OpenAI-compatible API (e.g. Groq). For Ollama: default `http://localhost:11434`.
  - **openai**: needs `OPENAI_API_KEY` in env. Best for flexible, natural-language understanding.
  - **ollama**: no API key. Run [Ollama](https://ollama.ai) locally (e.g. `ollama run llama3.2`). Good for offline/private use.
  - **keyword**: no API key, no network. Simple regex/keyword matching for commands (e.g. “ledger of X”, “list ledgers”, “vouchers”). Good for fixed commands and no dependency on any API.
- **`whatsapp`**: `onlyFromMe`, `onlyPrivateChats`, `onlySelfChat`. 
  - `onlyFromMe`: `true` to only process messages sent by you (default: `true`).
  - `onlyPrivateChats`: `true` to ignore group chats (default: `true`).
  - `onlySelfChat`: `true` to only reply in **Saved Messages** (self-chat); it will ignore all other chats including other 1:1 and groups (recommended for employee use).
- **`translation`**: optional. Enables Sarvam AI for language detection, translation, and audio transcription.
  - **`enabled`**: `true` to enable translation features.
  - **`provider`**: `"sarvam"` (currently the only supported provider).
  - **`apiKey`**: Sarvam AI API key (can also be set via `SARVAM_API_KEY` env var).
  - **`baseUrl`**: optional. Defaults to `https://api.sarvam.ai`.
  - **`model`**: `"mayura:v1"` (default, 12 languages, all modes) or `"sarvam-translate:v1"` (22 languages, formal only).
  - **`translateReplies`**: `true` to translate bot replies back to the user's detected language.
  - **Features**:
    - **Text translation**: Detects language of incoming messages (22+ Indian languages + English), translates non-English to English before processing, optionally translates replies back.
    - **Audio transcription**: Transcribes voice notes and audio messages, translates to English automatically.
    - **Language detection**: Automatically identifies the language of text and audio messages.
- **`skills`**: array of:
  - `id` – must match folder name under `src/skills/` (e.g. `tally`)
  - `enabled` – if false, skill is not loaded
  - `name` – display name (used in prompts)
  - `config` – passed to the skill’s `execute(..., skillConfig)`
  - `actions` – array of `{ id, description, parameters[] }` (drives OpenAI and validation)

## Adding a new integration

1. **Create the skill module**
   - Add folder: `src/skills/<id>/` (e.g. `src/skills/jira/`).
   - Add `index.js` that exports:
     ```js
     async function execute(skillId, action, params = {}, skillConfig = {}) {
       // skillConfig = your skill block’s config from skills.json
       // Return { success: boolean, message?: string, data?: any }
     }
     module.exports = { execute };
     ```
   - Optionally add more files in that folder (e.g. `client.js` for API calls).

2. **Register in config**
   - In `config/skills.json`, add a skill object with the same `id`:
     ```json
     {
       "id": "jira",
       "enabled": true,
       "name": "Jira",
       "config": { "baseUrl": "https://your.atlassian.net", "apiToken": "..." },
       "actions": [
         { "id": "get_issue", "description": "Get a Jira issue by key", "parameters": ["issue_key"] }
       ]
     }
     ```
   - Restart the bot. The skill is **discovered** from the folder; no code change in `src/skills/index.js`.

3. **Secrets**
   - Keep API keys/tokens out of `skills.json` if it’s committed. Use env vars and pass them via `config` (e.g. load in `config/load.js` from `process.env`) or a separate secrets loader.

## Skill contract

- **Discovery**: Any directory under `src/skills/` with an `index.js` that exports `execute` is a skill. The config `id` must match the directory name.
- **Execute**: `execute(skillId, action, params, skillConfig) → Promise<{ success, message?, data? }>`.
- **Actions**: Only actions listed in config for that skill are valid. The registry checks `action` against the skill’s `actions` before calling the module.

## Multiple WhatsApp (one config per company)

**One bot process = one WhatsApp account = one config = one curated skill set.**  
So “one WhatsApp per company, each with company-specific skills” is done by **running one process per company**, each with its own config and session.

- **Config**: Each company has its own config file (e.g. `config/company-a.json`) with that company’s skills and skill config (e.g. Tally `companyName`, port, or which skills are enabled).
- **Session**: Each WhatsApp account needs its own session directory so credentials don’t clash.
- **Env per process**:
  - `CONFIG_PATH` – path to that company’s config (default: `config/skills.json`).
  - `MPBOT_SESSION_DIR` – directory for this WhatsApp session (default: `.wwebjs_auth`). Use a different dir per company (e.g. `.wwebjs_auth_company_a`).
  - `MPBOT_UI_PORT` – HTTP port for the QR/status UI (default: `3750`). Use a different port per process so multiple bots don’t clash.

**Example: two companies**

- `config/company-a.json`: Tally with `companyName: "Acme"`, only `get_ledger` and `list_ledgers` enabled.
- `config/company-b.json`: Tally with `companyName: "Beta"`, different actions or skills.

Terminal 1 (Company A):

```bash
CONFIG_PATH=config/company-a.json MPBOT_SESSION_DIR=.wwebjs_auth_company_a MPBOT_UI_PORT=3750 npm run bot
```

Terminal 2 (Company B):

```bash
CONFIG_PATH=config/company-b.json MPBOT_SESSION_DIR=.wwebjs_auth_company_b MPBOT_UI_PORT=3751 npm run bot
```

Scan one QR with the WhatsApp account for Company A, the other with the account for Company B. Each bot only sees the skills and Tally config defined in its own config file.

You can use a process manager (e.g. PM2) or scripts to start multiple instances from a single “tenants” list.

### How each employee connects their WhatsApp

Two common patterns:

**1. One WhatsApp per company (shared bot number)**  
- One device/number scans the QR for that company's process. That number is the "bot" for the company.  
- Only that linked account's messages are processed today (`onlyFromMe: true`). So in practice, the person using that phone (or a linked device) talks to the bot.  
- If you want **employees to message the company number** from their personal WhatsApp and get replies, the app would need an **allow list** of employee numbers (and to accept messages from those numbers, not only fromMe). That's a possible future change.

**2. One bot instance per employee (each employee's own WhatsApp)**  
- Same company config, but **one process per employee**, each with its own **session directory** (and UI port).  
- Each employee "connects" by: starting their instance (or opening the UI for their instance), seeing the **QR code**, and scanning it with **their own WhatsApp** (Linked devices → Link a device).  
- After that, only that employee's messages are handled by that instance (same company skills, private conversation).

Example for two employees of the same company (same config, different sessions and ports):

```bash
# Employee 1
CONFIG_PATH=config/company-a.json MPBOT_SESSION_DIR=.wwebjs_auth_employee_1 MPBOT_UI_PORT=3750 npm run bot
# → Open http://127.0.0.1:3750, scan QR with Employee 1's WhatsApp

# Employee 2 (e.g. different terminal or same server, different port)
CONFIG_PATH=config/company-a.json MPBOT_SESSION_DIR=.wwebjs_auth_employee_2 MPBOT_UI_PORT=3751 npm run bot
# → Open http://127.0.0.1:3751, scan QR with Employee 2's WhatsApp
```

So **each employee connects by scanning the QR** for their own instance (their own `MPBOT_SESSION_DIR`). You can use a naming scheme (e.g. `.wwebjs_auth_employee_<id>`) and a process manager or a simple script to start N instances with different ports and session dirs.

**3. Single page: one URL, one QR per employee**  
- Run **one process** with a **`tenants`** list in config. The app starts one WhatsApp client per tenant and serves **one web page** with a **card per employee**. Each card shows that employee’s name, their **own QR code**, status, and log.  
- Everyone opens the **same URL** (e.g. `http://127.0.0.1:3750`). Each employee finds their name and scans their QR. No separate ports or terminals.  
- Add a `tenants` array to your config (same file as `skills`, or a config that also has `openai`, `whatsapp`, `skills`). Each tenant: `id`, `name`, `sessionDir`.

Example config (e.g. `config/skills.json` or `config/company-a.json`) with tenants:

```json
{
  "openai": { "model": "gpt-4o-mini" },
  "whatsapp": { "onlyFromMe": true, "onlyPrivateChats": true },
  "skills": [ ... ],
  "tenants": [
    { "id": "employee_1", "name": "Employee 1", "sessionDir": ".wwebjs_auth_employee_1" },
    { "id": "employee_2", "name": "Employee 2", "sessionDir": ".wwebjs_auth_employee_2" }
  ]
}
```

Run once: `npm run bot`. Open the printed URL; the page shows one card per tenant. Each employee scans their own QR from the same page.

## UI Pages

The bot provides three web UI pages:

1. **Dashboard** (`/`): Shows QR code for WhatsApp connection, connection status, and real-time logs. Links to conversation and admin pages.
2. **Conversation UI** (`/chat`): Displays conversation history between the user and bot. Shows only self-chat messages (Saved Messages). Features:
   - Chat-like interface with user messages (right, blue) and bot replies (left, dark)
   - Real-time updates (auto-refreshes every 2 seconds)
   - Shows audio transcription badges and language indicators
   - Timestamps and message metadata
   - Supports multi-tenant mode with `?tenantId=` parameter
3. **Admin UI** (`/admin`): Configuration management interface. Configure:
   - LLM provider (OpenAI, Ollama, Keyword)
   - WhatsApp settings (onlyFromMe, onlyPrivateChats, onlySelfChat)
   - Translation settings (Sarvam AI API key, model, reply translation)
   - Employees/tenants (for multi-tenant mode)
   - Skills (enable/disable, configure)

## Message Storage & Echo Suppression

- **Message Storage**: The orchestrator stores self-chat messages (both user and bot) in memory. Messages are exposed via `/api/messages` API endpoint for the conversation UI. Stores up to 500 messages per session.
- **Echo Suppression**: Prevents bot's own replies from being processed as user input:
  - Text matching: If incoming message text matches the bot's last sent message, skip immediately
  - Timing window: Any `fromMe` message within 10 seconds of bot sending is treated as potential echo
  - Duplicate detection: Prevents processing the same user message multiple times (e.g., from multiple linked devices)
- **Self-Chat Detection**: Strict detection ensures only Saved Messages are processed when `onlySelfChat: true`:
  - Checks `message.from === message.to`
  - Verifies `chat.id` matches user's phone number
  - Validates chat contact matches user's number (for linked devices)

## Scaling notes

- **Many services**: Add more folders under `src/skills/` and more entries in `config/skills.json`. OpenAI sees all enabled actions and chooses `skillId` + `action` + `params`.
- **Prompt**: The system prompt is built from config (all skills’ actions). The “suggestedReply” hint is generated from skill names and action ids so it stays relevant as you add services.
- **Optional**: You can add a `description` or `metadata` to skills for docs or a future admin UI; the runtime only requires `id`, `enabled`, `name`, `config`, and `actions`.
- **Conversation History**: Messages are stored in memory. For persistence across restarts, consider adding database storage (future enhancement).
