/**
 * browserSpeechService — thin wrapper around the Web Speech API
 * (`window.speechSynthesis`) for the pharmacy inventory system.
 *
 * DESIGN PRINCIPLE
 * The pronunciation text entered by pharmacy staff is the single source of
 * truth. This module NEVER generates, translates, or rewrites that text — it
 * hands it verbatim to the device's built-in (browser/OS) Text-to-Speech engine.
 *
 * No audio files are stored in PostgreSQL. No external pronunciation API is
 * called. Everything is local to the user's browser/device.
 */

export const SPEECH_STATE = {
  OK: 'ok',
  NOT_SUPPORTED: 'not_supported',
  EMPTY: 'empty',
  VOICE_UNAVAILABLE: 'voice_unavailable',
  ERROR: 'error',
};

const isBrowser = typeof window !== 'undefined';
export const isSpeechSupported = () => isBrowser && !!window.speechSynthesis;

/* ── Voice cache ─────────────────────────────────────────────────────── */
/* Browser voices load asynchronously (notably on Chrome), so we cache them and
   listen for the `voiceschanged` event, with a one-shot safety poll. */
let voicesCache = [];
const refreshVoices = () => {
  if (!isSpeechSupported()) { voicesCache = []; return; }
  try { voicesCache = window.speechSynthesis.getVoices() || []; } catch (_) { voicesCache = []; }
};

if (isBrowser && window.speechSynthesis) {
  refreshVoices();
  try { window.speechSynthesis.addEventListener('voiceschanged', refreshVoices); } catch (_) {}
  const poll = setTimeout(refreshVoices, 600);
  window.addEventListener('beforeunload', () => clearTimeout(poll), { once: true });
}

export const getVoices = () => {
  refreshVoices();
  return voicesCache;
};

/**
 * Wait until at least one voice is reported (Chrome loads them late).
 * Resolves with the cached voices list (possibly empty on unsupported browsers).
 */
const waitForVoices = () => {
  if (!isSpeechSupported()) return Promise.resolve([]);
  refreshVoices();
  if (voicesCache.length > 0) return Promise.resolve(voicesCache);
  return new Promise((resolve) => {
    const onVoices = () => {
      refreshVoices();
      if (voicesCache.length > 0) { finish(); resolve(voicesCache); }
    };
    const finish = () => {
      try { window.speechSynthesis.removeEventListener('voiceschanged', onVoices); } catch (_) {}
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { finish(); resolve(voicesCache); }, 1500);
    try { window.speechSynthesis.addEventListener('voiceschanged', onVoices); } catch (_) {}
  });
};

/* ── Voice selection ─────────────────────────────────────────────────── */
/**
 * Pick the best matching voice for a language tag.
 * language: 'en', 'en-US', 'am-ET', 'am', etc.
 *   English -> prefer en-US, then en-GB, then any en-*.
 *   Amharic  -> prefer am-ET, then any am-*.
 *   Other    -> prefer exact tag, then any same-root language.
 */
export const selectVoice = (voices, language) => {
  const lang = String(language || '').toLowerCase();
  const code = lang.split('-')[0];
  if (code === 'am') {
    return voices.find((v) => v.lang && v.lang.toLowerCase() === 'am-et')
      || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('am')) || null;
  }
  if (code === 'en') {
    return voices.find((v) => v.lang && v.lang.toLowerCase() === 'en-us')
      || voices.find((v) => v.lang && v.lang.toLowerCase() === 'en-gb')
      || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('en')) || null;
  }
    return voices.find((v) => v.lang && v.lang.toLowerCase() === lang)
    || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(code)) || null;
};

/* ── Coordinated global "is anything speaking" state ────────────────── */
/* A single source of truth so that clicking one speaker button instantly
   reflects in all others (and cancels overlapping speech). */
let activeState = {
  speaking: false,
  lang: null,
  supported: isSpeechSupported(),
  voiceUnavailableFor: null,
};
const listeners = new Set();

