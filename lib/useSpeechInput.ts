import { useEffect, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

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

  useSpeechRecognitionEvent('result', (event) => {
    if (!event.isFinal) return;
    const transcript = event.results?.[0]?.transcript?.trim() ?? '';
    if (!transcript) return;
    const existing = currentValueRef.current.trim();
    callbackRef.current(existing ? `${existing} ${transcript}` : transcript);
  });

  useSpeechRecognitionEvent('end', () => {
    setActiveTarget(null);
  });

  useSpeechRecognitionEvent('error', (event) => {
    setActiveTarget(null);
    // 'aborted' is triggered by our own stop() call — don't show a toast for that
    if ((event as any).error !== 'aborted') {
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
