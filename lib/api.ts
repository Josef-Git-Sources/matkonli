import { supabase } from '@/lib/supabase';
import type { CategoryRow, DifficultyLevel, RecipeRow, IngredientRow } from '@/types/database';

// ── Recipes (read) ────────────────────────────────────────────

export interface RecipeWithCategories extends RecipeRow {
  /** Hebrew category names for this recipe, used for text search on the home screen. */
  categoryNames: string[];
}

/**
 * Returns all recipes for the signed-in user (newest first), with each
 * recipe's category names pre-fetched for client-side search filtering.
 */
export async function fetchRecipes(): Promise<RecipeWithCategories[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('*, recipe_categories(categories(name_he))')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    ...r,
    categoryNames: (r.recipe_categories ?? [])
      .map((rc: any) => rc.categories?.name_he as string | undefined)
      .filter((n): n is string => Boolean(n)),
  }));
}

export interface RecipeDetail extends RecipeRow {
  ingredients: IngredientRow[];
  categories:  CategoryRow[];
}

/**
 * Fetches a single recipe with its ingredients and categories.
 */
export async function fetchRecipeById(id: string): Promise<RecipeDetail> {
  const [recipeRes, ingredientsRes, categoryLinksRes] = await Promise.all([
    supabase.from('recipes').select('*').eq('id', id).single(),
    supabase.from('ingredients').select('*').eq('recipe_id', id).order('order_index'),
    supabase
      .from('recipe_categories')
      .select('category_id, categories(*)')
      .eq('recipe_id', id),
  ]);

  if (recipeRes.error)      throw recipeRes.error;
  if (ingredientsRes.error) throw ingredientsRes.error;
  if (categoryLinksRes.error) throw categoryLinksRes.error;

  const categories = (categoryLinksRes.data ?? [])
    .map((row: any) => row.categories)
    .filter(Boolean) as CategoryRow[];

  return {
    ...recipeRes.data,
    ingredients: ingredientsRes.data ?? [],
    categories,
  };
}

// ── Categories ───────────────────────────────────────────────

/**
 * Returns all categories available to the current user:
 *   - System defaults (user_id IS NULL) — visible to everyone
 *   - The signed-in user's own custom tags
 *
 * Results are sorted: system categories first, then custom,
 * both groups sorted alphabetically by Hebrew name.
 */
export async function fetchCategories(): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('user_id', { ascending: true, nullsFirst: true })
    .order('name_he',  { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Creates a new custom category for the signed-in user.
 * Throws if the user is not authenticated.
 */
export async function createCategory(params: {
  slug:    string;
  name_he: string;
  name_en: string;
  icon?:   string;
}): Promise<CategoryRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in to create a category.');

  const { data, error } = await supabase
    .from('categories')
    .insert({
      user_id: user.id,
      slug:    params.slug,
      name_he: params.name_he,
      name_en: params.name_en,
      icon:    params.icon ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deletes a custom category owned by the signed-in user.
 * RLS prevents deleting system categories or others' tags.
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId);

  if (error) throw error;
}

// ── Storage ───────────────────────────────────────────────────

/**
 * Uploads an image file to the recipe-images bucket and returns its public URL.
 * `uri` is a local file URI from expo-image-picker.
 */
export async function uploadRecipeImage(uri: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  const uid        = user?.id ?? 'anon';
  const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
  const filePath   = `${uid}/${uniqueName}`;

  const response  = await fetch(uri);
  const blob      = await response.blob();

  const { error } = await supabase.storage
    .from('recipe-images')
    .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false });

  if (error) throw error;

  const { data } = supabase.storage.from('recipe-images').getPublicUrl(filePath);
  return data.publicUrl;
}

// ── Recipes (write) ──────────────────────────────────────────

export async function deleteRecipe(id: string): Promise<void> {
  const { error } = await supabase.from('recipes').delete().eq('id', id);
  if (error) throw error;
}

export async function toggleFavorite(id: string, isFavorite: boolean): Promise<void> {
  const { error } = await supabase
    .from('recipes')
    .update({ is_favorite: isFavorite })
    .eq('id', id);
  if (error) throw error;
}

export interface UpdateRecipeParams {
  title:                  string;
  description:            string;
  prepTime:               string;
  difficulty:             DifficultyLevel | null;
  selectedCategories:     string[];
  ingredients:            string[];
  steps:                  string[];
  imageUri?:              string;   // new local file URI — upload if present
  existingImageUrl?:      string;   // keep existing remote URL if no new image
  /** New local OCR image URIs to upload and append (v1.17.0). */
  ocrImageUris?:          string[];
  /** Already-stored OCR image URLs to keep (v1.17.0). */
  existingOcrImageUrls?:  string[];
}

