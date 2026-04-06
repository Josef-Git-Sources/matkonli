import { I18nManager } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/context/auth';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

// Redirects unauthenticated users to /login and authenticated users away from it.
function AuthGate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router   = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthScreen = segments[0] === 'login';

    if (!session && !inAuthScreen) {
      router.replace('/login');
    } else if (session && inAuthScreen) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments]);

  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate />
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
        <Stack.Screen name="recipe/[id]" />
        <Stack.Screen name="recipe/edit/[id]" />
      </Stack>
    </AuthProvider>
  );
}
