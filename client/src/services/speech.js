/**
 * browserSpeechService — Text-to-Speech for the pharmacy system.
 *
 * WHY PRONUNCIATION USED TO SOUND LIKE A ROBOT
 * ────────────────────────────────────────────
 * The previous selector returned the FIRST voice whose language matched. On
 * most devices that is a low-quality, local, often female "desktop" voice
 * (or an eSpeak-style synth), so every word came out flat and mechanical —
 * and for Amharic it went completely silent whenever no `am-*` voice existed.
 *
 * HOW A GOOD VOICE IS CHOSEN NOW
 * ──────────────────────────────
 * Every voice is SCORED, and the best one wins:
 *   + exact language match
 *   + network/cloud voice (`localService === false`) → Google/Microsoft
 *     neural voices, which are dramatically clearer than local ones
 *   + known premium names (Natural, Neural, Online, Enhanced, Premium, Wavenet,
 *     Google, Siri)
 *   + MALE voice names (David, Guy, Ryan, Meles, …) — the requested voice
 *   − female voice names
 *   − legacy/robot synths (eSpeak, Festival, Pico, Flite, "compact")
 *   − novelty voices (Bubbles, Zarvox, …) are removed entirely
 *
 * AMHARIC STRATEGY (never silent if it can be helped)
 *   1. `am-ET` / `am-*` voice                     → exact
 *   2. `ti-ET` / `ti-*` voice                     → SAME GE'EZ SCRIPT, so the
 *      text is read correctly, just in a Tigrinya accent (marked "approximate")
 *   3. no Ethiopic voice at all                   → the English transliteration
 *      (`fallbackText`) is spoken with the best English male voice, clearly
 *      labelled as an approximation in the UI.
 *
 * Optional per-voice override: the chosen voice is remembered in localStorage
 * (`pharm_tts_voice_en` / `pharm_tts_voice_am`), so if staff prefer a specific
 * voice it stays selected on that device.
 *
 * Nothing is stored in PostgreSQL and no external pronunciation API is called:
 * the pharmacy's own pronunciation text is handed verbatim to the device TTS.
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

/* ── Voice cache (Chrome loads voices late) ──────────────────────────── */
let voicesCache = [];

const refreshVoices = () => {
  if (!isSpeechSupported()) { voicesCache = []; return; }
  try { voicesCache = window.speechSynthesis.getVoices() || []; } catch (_) { voicesCache = []; }
};

if (isBrowser && window.speechSynthesis) {
  refreshVoices();
  try { window.speechSynthesis.addEventListener('voiceschanged', refreshVoices); } catch (_) {}
  const poll = setTimeout(refreshVoices, 700);
  window.addEventListener('beforeunload', () => clearTimeout(poll), { once: true });
}

export const getVoices = () => {
  refreshVoices();
  return voicesCache;
};

/** Wait until the browser reports at least one voice (max 1.5s). */
const waitForVoices = () => {
  if (!isSpeechSupported()) return Promise.resolve([]);
  refreshVoices();
  if (voicesCache.length > 0) return Promise.resolve(voicesCache);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { window.speechSynthesis.removeEventListener('voiceschanged', onVoices); } catch (_) {}
      clearTimeout(timer);
      resolve(voicesCache);
    };
    const onVoices = () => {
      refreshVoices();
      if (voicesCache.length > 0) finish();
    };
    const timer = setTimeout(finish, 1500);
    try { window.speechSynthesis.addEventListener('voiceschanged', onVoices); } catch (_) {}
  });
};

/* ── Voice catalogs ──────────────────────────────────────────────────── */

/* Clear male voice names across Windows / macOS / Android / Chrome. */
const MALE_NAMES = [
  'male', 'david', 'guy', 'ryan', 'george', 'brian', 'mark', 'christopher', 'eric',
  'steffan', 'alex', 'daniel', 'arthur', 'oliver', 'thomas', 'james', 'john', 'michael',
  'paul', 'richard', 'robert', 'william', 'liam', 'connor', 'fred', 'ralph', 'aaron',
  'rishi', 'ravi', 'prabhat', 'hemant', 'madhur', 'valluv', 'meles', 'dawit', 'abebe',
  'kaleb', 'nahom', 'samuel', 'yohannes', 'joseph', 'hans', 'stefan', 'klaus', 'lars',
  'magnus', 'jorge', 'diego', 'carlos', 'juan', 'luca', 'matteo', 'nicolas', 'henri',
  'pierre', 'antoine', 'yannick', 'allan', 'gordon', 'reed', 'rocko', 'jester',
];

