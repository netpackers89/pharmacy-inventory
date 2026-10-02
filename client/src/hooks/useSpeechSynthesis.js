import { useState, useEffect, useCallback } from 'react';
import {
  speakPronunciation,
  cancelSpeech,
  isSpeechSupported,
  subscribeSpeech,
  getSpeechState,
  SPEECH_STATE,
} from '../services/speech';

/**
 * React hook around the shared browser TTS service.
 *
 * Multiple PronunciationSpeaker buttons subscribe to the SAME global
 * speaking state, so:
 *   - clicking one speaker stops any pronunciation currently playing, and
 *   - every button instantly reflects the correct "speaking" / "idle" state.
 *
 * It also reports which voice the device will use (`voiceLabel`) and whether
 * the current language is being read with an APPROXIMATE voice (a same-script
 * Tigrinya voice, or the English transliteration) so the UI can say so instead
 * of silently sounding wrong.
 *
 * The hook also stops speech automatically when the subscribing component
 * unmounts (e.g. the medicine detail modal is closed).
 */
export const useSpeechSynthesis = () => {
  const [state, setState] = useState(() => getSpeechState());

  useEffect(() => subscribeSpeech(setState), []);

  // `opts` accepts { fallbackText, tuning, onVoiceUnavailable }.
  const speak = useCallback(
    (text, language, opts) => speakPronunciation(text, language, opts),
    []
  );
  const cancel = useCallback(() => cancelSpeech(), []);

  /* Compare language ROOTS so "am", "am-ET" and "am-et" all match. */
  const sameLang = (value, language) => {
    if (!value || !language) return false;
    return String(value).split('-')[0].toLowerCase() === String(language).split('-')[0].toLowerCase();
  };

  const isSpeaking = useCallback((language) => state.speaking && sameLang(state.lang, language), [state.speaking, state.lang]);
  const voiceUnavailableFor = useCallback((language) => sameLang(state.voiceUnavailableFor, language), [state.voiceUnavailableFor]);
  const isApproximate = useCallback((language) => sameLang(state.approximateFor, language), [state.approximateFor]);

  return {
    speak,
    cancel,
    speaking: state.speaking,
    speakingLang: state.lang,
    supported: state.supported,
    voiceLabel: state.voiceLabel,
    isSpeaking,
    voiceUnavailableFor,
    isApproximate,
    SPEECH_STATE,
  };
};

export default useSpeechSynthesis;
