# Translation Flow: Indian Languages → Actionable Commands

## Overview

The bot automatically handles Indian language input (text or audio) and translates it to English before processing commands. This enables users to interact with Tally features in their preferred language.

## Current Implementation ✅

The translation system is **already implemented** and working! Here's how it works:

---

## Flow Diagram

```
User Input (Hindi/Marathi/Gujarati/etc.)
    ↓
[Text Message] OR [Audio/Voice Note]
    ↓
┌─────────────────────────────────────┐
│  STEP 1: Language Detection         │
│  (Sarvam AI /text-lid endpoint)    │
│  → Detects: hi-IN, mr-IN, gu-IN... │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  STEP 2: Translation to English    │
│  (Sarvam AI /translate endpoint)    │
│  → Translates to: en-IN             │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  STEP 3: Intent Parsing            │
│  (OpenAI/Ollama/Keyword)            │
│  → Extracts: skillId, action, params│
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  STEP 4: Execute Action            │
│  (Tally skill: get_ledger, etc.)   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  STEP 5: Translate Reply (Optional)│
│  (Sarvam AI /translate endpoint)   │
│  → Translates back to user's lang  │
└─────────────────────────────────────┘
    ↓
Bot Reply (in user's language)
```

---

## Detailed Flow

### For Text Messages:

1. **User sends text** in Indian language (e.g., Hindi: "ABC कंपनी का ledger दिखाओ")
2. **Language Detection**: Sarvam AI detects language → `hi-IN`
3. **Translation**: Text translated to English → "Show ledger for ABC company"
4. **Intent Parsing**: OpenAI processes English text → `{ skillId: "tally", action: "get_ledger", params: { party_name: "ABC company" } }`
5. **Action Execution**: Tally skill executes the command
6. **Reply Translation** (if enabled): Bot reply translated back to Hindi → "ABC कंपनी का ledger..."

### For Audio/Voice Messages:

1. **User sends voice note** in Indian language
2. **Audio Transcription**: Sarvam AI transcribes audio → Text in original language
3. **Translation**: Transcription translated to English (done automatically in transcription step)
4. **Intent Parsing**: OpenAI processes English text
5. **Action Execution**: Tally skill executes
6. **Reply Translation**: Bot reply translated back to user's language

---

## Supported Languages

Sarvam AI supports **22+ Indian languages**:

- **Hindi** (hi-IN)
- **Marathi** (mr-IN)
- **Gujarati** (gu-IN)
- **Tamil** (ta-IN)
- **Telugu** (te-IN)
- **Kannada** (kn-IN)
- **Malayalam** (ml-IN)
- **Bengali** (bn-IN)
- **Punjabi** (pa-IN)
- **Odia** (or-IN)
- **Assamese** (as-IN)
- **Urdu** (ur-IN)
- And more...

**Note**: The bot automatically detects the language, so users don't need to specify it.

---

## Example Conversations

### Example 1: Hindi Text
```
User: "ABC कंपनी का GST दिखाओ"
  ↓ (Translation)
Bot processes: "Show GST for ABC company"
  ↓ (Intent parsing)
Action: get_gst_summary(party_name="ABC company")
  ↓ (Execute)
Bot: "ABC कंपनी का GST summary: ..."
```

### Example 2: Marathi Audio
```
User: [Voice note in Marathi] "XYZ ची ledger दाखवा"
  ↓ (Transcribe + Translate)
Bot processes: "Show ledger for XYZ"
  ↓ (Intent parsing)
Action: get_ledger(party_name="XYZ")
  ↓ (Execute)
Bot: [Reply in Marathi] "XYZ ची ledger: ..."
```

### Example 3: Gujarati Text
```
User: "છેલ્લા મહિનાનું profit and loss બતાવો"
  ↓ (Translation)
Bot processes: "Show profit and loss for last month"
  ↓ (Intent parsing)
Action: get_profit_loss(date_from="2025-01-01", date_to="2025-01-31")
  ↓ (Execute)
Bot: [Reply in Gujarati] "છેલ્લા મહિનાનું P&L: ..."
```

---

## Configuration

Translation is configured in `config/skills.json`:

```json
{
  "translation": {
    "enabled": true,
    "provider": "sarvam",
    "model": "mayura:v1",
    "translateReplies": true,
    "apiKey": "sk-your-sarvam-key"
  }
}
```

Or via environment variable:
```bash
SARVAM_API_KEY=sk-your-key
```

### Settings:

