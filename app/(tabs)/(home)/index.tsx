import {
  View,
  Text,
  Image,
  ImageBackground,
  FlatList,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Share,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useMemo, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/auth';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { fetchRecipes, fetchCategories, toggleFavorite } from '@/lib/api';
import type { RecipeWithCategories } from '@/lib/api';
import type { CategoryRow, DifficultyLevel } from '@/types/database';
import { useTheme } from '@/context/ThemeContext';

// ── Difficulty helpers ─────────────────────────────────────────

const DIFFICULTY_LABEL: Record<DifficultyLevel, string> = {
  easy:   'קל',
  medium: 'בינוני',
  hard:   'קשה',
};

const DIFFICULTY_COLOR: Record<DifficultyLevel, string> = {
  easy:   '#2A7E4F',
  medium: '#E8901A',
  hard:   '#C0392B',
};

function getNumColumns(width: number): number {
  if (width >= 1024) return 4;
  if (width >= 768)  return 3;
  return 2; // Always 2 columns on mobile so ≥4 recipes are visible at once
}

// ── Types ─────────────────────────────────────────────────────

type FillerItem = { id: string; filler: true };
type GridItem   = RecipeWithCategories | FillerItem;

function isFiller(item: GridItem): item is FillerItem {
  return 'filler' in item;
}

// ── Screen ────────────────────────────────────────────────────

export default function HomeScreen() {
  const [recipes, setRecipes]               = useState<RecipeWithCategories[]>([]);
  const [allCategories, setAllCategories]   = useState<CategoryRow[]>([]);
  const [isLoading, setIsLoading]           = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [searchQuery, setSearchQuery]                 = useState('');
  const [selectedCategoryId, setSelectedCategoryId]   = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty]   = useState<DifficultyLevel | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly]     = useState(false);
  const router     = useRouter();
  const { width }  = useWindowDimensions();
  const numColumns = getNumColumns(width);
  const { backgroundImage, backgroundOpacity } = useTheme();
  // loading = true until the Supabase session is restored from AsyncStorage.
  // On mobile this is async; on web localStorage hydration is synchronous.
  const { loading: authLoading } = useAuth();

  useFocusEffect(
    useCallback(() => {
      // Block the fetch until the session is available.  Without this guard,
      // fetchRecipes() calls getSession() before AsyncStorage has been read on
      // mobile, gets no user, and immediately returns [] — leaving the list empty.
      // When authLoading flips to false the callback ref changes and useFocusEffect
      // re-runs automatically, triggering the actual fetch.
      if (authLoading) return;

      setIsLoading(true);
      setError(null);
      Promise.all([fetchRecipes(), fetchCategories()])
        .then(([r, cats]) => { setRecipes(r); setAllCategories(cats); })
        .catch(() => setError('שגיאה בטעינת המתכונים'))
        .finally(() => setIsLoading(false));
    }, [authLoading])
  );

  function handleToggleFavorite(id: string, currentValue: boolean) {
    const newValue = !currentValue;
    // Optimistic update — filteredRecipes recomputes immediately from the new recipes state
    setRecipes(prevRecipes => prevRecipes.map(r => r.id === id ? { ...r, is_favorite: newValue } : r));
    // Sync to DB; revert on failure
    toggleFavorite(id, newValue).catch(() => {
      setRecipes(prevRecipes => prevRecipes.map(r => r.id === id ? { ...r, is_favorite: currentValue } : r));
    });
  }

  // All categories (system + user) for the filter bar — loaded from fetchCategories()
  const availableCategories = allCategories;

  // Derive difficulty values that actually appear in the loaded recipes
  const availableDifficulties = useMemo<DifficultyLevel[]>(() => {
    const order: DifficultyLevel[] = ['easy', 'medium', 'hard'];
    const seen = new Set(recipes.map(r => r.difficulty).filter(Boolean) as DifficultyLevel[]);
    return order.filter(d => seen.has(d));
  }, [recipes]);

  // Apply search + category (by ID) + difficulty + favorites filter
  const filteredRecipes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return recipes.filter(r => {
      if (showFavoritesOnly && !r.is_favorite) return false;
      const matchesSearch = !q || (
        r.title.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        r.categoryNames.some(n => n.toLowerCase().includes(q))
      );
      // Filter by category ID — works for both cloud (UUID) and local ("local_cat_") categories
      const matchesCategory = !selectedCategoryId || (r.categoryIds ?? []).includes(selectedCategoryId);
      const matchesDifficulty = !selectedDifficulty || r.difficulty === selectedDifficulty;
      return matchesSearch && matchesCategory && matchesDifficulty;
    });
  }, [recipes, searchQuery, selectedCategoryId, selectedDifficulty, showFavoritesOnly]);

  // Pad with filler cells so the last grid row doesn't stretch
  const remainder   = filteredRecipes.length % numColumns;
  const fillerCount = remainder > 0 ? numColumns - remainder : 0;
  const gridData: GridItem[] = [
    ...filteredRecipes,
    ...Array.from({ length: fillerCount }, (_, i) => ({ id: `filler-${i}`, filler: true as const })),
  ];

  const showFilterBar = !isLoading && !error && recipes.length > 0;

  return (
    <ImageBackground
      source={{ uri: backgroundImage }}
      style={{ flex: 1 }}
      imageStyle={{ opacity: backgroundOpacity }}
      resizeMode="cover"
    >
    <SafeAreaView style={styles.safeArea}>

      {/* ── Page header ── */}
      <View style={styles.header}>
        <Ionicons name="restaurant" size={24} color={Colors.primary} />
        <Text style={styles.headerTitle}>המתכונים שלי</Text>
      </View>

      {/* ── Search + filter bar (only when there are recipes) ── */}
      {showFilterBar && (
        <View style={styles.filterContainer}>

          {/* Search input */}
          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="חיפוש מתכון..."
              placeholderTextColor={Colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              textAlign="right"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Category chips */}
          {availableCategories.length > 0 && (
            <View style={styles.filterRow}>
              <Text style={styles.filterRowLabel}>קטגוריה:</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsContent}
                style={styles.chipsScroll}
              >
                <TouchableOpacity
                  style={[styles.chip, !selectedCategoryId && styles.chipActive]}
                  onPress={() => setSelectedCategoryId(null)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipLabel, !selectedCategoryId && styles.chipLabelActive]}>הכל</Text>
                </TouchableOpacity>
                {availableCategories.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.chip, selectedCategoryId === cat.id && styles.chipActive]}
                    onPress={() => setSelectedCategoryId(prev => prev === cat.id ? null : cat.id)}
                    activeOpacity={0.75}
                  >
                    {cat.icon ? (
                      <Text style={styles.chipIcon}>{cat.icon}</Text>
                    ) : null}
                    <Text style={[styles.chipLabel, selectedCategoryId === cat.id && styles.chipLabelActive]}>
                      {cat.name_he}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Difficulty chips */}
          {availableDifficulties.length > 0 && (
            <View style={styles.filterRow}>
              <Text style={styles.filterRowLabel}>קושי:</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsContent}
                style={styles.chipsScroll}
              >
                <TouchableOpacity
                  style={[styles.chip, !selectedDifficulty && styles.chipActive]}
                  onPress={() => setSelectedDifficulty(null)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipLabel, !selectedDifficulty && styles.chipLabelActive]}>הכל</Text>
                </TouchableOpacity>
                {availableDifficulties.map(diff => (
                  <TouchableOpacity
                    key={diff}
                    style={[
                      styles.chip,
                      selectedDifficulty === diff && { backgroundColor: DIFFICULTY_COLOR[diff], borderColor: DIFFICULTY_COLOR[diff] },
                    ]}
                    onPress={() => setSelectedDifficulty(prev => prev === diff ? null : diff)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipLabel, selectedDifficulty === diff && styles.chipLabelActive]}>
                      {DIFFICULTY_LABEL[diff]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Favorites toggle */}
          <TouchableOpacity
            style={[styles.favoritesChip, showFavoritesOnly && styles.favoritesChipActive]}
            onPress={() => setShowFavoritesOnly(prev => !prev)}
            activeOpacity={0.75}
          >
            <Text style={[styles.favoritesChipLabel, showFavoritesOnly && styles.favoritesChipLabelActive]}>
              ⭐ מועדפים בלבד
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.mainContent}>
        {isLoading ? (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.centerContent}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : recipes.length === 0 ? (
          <View style={styles.centerContent}>
            <Ionicons name="book-outline" size={56} color={Colors.border} />
            <Text style={styles.emptyText}>
              עדיין אין מתכונים.{'\n'}לחץ על ה-➕ כדי להוסיף את המתכון הראשון שלך!
            </Text>
            <Text style={styles.versionLabel}>גרסה: v1.19.3</Text>
          </View>
        ) : filteredRecipes.length === 0 ? (
          <View style={styles.centerContent}>
            <Ionicons name="search-outline" size={48} color={Colors.border} />
            <Text style={styles.emptyText}>לא נמצאו מתכונים תואמים.</Text>
          </View>
        ) : (
          <FlatList
            key={numColumns}
            data={gridData}
            keyExtractor={item => item.id}
            numColumns={numColumns}
            contentContainerStyle={styles.listContent}
            columnWrapperStyle={numColumns > 1 ? styles.columnWrapper : undefined}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) =>
              isFiller(item) ? (
                <View style={[styles.cardGrid, styles.cardFiller]} />
              ) : (
                <RecipeCard
                  recipe={item}
                  onPress={() => router.push(`/recipe/${item.id}`)}
                  numColumns={numColumns}
                  onToggleFavorite={() => handleToggleFavorite(item.id, item.is_favorite)}
                />
              )
            }
            ListFooterComponent={
              <Text style={styles.versionLabel}>גרסה: v1.19.3</Text>
            }
          />
        )}
      </View>

    </SafeAreaView>
    </ImageBackground>
  );
}

