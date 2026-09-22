import React from 'react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import './PronunciationSpeaker.css';

/**
 * PronunciationSpeaker — a reusable, accessible Text-to-Speech button.
 *
 * It takes the EXACT pronunciation text that staff entered (never rewritten /
 * translated) and hands it to the device's built-in TTS engine when clicked.
 *
 * Props:
 *   text      — exact pronunciation text to speak (source of truth).
 *   language  — BCP-47-ish tag, e.g. "en" or "am-ET".
 *   label     — human-readable name, e.g. "English" / "Amharic".
 *
 * Behaviour:
 *   - Clicking starts speaking (the shared service cancels anything currently
 *     playing so pronunciations never overlap).
 *   - Clicking the language that is ALREADY speaking toggles it off.
 *   - Shows a non-blocking note when no matching voice exists (e.g. Amharic),
 *     without falling back to another language.
 *   - Touch-friendly (48px target), desktop tooltip via `title`, full ARIA.
 */
export const PronunciationSpeaker = ({ text, language, label }) => {
  const { speak, cancel, isSpeaking, supported, voiceUnavailableFor } = useSpeechSynthesis();
  const active = isSpeaking(language);
  const noVoice = voiceUnavailableFor(language);

  const handleClick = () => {
    if (!supported) return;
    if (active) {
      cancel();
      return;
    }
    if (!text || !text.trim()) return;
    speak(text, language);
  };

  if (!text) return null;

  // Browser has no Web Speech API at all -> show an inert, explanatory note
  // rather than a broken button. The rest of the app still works fine.
  if (!supported) {
    return (
      <span
        className="pron-speaker pron-speaker--unsupported"
        aria-label="Text-to-speech is not supported by this browser"
        title="Text-to-speech is not supported by this browser"
      >
        <span aria-hidden="true">🔊</span>
        <span className="pron-speaker__note">TTS is not supported by this browser.</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`pron-speaker ${active ? 'pron-speaker--speaking' : 'pron-speaker--idle'}`}
      aria-label={active ? `Reading ${label} pronunciation…` : `Read ${label} pronunciation`}
      title={active ? `Reading ${label} pronunciation…` : `Read ${label} pronunciation`}
      aria-pressed={active}
      aria-live={active ? 'assertive' : undefined}
      onClick={handleClick}
    >
      <span className="pron-speaker__icon" aria-hidden="true">🔊</span>
      <span className="pron-speaker__label">{label}</span>
      {active && <span className="pron-speaker__pulse" aria-label="Speaking" />}
      {active && <span className="pron-speaker__status" aria-live="polite">Speaking…</span>}
      {!active && noVoice && (
        <span className="pron-speaker__note" aria-live="polite">
          {label} voice is not available on this device.
        </span>
      )}
    </button>
  );
};

export default PronunciationSpeaker;
