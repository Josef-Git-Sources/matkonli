import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RecipeRow, DifficultyLevel } from '@/types/database';

const STORAGE_KEY = 'local_recipes_v1';

// ── Types ─────────────────────────────────────────────────────

/** A recipe saved on-device for free (non-premium) users. */
export interface LocalRecipe extends RecipeRow {
  categoryNames:    string[];
  _local:           true;
  ingredients_list: string[];  // raw ingredient name strings
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

// ── CRUD ──────────────────────────────────────────────────────

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
