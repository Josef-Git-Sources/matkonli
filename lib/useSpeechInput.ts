import { useEffect, useRef, useState } from 'react';

// ── Native module availability guard ──────────────────────────────────
// expo-speech-recognition requires a custom native build (EAS Build).
// In standard Expo Go the native module is not present — guard all access
// with a module-level try/catch so the app never crashes on import.
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: (event: string, handler: (e: any) => void) => void = () => {};

try {
  const mod = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule ?? null;
  useSpeechRecognitionEvent   = mod.useSpeechRecognitionEvent   ?? (() => {});
} catch {
  // Native module not present in this build — speech feature silently disabled.
}

/** True only when the expo-speech-recognition native module is available. */
export const SPEECH_AVAILABLE = ExpoSpeechRecognitionModule != null;

export interface SpeechTarget {
  type: string;   // 'ingredient' | 'step'
  index: number;
}

/**
 * Encapsulates Hebrew speech-to-text for form fields.
 *
 * Usage:
 *   const { activeTarget, toastMsg, startListening } = useSpeechInput();
 *
 *   // In a list row:
 *   <MicButton
 *     isActive={activeTarget?.type === 'ingredient' && activeTarget.index === i}
 *     onPress={() => startListening('ingredient', i, ingredients[i], v => updateIngredient(i, v))}
 *   />
 */
export function useSpeechInput() {
  const [activeTarget, setActiveTarget] = useState<SpeechTarget | null>(null);
  const [toastMsg, setToastMsg]         = useState<string | null>(null);

  // Stable refs so event callbacks don't become stale
  const callbackRef     = useRef<(v: string) => void>(() => {});
  const currentValueRef = useRef('');

  // These three calls are always executed (same hook count every render).
  // When SPEECH_AVAILABLE is false, useSpeechRecognitionEvent is a no-op,
  // so zero React hooks are registered — consistent across all renders.
  useSpeechRecognitionEvent('result', (event: any) => {
    if (!event.isFinal) return;
    const transcript = event.results?.[0]?.transcript?.trim() ?? '';
    if (!transcript) return;
    const existing = currentValueRef.current.trim();
    callbackRef.current(existing ? `${existing} ${transcript}` : transcript);
  });

  useSpeechRecognitionEvent('end', () => {
    setActiveTarget(null);
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    setActiveTarget(null);
    // 'aborted' is triggered by our own stop() call — don't show a toast for that
    if (event?.error !== 'aborted') {
      setToastMsg('זיהוי קול נכשל. בדוק הרשאת מיקרופון ונסה שוב.');
    }
  });

  // Auto-dismiss toast after 3.5 s
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3500);
    return () => clearTimeout(t);
  }, [toastMsg]);

  async function startListening(
    type: string,
    index: number,
    currentValue: string,
    onResult: (v: string) => void,
  ) {
    if (!SPEECH_AVAILABLE) {
      setToastMsg('זיהוי קול אינו זמין בסביבה זו.');
      return;
    }

    // Tapping an active field stops it
    if (activeTarget?.type === type && activeTarget.index === index) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    // Stop any other active session first
    if (activeTarget) {
      ExpoSpeechRecognitionModule.stop();
    }

    // Request microphone permission (no-op on web — browser handles it natively)
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) {
        setToastMsg('יש לאפשר הרשאת מיקרופון בהגדרות.');
        return;
      }
    } catch {
      // On web the browser prompts automatically; ignore the thrown error
    }

    currentValueRef.current = currentValue;
    callbackRef.current     = onResult;
    setActiveTarget({ type, index });

    try {
      ExpoSpeechRecognitionModule.start({ lang: 'he-IL', interimResults: false });
    } catch {
      setActiveTarget(null);
      setToastMsg('זיהוי קול אינו נתמך במכשיר זה.');
    }
  }

  return { activeTarget, toastMsg, startListening };
}