const publish = (patch) => {
  activeState = { ...activeState, supported: isSpeechSupported(), ...patch };
  listeners.forEach((l) => l(activeState));
};

export const getSpeechState = () => ({ ...activeState });

export const subscribeSpeech = (listener) => {
  listeners.add(listener);
  listener(activeState); // replay current state immediately
  return () => listeners.delete(listener);
};

/* ── Public API ──────────────────────────────────────────────────────── */

/**
 * Speak `text` verbatim using the device TTS engine for `language`.
 * The saved pronunciation text is NEVER modified, translated, or rewritten.
 *
 * Returns a promise resolving to a status object:
 *   { status: 'ok' }
 *   { status: 'not_supported' }         — speechSynthesis unavailable
 *   { status: 'empty' }                 — no text provided
 *   { status: 'voice_unavailable', lang }— required voice missing (e.g. Amharic)
 *   { status: 'error', message }
 *
 * onStateChange('speaking' | 'idle') and onVoiceUnavailable(code) are invoked
 * so subscribed components can update their UI.
 */
export const speakPronunciation = async (text, language = 'en', opts = {}) => {
  const { onStateChange, onVoiceUnavailable } = opts;
  const lang = String(language || '').toLowerCase();
  const code = lang.split('-')[0];
  const safeText = String(text == null ? '' : text).trim();

  if (!isSpeechSupported()) {
    publish({ speaking: false, lang: null, voiceUnavailableFor: null });
    onStateChange?.('idle');
    return { status: SPEECH_STATE.NOT_SUPPORTED };
  }
  if (!safeText) {
    publish({ speaking: false, lang: null, voiceUnavailableFor: null });
    onStateChange?.('idle');
    return { status: SPEECH_STATE.EMPTY };
  }

  const voices = await waitForVoices();
  const voice = selectVoice(voices, language);

  // For non-English languages (e.g. Amharic) a matching voice is REQUIRED.
  // We deliberately do NOT fall back to a different-language voice, because
  // that would mis-read / effectively "translate" the entered text.
  const requiresOwnVoice = code !== 'en';
  if (requiresOwnVoice && !voice) {
    publish({ speaking: false, lang: null, voiceUnavailableFor: code });
    onStateChange?.('idle');
    onVoiceUnavailable?.(code);
    return { status: SPEECH_STATE.VOICE_UNAVAILABLE, lang: code };
  }

  // Stop whatever is currently playing so pronunciations never overlap.
  try { window.speechSynthesis.cancel(); } catch (_) {}
  publish({ speaking: true, lang: language, voiceUnavailableFor: null });
  onStateChange?.('speaking');

  const utterance = new SpeechSynthesisUtterance(safeText);
  utterance.lang = lang;
  if (voice) utterance.voice = voice;
  utterance.onend = () => {
    publish({ speaking: false, lang: null, voiceUnavailableFor: null });
    onStateChange?.('idle');
  };
  utterance.onerror = () => {
    publish({ speaking: false, lang: null, voiceUnavailableFor: null });
    onStateChange?.('idle');
  };

  try {
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    publish({ speaking: false, lang: null, voiceUnavailableFor: null });
    onStateChange?.('idle');
    return { status: SPEECH_STATE.ERROR, message: err?.message || 'speak failed' };
  }
  return { status: SPEECH_STATE.OK, voice: !!voice };
};

/** Stop the currently playing utterance (and clear all shared state). */
export const cancelSpeech = () => {
  if (isSpeechSupported()) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  publish({ speaking: false, lang: null, voiceUnavailableFor: null });
};

/* ── Best-effort cleanup on navigation / tab hide ───────────────────── */
if (isBrowser) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelSpeech();
  });
  window.addEventListener('beforeunload', () => {
    try { cancelSpeech(); } catch (_) {}
  }, { once: true });
}

export default {
  SPEECH_STATE,
  isSpeechSupported,
  getVoices,
  selectVoice,
  speakPronunciation,
  cancelSpeech,
  subscribeSpeech,
  getSpeechState,
};

