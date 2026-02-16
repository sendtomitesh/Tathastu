// Use native FormData (Node.js 18+) instead of form-data package for better fetch compatibility

const BASE_URL = 'https://api.sarvam.ai';

/**
 * Sarvam AI translation and transcription client.
 * API docs: https://docs.sarvam.ai
 */
class SarvamClient {
  constructor(apiKey, baseUrl = BASE_URL) {
    this.apiKey = apiKey;
    // Handle null/undefined baseUrl - use default if not provided
    const url = baseUrl || BASE_URL;
    this.baseUrl = url.replace(/\/$/, '');
  }

  /**
   * Detect language of text.
   * @param {string} text
   * @returns {Promise<{ lang: string, confidence?: number }>}
   */
  async detectLanguage(text) {
    if (!text || !text.trim()) return { lang: 'en-IN' };
    try {
      const res = await fetch(`${this.baseUrl}/text-lid`, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: text.trim().slice(0, 1000) }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Sarvam detect-language failed: ${res.status} ${errText}`);
      }
      const data = await res.json();
      return {
        lang: data.language_code || 'en-IN',
        confidence: data.confidence || null,
      };
    } catch (err) {
      console.warn('[sarvam] detectLanguage error:', err.message);
      return { lang: 'en-IN' }; // Fallback to English
    }
  }

  /**
   * Translate text from source language to target language.
   * @param {string} text
   * @param {object} options
   * @param {string} [options.from] - Source language code (e.g. 'hi-IN', 'auto' for auto-detect)
   * @param {string} [options.to] - Target language code (e.g. 'en-IN')
   * @param {string} [options.model] - 'mayura:v1' or 'sarvam-translate:v1' (default: mayura:v1)
   * @returns {Promise<string>} Translated text
   */
  async translate(text, options = {}) {
    if (!text || !text.trim()) return text;
    const from = options.from || 'auto';
    const to = options.to || 'en-IN';
    const model = options.model || 'mayura:v1';
    try {
      const res = await fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text.trim().slice(0, 2000),
          source_language_code: from,
          target_language_code: to,
          model: model,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Sarvam translate failed: ${res.status} ${errText}`);
      }
      const data = await res.json();
      return data.translated_text || text;
    } catch (err) {
      console.warn('[sarvam] translate error:', err.message);
      return text; // Fallback: return original text
    }
  }

  /**
   * Transcribe audio to text, optionally translating to English.
   * @param {object} options
   * @param {Buffer|string} options.data - Audio file data (Buffer or base64 string)
   * @param {string} options.mimeType - MIME type (e.g. 'audio/ogg; codecs=opus', 'audio/mpeg')
   * @param {string} [options.languageCode] - Language hint (e.g. 'hi-IN', 'unknown' for auto-detect)
   * @param {boolean} [options.translateToEnglish] - If true, use mode='translate' to get English directly
   * @returns {Promise<{ text: string, lang?: string }>}
   */
  async transcribeAudio(options) {
    const { data, mimeType, languageCode = 'unknown', translateToEnglish = true } = options;
    if (!data) throw new Error('Audio data is required');
    
    try {
      // Convert base64 to Buffer if needed
      let audioBuffer;
      if (typeof data === 'string') {
        // Assume base64
        audioBuffer = Buffer.from(data, 'base64');
      } else {
        audioBuffer = data;
      }

      // Normalize mimeType - remove codecs parameter if present
      const cleanMimeType = mimeType ? mimeType.split(';')[0].trim() : 'audio/ogg';
      
      // Determine file extension from mimeType
      let ext = 'ogg';
      if (cleanMimeType.includes('mp3') || cleanMimeType.includes('mpeg')) ext = 'mp3';
      else if (cleanMimeType.includes('wav') || cleanMimeType.includes('wave')) ext = 'wav';
      else if (cleanMimeType.includes('opus')) ext = 'opus';
      else if (cleanMimeType.includes('ogg')) ext = 'ogg';

      // Use native FormData (Node.js 18+) - convert Buffer to Blob
      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: cleanMimeType });
      form.append('file', blob, `audio.${ext}`);
      form.append('model', 'saaras:v3');
      if (translateToEnglish) {
        form.append('mode', 'translate'); // Direct translation to English
      } else {
        form.append('mode', 'transcribe'); // Original language
      }
      form.append('language_code', languageCode);

      const res = await fetch(`${this.baseUrl}/speech-to-text`, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
          // Don't set Content-Type header - fetch will set it automatically with boundary
        },
        body: form,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Sarvam transcribe failed: ${res.status} ${errText}`);
      }

      const result = await res.json();
      return {
        text: result.transcript || '',
        lang: result.language_code || null,
      };
    } catch (err) {
      console.warn('[sarvam] transcribeAudio error:', err.message);
      throw err;
    }
  }
}

module.exports = { SarvamClient };
