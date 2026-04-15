import { createContext, useContext, useState } from 'react';

// ── Default floral background ─────────────────────────────────
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?q=80&w=800';

// ── Types ─────────────────────────────────────────────────────

interface ThemeContextValue {
  backgroundImage:   string;
  backgroundOpacity: number;
  setBackgroundImage:   (uri: string)   => void;
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
  const [backgroundImage,   setBackgroundImage]   = useState(DEFAULT_IMAGE);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.6);

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