export async function updateRecipe(id: string, params: UpdateRecipeParams): Promise<void> {
  const cleanIngredients = params.ingredients.filter(i => i.trim());
  const cleanSteps       = params.steps.filter(s => s.trim());

  // 1. Upload new cover image if the user picked one
  let imageUrl: string | null = params.existingImageUrl ?? null;
  if (params.imageUri) {
    imageUrl = await uploadRecipeImage(params.imageUri);
  }

  // 2. Upload new OCR images and merge with existing ones (v1.17.0)
  let ocrImageUrls: string[] = params.existingOcrImageUrls ?? [];
  if (params.ocrImageUris && params.ocrImageUris.length > 0) {
    const newUrls = await Promise.all(params.ocrImageUris.map(uri => uploadRecipeImage(uri)));
    ocrImageUrls = [...ocrImageUrls, ...newUrls];
  }

  // 3. Update recipe row
  const { error: recipeError } = await supabase
    .from('recipes')
    .update({
      title:        params.title.trim(),
      description:  params.description.trim() || null,
      prep_time:    params.prepTime ? parseInt(params.prepTime, 10) : null,
      difficulty:   params.difficulty,
      instructions: cleanSteps.map((text, i) => ({ step: i + 1, text, image_url: null })),
      image_url:    imageUrl,
      // NOTE: requires DB migration: ALTER TABLE recipes ADD COLUMN ocr_images jsonb;
      ...(ocrImageUrls.length > 0 ? { ocr_images: ocrImageUrls } : {}),
    })
    .eq('id', id);

  if (recipeError) throw recipeError;

  // 3. Replace ingredients (delete all, re-insert)
  const { error: delIngError } = await supabase.from('ingredients').delete().eq('recipe_id', id);
  if (delIngError) throw delIngError;

  if (cleanIngredients.length > 0) {
    const { error: ingError } = await supabase.from('ingredients').insert(
      cleanIngredients.map((name, i) => ({
        recipe_id: id, name, amount: null, unit: null, notes: null, order_index: i,
      }))
    );
    if (ingError) throw ingError;
  }

  // 4. Replace category links (delete all, re-insert)
  const { error: delCatError } = await supabase.from('recipe_categories').delete().eq('recipe_id', id);
  if (delCatError) throw delCatError;

  if (params.selectedCategories.length > 0) {
    const { error: catError } = await supabase.from('recipe_categories').insert(
      params.selectedCategories.map(category_id => ({ recipe_id: id, category_id }))
    );
    if (catError) throw catError;
  }
}

export interface SaveRecipeParams {
  title:              string;
  description:        string;
  prepTime:           string;
  difficulty:         DifficultyLevel | null;
  selectedCategories: string[];
  ingredients:        string[];
  steps:              string[];
  imageUri?:          string;
  /** Local file URIs of OCR source images; will be uploaded to Storage on save (v1.17.0). */
  ocrImageUris?:      string[];
}

/**
 * Inserts a full recipe (with ingredients and category links) for the
 * signed-in user. Steps are stored as JSONB in recipes.instructions.
 * Throws on any error so the caller can surface it to the user.
 */
export async function saveRecipe(params: SaveRecipeParams): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('יש להתחבר כדי לשמור מתכון.');

  const cleanIngredients = params.ingredients.filter(i => i.trim());
  const cleanSteps       = params.steps.filter(s => s.trim());

  // 1. Upload recipe cover image if provided
  let imageUrl: string | null = null;
  if (params.imageUri) {
    imageUrl = await uploadRecipeImage(params.imageUri);
  }

  // 2. Upload OCR source images if provided (v1.17.0)
  let ocrImageUrls: string[] = [];
  if (params.ocrImageUris && params.ocrImageUris.length > 0) {
    ocrImageUrls = await Promise.all(params.ocrImageUris.map(uri => uploadRecipeImage(uri)));
  }

  // 3. Insert recipe row
  const { data: recipe, error: recipeError } = await supabase
    .from('recipes')
    .insert({
      user_id:      user.id,
      title:        params.title.trim(),
      description:  params.description.trim() || null,
      prep_time:    params.prepTime ? parseInt(params.prepTime, 10) : null,
      difficulty:   params.difficulty,
      instructions: cleanSteps.map((text, i) => ({ step: i + 1, text, image_url: null })),
      image_url:    imageUrl,
      // NOTE: requires DB migration before this column is active:
      // ALTER TABLE recipes ADD COLUMN ocr_images jsonb;
      ...(ocrImageUrls.length > 0 ? { ocr_images: ocrImageUrls } : {}),
      is_public:    false,
      source_type:  'manual',
      language:     'he',
    })
    .select('id')
    .single();

  if (recipeError) throw recipeError;

  const recipeId = recipe.id;

  // 4. Insert ingredients (skip if none)
  if (cleanIngredients.length > 0) {
    const { error: ingError } = await supabase
      .from('ingredients')
      .insert(
        cleanIngredients.map((name, i) => ({
          recipe_id:   recipeId,
          name,
          amount:      null,
          unit:        null,
          notes:       null,
          order_index: i,
        }))
      );
    if (ingError) throw ingError;
  }

  // 5. Link categories (skip if none selected)
  if (params.selectedCategories.length > 0) {
    const { error: catError } = await supabase
      .from('recipe_categories')
      .insert(
        params.selectedCategories.map(category_id => ({ recipe_id: recipeId, category_id }))
      );
    if (catError) throw catError;
  }
}
