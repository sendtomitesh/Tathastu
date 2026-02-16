# BotBandhu

WhatsApp command bot with a skill-based architecture. Connects via QR, uses OpenAI (or Ollama/Keyword) to understand natural-language commands, and executes actions (Tally first) via configuration-driven skills. Supports multi-language translation (Sarvam AI), audio transcription, and provides a conversation UI for employees to view their chat history.

## Prerequisites

- **Node.js** 18+ (LTS)
- **TallyPrime** (for Tally skill): open TallyPrime, load a company, and enable HTTP server on port 9000: **F1 → Settings → Advanced Configuration → enable HTTP Server (port 9000)**
- **OpenAI API key** (required only if using OpenAI for intent parsing)
- **Sarvam AI API key** (optional, for translation and audio transcription): Get one at [sarvam.ai](https://sarvam.ai). Add to `.env` as `SARVAM_API_KEY` or configure in Admin UI.

## Setup

1. Clone or copy the project, then install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set your API keys:

   ```bash
   cp .env.example .env
   # Edit .env and set:
   # OPENAI_API_KEY=sk-your-key (required if using OpenAI)
   # SARVAM_API_KEY=sk-your-key (optional, for translation/audio)
   ```

3. Optionally edit `config/skills.json` to change Tally port, company name, or disable/enable skills.

## Run

- **With interface**: `npm run bot` — starts the bot and **opens a web UI in your browser** (QR code, status, log). No command prompt needed after the first run.
- **Dashboard**: `http://127.0.0.1:3750` — Main dashboard showing QR code, connection status, and logs
- **Conversation UI**: `http://127.0.0.1:3750/chat` — View your conversation history with the bot (self-chat messages only)
- **Config UI**: `http://127.0.0.1:3750/admin` — Configure employees (tenants), skills, LLM provider, translation, and WhatsApp options in the browser. Restart the bot after saving for changes to apply.
- **Electron window** (if it works on your system): `npm start` or `npm run dev`.
- On first run, scan the QR code shown in the browser (or terminal if the browser did not open). Open WhatsApp on your phone → **Linked Devices** → **Link a device** and scan the QR. Session is stored in `.wwebjs_auth` so you usually only scan once.
- Send a message in **Saved Messages** (self-chat). If `whatsapp.onlySelfChat` is true in config, only messages in Saved Messages are processed.
- Example commands: “get ledger of ABC party”, “show last 5 sales vouchers”, “list ledgers”.
- **View conversation**: Open `/chat` in your browser to see all your exchanges with the bot in a chat-like interface.

## Configuration

- **`config/skills.json`**: Defines enabled skills and their actions. The bot and OpenAI use this to know what commands exist. See **`docs/ARCHITECTURE.md`** for how to add new integrations (add a folder under `src/skills/<id>/` and a matching skill block in config; skills are auto-discovered).
- **`.env`**: 
  - `OPENAI_API_KEY` (required only if using OpenAI)
  - `SARVAM_API_KEY` (optional, for translation and audio transcription)
  - Optional: `CONFIG_PATH` to override config file path
- **Language understanding**: By default the bot uses OpenAI. You can switch to **Ollama** (local, no API key) or **keyword** (simple regex, no API) by setting `llm.provider` in config. See `docs/ARCHITECTURE.md` (Config shape → `llm`).
- **Translation & Audio**: Enable Sarvam AI translation in the Admin UI (`/admin`) or `config/skills.json`. Supports 22+ Indian languages for text translation and audio transcription. See `docs/ARCHITECTURE.md` (Config shape → `translation`).
- **Multiple WhatsApp (one company per bot)**: Run one process per company with its own config and session. Use `CONFIG_PATH`, `MPBOT_SESSION_DIR`, and `MPBOT_UI_PORT` (see `docs/ARCHITECTURE.md`).

## Project layout

- `config/skills.json` – Skill and action definitions
- `src/main/` – Electron main process
- `src/whatsapp/` – WhatsApp client (QR, LocalAuth, message handler)
- `src/config/` – Config loader
- `src/skills/` – Skill registry and interface; `src/skills/tally/` – Tally (XML over HTTP)
- `src/openai/` – Config-driven intent parsing (OpenAI/Ollama/Keyword)
- `src/translation/` – Sarvam AI integration (language detection, translation, audio transcription)
- `src/bot/` – Orchestrator (message → [audio transcription] → [translation] → OpenAI → skill → [translation] → reply, with echo suppression)
- `src/ui/` – Web UI server (dashboard, conversation history, admin config)
- `src/preload/`, `src/renderer/` – Electron UI (QR, status, optional log)

## Running on Windows

1. **Prerequisites**
   - Install **Node.js 18+** (LTS) from [nodejs.org](https://nodejs.org). Use the Windows installer and ensure "Add to PATH" is checked.
   - (Optional) **TallyPrime** on the same machine if you use the Tally skill. Open TallyPrime → F1 → Settings → Advanced Configuration → enable **HTTP Server** on port **9000**.
   - For **OpenAI**: create an API key and put it in `.env`. For **keyword** or **Ollama** you don't need an API key (set `llm.provider` in config).

2. **Get the project**
   - Copy the project folder to your PC (or clone with Git).

3. **Setup (Command Prompt or PowerShell)**
   ```cmd
   cd path\to\mpbot
   npm install
   copy .env.example .env
   ```
   Then edit `.env` in Notepad and set `OPENAI_API_KEY=sk-your-key` if you use OpenAI. If you use `keyword` or `ollama`, you can leave it blank.

4. **Run**
   ```cmd
   npm run bot
   ```
   A browser window will open with the QR code. Scan it with WhatsApp (Phone → Linked devices → Link a device). After that, send messages in a **private chat** to use the bot.

5. **Notes**
   - The first run may take a minute while Puppeteer downloads Chromium.
   - If Windows Firewall asks for Node or Chrome, allow access for the bot to work.
   - Session is stored in `.wwebjs_auth` in the project folder; you usually scan the QR only once per machine.

## Building for Windows

```bash
npm run build
# Or use electron-builder: npx electron-builder --win
```

Output will be in `dist/`. Document for users: open TallyPrime, load company, enable HTTP server (port 9000) before using “get ledger” / “get vouchers” commands.

## License

MIT
