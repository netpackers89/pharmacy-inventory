import React, { useMemo, useState } from 'react';
import { Volume2, Square, AlertTriangle, VolumeX } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { getVoices, resolveVoice, describeVoice } from '../services/speech';
import './PronunciationSpeaker.css';

/**
 * PronunciationSpeaker — an accessible, touch-friendly Text-to-Speech button
 * with a proper ICON for each language (English / አማርኛ) instead of an emoji.
 *
 * It speaks the EXACT pronunciation text that staff entered (never rewritten,
 * translated or rewritten) using the best available MALE voice for the
 * language, chosen by services/speech.js.
 *
 * Props:
 *   text          — pronunciation text in that language (source of truth).
 *   language      — BCP-47 tag: "en" or "am-ET".
 *   label         — short button label; defaults to "EN" / "አማ".
 *   fallbackText  — English transliteration, used ONLY when the device has no
 *                   Ethiopic voice at all (so Amharic is never silent).
 *
 * Behaviour:
 *   - click starts speaking (overlapping speech is cancelled first);
 *   - clicking the language already speaking stops it (icon becomes "stop");
 *   - the tooltip shows the exact voice that will be used;
 *   - an "≈" badge appears when the voice is only an approximation, and a note
 *     when no voice exists at all — nothing is ever silently mispronounced.
 */
export const PronunciationSpeaker = ({
  text,
  language = 'en',
  label,
  fallbackText = '',
  compact = false,
}) => {
  const { speak, cancel, isSpeaking, supported, voiceUnavailableFor, isApproximate, voiceLabel } = useSpeechSynthesis();
  const [notice, setNotice] = useState(null);

  const active = isSpeaking(language);
  const missing = voiceUnavailableFor(language);
  const approximate = isApproximate(language);
  const isAmharic = String(language).toLowerCase().startsWith('am');
  const visibleLabel = label || (isAmharic ? 'አማ' : 'EN');
  const langName = isAmharic ? 'Amharic (አማርኛ)' : 'English';
  const hasText = Boolean(String(text || '').trim() || String(fallbackText || '').trim());

  /* Which voice will be used — read once per render from the cached list. */
  const plannedVoice = useMemo(() => {
    if (!supported) return null;
    const resolved = resolveVoice(getVoices(), language);
    return resolved.voice ? describeVoice(resolved.voice) : null;
  }, [supported, language]);

  const handleClick = () => {
    if (!supported || !hasText) return;
    if (active) { cancel(); return; }

    setNotice(null);
    // `speak` resolves with the outcome so we can explain an approximation.
    Promise.resolve(speak(text, language, { fallbackText })).then((result) => {
      if (!result) return;
      if (result.status === 'voice_unavailable') {
        setNotice(`No ${langName} voice on this device.`);
      } else if (result.approximate && result.usedFallbackText) {
        setNotice(`No ${langName} voice — reading the English spelling instead.`);
      } else if (result.approximate) {
        setNotice('Approximate voice (same script, different accent).');
      }
    }).catch(() => setNotice('Pronunciation could not be played.'));
  };

  if (!hasText) return null;

  /* No Web Speech API at all: an explanatory, inert chip beats a broken button. */
  if (!supported) {
    return (
      <span className="pron-speaker pron-speaker--unsupported" title="This browser cannot play pronunciation audio.">
        <VolumeX size={14} aria-hidden="true" />
        <span className="pron-speaker__label">{visibleLabel}</span>
      </span>
    );
  }

  const title = active
    ? `Stop ${langName} pronunciation`
    : missing
      ? `No ${langName} voice is installed on this device`
      : `Play ${langName} pronunciation${plannedVoice ? ` — voice: ${plannedVoice}` : ''}`;

  return (
    <span className="pron-speaker-wrap">
      <button
        type="button"
        className={[
          'pron-speaker',
          active ? 'pron-speaker--speaking' : 'pron-speaker--idle',
          missing ? 'pron-speaker--missing' : '',
          compact ? 'pron-speaker--compact' : '',
        ].filter(Boolean).join(' ')}
        aria-label={title}
        title={title}
        aria-pressed={active}
        onClick={handleClick}
      >
        {active
          ? <Square size={14} className="pron-speaker__svg" aria-hidden="true" />
          : <Volume2 size={15} className="pron-speaker__svg" aria-hidden="true" />}
        <span className="pron-speaker__label">{visibleLabel}</span>
        {approximate && !active && (
          <span className="pron-speaker__badge" title="Approximate pronunciation voice">≈</span>
        )}
        {active && <span className="pron-speaker__pulse" aria-hidden="true" />}
      </button>

      {active && (
        <span className="pron-speaker__note pron-speaker__note--live" aria-live="polite">
          Speaking{voiceLabel ? ` (${voiceLabel})` : ''}…
        </span>
      )}
      {!active && notice && (
        <span className="pron-speaker__note" role="note" aria-live="polite">
          <AlertTriangle size={11} aria-hidden="true" /> {notice}
        </span>
      )}
      {!active && !notice && missing && (
        <span className="pron-speaker__note" role="note">
          <AlertTriangle size={11} aria-hidden="true" /> No {langName} voice installed.
        </span>
      )}
    </span>
  );
};

export default PronunciationSpeaker;