/* Names that are definitely NOT male — used as a negative signal. */
const FEMALE_NAMES = [
  'female', 'zira', 'aria', 'jenny', 'michelle', 'samantha', 'karen', 'moira', 'tessa',
  'fiona', 'victoria', 'susan', 'heera', 'neerja', 'raveena', 'catherine', 'hazel',
  'linda', 'monica', 'paulina', 'amelie', 'anna', 'carmit', 'damayanti', 'ioana',
  'joana', 'kanya', 'kyoko', 'laila', 'lekha', 'mariska', 'melina', 'nora', 'sara',
  'satu', 'sin-ji', 'tarja', 'ting-ting', 'yelda', 'zosia', 'ava', 'allison', 'serena',
  'veena', 'emma', 'clara', 'elise', 'julie', 'kate', 'olivia', 'cora', 'martha',
  'libby', 'sonia', 'amber', 'ana', 'shelley', 'kathy', 'princess', 'helena', 'katja',
];

/* High-quality engine markers (neural / cloud voices). */
const PREMIUM_MARKERS = [
  'natural', 'neural', 'online', 'enhanced', 'premium', 'wavenet', 'studio',
  'siri', 'google',
];

/* Legacy / robotic synths — heavily penalised, never preferred. */
const ROBOT_MARKERS = ['espeak', 'espeak-ng', 'festival', 'flite', 'pico', 'sam', 'robot', 'legacy', 'compact'];

/* Novelty voices (they literally sing or croak) — excluded completely. */
const NOVELTY_NAMES = [
  'bad news', 'good news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged',
  'hysterical', 'jester', 'organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox',
  'albert', 'junior',
];

/* Tigrinya shares the Ge'ez script with Amharic → a usable script fallback. */
const SCRIPT_FALLBACK_LANGS = { am: ['ti'] };

/* ── Scoring / selection ─────────────────────────────────────────────── */

const norm = (value) => String(value || '').toLowerCase();
const tagOf = (voice) => norm(voice && voice.lang).replace('_', '-');
const nameOf = (voice) => norm(voice && voice.name);
const uriOf = (voice) => norm(voice && voice.voiceURI);

/** Heuristic gender: 1 = male, -1 = female, 0 = unknown. */
export const guessGender = (voice) => {
  const haystack = `${nameOf(voice)} ${uriOf(voice)}`;
  if (/\bmale\b/.test(haystack) && !/female/.test(haystack)) return 1;
  if (FEMALE_NAMES.some((n) => haystack.includes(n))) return -1;
  if (MALE_NAMES.some((n) => haystack.includes(n))) return 1;
  return 0;
};

/** Novelty voices (singing / croaking) are never used for drug names. */
export const isNoveltyVoice = (voice) => NOVELTY_NAMES.some((n) => nameOf(voice).includes(n));

/**
 * Can this voice read the requested language AT ALL?
 *
 * This is a hard filter, deliberately separate from the score: a low-scoring
 * voice (for example the only female voice on a device) must still be USED,
 * because a mediocre voice is far better than silence. Usability is therefore
 * "right language AND not a novelty voice" — never "high enough score".
 */
export const isUsableVoice = (voice, language) => {
  if (!voice || !voice.lang) return false;
  if (isNoveltyVoice(voice)) return false;
  const wanted = norm(language).replace('_', '-').split('-')[0];
  if (!wanted) return false;
  return tagOf(voice).split('-')[0] === wanted;
};

/**
 * Score one voice for a language tag. Higher is better; -1 = unusable.
 * Exported so it can be unit-tested without a browser.
 */
export const scoreVoice = (voice, language) => {
  if (!isUsableVoice(voice, language)) return -1;

  const tag = tagOf(voice);
  const wanted = norm(language).replace('_', '-');

  let score = tag === wanted ? 60 : 30; // exact tag beats same-language

  const haystack = `${nameOf(voice)} ${uriOf(voice)}`;
  if (voice.localService === false) score += 40;   // cloud/neural engine = clearest
  if (PREMIUM_MARKERS.some((m) => haystack.includes(m))) score += 25;
  if (ROBOT_MARKERS.some((m) => haystack.includes(m))) score -= 45;

  const gender = guessGender(voice);
  if (gender === 1) score += 28;        // requested: a male voice
  else if (gender === -1) score -= 40;

  if (!voice.default) score += 2;       // prefer a deliberate choice over the OS default
  return score;
};

/**
 * Every usable voice for a language, best first.
 * The list is NOT filtered by score, so a device that only has one mediocre
 * voice still gets audio instead of silence.
 */
export const rankVoices = (voices, language) => (voices || [])
  .filter((voice) => isUsableVoice(voice, language))
  .map((voice) => ({ voice, score: scoreVoice(voice, language) }))
  .sort((a, b) => b.score - a.score)
  .map((entry) => entry.voice);

/** Best single voice for a language, or null. */
export const selectVoice = (voices, language) => rankVoices(voices, language)[0] || null;

