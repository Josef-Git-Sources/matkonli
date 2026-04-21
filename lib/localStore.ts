import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CategoryRow, RecipeRow, DifficultyLevel } from '@/types/database';

const STORAGE_KEY      = 'local_recipes_v1';
const CATEGORIES_KEY   = 'local_categories_v1';

// ── Types ─────────────────────────────────────────────────────

/** A recipe saved on-device for free (non-premium) users. */
export interface LocalRecipe extends RecipeRow {
  categoryNames:    string[];
  categoryIds:      string[];   // IDs (may include "local_cat_" prefixed IDs)
  _local:           true;
  ingredients_list: string[];   // raw ingredient name strings
}

/** A user-created category saved on-device for free (non-premium) users. */
export interface LocalCategory extends CategoryRow {
  _local: true;
}

export interface SaveLocalRecipeParams {
  title:              string;
  description:        string;
  prepTime:           string;
  difficulty:         DifficultyLevel | null;
  selectedCategories: string[];
  ingredients:        string[];
  steps:              string[];
  imageUri?:          string;
  ocrImageUris?:      string[];
}

// ── Recipe CRUD ───────────────────────────────────────────────

export async function saveLocalRecipe(params: SaveLocalRecipeParams, userId: string): Promise<void> {
  const existing        = await getLocalRecipes();
  const id              = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now             = new Date().toISOString();
  const cleanIngredients = params.ingredients.filter(i => i.trim());
  const cleanSteps       = params.steps.filter(s => s.trim());

  const recipe: LocalRecipe = {
    id,
    user_id:          userId,
    title:            params.title.trim(),
    description:      params.description.trim() || null,
    image_url:        params.imageUri ?? null,
    ocr_images:       params.ocrImageUris?.length ? params.ocrImageUris : null,
    instructions:     cleanSteps.map((text, i) => ({ step: i + 1, text, image_url: null })),
    prep_time:        params.prepTime ? parseInt(params.prepTime, 10) : null,
    cook_time:        null,
    servings:         null,
    difficulty:       params.difficulty,
    is_public:        false,
    is_favorite:      false,
    source_url:       null,
    source_type:      'manual',
    language:         'he',
    created_at:       now,
    updated_at:       now,
    categoryNames:    [],
    categoryIds:      params.selectedCategories,
    _local:           true,
    ingredients_list: cleanIngredients,
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([recipe, ...existing]));
}

export async function getLocalRecipes(): Promise<LocalRecipe[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LocalRecipe[];
  } catch {
    return [];
  }
}

export async function getLocalRecipeById(id: string): Promise<LocalRecipe | null> {
  const recipes = await getLocalRecipes();
  return recipes.find(r => r.id === id) ?? null;
}

// ── Local Category CRUD ───────────────────────────────────────

export async function getLocalCategories(): Promise<LocalCategory[]> {
  try {
    const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LocalCategory[];
  } catch {
    return [];
  }
}

export async function saveLocalCategory(name_he: string, userId: string): Promise<LocalCategory> {
  const existing = await getLocalCategories();
  const id       = `local_cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now      = new Date().toISOString();
  const slug     = name_he.replace(/\s+/g, '-').toLowerCase().replace(/[^\w-]/g, '');

  const category: LocalCategory = {
    id,
    user_id:    userId,
    slug:       slug || id,
    name_en:    name_he,
    name_he,
    icon:       null,
    created_at: now,
    _local:     true,
  };

  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify([...existing, category]));
  return category;
}

export async function renameLocalCategory(id: string, name_he: string): Promise<void> {
  const categories = await getLocalCategories();
  const updated = categories.map(c =>
    c.id === id ? { ...c, name_he, name_en: name_he } : c
  );
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(updated));
}

export async function deleteLocalCategory(id: string): Promise<void> {
  const categories = await getLocalCategories();
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories.filter(c => c.id !== id)));
}

/** How many local recipes reference this category ID. */
export async function countLocalRecipesUsingCategory(categoryId: string): Promise<number> {
  const recipes = await getLocalRecipes();
  return recipes.filter(r => (r.categoryIds ?? []).includes(categoryId)).length;
}

/** Remove a category ID from all local recipes (cascade on delete). */
export async function removeCategoryFromLocalRecipes(categoryId: string): Promise<void> {
  const recipes = await getLocalRecipes();
  const updated = recipes.map(r => ({
    ...r,
    categoryIds: (r.categoryIds ?? []).filter(id => id !== categoryId),
  }));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

/** Update an existing local recipe in place. */
export async function updateLocalRecipe(id: string, params: {
  title:                string;
  description:          string;
  prepTime:             string;
  difficulty:           DifficultyLevel | null;
  selectedCategories:   string[];
  ingredients:          string[];
  steps:                string[];
  imageUri?:            string;
  existingImageUrl?:    string;
  ocrImageUris?:        string[];
  existingOcrImageUrls?: string[];
}): Promise<void> {
  const recipes = await getLocalRecipes();
  const idx = recipes.findIndex(r => r.id === id);
  if (idx === -1) throw new Error('Local recipe not found');

  const now              = new Date().toISOString();
  const cleanIngredients = params.ingredients.filter(i => i.trim());
  const cleanSteps       = params.steps.filter(s => s.trim());
  const newImageUrl      = params.imageUri ?? params.existingImageUrl ?? recipes[idx].image_url;
  const ocrImages        = [...(params.existingOcrImageUrls ?? []), ...(params.ocrImageUris ?? [])];

  recipes[idx] = {
    ...recipes[idx],
    title:            params.title.trim(),
    description:      params.description.trim() || null,
    image_url:        newImageUrl ?? null,
    ocr_images:       ocrImages.length > 0 ? ocrImages : null,
    instructions:     cleanSteps.map((text, i) => ({ step: i + 1, text, image_url: null })),
    prep_time:        params.prepTime ? parseInt(params.prepTime, 10) : null,
    difficulty:       params.difficulty,
    updated_at:       now,
    categoryIds:      params.selectedCategories,
    ingredients_list: cleanIngredients,
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}
