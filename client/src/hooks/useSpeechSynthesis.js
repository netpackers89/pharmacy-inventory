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
 * The hook also stops speech automatically when the subscribing component
 * unmounts (e.g. the medicine detail modal is closed).
 */
export const useSpeechSynthesis = () => {
  const [state, setState] = useState(() => getSpeechState());

  useEffect(() => subscribeSpeech(setState), []);

  const speak = useCallback((text, language) => speakPronunciation(text, language), []);
  const cancel = useCallback(() => cancelSpeech(), []);

  const isSpeaking = useCallback(
    (language) => {
      if (!state.speaking || !language) return false;
      return String(state.lang).toLowerCase() === String(language).toLowerCase();
    },
    [state.speaking, state.lang]
  );

  const voiceUnavailableFor = useCallback(
    (language) => {
      if (!state.voiceUnavailableFor || !language) return false;
      return String(state.voiceUnavailableFor) === String(language).split('-')[0].toLowerCase();
    },
    [state.voiceUnavailableFor]
  );

  return {
    speak,
    cancel,
    speaking: state.speaking,
    speakingLang: state.lang,
    supported: state.supported,
    isSpeaking,
    voiceUnavailableFor,
    SPEECH_STATE,
  };
};

export default useSpeechSynthesis;