/* Optional device-level override chosen by staff (localStorage, per language). */
const overrideKey = (code) => `pharm_tts_voice_${code}`;

const readOverride = (code) => {
  if (!isBrowser) return null;
  try { return window.localStorage.getItem(overrideKey(code)) || null; } catch (_) { return null; }
};

/** Remember a preferred voice for a language (used by the voice picker). */
export const setPreferredVoice = (language, voiceURI) => {
  if (!isBrowser) return;
  const code = norm(language).split('-')[0];
  try {
    if (voiceURI) window.localStorage.setItem(overrideKey(code), voiceURI);
    else window.localStorage.removeItem(overrideKey(code));
  } catch (_) { /* storage disabled — selection stays automatic */ }
};

/**
 * Resolve which voice to use for a language and how good the match is.
 *   { voice, match: 'exact' | 'language' | 'script' | 'none',
 *     approximate, scriptFallbackLang }
 */
export const resolveVoice = (voices, language) => {
  const wanted = norm(language).replace('_', '-');
  const code = wanted.split('-')[0];
  const list = voices || [];

  const preferredURI = readOverride(code);
  if (preferredURI) {
    const preferred = list.find((v) => uriOf(v) === norm(preferredURI));
    if (preferred && scoreVoice(preferred, language) >= 0) {
      return { voice: preferred, match: 'preferred', approximate: false, scriptFallbackLang: null };
    }
  }

  const best = rankVoices(list, language);
  if (best.length) {
    return {
      voice: best[0],
      match: tagOf(best[0]) === wanted ? 'exact' : 'language',
      approximate: false,
      scriptFallbackLang: null,
    };
  }

  // Same-script fallback (Amharic → Tigrinya): the Ge'ez characters are read
  // correctly, only the accent differs, so this is far better than silence.
  for (const fallbackCode of SCRIPT_FALLBACK_LANGS[code] || []) {
    const scriptVoice = rankVoices(list, fallbackCode)[0];
    if (scriptVoice) {
      return {
        voice: scriptVoice,
        match: 'script',
        approximate: true,
        scriptFallbackLang: fallbackCode,
      };
    }
  }

  return { voice: null, match: 'none', approximate: false, scriptFallbackLang: null };
};

/** Human label for tooltips: "Google UK English Male · network". */
export const describeVoice = (voice) => {
  if (!voice) return 'no matching voice on this device';
  const engine = voice.localService === false ? 'network' : 'device';
  return `${voice.name} · ${voice.lang} · ${engine}`;
};


