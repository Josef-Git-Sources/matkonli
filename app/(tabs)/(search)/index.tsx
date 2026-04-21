import {
  View,
  Text,
  Image,
  FlatList,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Platform,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { fetchRecipes, fetchCategories, toggleFavorite } from '@/lib/api';
import type { RecipeWithCategories } from '@/lib/api';
import type { CategoryRow, DifficultyLevel } from '@/types/database';

// ── Helpers ───────────────────────────────────────────────────

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
  if (width >= 480)  return 2;
  return 1;
}

type FillerItem = { id: string; filler: true };
type GridItem   = RecipeWithCategories | FillerItem;
function isFiller(item: GridItem): item is FillerItem { return 'filler' in item; }

// ── Screen ────────────────────────────────────────────────────

export default function SearchScreen() {
  const router          = useRouter();
  const { width }       = useWindowDimensions();
  const numColumns      = getNumColumns(width);
  const searchInputRef  = useRef<TextInput>(null);

  const [recipes, setRecipes]           = useState<RecipeWithCategories[]>([]);
  const [allCategories, setAllCategories] = useState<CategoryRow[]>([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [error, setError]               = useState<string | null>(null);

  const [searchQuery,          setSearchQuery]          = useState('');
  const [selectedCategoryId,   setSelectedCategoryId]   = useState<string | null>(null);
  const [selectedDifficulty,   setSelectedDifficulty]   = useState<DifficultyLevel | null>(null);
  const [showFavoritesOnly,    setShowFavoritesOnly]    = useState(false);

  // Reload recipes + categories every time the tab gains focus
  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      setError(null);
      Promise.all([fetchRecipes(), fetchCategories()])
        .then(([r, cats]) => { setRecipes(r); setAllCategories(cats); })
        .catch(() => setError('שגיאה בטעינת המתכונים'))
        .finally(() => {
          setIsLoading(false);
          // Small delay so the keyboard doesn't fight with the focus animation
          setTimeout(() => searchInputRef.current?.focus(), 150);
        });
    }, [])
  );

  function handleToggleFavorite(id: string, currentValue: boolean) {
    const next = !currentValue;
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: next } : r));
    toggleFavorite(id, next).catch(() =>
      setRecipes(prev => prev.map(r => r.id === id ? { ...r, is_favorite: currentValue } : r))
    );
  }

  // ── Derived filter options ──────────────────────────────────

  // All categories (system + user) for filter chips — loaded via fetchCategories()
  const availableCategories = allCategories;

  const availableDifficulties = useMemo<DifficultyLevel[]>(() => {
    const order: DifficultyLevel[] = ['easy', 'medium', 'hard'];
    const seen = new Set(recipes.map(r => r.difficulty).filter(Boolean) as DifficultyLevel[]);
    return order.filter(d => seen.has(d));
  }, [recipes]);

  // ── Filtering ───────────────────────────────────────────────

  const filteredRecipes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return recipes.filter(r => {
      if (showFavoritesOnly && !r.is_favorite) return false;
      const matchesSearch =
        !q ||
        r.title.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        r.categoryNames.some(n => n.toLowerCase().includes(q));
      const matchesCategory   = !selectedCategoryId || (r.categoryIds ?? []).includes(selectedCategoryId);
      const matchesDifficulty = !selectedDifficulty  || r.difficulty === selectedDifficulty;
      return matchesSearch && matchesCategory && matchesDifficulty;
    });
  }, [recipes, searchQuery, selectedCategoryId, selectedDifficulty, showFavoritesOnly]);

  const hasActiveFilter = !!(searchQuery || selectedCategoryId || selectedDifficulty || showFavoritesOnly);

  // Pad last row with invisible filler cells
  const remainder   = filteredRecipes.length % numColumns;
  const fillerCount = remainder > 0 ? numColumns - remainder : 0;
  const gridData: GridItem[] = [
    ...filteredRecipes,
    ...Array.from({ length: fillerCount }, (_, i) => ({ id: `filler-${i}`, filler: true as const })),
  ];

  // ── Render ──────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Ionicons name="search" size={22} color={Colors.primary} />
        <Text style={styles.headerTitle}>חיפוש מתכונים</Text>
      </View>

      {/* ── Search bar (always visible) ── */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={Colors.textSecondary} />
        <TextInput
          ref={searchInputRef}
          style={styles.searchInput}
          placeholder="חפש לפי שם, תיאור או קטגוריה..."
          placeholderTextColor={Colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          textAlign="right"
          returnKeyType="search"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Filter chips (only once data is loaded) ── */}
      {!isLoading && !error && recipes.length > 0 && (
        <View style={styles.filterContainer}>

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
                    {cat.icon ? <Text style={styles.chipIcon}>{cat.icon}</Text> : null}
                    <Text style={[styles.chipLabel, selectedCategoryId === cat.id && styles.chipLabelActive]}>
                      {cat.name_he}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

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
                      selectedDifficulty === diff && {
                        backgroundColor: DIFFICULTY_COLOR[diff],
                        borderColor:     DIFFICULTY_COLOR[diff],
                      },
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

      {/* ── Body ── */}
      {isLoading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !hasActiveFilter ? (
        <View style={styles.centerContent}>
          <Ionicons name="search-outline" size={56} color={Colors.border} />
          <Text style={styles.emptyText}>
            הקלד שם מתכון, מרכיב{'\n'}או בחר קטגוריה לחיפוש
          </Text>
        </View>
      ) : filteredRecipes.length === 0 ? (
        <View style={styles.centerContent}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.border} />
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
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) =>
            isFiller(item) ? (
              <View style={[styles.cardGrid, styles.cardFiller]} />
            ) : (
              <RecipeCard
                recipe={item}
                numColumns={numColumns}
                onPress={() => router.push(`/recipe/${item.id}`)}
                onToggleFavorite={() => handleToggleFavorite(item.id, item.is_favorite)}
              />
            )
          }
          ListFooterComponent={
            <Text style={styles.versionLabel}>
              {filteredRecipes.length} תוצאות · v1.15.0
            </Text>
          }
        />
      )}

    </SafeAreaView>
  );
}