// ── Share helper ─────────────────────────────────────────────

async function handleShare(recipe: RecipeWithCategories) {
  const lines: string[] = [];

  lines.push(`🍳 *${recipe.title}* 🍳`);

  if (recipe.description) {
    lines.push('', recipe.description);
  }

  if (recipe.instructions?.length > 0) {
    lines.push('', '👨‍🍳 *שלבי הכנה:*');
    for (const step of recipe.instructions) {
      lines.push(`${step.step}. ${step.text}`);
    }
  }

  lines.push('', 'בתאבון! 😊');

  await Share.share({ message: lines.join('\n') });
}

// ── Recipe Card ───────────────────────────────────────────────

function RecipeCard({
  recipe,
  onPress,
  numColumns,
  onToggleFavorite,
}: {
  recipe: RecipeWithCategories;
  onPress: () => void;
  numColumns: number;
  onToggleFavorite: () => void;
}) {
  const stepCount      = recipe.instructions?.length ?? 0;
  const ingredientHint = stepCount > 0 ? `${stepCount} שלבים` : null;

  return (
    <TouchableOpacity
      style={[styles.card, numColumns > 1 && styles.cardGrid]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View>
        {recipe.image_url ? (
          <Image source={{ uri: recipe.image_url }} style={styles.cardImage} resizeMode="cover" />
        ) : (
          <View style={styles.cardImagePlaceholder}>
            <Ionicons name="restaurant-outline" size={32} color={Colors.border} />
          </View>
        )}
        {/* Share — top-left */}
        <TouchableOpacity
          style={styles.cardShareButton}
          onPress={() => handleShare(recipe)}
          activeOpacity={0.8}
          hitSlop={6}
        >
          <Ionicons name="share-social-outline" size={15} color="#fff" />
        </TouchableOpacity>
        {/* Favorite — top-right */}
        <TouchableOpacity
          style={styles.cardFavoriteButton}
          onPress={onToggleFavorite}
          activeOpacity={0.8}
          hitSlop={6}
        >
          <Ionicons
            name={recipe.is_favorite ? 'heart' : 'heart-outline'}
            size={15}
            color={recipe.is_favorite ? '#E74C3C' : '#fff'}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{recipe.title}</Text>

        {recipe.description ? (
          <Text style={styles.cardDescription} numberOfLines={numColumns > 1 ? 1 : 2}>
            {recipe.description}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {recipe.difficulty ? (
            <View style={[
              styles.difficultyBadge,
              {
                backgroundColor: DIFFICULTY_COLOR[recipe.difficulty] + '1A',
                borderColor:     DIFFICULTY_COLOR[recipe.difficulty] + '55',
              },
            ]}>
              <Text style={[styles.difficultyText, { color: DIFFICULTY_COLOR[recipe.difficulty] }]}>
                {DIFFICULTY_LABEL[recipe.difficulty]}
              </Text>
            </View>
          ) : null}

          {recipe.prep_time ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaText}>{recipe.prep_time} דקות</Text>
              <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
            </View>
          ) : null}

          {ingredientHint ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaText}>{ingredientHint}</Text>
              <Ionicons name="list-outline" size={14} color={Colors.textSecondary} />
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
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

  // ── Filter bar ──
  filterContainer: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  searchRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    height: '100%',
  },

  filterRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  filterRowLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    flexShrink: 0,
  },
  chipsScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  chipsContent: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    minHeight: 36,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipIcon: {
    fontSize: 14,
    marginEnd: 4,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  chipLabelActive: {
    color: '#fff',
    fontWeight: '700',
  },

  mainContent: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  errorText: {
    fontSize: 15,
    color: '#C0392B',
    textAlign: 'center',
  },

  listContent: {
    padding: 12,
    paddingBottom: 32,
  },
  columnWrapper: {
    gap: 0,
  },

  // ── Card ──
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 12,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  cardGrid:   { flex: 1 },
  cardFiller: { backgroundColor: 'transparent', borderWidth: 0, elevation: 0, shadowOpacity: 0 },

  cardImage: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  cardShareButton: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 16,
    padding: 6,
  },
  cardFavoriteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 16,
    padding: 6,
  },
  cardImagePlaceholder: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody:        { padding: 10 },
  cardTitle:       { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, textAlign: 'right', marginBottom: 4 },
  cardDescription: { fontSize: 12, color: Colors.textSecondary, textAlign: 'right', lineHeight: 17, marginBottom: 8 },

  metaRow:  { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  metaItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11, color: Colors.textSecondary },

  difficultyBadge: { borderRadius: 5, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  difficultyText:  { fontSize: 11, fontWeight: '600' },

  // ── Favorites chip ──
  favoritesChip: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#F0C040',
    backgroundColor: Colors.background,
    marginBottom: 2,
  },
  favoritesChipActive: {
    backgroundColor: '#F0C040',
    borderColor: '#F0C040',
  },
  favoritesChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B8860B',
  },
  favoritesChipLabelActive: {
    color: '#5C4000',
  },

  versionLabel: {
    textAlign: 'center',
    fontSize: 11,
    color: '#C0C0C0',
    marginTop: 8,
    marginBottom: 4,
  },
});
