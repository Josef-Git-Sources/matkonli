import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/colors';

export default function ProfileScreen() {
  const router = useRouter();
  const [email, setEmail]         = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
      setIsLoading(false);
    });
  }, []);

  async function handleSignOut() {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    // AuthGate in _layout.tsx will redirect to /login automatically
    // once the session is cleared via onAuthStateChange.
  }

  return (
    <SafeAreaView style={styles.safeArea}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Ionicons name="person-circle-outline" size={24} color={Colors.primary} />
        <Text style={styles.headerTitle}>החשבון שלי</Text>
      </View>

      <View style={styles.body}>

        {/* ── Account card ── */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Ionicons name="mail-outline" size={20} color={Colors.textSecondary} />
            <View style={styles.cardTextBlock}>
              <Text style={styles.cardLabel}>כתובת אימייל</Text>
              {isLoading ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Text style={styles.cardValue}>{email ?? '—'}</Text>
              )}
            </View>
          </View>
        </View>

        {/* ── Sign-out button ── */}
        <TouchableOpacity
          style={[styles.signOutButton, isSigningOut && styles.signOutButtonDisabled]}
          onPress={handleSignOut}
          disabled={isSigningOut}
          activeOpacity={0.85}
        >
          {isSigningOut ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={20} color="#fff" />
              <Text style={styles.signOutText}>התנתק</Text>
            </>
          )}
        </TouchableOpacity>

      </View>

      <Text style={styles.versionLabel}>גרסה: v1.5.0</Text>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'right',
  },

  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 24,
  },
  cardRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 14,
  },
  cardTextBlock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  cardLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 2,
    textAlign: 'right',
  },
  cardValue: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'right',
  },

  signOutButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#C0392B',
    borderRadius: 14,
    paddingVertical: 15,
  },
  signOutButtonDisabled: {
    opacity: 0.5,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  versionLabel: {
    textAlign: 'center',
    fontSize: 11,
    color: '#C0C0C0',
    paddingBottom: 12,
  },
});
