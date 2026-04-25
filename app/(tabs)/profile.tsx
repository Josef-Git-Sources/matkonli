import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Modal,
  ImageBackground,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';
import { getUserProfile } from '@/lib/userProfile';
import type { UserProfile } from '@/lib/userProfile';
import {
  fetchCategories, createCategory, renameCategory,
  deleteCategory, countRecipesUsingCategory,
} from '@/lib/api';
import type { CategoryRow } from '@/types/database';

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
  const [isSigningOut, setIsSigningOut]   = useState(false);
  const [isUploadingBg, setIsUploadingBg] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // ── Category management state ──
  const [catModalVisible, setCatModalVisible]     = useState(false);
  const [allCategories, setAllCategories]         = useState<CategoryRow[]>([]);
  const [catsLoading, setCatsLoading]             = useState(false);
  const [editingCatId, setEditingCatId]           = useState<string | null>(null);
  const [editingCatName, setEditingCatName]       = useState('');
  const [addCatModalVisible, setAddCatModalVisible] = useState(false);
  const [newCatName, setNewCatName]               = useState('');
  const [isAddingCat, setIsAddingCat]             = useState(false);
  // Delete confirmation state (custom Modal replaces Alert.alert — alert silently fails inside Modal)
  const [deleteCatModalVisible, setDeleteCatModalVisible] = useState(false);
  const [deleteCatTarget, setDeleteCatTarget]     = useState<CategoryRow | null>(null);
  const [deleteCatCount, setDeleteCatCount]       = useState(0);
  const [isDeletingCat, setIsDeletingCat]         = useState(false);

  const { backgroundImage, backgroundOpacity, setBackgroundImage, setBackgroundOpacity } = useTheme();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
      setIsLoading(false);
    });
    getUserProfile().then(setUserProfile).catch(() => {});
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
    if (status !== 'granted') return;

    // base64: true ensures we always get raw base64 data alongside the URI.
    // This is the fallback for web/Expo Go where the URI is a blob: object
    // that React Native cannot render or persist.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      base64: true,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setIsUploadingBg(true);

    try {
      let dataUri: string;

      if (asset.uri.startsWith('file://')) {
        // Native path: the URI is a real file on disk.
        // Compress it first (limits size to ≤1080px wide, 50% quality JPEG),
        // then read the compressed bytes as base64 via expo-file-system.
        const compressed = await manipulateAsync(
          asset.uri,
          [{ resize: { width: 1080 } }],
          { compress: 0.5, format: SaveFormat.JPEG },
        );
        const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        dataUri = `data:image/jpeg;base64,${base64}`;
      } else {
        // Web / Expo Go path: the URI is a blob: which FileSystem cannot read.
        // Use the base64 data the picker already decoded for us.
        if (!asset.base64) {
          Alert.alert('שגיאה', 'לא ניתן לקרוא את התמונה בסביבה זו.');
          return;
        }
        dataUri = `data:image/jpeg;base64,${asset.base64}`;
      }

      // setBackgroundImage validates the URI and saves to AsyncStorage + Supabase
      setBackgroundImage(dataUri);
      if (backgroundOpacity === 0) setBackgroundOpacity(0.6);
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לעבד את התמונה. נסה שוב.');
    } finally {
      setIsUploadingBg(false);
    }
  }

  // ── Category management handlers ──

  function isSystemCategory(cat: CategoryRow): boolean {
    return cat.user_id === null && !(cat as any)._local;
  }

  async function openManageCategories() {
    setCatModalVisible(true);
    setCatsLoading(true);
    try {
      const all = await fetchCategories();
      setAllCategories(all);
    } catch {
      // ignore
    } finally {
      setCatsLoading(false);
    }
  }

  async function handleAddCategory() {
    const name = newCatName.trim();
    if (!name) return;
    setIsAddingCat(true);
    try {
      const newCat = await createCategory({ name_he: name });
      setAllCategories(prev => [...prev, newCat]);
      setNewCatName('');
      setAddCatModalVisible(false);
    } catch (e: any) {
      Alert.alert('שגיאה', e.message ?? 'לא ניתן ליצור קטגוריה');
    } finally {
      setIsAddingCat(false);
    }
  }

  async function handleConfirmRename(id: string) {
    const name = editingCatName.trim();
    setEditingCatId(null);
    if (!name) return;
    try {
      await renameCategory(id, name);
      setAllCategories(prev => prev.map(c => c.id === id ? { ...c, name_he: name } : c));
    } catch (e: any) {
      Alert.alert('שגיאה', e.message ?? 'לא ניתן לשנות שם');
    }
  }

  async function handleDeleteCategory(cat: CategoryRow) {
    let count = 0;
    try {
      count = await countRecipesUsingCategory(cat.id);
    } catch {
      // Default to 0 on error — modal will show the no-associated-recipes message
    }
    setDeleteCatTarget(cat);
    setDeleteCatCount(count);
    setDeleteCatModalVisible(true);
  }

  async function confirmDeleteCategory() {
    if (!deleteCatTarget) return;
    setIsDeletingCat(true);
    try {
      await deleteCategory(deleteCatTarget.id);
      setAllCategories(prev => prev.filter(c => c.id !== deleteCatTarget!.id));
      setDeleteCatModalVisible(false);
      setDeleteCatTarget(null);
    } catch (e: any) {
      setDeleteCatModalVisible(false);
      // Re-open an error modal after a tick so it renders outside the closed modal
      setTimeout(() => Alert.alert('שגיאה', e?.message ?? 'לא ניתן למחוק קטגוריה'), 300);
    } finally {
      setIsDeletingCat(false);
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

        {/* ── AI Quota card ── */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.aiIcon}>👑</Text>
            <Text style={styles.sectionTitle}>ייבוא AI</Text>
          </View>

          {isLoading || !userProfile ? (
            <ActivityIndicator size="small" color={Colors.primary} style={{ alignSelf: 'flex-end' }} />
          ) : userProfile.is_premium ? (
            <View style={styles.cardRow}>
              <Ionicons name="checkmark-circle" size={20} color="#2A7E4F" />
              <View style={styles.cardTextBlock}>
                <Text style={styles.cardLabel}>סטטוס מנוי</Text>
                <Text style={[styles.cardValue, { color: '#2A7E4F' }]}>פרימיום — סריקות ללא הגבלה</Text>
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.cardRow}>
                <Ionicons
                  name={userProfile.ai_quota > 0 ? 'flash-outline' : 'flash-off-outline'}
                  size={20}
                  color={userProfile.ai_quota > 0 ? Colors.textSecondary : '#C0392B'}
                />
                <View style={styles.cardTextBlock}>
                  <Text style={styles.cardLabel}>סריקות AI שנותרו</Text>
                  <Text style={[styles.cardValue, userProfile.ai_quota === 0 && styles.quotaEmpty]}>
                    {userProfile.ai_quota} מתוך 3
                  </Text>
                </View>
              </View>
              {userProfile.ai_quota === 0 && (
                <Text style={styles.quotaExhaustedText}>
                  מכסת ה-AI החינמית אזלה — שדרג לפרימיום לסריקות ללא הגבלה
                </Text>
              )}
            </View>
          )}
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
            style={[styles.galleryButton, isUploadingBg && styles.galleryButtonDisabled]}
            onPress={pickGalleryBackground}
            activeOpacity={0.8}
            disabled={isUploadingBg}
          >
            {isUploadingBg ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Ionicons name="image-outline" size={18} color={Colors.primary} />
            )}
            <Text style={styles.galleryButtonLabel}>
              {isUploadingBg ? 'מעבד תמונה...' : 'בחר רקע מהגלריה'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Manage Categories card ── */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="pricetag-outline" size={20} color={Colors.primary} />
            <Text style={styles.sectionTitle}>קטגוריות</Text>
          </View>
          <TouchableOpacity
            style={styles.galleryButton}
            onPress={openManageCategories}
            activeOpacity={0.8}
          >
            <Ionicons name="settings-outline" size={18} color={Colors.primary} />
            <Text style={styles.galleryButtonLabel}>ניהול קטגוריות</Text>
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

        <Text style={styles.versionLabel}>גרסה: v1.24.0</Text>

      </ScrollView>
    </SafeAreaView>

    {/* ── Manage Categories Screen (full-screen modal) ── */}
    <Modal
      visible={catModalVisible}
      animationType="slide"
      onRequestClose={() => { setCatModalVisible(false); setEditingCatId(null); }}
    >
      <SafeAreaView style={styles.modalSafe}>

        {/* ── Top bar ── */}
        <View style={styles.catTopBar}>
          <TouchableOpacity
            style={styles.catBackBtn}
            onPress={() => { setCatModalVisible(false); setEditingCatId(null); }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={20} color={Colors.primary} />
            <Text style={styles.catBackText}>חזור</Text>
          </TouchableOpacity>
          <Text style={styles.catScreenTitle}>ניהול קטגוריות</Text>
          {/* spacer to balance back button */}
          <View style={styles.catTopBarSpacer} />
        </View>

        {/* ── Category list ── */}
        {catsLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 60 }} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.catListContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* System categories — compact chips, read-only */}
            <View style={styles.catSectionHeader}>
              <Ionicons name="lock-closed-outline" size={13} color={Colors.textSecondary} />
              <Text style={styles.catSectionLabel}>קטגוריות בסיסיות</Text>
            </View>
            <View style={styles.systemChipsWrap}>
              {allCategories.filter(isSystemCategory).map(cat => (
                <View key={cat.id} style={styles.systemChip}>
                  {cat.icon ? <Text style={styles.systemChipIcon}>{cat.icon}</Text> : null}
                  <Text style={styles.systemChipLabel}>{cat.name_he}</Text>
                </View>
              ))}
            </View>

            {/* User categories section header */}
            <Text style={[styles.catSectionLabel, { marginTop: 20 }]}>הקטגוריות שלי</Text>

            {allCategories.filter(c => !isSystemCategory(c)).length === 0 && (
              <Text style={styles.catEmptyText}>
                עדיין אין קטגוריות אישיות.{'\n'}לחץ על הכפתור למטה כדי להוסיף.
              </Text>
            )}

            {allCategories.filter(c => !isSystemCategory(c)).map(cat => (
              <View key={cat.id} style={styles.catRow}>
                {editingCatId === cat.id ? (
                  /* ── Inline rename ── */
                  <View style={styles.catEditInner}>
                    <TouchableOpacity
                      onPress={() => handleConfirmRename(cat.id)}
                      activeOpacity={0.75}
                      style={styles.catActionBtn}
                    >
                      <Ionicons name="checkmark-circle" size={24} color={Colors.primary} />
                    </TouchableOpacity>
                    <TextInput
                      style={styles.catEditInput}
                      value={editingCatName}
                      onChangeText={setEditingCatName}
                      autoFocus
                      textAlign="right"
                      returnKeyType="done"
                      onSubmitEditing={() => handleConfirmRename(cat.id)}
                    />
                    <TouchableOpacity
                      onPress={() => setEditingCatId(null)}
                      activeOpacity={0.75}
                      style={styles.catActionBtn}
                    >
                      <Ionicons name="close-circle-outline" size={22} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* ── Display row ── */
                  <>
                    <TouchableOpacity
                      onPress={() => handleDeleteCategory(cat)}
                      activeOpacity={0.75}
                      style={styles.catActionBtn}
                    >
                      <Ionicons name="trash-outline" size={20} color="#C0392B" />
                    </TouchableOpacity>
                    <View style={styles.catNameArea}>
                      {cat.icon ? <Text style={styles.catRowIcon}>{cat.icon}</Text> : null}
                      <Text style={styles.catName}>{cat.name_he}</Text>
                      {(cat as any)._local ? (
                        <Text style={styles.catLocalBadge}>מקומי</Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      onPress={() => { setEditingCatId(cat.id); setEditingCatName(cat.name_he); }}
                      activeOpacity={0.75}
                      style={styles.catActionBtn}
                    >
                      <Ionicons name="pencil-outline" size={20} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ))}

            {/* ── Add category button at bottom of list ── */}
            <TouchableOpacity
              style={styles.addCatListBtn}
              onPress={() => { setNewCatName(''); setAddCatModalVisible(true); }}
              activeOpacity={0.8}
            >
              <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
              <Text style={styles.addCatListBtnLabel}>+ הוסף קטגוריה חדשה</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>

      {/* ── Delete Confirmation mini-modal ── */}
      <Modal
        visible={deleteCatModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!isDeletingCat) setDeleteCatModalVisible(false); }}
      >
        <View style={styles.addModalOverlay}>
          <View style={styles.addModalBox}>
            <Text style={styles.addModalTitle}>מחיקת קטגוריה</Text>
            <Text style={styles.deleteModalMessage}>
              {deleteCatCount === 0
                ? `האם למחוק את הקטגוריה "${deleteCatTarget?.name_he}"?`
                : `שים לב! הקטגוריה הזו משויכת ל-${deleteCatCount} מתכונים. המתכונים עצמם לא יימחקו, אך התווית תוסר מהם. האם להמשיך במחיקה?`}
            </Text>
            <View style={styles.addModalBtns}>
              <TouchableOpacity
                onPress={() => setDeleteCatModalVisible(false)}
                style={styles.addModalCancelBtn}
                activeOpacity={0.75}
                disabled={isDeletingCat}
              >
                <Text style={styles.addModalCancelText}>ביטול</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmDeleteCategory}
                disabled={isDeletingCat}
                style={[styles.addModalSaveBtn, { backgroundColor: '#C0392B' }]}
                activeOpacity={0.85}
              >
                {isDeletingCat ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addModalSaveText}>מחק</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add New Category mini-modal ── */}
      <Modal
        visible={addCatModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddCatModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.addModalOverlay}
          activeOpacity={1}
          onPress={() => { if (!isAddingCat) setAddCatModalVisible(false); }}
        >
          <TouchableOpacity activeOpacity={1} style={styles.addModalBox}>
            <Text style={styles.addModalTitle}>קטגוריה חדשה</Text>
            <TextInput
              style={styles.addModalInput}
              value={newCatName}
              onChangeText={setNewCatName}
              placeholder="שם הקטגוריה..."
              placeholderTextColor={Colors.textSecondary}
              textAlign="right"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddCategory}
            />
            <View style={styles.addModalBtns}>
              <TouchableOpacity
                onPress={() => setAddCatModalVisible(false)}
                style={styles.addModalCancelBtn}
                activeOpacity={0.75}
              >
                <Text style={styles.addModalCancelText}>ביטול</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAddCategory}
                disabled={!newCatName.trim() || isAddingCat}
                style={[
                  styles.addModalSaveBtn,
                  (!newCatName.trim() || isAddingCat) && styles.addModalSaveBtnDisabled,
                ]}
                activeOpacity={0.85}
              >
                {isAddingCat ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addModalSaveText}>הוסף</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Modal>

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
  galleryButtonDisabled: {
    opacity: 0.55,
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

  aiIcon: {
    fontSize: 18,
  },
  quotaEmpty: {
    color: '#C0392B',
    fontWeight: '700',
  },
  quotaExhaustedText: {
    fontSize: 12,
    color: '#C0392B',
    textAlign: 'right',
    marginTop: 8,
    lineHeight: 18,
  },

  // ── Manage Categories screen ──
  modalSafe: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  catTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  catBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingRight: 8,
  },
  catBackText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
  },
  catScreenTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  catTopBarSpacer: {
    width: 60,  // mirrors back button width to keep title centered
  },

  catListContent: {
    paddingBottom: 32,
  },
  catSectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  catSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    textAlign: 'right',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  systemChipsWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  systemChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  systemChipIcon: {
    fontSize: 13,
  },
  systemChipLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  catEmptyText: {
    textAlign: 'center',
    color: Colors.textSecondary,
    fontSize: 14,
    marginTop: 16,
    marginBottom: 8,
    lineHeight: 22,
    paddingHorizontal: 32,
  },
  catRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
    minHeight: 56,
  },
  catNameArea: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  catRowIcon: {
    fontSize: 18,
  },
  catName: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: '500',
    textAlign: 'right',
    flexShrink: 1,
  },
  catLocalBadge: {
    fontSize: 10,
    color: Colors.textSecondary,
    backgroundColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  catActionBtn: {
    padding: 10,
  },
  catEditInner: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  catEditInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.primary,
    paddingVertical: 6,
    textAlign: 'right',
  },

  addCatListBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  addCatListBtnLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
  },

  // ── Add-category mini-modal ──
  addModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  addModalBox: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  addModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'right',
    marginBottom: 16,
  },
  deleteModalMessage: {
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'right',
    lineHeight: 22,
    marginBottom: 24,
  },
  addModalInput: {
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    marginBottom: 20,
  },
  addModalBtns: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  addModalSaveBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addModalSaveBtnDisabled: {
    opacity: 0.45,
  },
  addModalSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  addModalCancelBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  addModalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
});
