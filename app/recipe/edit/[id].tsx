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
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { fetchRecipeById, fetchCategories, updateRecipe } from '@/lib/api';
import type { CategoryRow, DifficultyLevel } from '@/types/database';

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
    if (!result.canceled) setImageUri(result.assets[0].uri);
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
        imageUri:         imageUri ?? undefined,
        existingImageUrl: existingImageUrl ?? undefined,
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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* ── Top bar ── */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.topBarButton} activeOpacity={0.7}>
            <Ionicons name="chevron-forward" size={26} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle} numberOfLines={1}>עריכת מתכון</Text>
          <View style={{ width: 34 }} />
        </View>

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
              </>
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="image-outline" size={36} color={Colors.textSecondary} />
                <Text style={styles.imagePlaceholderText}>הוסף תמונה למתכון</Text>
              </View>
            )}
          </TouchableOpacity>

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

          <Text style={styles.versionLabel}>גרסה: v1.4.0</Text>

        </ScrollView>
      </KeyboardAvoidingView>
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
  safeArea:     { flex: 1, backgroundColor: Colors.background },
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
  imagePlaceholder:    { flex: 1, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', gap: 8 },
  imagePlaceholderText:{ fontSize: 14, color: Colors.textSecondary },
});
