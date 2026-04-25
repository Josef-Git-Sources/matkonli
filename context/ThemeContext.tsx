import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

// ── Default floral background ─────────────────────────────────
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?q=80&w=800';

const STORAGE_KEY_IMAGE   = '@theme/backgroundImage';
const STORAGE_KEY_OPACITY = '@theme/backgroundOpacity';

// ── Helpers ───────────────────────────────────────────────────

/**
 * Returns true only for URI schemes that React Native's Image component
 * can safely render: https://, data:image/..., and file://.
 * blob: URIs are ephemeral browser objects that RN cannot render — they
 * must never reach <ImageBackground>.
 */
function isSafeUri(uri: string | null | undefined): uri is string {
  if (!uri) return false;
  return (
    uri.startsWith('https://') ||
    uri.startsWith('http://')  ||
    uri.startsWith('data:image/') ||
    uri.startsWith('file://')
  );
}

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

  // 1. Load from AsyncStorage immediately on mount (fast, offline-friendly)
  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY_IMAGE, STORAGE_KEY_OPACITY])
      .then(([imgEntry, opacityEntry]) => {
        // Only apply if the stored URI is safe to render — skip stale blob: values
        if (isSafeUri(imgEntry[1]))  setBackgroundImageState(imgEntry[1]);
        if (opacityEntry[1])         setBackgroundOpacityState(parseFloat(opacityEntry[1]));
      })
      .catch(() => { /* ignore read errors — keep defaults */ });
  }, []);

  // 2. Sync with Supabase profile — loads saved preferences from any device
  useEffect(() => {
    // Check for an already-active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) syncFromSupabase(session.user.id);
    });

    // Also update whenever the auth state changes (sign-in / sign-out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) syncFromSupabase(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function syncFromSupabase(userId: string) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('background_image_url, background_opacity')
        .eq('id', userId)
        .single();

      const url = data?.background_image_url;

      if (isSafeUri(url)) {
        // Safe URI (https://, data:image/, file://) — apply it
        setBackgroundImageState(url);
        AsyncStorage.setItem(STORAGE_KEY_IMAGE, url).catch(() => {});
      } else if (url != null) {
        // Stale blob: URI saved before the fix — clear it from Supabase silently
        supabase
          .from('profiles')
          .update({ background_image_url: null })
          .eq('id', userId)
          .then(() => {});
        AsyncStorage.removeItem(STORAGE_KEY_IMAGE).catch(() => {});
      }

      if (data?.background_opacity != null) {
        setBackgroundOpacityState(data.background_opacity);
        AsyncStorage.setItem(STORAGE_KEY_OPACITY, String(data.background_opacity)).catch(() => {});
      }
    } catch {
      // Network unavailable or column not yet migrated — keep local values
    }
  }

  async function setBackgroundImage(uri: string) {
    // Never render or persist a blob: URI — they are ephemeral browser objects
    if (!isSafeUri(uri)) return;
    setBackgroundImageState(uri);
    AsyncStorage.setItem(STORAGE_KEY_IMAGE, uri).catch(() => {});
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .update({ background_image_url: uri })
          .eq('id', user.id);
      }
    } catch {
      // Offline or not logged in — AsyncStorage is the fallback
    }
  }

  async function setBackgroundOpacity(opacity: number) {
    setBackgroundOpacityState(opacity);
    AsyncStorage.setItem(STORAGE_KEY_OPACITY, String(opacity)).catch(() => {});
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .update({ background_opacity: opacity })
          .eq('id', user.id);
      }
    } catch {
      // Offline or not logged in — AsyncStorage is the fallback
    }
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
