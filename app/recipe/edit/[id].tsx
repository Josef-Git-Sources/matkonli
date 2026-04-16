import {
  View,
  Text,
  Image,
  TextInput,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import ImageViewerModal from '@/components/ImageViewerModal';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { compressImage } from '@/utils/imageUtils';
import { fetchRecipeById, fetchCategories, updateRecipe } from '@/lib/api';
import type { CategoryRow, DifficultyLevel } from '@/types/database';
import { useSpeechInput } from '@/lib/useSpeechInput';
import { MicButton, SpeechToast } from '@/components/MicButton';

// ── Constants ─────────────────────────────────────────────────

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string; color: string }[] = [
  { value: 'easy',   label: 'קל',    color: '#2A7E4F' },
  { value: 'medium', label: 'בינוני', color: '#E8901A' },
  { value: 'hard',   label: 'קשה',   color: '#C0392B' },
];

// ── Screen ────────────────────────────────────────────────────

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();

  // ── Form state ──
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [prepTime, setPrepTime]       = useState('');
  const [difficulty, setDifficulty]   = useState<DifficultyLevel | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [ingredients, setIngredients] = useState<string[]>(['']);
  const [steps, setSteps]             = useState<string[]>(['']);
  const [imageUri, setImageUri]       = useState<string | null>(null);   // new local image
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null); // remote URL
  const [ocrImages, setOcrImages]     = useState<string[]>([]);  // new local OCR images
  const [existingOcrImageUrls, setExistingOcrImageUrls] = useState<string[]>([]); // stored OCR URLs

  const { activeTarget, toastMsg, startListening } = useSpeechInput();
  const [showOcrPreview, setShowOcrPreview] = useState(false);

  const allOcrImages = [...existingOcrImageUrls, ...ocrImages];

  // Unified image viewer
  const [viewerImages,  setViewerImages]  = useState<{ uri: string }[]>([]);
  const [viewerIndex,   setViewerIndex]   = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);

  function openViewer(images: string[], startIndex = 0) {
    setViewerImages(images.map(uri => ({ uri })));
    setViewerIndex(startIndex);
    setViewerVisible(true);
  }

  // ── Loading state ──
  const [isFetching, setIsFetching]   = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fetchError, setFetchError]   = useState<string | null>(null);

  // ── Categories ──
  const [categories, setCategories]               = useState<CategoryRow[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  // Fetch recipe + categories in parallel on mount
  useEffect(() => {
    if (!id) return;
    Promise.all([fetchRecipeById(id), fetchCategories()])
      .then(([recipe, cats]) => {
        setTitle(recipe.title);
        setDescription(recipe.description ?? '');
        setPrepTime(recipe.prep_time ? String(recipe.prep_time) : '');
        setDifficulty(recipe.difficulty ?? null);
        setSelectedCategories(recipe.categories.map(c => c.id));
        setIngredients(recipe.ingredients.length > 0 ? recipe.ingredients.map(i => i.name) : ['']);
        setSteps(recipe.instructions.length > 0 ? recipe.instructions.map(s => s.text) : ['']);
        setExistingImageUrl(recipe.image_url ?? null);
        setExistingOcrImageUrls(recipe.ocr_images ?? []);
        setCategories(cats);
      })
      .catch(() => setFetchError('שגיאה בטעינת המתכון'))
      .finally(() => { setIsFetching(false); setCategoriesLoading(false); });
  }, [id]);

  // ── Handlers ──

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('הרשאה נדרשת', 'יש לאפשר גישה לגלריה כדי להוסיף תמונה.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled) {
      const compressed = await compressImage(result.assets[0].uri);
      setImageUri(compressed);
    }
  }

  async function pickOcrImages() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('הרשאה נדרשת', 'יש לאפשר גישה לגלריה כדי לסרוק תמונות.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      const compressed = await Promise.all(result.assets.map(a => compressImage(a.uri)));
      setOcrImages(prev => [...prev, ...compressed]);
    }
  }

  function removeOcrImage(index: number) {
    // Indices 0..existingOcrImageUrls.length-1 are existing; rest are new local
    if (index < existingOcrImageUrls.length) {
      setExistingOcrImageUrls(prev => prev.filter((_, i) => i !== index));
    } else {
      const localIndex = index - existingOcrImageUrls.length;
      setOcrImages(prev => prev.filter((_, i) => i !== localIndex));
    }
  }

  function toggleCategory(catId: string) {
    setSelectedCategories(prev =>
      prev.includes(catId) ? prev.filter(c => c !== catId) : [...prev, catId]
    );
  }

  function updateIngredient(index: number, value: string) {
    setIngredients(prev => prev.map((item, i) => (i === index ? value : item)));
  }
  function removeIngredient(index: number) {
    setIngredients(prev => prev.length === 1 ? [''] : prev.filter((_, i) => i !== index));
  }

  function updateStep(index: number, value: string) {
    setSteps(prev => prev.map((item, i) => (i === index ? value : item)));
  }
  function removeStep(index: number) {
    setSteps(prev => prev.length === 1 ? [''] : prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!title.trim()) {
      Alert.alert('שגיאה', 'נא להזין כותרת למתכון');
      return;
    }
    setIsSubmitting(true);
    try {
      await updateRecipe(id!, {
        title,
        description,
        prepTime,
        difficulty,
        selectedCategories,
        ingredients,
        steps,
        imageUri:            imageUri ?? undefined,
        existingImageUrl:    existingImageUrl ?? undefined,
        ocrImageUris:        ocrImages.length > 0 ? ocrImages : undefined,
        existingOcrImageUrls: existingOcrImageUrls.length > 0 ? existingOcrImageUrls : undefined,
      });
      router.replace(`/recipe/${id}`);
    } catch (error: any) {
      console.error('Update Error:', error);
      Alert.alert('שגיאה בשמירה', error.message || JSON.stringify(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSave = title.trim().length > 0 && !isSubmitting;
  const previewUri = imageUri ?? existingImageUrl;

  // ── Loading / error gates ──

  if (isFetching) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{fetchError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SpeechToast message={toastMsg} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* ── Top bar ── */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.topBarButton} activeOpacity={0.7}>
            <Ionicons name="chevron-forward" size={26} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle} numberOfLines={1}>עריכת מתכון</Text>
          {allOcrImages.length > 0 ? (
            <TouchableOpacity
              style={[styles.topBarButton, showOcrPreview && styles.topBarButtonActive]}
              onPress={() => setShowOcrPreview(p => !p)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={showOcrPreview ? 'eye' : 'eye-outline'}
                size={22}
                color={showOcrPreview ? Colors.primary : Colors.textSecondary}
              />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 34 }} />
          )}
        </View>

        {/* ── Collapsible OCR reference images panel ── */}
        {showOcrPreview && allOcrImages.length > 0 && (
          <View style={styles.ocrPreviewPanel}>
            <View style={styles.ocrPreviewHeader}>
              <Text style={styles.ocrPreviewTitle}>תמונות מקור לסריקה</Text>
              <Ionicons name="images-outline" size={16} color={Colors.primary} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.ocrPreviewContent}
            >
              {allOcrImages.map((uri, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.ocrPreviewThumbWrap}
                  onPress={() => openViewer(allOcrImages, index)}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri }} style={styles.ocrPreviewThumb} resizeMode="cover" />
                  <View style={styles.ocrPreviewThumbHint}>
                    <Ionicons name="expand-outline" size={12} color="#fff" />
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ══ IMAGE PICKER ══ */}
          <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.8}>
            {previewUri ? (
              <>
                <Image source={{ uri: previewUri }} style={styles.imagePreview} resizeMode="cover" />
                <View style={styles.imageOverlay}>
                  <Ionicons name="camera-outline" size={22} color="#fff" />
                  <Text style={styles.imageOverlayText}>החלף תמונה</Text>
                </View>
                {/* Zoom button — tap without triggering the replace-image handler */}
                <TouchableOpacity
                  style={styles.imageZoomBtn}
                  onPress={(e) => { e.stopPropagation(); openViewer([previewUri]); }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="expand-outline" size={16} color="#fff" />
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="image-outline" size={36} color={Colors.textSecondary} />
                <Text style={styles.imagePlaceholderText}>הוסף תמונה למתכון</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* ══ OCR IMAGES SECTION ══ */}
          <>
            <TouchableOpacity
              style={styles.ocrScanBtn}
              onPress={pickOcrImages}
              activeOpacity={0.8}
            >
              <Ionicons name="scan-outline" size={17} color={Colors.primary} />
              <Text style={styles.ocrScanBtnLabel}>סרוק תמונות למתכון</Text>
            </TouchableOpacity>
            {allOcrImages.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.ocrThumbnailsScroll}
                contentContainerStyle={styles.ocrThumbnailsContent}
              >
                {allOcrImages.map((uri, index) => (
                  <View key={index} style={styles.ocrThumbnailWrap}>
                    <Image source={{ uri }} style={styles.ocrThumbnail} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.ocrRemoveBtn}
                      onPress={() => removeOcrImage(index)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="close-circle" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </>

          {/* ══ SECTION: Recipe Details ══ */}
          <SectionCard label="פרטי המתכון">
            <FieldLabel text="כותרת *" />
            <TextInput
              style={styles.input}
              placeholder="למשל: עוגת שוקולד של סבתא"
              placeholderTextColor={Colors.textSecondary}
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
            />
            <FieldLabel text="תיאור" />
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="ספר קצת על המתכון..."
              placeholderTextColor={Colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </SectionCard>

          {/* ══ SECTION: Extra Details ══ */}
          <SectionCard label="פרטים נוספים">
            <FieldLabel text="זמן הכנה (דקות)" />
            <TextInput
              style={[styles.input, styles.inputNarrow]}
              placeholder="30"
              placeholderTextColor={Colors.textSecondary}
              value={prepTime}
              onChangeText={t => setPrepTime(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={4}
            />
            <FieldLabel text="רמת קושי" />
            <View style={styles.chipRow}>
              {DIFFICULTY_OPTIONS.map(({ value, label, color }) => {
                const active = difficulty === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[styles.chip, active && { backgroundColor: color, borderColor: color }]}
                    onPress={() => setDifficulty(active ? null : value)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </SectionCard>

          {/* ══ SECTION: Categories ══ */}
          <SectionCard label="קטגוריות">
            {categoriesLoading ? (
              <ActivityIndicator color={Colors.primary} style={styles.loader} />
            ) : (
              <View style={styles.categoriesWrap}>
                {categories.map(cat => {
                  const active = selectedCategories.includes(cat.id);
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => toggleCategory(cat.id)}
                      activeOpacity={0.75}
                    >
                      {cat.icon ? <Text style={styles.categoryIcon}>{cat.icon}</Text> : null}
                      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                        {cat.name_he}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </SectionCard>

          {/* ══ SECTION: Ingredients ══ */}
          <SectionCard label="מרכיבים">
            {ingredients.map((ingredient, index) => (
              <View key={index} style={styles.listRow}>
                <TouchableOpacity style={styles.deleteButton} onPress={() => removeIngredient(index)} activeOpacity={0.7}>
                  <Ionicons name="trash-outline" size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, styles.listInput]}
                  placeholder="מצרך..."
                  placeholderTextColor={Colors.textSecondary}
                  value={ingredient}
                  onChangeText={v => updateIngredient(index, v)}
                  returnKeyType="next"
                />
                <MicButton
                  isActive={activeTarget?.type === 'ingredient' && activeTarget.index === index}
                  onPress={() => startListening('ingredient', index, ingredient, v => updateIngredient(index, v))}
                />
              </View>
            ))}
            <TouchableOpacity
              style={styles.addRowButton}
              onPress={() => setIngredients(prev => [...prev, ''])}
              activeOpacity={0.75}
            >
              <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
              <Text style={styles.addRowLabel}>הוסף מצרך</Text>
            </TouchableOpacity>
          </SectionCard>

          {/* ══ SECTION: Steps ══ */}
          <SectionCard label="שלבי הכנה">
            {steps.map((step, index) => (
              <View key={index} style={styles.listRow}>
                <TouchableOpacity style={styles.deleteButton} onPress={() => removeStep(index)} activeOpacity={0.7}>
                  <Ionicons name="trash-outline" size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
                <View style={styles.stepInputWrap}>
                  <Text style={styles.stepNumber}>{index + 1}.</Text>
                  <TextInput
                    style={[styles.input, styles.listInput, styles.inputMultiline]}
                    placeholder="תאר את השלב..."
                    placeholderTextColor={Colors.textSecondary}
                    value={step}
                    onChangeText={v => updateStep(index, v)}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                  />
                </View>
                <MicButton
                  isActive={activeTarget?.type === 'step' && activeTarget.index === index}
                  onPress={() => startListening('step', index, step, v => updateStep(index, v))}
                />
              </View>
            ))}
            <TouchableOpacity
              style={styles.addRowButton}
              onPress={() => setSteps(prev => [...prev, ''])}
              activeOpacity={0.75}
            >
              <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
              <Text style={styles.addRowLabel}>הוסף שלב</Text>
            </TouchableOpacity>
          </SectionCard>

          {/* ── Save Button ── */}
          <TouchableOpacity
            style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
            disabled={!canSave}
            onPress={handleSave}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.saveButtonText}>שומר...</Text>
              </>
            ) : (
              <>
                <Text style={styles.saveButtonText}>שמור שינויים</Text>
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.versionLabel}>גרסה: v1.21.1</Text>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Unified fullscreen image viewer ── */}
      <ImageViewerModal
        images={viewerImages}
        imageIndex={viewerIndex}
        visible={viewerVisible}
        onRequestClose={() => setViewerVisible(false)}
      />
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────

function SectionCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea:     { flex: 1, backgroundColor: 'transparent' },
  flex:         { flex: 1 },
  centerContent:{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText:    { fontSize: 15, color: '#C0392B', textAlign: 'center' },
  scrollContent:{ paddingHorizontal: 16, paddingBottom: 40 },

  topBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  topBarButton: { padding: 4 },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'right',
    marginHorizontal: 8,
  },

  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'right',
  },

  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 4,
    textAlign: 'right',
  },

  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.textPrimary,
    marginBottom: 12,
    textAlign: 'right',
  },
  inputMultiline: { minHeight: 80, paddingTop: 11 },
  inputNarrow:    { width: 120, alignSelf: 'flex-end' },

  chipRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive:      { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLabel:       { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  chipLabelActive: { color: '#fff', fontWeight: '600' },

  categoriesWrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, paddingVertical: 4 },
  categoryIcon:   { fontSize: 14 },

  listRow:      { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  listInput:    { flex: 1 },
  deleteButton: { paddingTop: 13, paddingHorizontal: 4 },
  stepInputWrap:{ flex: 1, flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 6 },
  stepNumber:   { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, paddingTop: 13, minWidth: 20, textAlign: 'right' },
  addRowButton: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingVertical: 8, alignSelf: 'flex-end' },
  addRowLabel:  { fontSize: 14, color: Colors.primary, fontWeight: '600' },

  loader:    { marginVertical: 12 },

  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 8,
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText:     { fontSize: 17, fontWeight: '700', color: '#fff' },

  versionLabel: { marginTop: 20, textAlign: 'center', fontSize: 11, color: '#C0C0C0' },

  imagePicker: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  imagePreview: { width: '100%', height: '100%' },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  imageOverlayText:    { color: '#fff', fontSize: 14, fontWeight: '600' },
  imageZoomBtn: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 18,
    padding: 6,
  },
  imagePlaceholder:    { flex: 1, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', gap: 8 },
  imagePlaceholderText:{ fontSize: 14, color: Colors.textSecondary },

  topBarButtonActive: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
  },

  // ── OCR collapsible reference panel ──
  ocrPreviewPanel: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ocrPreviewHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  ocrPreviewTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  ocrPreviewContent: {
    gap: 8,
    paddingHorizontal: 2,
  },
  ocrPreviewThumbWrap: {
    width: 80,
    height: 80,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  ocrPreviewThumb: {
    width: '100%',
    height: '100%',
  },
  ocrPreviewThumbHint: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    padding: 3,
  },

  // ── OCR scan ──
  ocrScanBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  ocrScanBtnLabel: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  ocrThumbnailsScroll:   { marginBottom: 12 },
  ocrThumbnailsContent:  { gap: 8, paddingHorizontal: 2 },
  ocrThumbnailWrap:      { width: 90, height: 90, borderRadius: 10, overflow: 'hidden' },
  ocrThumbnail:          { width: '100%', height: '100%' },
  ocrRemoveBtn:          { position: 'absolute', top: 4, right: 4 },
});
