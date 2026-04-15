import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  ImageBackground,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';

// ── Background presets ────────────────────────────────────────

const BG_PRESETS = [
  {
    label: 'פרחים עדינים',
    uri:   'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?q=80&w=800',
    defaultOpacity: 0.6,
  },
  {
    label: 'מטבח כפרי',
    uri:   'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?q=80&w=800',
    defaultOpacity: 0.5,
  },
  {
    label: 'צבע חלק (לבן)',
    uri:   'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?q=80&w=800',
    defaultOpacity: 0,
  },
] as const;

const OPACITY_LEVELS = [
  { label: '20%', value: 0.2 },
  { label: '40%', value: 0.4 },
  { label: '60%', value: 0.6 },
  { label: '80%', value: 0.8 },
] as const;

// ── Screen ────────────────────────────────────────────────────

export default function ProfileScreen() {
  const [email, setEmail]         = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const { backgroundImage, backgroundOpacity, setBackgroundImage, setBackgroundOpacity } = useTheme();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
      setIsLoading(false);
    });
  }, []);

  async function handleSignOut() {
    setIsSigningOut(true);
    await supabase.auth.signOut();
  }

  function applyPreset(preset: typeof BG_PRESETS[number]) {
    setBackgroundImage(preset.uri);
    setBackgroundOpacity(preset.defaultOpacity);
  }

  async function pickGalleryBackground() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      // No alert needed — permission dialog already explains
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setBackgroundImage(result.assets[0].uri);
      // Keep current opacity, or default to 0.6 if currently at 0 (plain white)
      if (backgroundOpacity === 0) setBackgroundOpacity(0.6);
    }
  }

  const isPlainWhite = backgroundOpacity === 0;
  const activeBgUri  = backgroundImage;

  return (
    <ImageBackground
      source={{ uri: backgroundImage }}
      style={{ flex: 1 }}
      imageStyle={{ opacity: backgroundOpacity }}
      resizeMode="cover"
    >
    <SafeAreaView style={styles.safeArea}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Ionicons name="person-circle-outline" size={24} color={Colors.primary} />
        <Text style={styles.headerTitle}>החשבון שלי</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

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

        {/* ── Theme / background section ── */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="color-palette-outline" size={20} color={Colors.primary} />
            <Text style={styles.sectionTitle}>עיצוב האפליקציה</Text>
          </View>

          {/* Background presets */}
          <Text style={styles.subLabel}>רקע</Text>
          <View style={styles.chipRow}>
            {BG_PRESETS.map(preset => {
              const isActive =
                activeBgUri === preset.uri &&
                (preset.defaultOpacity === 0 ? isPlainWhite : !isPlainWhite);
              return (
                <TouchableOpacity
                  key={preset.label}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => applyPreset(preset)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Opacity buttons (hidden when plain white is active) */}
          {!isPlainWhite && (
            <>
              <Text style={styles.subLabel}>שקיפות הרקע</Text>
              <View style={styles.chipRow}>
                {OPACITY_LEVELS.map(({ label, value }) => {
                  const isActive = Math.abs(backgroundOpacity - value) < 0.05;
                  return (
                    <TouchableOpacity
                      key={label}
                      style={[styles.chip, isActive && styles.chipActive]}
                      onPress={() => setBackgroundOpacity(value)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* Custom gallery background */}
          <TouchableOpacity
            style={styles.galleryButton}
            onPress={pickGalleryBackground}
            activeOpacity={0.8}
          >
            <Ionicons name="image-outline" size={18} color={Colors.primary} />
            <Text style={styles.galleryButtonLabel}>בחר רקע מהגלריה</Text>
          </TouchableOpacity>
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

        <Text style={styles.versionLabel}>גרסה: v1.19.3</Text>

      </ScrollView>
    </SafeAreaView>
    </ImageBackground>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'right',
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },

  card: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 16,
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

  // ── Theme section ──
  sectionHeaderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'right',
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    textAlign: 'right',
    marginBottom: 8,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  chipLabelActive: {
    color: '#fff',
    fontWeight: '600',
  },

  galleryButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  galleryButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },

  signOutButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#C0392B',
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 8,
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
    paddingTop: 20,
    paddingBottom: 4,
  },
});