// ── Recipe Card ───────────────────────────────────────────────

function RecipeCard({
  recipe,
  numColumns,
  onPress,
  onToggleFavorite,
}: {
  recipe: RecipeWithCategories;
  numColumns: number;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  const stepCount = recipe.instructions?.length ?? 0;

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
            <Ionicons name="image-outline" size={32} color={Colors.border} />
          </View>
        )}
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
          <Text style={styles.cardDescription} numberOfLines={2}>{recipe.description}</Text>
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

          {stepCount > 0 ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaText}>{stepCount} שלבים</Text>
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
  safeArea: { flex: 1, backgroundColor: Colors.background },

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

  // ── Search bar ──
  searchBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: 42,
    fontSize: 15,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
  },

  // ── Filter chips ──
  filterContainer: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  filterRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  filterRowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    flexShrink: 0,
  },
  chipsScroll:  { flexGrow: 0, flexShrink: 1 },
  chipsContent: { flexDirection: 'row-reverse', gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive:       { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipIcon:         { fontSize: 13, marginEnd: 2 },
  chipLabel:        { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  chipLabelActive:  { color: '#fff', fontWeight: '600' },

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
  favoritesChipActive:      { backgroundColor: '#F0C040', borderColor: '#F0C040' },
  favoritesChipLabel:       { fontSize: 13, fontWeight: '600', color: '#B8860B' },
  favoritesChipLabelActive: { color: '#5C4000' },

  // ── Body states ──
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

  // ── List ──
  listContent:   { padding: 12, paddingBottom: 32 },
  columnWrapper: { gap: 0 },

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
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6 },
      android: { elevation: 3 },
      default: {},
    }),
  },
  cardGrid:   { flex: 1 },
  cardFiller: { backgroundColor: 'transparent', borderWidth: 0, elevation: 0, shadowOpacity: 0 },

  cardImage:            { width: '100%', aspectRatio: 1 },
  cardImagePlaceholder: { width: '100%', aspectRatio: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  cardFavoriteButton:   { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 16, padding: 6 },

  cardBody:        { padding: 10 },
  cardTitle:       { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, textAlign: 'right', marginBottom: 4 },
  cardDescription: { fontSize: 12, color: Colors.textSecondary, textAlign: 'right', lineHeight: 17, marginBottom: 8 },

  metaRow:         { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  metaItem:        { flexDirection: 'row-reverse', alignItems: 'center', gap: 3 },
  metaText:        { fontSize: 11, color: Colors.textSecondary },
  difficultyBadge: { borderRadius: 5, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  difficultyText:  { fontSize: 11, fontWeight: '600' },

  versionLabel: { textAlign: 'center', fontSize: 11, color: '#C0C0C0', marginTop: 8, marginBottom: 4 },
});