/* ── Shared "is anything speaking" state ─────────────────────────────── */
/* One source of truth, so clicking any speaker instantly updates all others. */
let activeState = {
  speaking: false,
  lang: null,
  supported: isSpeechSupported(),
  voiceUnavailableFor: null,
  approximateFor: null,     // language code currently read with an approximate voice
  voiceLabel: null,         // human-readable voice name (for tooltips / status)
  status: null,             // last resolution status, see SPEECH_STATE
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

const idlePatch = () => ({
  speaking: false, lang: null, voiceUnavailableFor: null,
  approximateFor: null, voiceLabel: null, status: null,
});

/* ── Pronunciation settings (natural, neutral) ────────────────────────────
 *
 * These values used to be `rate: 0.92, pitch: 0.85, volume: 1`, chosen to
 * force a "deep male character". On any device whose local voices are
 * low-quality synths (eSpeak / Flite "compact" voices, common on Linux and
 * Android), a LOW pitch applied to an already-robotic voice produces exactly
 * the distorted, growl-like "horror" tone this app was reported for.
 *
 * The fix is to stay at the browser's neutral defaults (rate 1, pitch 1) and a
 * moderate volume. The voice RANKING in `scoreVoice` still prefers a good
 * male, natural/neural voice when one exists — so the pronunciation still
 * sounds like a clear male reading rather than a generic default voice — but
 * nothing is artificially deep, slowed or blown out any more.
 */
export const SPEECH_TUNING = {
  rate: 1,        // natural speed
  pitch: 1,       // neutral pitch — no artificial deepening / growling
  volume: 0.85,   // moderate, leaves headroom so it cannot clip
};

let activeUtterance = null;
let watchdog = null;

const clearWatchdog = () => {
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
};

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

/**
 * Speak `text` with the best matching male voice for `language`.
 *
 * The saved pronunciation text is NEVER modified, translated or rewritten.
 * The only extra text this module may speak is `opts.fallbackText` — the
 * English transliteration the pharmacist ALREADY saved — and only when the
 * device has no Ethiopic voice at all. That case is reported as
 * `approximateFor` so the UI can say so.
 *
 * Returns:
 *   { status: 'ok', voice, match, approximate, usedFallbackText }
 *   { status: 'not_supported' | 'empty' | 'voice_unavailable' | 'error' }
 */
export const speakPronunciation = async (text, language = 'en', opts = {}) => {
  const { onStateChange, onVoiceUnavailable, fallbackText = '', tuning = {} } = opts;
  const safeText = String(text == null ? '' : text).trim();
  const fallback = String(fallbackText == null ? '' : fallbackText).trim();
  const lang = norm(language) || 'en';
  const code = lang.split('-')[0];

  if (!isSpeechSupported()) {
    publish(idlePatch());
    onStateChange?.('idle');
    return { status: SPEECH_STATE.NOT_SUPPORTED };
  }
  if (!safeText && !fallback) {
    publish(idlePatch());
    onStateChange?.('idle');
    return { status: SPEECH_STATE.EMPTY };
  }

  const voices = await waitForVoices();
  let resolution = resolveVoice(voices, language);
  let spokenText = safeText;
  let usedFallbackText = false;

  if (!resolution.voice) {
    /*
     * No voice for this language AND no same-script voice (e.g. Amharic on a
     * device without Ge'ez support). Reading the Amharic characters with an
     * English voice would produce nonsense, so we speak the pharmacist's own
     * English transliteration instead — and tell the UI it is approximate.
     */
    const englishVoice = resolveVoice(voices, 'en-US').voice || selectVoice(voices, 'en');
    if (fallback && englishVoice) {
      resolution = { voice: englishVoice, match: 'transliteration', approximate: true, scriptFallbackLang: null };
      spokenText = fallback;
      usedFallbackText = true;
    } else {
      publish({
        speaking: false, lang: null, voiceUnavailableFor: code,
        approximateFor: null, voiceLabel: null, status: SPEECH_STATE.VOICE_UNAVAILABLE,
      });
      onStateChange?.('idle');
      onVoiceUnavailable?.(code);
      return { status: SPEECH_STATE.VOICE_UNAVAILABLE, lang: code };
    }
  }

  // Never overlap two pronunciations.
  cancelSpeech();
  await new Promise((resolve) => setTimeout(resolve, 80)); // Chrome needs a beat after cancel()

  const utterance = new SpeechSynthesisUtterance(spokenText);
  /*
   * Use the VOICE's own tag, not the requested one: when a Tigrinya voice reads
   * Amharic text the engine must be told "ti-ET", otherwise it is handed the
   * wrong phoneme set for the very script it is reading.
   */
  utterance.lang = (resolution.voice && resolution.voice.lang) || language;
  if (resolution.voice) utterance.voice = resolution.voice;
  utterance.rate = clamp(tuning.rate ?? SPEECH_TUNING.rate, 0.5, 1.5);
  utterance.pitch = clamp(tuning.pitch ?? SPEECH_TUNING.pitch, 0, 2);
  utterance.volume = clamp(tuning.volume ?? SPEECH_TUNING.volume, 0, 1);

  const finish = () => {
    activeUtterance = null;
    clearWatchdog();
    publish(idlePatch());
    onStateChange?.('idle');
  };
  utterance.onend = finish;
  utterance.onerror = finish;

  activeUtterance = utterance;
  publish({
    speaking: true,
    lang: language,
    voiceUnavailableFor: null,
    approximateFor: resolution.approximate ? code : null,
    voiceLabel: describeVoice(resolution.voice),
    status: SPEECH_STATE.OK,
  });
  onStateChange?.('speaking');

  try {
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    finish();
    return { status: SPEECH_STATE.ERROR, message: (err && err.message) || 'speak failed' };
  }

  /* Chrome quirks: it sometimes starts paused, and it can silently get stuck. */
  setTimeout(() => {
    try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); } catch (_) {}
  }, 250);
  clearWatchdog();
  watchdog = setTimeout(() => {
    try { window.speechSynthesis.cancel(); } catch (_) {}
    finish();
  }, 30000);

  return {
    status: SPEECH_STATE.OK,
    voice: (resolution.voice && resolution.voice.name) || null,
    voiceLabel: describeVoice(resolution.voice),
    match: resolution.match,
    approximate: resolution.approximate,
    usedFallbackText,
    spokenText,
  };
};

/** Stop the current utterance and clear the shared state. */
export const cancelSpeech = () => {
  clearWatchdog();
  if (isSpeechSupported()) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  activeUtterance = null;
  publish(idlePatch());
};

/* ── Best-effort cleanup on navigation / tab hide ────────────────────── */
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
  SPEECH_TUNING,
  isSpeechSupported,
  getVoices,
  selectVoice,
  rankVoices,
  scoreVoice,
  isUsableVoice,
  resolveVoice,
  describeVoice,
  guessGender,
  setPreferredVoice,
  speakPronunciation,
  cancelSpeech,
  subscribeSpeech,
  getSpeechState,
};