- **`enabled`**: `true` to enable translation features
- **`translateReplies`**: `true` to translate bot replies back to user's language
- **`model`**: 
  - `"mayura:v1"` (default) - 12 languages, supports all modes
  - `"sarvam-translate:v1"` - 22 languages, formal translation only

---

## Code Flow (Technical)

### In `src/bot/orchestrator.js`:

1. **Audio Handling** (lines 210-237):
   ```javascript
   if (isAudioMessage && sarvamClient) {
     const result = await sarvamClient.transcribeAudio({
       data: media.data,
       translateToEnglish: true, // Direct translation
     });
     userText = result.text; // Already in English
     userLang = result.lang; // Original language
   }
   ```

2. **Text Translation** (lines 305-327):
   ```javascript
   // Detect language
   const detected = await sarvamClient.detectLanguage(userText);
   userLang = detected.lang;
   
   // Translate to English if needed
   if (userLang !== 'en-IN' && userLang !== 'en') {
     textForProcessing = await sarvamClient.translate(userText, {
       from: userLang,
       to: 'en-IN',
     });
   }
   ```

3. **Intent Parsing** (line 331):
   ```javascript
   const { skillId, action, params } = await parseIntent(textForProcessing, config);
   // textForProcessing is now in English
   ```

4. **Reply Translation** (lines 347-360):
   ```javascript
   if (translateReplies && userLang !== 'en-IN') {
     finalResponseText = await sarvamClient.translate(responseText, {
       from: 'en-IN',
       to: userLang,
     });
   }
   ```

---

## Natural Language Examples (Indian Languages)

### Hindi:
- "ABC कंपनी का ledger दिखाओ" → `get_ledger(party_name="ABC company")`
- "GST summary दिखाओ XYZ के लिए" → `get_gst_summary(party_name="XYZ")`
- "पिछले महीने का profit and loss बताओ" → `get_profit_loss(date_from="last month")`
- "कितना outstanding है ABC से?" → `get_outstanding_receivables(party_name="ABC")`

### Marathi:
- "XYZ ची ledger दाखवा" → `get_ledger(party_name="XYZ")`
- "ABC चा GST दाखवा" → `get_gst_summary(party_name="ABC")`
- "मागील महिन्याचा P&L दाखवा" → `get_profit_loss(date_from="last month")`

### Gujarati:
- "ABC નું ledger બતાવો" → `get_ledger(party_name="ABC")`
- "XYZ નો GST summary બતાવો" → `get_gst_summary(party_name="XYZ")`
- "છેલ્લા મહિનાનું profit loss બતાવો" → `get_profit_loss(date_from="last month")`

### Tamil:
- "ABC நிறுவனத்தின் ledger காட்டு" → `get_ledger(party_name="ABC company")`
- "XYZ க்கான GST summary காட்டு" → `get_gst_summary(party_name="XYZ")`

---

## Benefits

1. **Accessibility**: Users can interact in their native language
2. **Natural**: No need to learn English commands
3. **Audio Support**: Voice notes work seamlessly
4. **Bidirectional**: Replies also in user's language (if enabled)
5. **Automatic**: No manual language selection needed

---

## Testing

To test translation:

1. **Enable translation** in config:
   ```json
   "translation": {
     "enabled": true,
     "translateReplies": true
   }
   ```

2. **Send a message** in Hindi/Marathi/etc.:
   ```
   "ABC कंपनी का ledger दिखाओ"
   ```

3. **Check logs** for translation steps:
   ```
   [translation] Detected language: hi-IN
   [translation] Translated to English: "Show ledger for ABC company"
   [translation] Translated reply back to: hi-IN
   ```

4. **Verify response** is in the same language (if `translateReplies: true`)

---

## Future Enhancements

- [ ] Support for mixed-language input (code-switching)
- [ ] Context-aware translation (accounting terms preserved)
- [ ] Regional number formatting (Indian number system)
- [ ] Date parsing in Indian languages ("पिछले महीने" → "last month")

---

## Troubleshooting

### Translation not working?
1. Check `SARVAM_API_KEY` is set in `.env`
2. Verify `translation.enabled: true` in config
3. Check logs for Sarvam API errors
4. Ensure internet connection (Sarvam is cloud API)

### Wrong language detected?
- Sarvam auto-detects, but short messages may be ambiguous
- Try adding more context to your message
- Check detected language in logs

### Reply not translated?
- Check `translateReplies: true` in config
- Verify original language was detected correctly
- Check logs for translation errors
