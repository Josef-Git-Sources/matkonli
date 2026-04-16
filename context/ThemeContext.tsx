import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Default floral background ─────────────────────────────────
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?q=80&w=800';

const STORAGE_KEY_IMAGE   = '@theme/backgroundImage';
const STORAGE_KEY_OPACITY = '@theme/backgroundOpacity';

// ── Types ─────────────────────────────────────────────────────

interface ThemeContextValue {
  backgroundImage:   string;
  backgroundOpacity: number;
  setBackgroundImage:   (uri: string)     => void;
  setBackgroundOpacity: (opacity: number) => void;
}

// ── Context ───────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue>({
  backgroundImage:      DEFAULT_IMAGE,
  backgroundOpacity:    0.6,
  setBackgroundImage:   () => {},
  setBackgroundOpacity: () => {},
});

// ── Provider ──────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [backgroundImage,   setBackgroundImageState]   = useState(DEFAULT_IMAGE);
  const [backgroundOpacity, setBackgroundOpacityState] = useState(0.6);

  // Load persisted theme on mount
  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY_IMAGE, STORAGE_KEY_OPACITY])
      .then(([imgEntry, opacityEntry]) => {
        if (imgEntry[1])     setBackgroundImageState(imgEntry[1]);
        if (opacityEntry[1]) setBackgroundOpacityState(parseFloat(opacityEntry[1]));
      })
      .catch(() => { /* ignore read errors — keep defaults */ });
  }, []);

  function setBackgroundImage(uri: string) {
    setBackgroundImageState(uri);
    AsyncStorage.setItem(STORAGE_KEY_IMAGE, uri).catch(() => {});
  }

  function setBackgroundOpacity(opacity: number) {
    setBackgroundOpacityState(opacity);
    AsyncStorage.setItem(STORAGE_KEY_OPACITY, String(opacity)).catch(() => {});
  }

  return (
    <ThemeContext.Provider
      value={{ backgroundImage, backgroundOpacity, setBackgroundImage, setBackgroundOpacity }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────

export function useTheme() {
  return useContext(ThemeContext);
}
