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
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { fetchCategories, saveRecipe } from '@/lib/api';
import type { CategoryRow, DifficultyLevel } from '@/types/database';
import { useSpeechInput } from '@/lib/useSpeechInput';
import { MicButton, SpeechToast } from '@/components/MicButton';
import { parseRawText, extractPdfText, extractDocxText } from '@/lib/parseRecipeText';

// ── Constants ─────────────────────────────────────────────────

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string; color: string }[] = [
  { value: 'easy',   label: 'קל',    color: '#2A7E4F' },
  { value: 'medium', label: 'בינוני', color: '#E8901A' },
  { value: 'hard',   label: 'קשה',   color: '#C0392B' },
];

// ── Component ─────────────────────────────────────────────────

export default function AddRecipeScreen() {
  const router = useRouter();

  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [prepTime, setPrepTime]       = useState('');
  const [difficulty, setDifficulty]   = useState<DifficultyLevel | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [ingredients, setIngredients]   = useState<string[]>(['']);
  const [steps, setSteps]               = useState<string[]>(['']);
  const [imageUri, setImageUri]         = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImporting, setIsImporting]   = useState(false);
  const [importedFields, setImportedFields] = useState<Set<string>>(new Set());

  const { activeTarget, toastMsg, startListening } = useSpeechInput();

  const [categories, setCategories]               = useState<CategoryRow[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError]     = useState<string | null>(null);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategoriesError('שגיאה בטעינת הקטגוריות'))
      .finally(() => setCategoriesLoading(false));
  }, []);

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
      setImageUri(result.assets[0].uri);
    }
  }

  async function handleImportFromFile() {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'application/pdf',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });
    } catch (err: any) {
      console.error('[Import] DocumentPicker error:', err);
      Alert.alert('שגיאה', 'לא ניתן לפתוח את בוחר הקבצים.');
      return;
    }

    console.log('[Import] File selected:', JSON.stringify(result, null, 2));

    if (result.canceled || !result.assets?.length) {
      console.log('[Import] Cancelled or no assets');
      return;
    }

    const asset = result.assets[0];
    setIsImporting(true);

    try {
      const mime = asset.mimeType ?? '';
      const uri  = asset.uri;
      console.log('[Import] Asset — name:', asset.name, '| mime:', mime, '| uri:', uri);

      // ── Read raw bytes as text ─────────────────────────────
      let rawContent = '';

      if (Platform.OS === 'web') {
        // On web, `asset.file` is the native browser File object.
        // FileReader is the only reliable way to read it — expo-file-system
        // is a no-op on web and silently returns nothing.
        const webFile = (asset as any).file as File | undefined;
        if (webFile) {
          rawContent = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = (e) => resolve((e.target?.result as string) ?? '');
            reader.onerror = ()  => reject(new Error('FileReader נכשל'));
            reader.readAsText(webFile, 'utf-8');
          });
        } else {
          // Fallback: fetch the blob/object URL the picker provided
          const response = await fetch(uri);
          rawContent = await response.text();
        }
      } else {
        // Native (iOS / Android)
        rawContent = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      console.log('[Import] Raw content length:', rawContent.length);
      console.log('[Import] Raw content preview:', rawContent.slice(0, 200));

      // ── Format-specific extraction ─────────────────────────
      let rawText = rawContent;

      if (mime === 'application/pdf' || asset.name?.endsWith('.pdf')) {
        rawText = extractPdfText(rawContent);
        console.log('[Import] PDF extracted text:', rawText.slice(0, 200));
        if (!rawText.trim()) {
          Alert.alert(
            'PDF מוצפן',
            'לא הצלחנו לחלץ טקסט מקובץ זה. נסה לשמור אותו כ-.txt ולייבא שוב.',
          );
          return;
        }
      } else if (
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        asset.name?.endsWith('.docx')
      ) {
        rawText = extractDocxText(rawContent);
        console.log('[Import] DOCX extracted text:', rawText.slice(0, 200));
        if (!rawText.trim()) {
          Alert.alert(
            'Word לא נתמך',
            'לא הצלחנו לקרוא את הקובץ. נסה לשמור אותו כ-.txt ולייבא שוב.',
          );
          return;
        }
      }
      // .txt — rawText is already rawContent

      if (!rawText.trim()) {
        Alert.alert('הקובץ ריק', 'לא נמצא טקסט בקובץ שנבחר.');
        return;
      }

      // ── Parse & populate form ──────────────────────────────
      const parsed = parseRawText(rawText);
      console.log('[Import] Parsed result:', JSON.stringify(parsed, null, 2));

      const filled = new Set<string>();

      if (parsed.title) {
        setTitle(parsed.title);
        filled.add('title');
      }
      if (parsed.description) {
        setDescription(parsed.description);
        filled.add('description');
      }
      if (parsed.ingredients.some(s => s.trim())) {
        setIngredients(parsed.ingredients);
        filled.add('ingredients');
      }
      if (parsed.steps.some(s => s.trim())) {
        setSteps(parsed.steps);
        filled.add('steps');
      }

      console.log('[Import] Filled fields:', [...filled]);
      setImportedFields(filled);

      Alert.alert(
        'יובא בהצלחה ✓',
        `זוהו: ${[...filled].join(', ')}.\nנא לבדוק את השדות המסומנים לפני השמירה.`,
      );
    } catch (err: any) {
      console.error('[Import] Error:', err);
      Alert.alert('שגיאה בקריאת הקובץ', err.message ?? 'שגיאה לא ידועה');
    } finally {
      setIsImporting(false);
    }
  }

  function toggleCategory(id: string) {
    setSelectedCategories(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
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
      await saveRecipe({ title, description, prepTime, difficulty, selectedCategories, ingredients, steps, imageUri: imageUri ?? undefined });
      setTitle('');
      setDescription('');
      setPrepTime('');
      setDifficulty(null);
      setSelectedCategories([]);
      setIngredients(['']);
      setSteps(['']);
      setImageUri(null);
      setImportedFields(new Set());
      router.replace('/');
    } catch (error: any) {
      console.error('Save Error:', error);
      alert('שגיאה בשמירה: ' + (error.message || JSON.stringify(error)));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSave = title.trim().length > 0 && !isSubmitting;

  return (
    <SafeAreaView style={styles.safeArea}>
      <SpeechToast message={toastMsg} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Header ── */}
          <View style={styles.header}>
            <TouchableOpacity
              style={[styles.importBtn, isImporting && styles.importBtnDisabled]}
              onPress={handleImportFromFile}
              disabled={isImporting}
              activeOpacity={0.8}
            >
              {isImporting ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Ionicons name="document-text-outline" size={17} color={Colors.primary} />
              )}
              <Text style={styles.importBtnLabel}>
                {isImporting ? 'טוען...' : 'טען מקובץ'}
              </Text>
            </TouchableOpacity>
            <View style={styles.headerTitleRow}>
              <Ionicons name="restaurant-outline" size={22} color={Colors.primary} />
              <Text style={styles.headerTitle}>מתכון חדש</Text>
            </View>
          </View>

          {/* ══ IMAGE PICKER ══ */}
          <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.8}>
            {imageUri ? (
              <>
                <Image source={{ uri: imageUri }} style={styles.imagePreview} resizeMode="cover" />
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
          <SectionCard label="פרטי המתכון" importHighlight={importedFields.has('title') || importedFields.has('description')}>
            <FieldLabel text="כותרת *" />
            <TextInput
              style={[styles.input, importedFields.has('title') && styles.inputHighlighted]}
              placeholder="למשל: עוגת שוקולד של סבתא"
              placeholderTextColor={Colors.textSecondary}
              value={title}
              onChangeText={t => { setTitle(t); setImportedFields(p => { const n = new Set(p); n.delete('title'); return n; }); }}
              returnKeyType="next"
            />

            <FieldLabel text="תיאור" />
            <TextInput
              style={[styles.input, styles.inputMultiline, importedFields.has('description') && styles.inputHighlighted]}
              placeholder="ספר קצת על המתכון..."
              placeholderTextColor={Colors.textSecondary}
              value={description}
              onChangeText={t => { setDescription(t); setImportedFields(p => { const n = new Set(p); n.delete('description'); return n; }); }}
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
                    style={[
                      styles.chip,
                      active && { backgroundColor: color, borderColor: color },
                    ]}
                    onPress={() => setDifficulty(active ? null : value)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </SectionCard>

          {/* ══ SECTION: Categories ══ */}
          <SectionCard label="קטגוריות">
            {categoriesLoading ? (
              <ActivityIndicator color={Colors.primary} style={styles.loader} />
            ) : categoriesError ? (
              <Text style={styles.errorText}>{categoriesError}</Text>
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
                      {cat.icon ? (
                        <Text style={styles.categoryIcon}>{cat.icon}</Text>
                      ) : null}
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
          <SectionCard label="מרכיבים" importHighlight={importedFields.has('ingredients')}>
            {ingredients.map((ingredient, index) => (
              <View key={index} style={styles.listRow}>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => removeIngredient(index)}
                  activeOpacity={0.7}
                >
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
          <SectionCard label="שלבי הכנה" importHighlight={importedFields.has('steps')}>
            {steps.map((step, index) => (
              <View key={index} style={styles.listRow}>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => removeStep(index)}
                  activeOpacity={0.7}
                >
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
                <Text style={styles.saveButtonText}>שמור מתכון</Text>
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.versionLabel}>גרסה: v1.15.0</Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────

function SectionCard({
  label,
  badge,
  importHighlight,
  children,
}: {
  label: string;
  badge?: string;
  importHighlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.sectionCard, importHighlight && styles.sectionCardHighlighted]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{label}</Text>
        {importHighlight ? (
          <View style={styles.importBadge}>
            <Ionicons name="checkmark-circle" size={12} color={Colors.primary} />
            <Text style={styles.importBadgeText}>יובא — נא לבדוק</Text>
          </View>
        ) : badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
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
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
  },

  // ── Import button ──
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  importBtnDisabled: {
    opacity: 0.5,
  },
  importBtnLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },

  // ── Import highlight ──
  sectionCardHighlighted: {
    borderColor: Colors.primary,
    borderWidth: 1.5,
  },
  inputHighlighted: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  importBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  importBadgeText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600',
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

  badge: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600',
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
  inputMultiline: {
    minHeight: 80,
    paddingTop: 11,
  },
  inputNarrow: {
    width: 120,
    alignSelf: 'flex-end',
  },

  chipRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 2,
  },
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

  categoriesWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 4,
  },

  categoryIcon: {
    fontSize: 14,
  },

  // ── Dynamic list rows ──
  listRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  listInput: {
    flex: 1,
  },
  deleteButton: {
    paddingTop: 13,
    paddingHorizontal: 4,
  },
  stepInputWrap: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 6,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    paddingTop: 13,
    minWidth: 20,
    textAlign: 'right',
  },
  addRowButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    alignSelf: 'flex-end',
  },
  addRowLabel: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600',
  },

  loader: {
    marginVertical: 12,
  },
  errorText: {
    fontSize: 13,
    color: '#C0392B',
  },

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
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  versionLabel: {
    marginTop: 20,
    textAlign: 'center',
    fontSize: 11,
    color: '#C0C0C0',
  },

  // ── Image picker ──
  imagePicker: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  imageOverlayText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  imagePlaceholder: {
    flex: 1,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  imagePlaceholderText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
