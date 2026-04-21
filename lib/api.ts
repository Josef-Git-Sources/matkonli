import { supabase } from '@/lib/supabase';
import type { CategoryRow, DifficultyLevel, RecipeRow, IngredientRow } from '@/types/database';
import { getUserProfile } from './userProfile';
import {
  saveLocalRecipe, getLocalRecipes, getLocalRecipeById,
  getLocalCategories, saveLocalCategory, renameLocalCategory,
  deleteLocalCategory, countLocalRecipesUsingCategory, removeCategoryFromLocalRecipes,
  updateLocalRecipe,
} from './localStore';

// ── Recipes (read) ────────────────────────────────────────────

export interface RecipeWithCategories extends RecipeRow {
  /** Hebrew category names for this recipe, used for text search. */
  categoryNames: string[];
  /** Category IDs for this recipe — used for reliable category filtering
   *  (works for both cloud UUIDs and "local_cat_" IDs). */
  categoryIds:   string[];
}

/**
 * Returns all recipes for the signed-in user (newest first), with each
 * recipe's category names pre-fetched for client-side search filtering.
 */
export async function fetchRecipes(): Promise<RecipeWithCategories[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const profile = await getUserProfile();

  // Fetch from Supabase — use !left so recipes always appear even if a category was deleted
  const { data, error } = await supabase
    .from('recipes')
    .select('*, recipe_categories(category_id, categories!left(name_he))')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const cloudRecipes: RecipeWithCategories[] = (data ?? []).map((r: any) => ({
    ...r,
    categoryNames: (r.recipe_categories ?? [])
      .map((rc: any) => rc.categories?.name_he as string | undefined)
      .filter((n): n is string => Boolean(n)),
    categoryIds: (r.recipe_categories ?? [])
      .map((rc: any) => rc.category_id as string | undefined)
      .filter((n): n is string => Boolean(n)),
  }));

  // Premium users: cloud only
  if (profile.is_premium) return cloudRecipes;

  // Free users: merge cloud recipes with any locally-saved recipes,
  // sorted newest-first. Local recipes have IDs starting with "local_".
  const localRecipes = await getLocalRecipes();

  // Resolve category names for local recipes that have cloud (UUID) category IDs
  // so that text-search by category name works correctly.
  const allLocalCatIds = new Set((await getLocalCategories()).map(c => c.id));
  const cloudCatIdsNeeded = new Set<string>();
  for (const r of localRecipes) {
    for (const cid of r.categoryIds ?? []) {
      if (cid && !allLocalCatIds.has(cid) && !cid.startsWith('local_')) {
        cloudCatIdsNeeded.add(cid);
      }
    }
  }
  const cloudCatNameMap = new Map<string, string>();
  if (cloudCatIdsNeeded.size > 0) {
    const { data: catRows } = await supabase
      .from('categories')
      .select('id, name_he')
      .in('id', [...cloudCatIdsNeeded]);
    for (const row of catRows ?? []) {
      cloudCatNameMap.set(row.id, row.name_he);
    }
  }

  const localAsCloud: RecipeWithCategories[] = localRecipes.map(r => {
    const ids = r.categoryIds ?? [];
    const names = ids
      .map(cid => cloudCatNameMap.get(cid) ?? '')
      .filter(Boolean);
    return { ...r, categoryIds: ids, categoryNames: names };
  });

  const merged = [...localAsCloud, ...cloudRecipes].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return merged;
}

export interface RecipeDetail extends RecipeRow {
  ingredients: IngredientRow[];
  categories:  CategoryRow[];
}

/**
 * Fetches a single recipe with its ingredients and categories.
 */
export async function fetchRecipeById(id: string): Promise<RecipeDetail> {
  // Local recipe (saved on-device for free users)
  if (id.startsWith('local_')) {
    const local = await getLocalRecipeById(id);
    if (!local) throw new Error('Local recipe not found');

    // Build a name map from AsyncStorage for local_cat_ IDs.
    const allLocalCats = await getLocalCategories();
    const localCatMap = new Map(allLocalCats.map(c => [c.id, c]));

    // Collect any UUID category IDs that live in Supabase, not AsyncStorage.
    const catIds = (local.categoryIds ?? []).filter(Boolean);
    const cloudIds = catIds.filter(cid => !cid.startsWith('local_') && !localCatMap.has(cid));
    const cloudCatMap = new Map<string, CategoryRow>();
    if (cloudIds.length > 0) {
      const { data: cloudCats } = await supabase
        .from('categories')
        .select('*')
        .in('id', cloudIds);
      for (const row of cloudCats ?? []) cloudCatMap.set(row.id, row as CategoryRow);
    }

    const categories: CategoryRow[] = catIds.map(catId => {
      const localCat = localCatMap.get(catId);
      if (localCat) return localCat as unknown as CategoryRow;
      const cloudCat = cloudCatMap.get(catId);
      if (cloudCat) return cloudCat;
      return { id: catId, name_he: '', name_en: '', slug: catId, user_id: null, icon: null, created_at: '' };
    });
    return {
      ...local,
      ingredients: local.ingredients_list.map((name, i) => ({
        id:          `local_ing_${i}`,
        recipe_id:   id,
        name,
        amount:      null,
        unit:        null,
        notes:       null,
        order_index: i,
        created_at:  local.created_at,
      })),
      categories,
    };
  }

  const [recipeRes, ingredientsRes, categoryLinksRes] = await Promise.all([
    supabase.from('recipes').select('*').eq('id', id).single(),
    supabase.from('ingredients').select('*').eq('recipe_id', id).order('order_index'),
    supabase
      .from('recipe_categories')
      .select('category_id, categories!left(*)')
      .eq('recipe_id', id),
  ]);

  if (recipeRes.error)      throw recipeRes.error;
  if (ingredientsRes.error) throw ingredientsRes.error;
  if (categoryLinksRes.error) throw categoryLinksRes.error;

  // Use LEFT JOIN data: if a category was deleted the row.categories will be null.
  // Return a minimal stub in that case so the edit screen preserves the ID.
  const categories = (categoryLinksRes.data ?? []).map((row: any): CategoryRow => {
    if (row.categories) return row.categories as CategoryRow;
    return {
      id:         row.category_id,
      name_he:    '',
      name_en:    '',
      slug:       row.category_id,
      user_id:    null,
      icon:       null,
      created_at: '',
    };
  }).filter(c => Boolean(c.id));

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
 *   - The signed-in user's own custom Supabase categories
 *   - Any legacy categories still in AsyncStorage (shown until migrated on next save)
 *
 * Results are sorted: system categories first, then custom,
 * both groups sorted alphabetically by Hebrew name.
 */
export async function fetchCategories(): Promise<CategoryRow[]> {
  // Fetch from Supabase.  For anonymous / offline users this may return an
  // empty array (RLS blocks unauthenticated reads) or throw on network error;
  // both cases fall through to returning local categories only.
  let cloudCategories: CategoryRow[] = [];
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('user_id', { ascending: true, nullsFirst: true })
      .order('name_he',  { ascending: true });

    if (!error) cloudCategories = (data ?? []) as CategoryRow[];
  } catch {
    // Network error or no session — proceed with local categories only
  }

  // Also surface any legacy local_cat_ categories still in AsyncStorage so the
  // user can see and select them; they will be migrated to Supabase on next save.
  const localCats = await getLocalCategories();
  if (localCats.length === 0) return cloudCategories;

  // Exclude any local category whose name_he already has a matching cloud entry
  // (avoids duplicates after a partial migration).
  const cloudNames = new Set(cloudCategories.map(c => c.name_he));
  const unseenLocal = localCats.filter(c => !cloudNames.has(c.name_he));
  return [...cloudCategories, ...(unseenLocal as unknown as CategoryRow[])];
}

/**
 * Migrates a single legacy "local_cat_" category to Supabase and returns its
 * new UUID.  Called automatically during saveRecipe / updateRecipe when a
 * local_cat_ ID is found in selectedCategories.
 *
 * Returns null if the local category cannot be found or the insert fails.
 */
async function migrateLocalCategoryToCloud(localCatId: string, userId: string): Promise<string | null> {
  const localCats = await getLocalCategories();
  const cat = localCats.find(c => c.id === localCatId);
  if (!cat) {
    console.warn('[migrateLocalCategory] ID not found in AsyncStorage:', localCatId);
    return null;
  }

  const slug = cat.name_he
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/[^\w-]/g, '')
    || `cat-${Date.now()}`;

  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: userId, slug, name_he: cat.name_he, name_en: cat.name_en ?? cat.name_he, icon: cat.icon ?? null })
    .select()
    .single();

  if (error) {
    console.error('[migrateLocalCategory] Supabase insert failed:', error, '| local id:', localCatId);
    return null;
  }

  console.log('[migrateLocalCategory] Migrated', localCatId, '→', data.id);
  return data.id;
}

/**
 * Resolves a selectedCategories array for use with a cloud (Supabase) recipe:
 *   - UUIDs pass through unchanged
 *   - local_cat_ IDs are migrated to Supabase on the fly
 *   - null/undefined entries are dropped
 */
async function resolveCloudCategoryIds(selectedCategories: string[], userId: string): Promise<string[]> {
  const resolved: string[] = [];
  for (const cid of selectedCategories) {
    if (!cid) continue;
    if (cid.startsWith('local_cat_')) {
      const cloudId = await migrateLocalCategoryToCloud(cid, userId);
      if (cloudId) {
        resolved.push(cloudId);
      } else {
        console.warn('[resolveCloudCategoryIds] Could not migrate local category, skipping:', cid);
      }
    } else {
      resolved.push(cid);
    }
  }
  return resolved;
}

/**
 * Creates a new custom category for the signed-in user.
 * Storage is based on AUTH status, not premium tier:
 *   - Authenticated users → Supabase (generates a real UUID usable in recipe_categories)
 *   - Anonymous / offline fallback → AsyncStorage with local_cat_ prefix
 */
export async function createCategory(params: {
  name_he: string;
  name_en?: string;
  icon?:   string;
}): Promise<CategoryRow> {
  const { data: { user } } = await supabase.auth.getUser();

  // Authenticated: always save to Supabase so the category gets a UUID that can
  // be stored in the recipe_categories junction table for any cloud recipe.
  if (user) {
    const slug = params.name_he
      .replace(/\s+/g, '-')
      .toLowerCase()
      .replace(/[^\w-]/g, '')
      || `cat-${Date.now()}`;

    const { data, error } = await supabase
      .from('categories')
      .insert({
        user_id: user.id,
        slug,
        name_he: params.name_he,
        name_en: params.name_en ?? params.name_he,
        icon:    params.icon ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Anonymous / offline fallback only
  const localCat = await saveLocalCategory(params.name_he, 'anonymous');
  return localCat as unknown as CategoryRow;
}

/**
 * Renames a custom category owned by the signed-in user.
 * Handles both local ("local_cat_" prefix) and cloud categories.
 */
export async function renameCategory(id: string, name_he: string): Promise<void> {
  if (id.startsWith('local_')) {
    await renameLocalCategory(id, name_he);
    return;
  }

  const { error } = await supabase
    .from('categories')
    .update({ name_he })
    .eq('id', id);

  if (error) throw error;
}

/**
 * Returns the total number of recipes (local + cloud) that use the given category.
 * Used by the smart-delete flow to warn users before deletion.
 */
export async function countRecipesUsingCategory(categoryId: string): Promise<number> {
  let total = 0;

  // Count local recipes
  total += await countLocalRecipesUsingCategory(categoryId);

  // Count cloud recipes (only meaningful for non-local category IDs)
  if (!categoryId.startsWith('local_')) {
    const { count, error } = await supabase
      .from('recipe_categories')
      .select('recipe_id', { count: 'exact', head: true })
      .eq('category_id', categoryId);

    if (!error && count) total += count;
  }

  return total;
}

/**
 * Deletes a custom category owned by the signed-in user and cascades
 * the deletion to recipe_categories (cloud) or local recipe categoryIds.
 * Recipes themselves are NOT deleted — only the label is removed.
 * RLS prevents deleting system categories or others' tags for cloud categories.
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  if (categoryId.startsWith('local_')) {
    await removeCategoryFromLocalRecipes(categoryId);
    await deleteLocalCategory(categoryId);
    return;
  }

  // Remove category links first (cascade), then delete the category
  await supabase.from('recipe_categories').delete().eq('category_id', categoryId);

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
  // Delegate to local storage for free-tier users' on-device recipes
  if (id.startsWith('local_')) {
    await updateLocalRecipe(id, params);
    return;
  }
  console.log('[updateRecipe] selectedCategories received:', params.selectedCategories, '→ recipe', id);

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
  // Migrate any legacy local_cat_ IDs to Supabase before inserting links.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const cloudCategoryIds = await resolveCloudCategoryIds(params.selectedCategories, user.id);

  console.log('[updateRecipe] Replacing category links with:', cloudCategoryIds, '→ recipe', id);

  const { error: deleteError } = await supabase.from('recipe_categories').delete().eq('recipe_id', id);
  if (deleteError) {
    console.error('DELETE OLD CATEGORIES ERROR:', deleteError, '| recipe', id);
    throw deleteError;
  }

  if (cloudCategoryIds.length > 0) {
    const { error: catError } = await supabase.from('recipe_categories').insert(
      cloudCategoryIds.map(category_id => ({ recipe_id: id, category_id }))
    );
    if (catError) {
      console.error('SUPABASE CATEGORY LINK ERROR:', catError, '| IDs:', cloudCategoryIds, '| recipe', id);
      throw catError;
    }
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

  const profile = await getUserProfile();

  // Free users: save to local device storage only
  if (!profile.is_premium) {
    await saveLocalRecipe(params, user.id);
    return;
  }

  // Premium users: save to Supabase
  console.log('[saveRecipe] selectedCategories received:', params.selectedCategories);
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

  // Helper: rolls back the committed recipe row so callers can safely retry.
  async function rollback(cause: unknown): Promise<never> {
    console.error('[saveRecipe] Rolling back recipe', recipeId, '— cause:', cause);
    await supabase.from('recipes').delete().eq('id', recipeId);
    throw cause;
  }

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
    if (ingError) {
      console.error('[saveRecipe] Ingredient insert failed:', ingError);
      await rollback(ingError);
    }
  }

  // 5. Link categories (skip if none selected)
  // Migrate any legacy local_cat_ IDs to Supabase before inserting links.
  const cloudCategoryIds = await resolveCloudCategoryIds(params.selectedCategories, user.id);

  if (cloudCategoryIds.length > 0) {
    console.log('[saveRecipe] Inserting category links:', cloudCategoryIds, '→ recipe', recipeId);
    const { error: catError } = await supabase
      .from('recipe_categories')
      .insert(
        cloudCategoryIds.map(category_id => ({ recipe_id: recipeId, category_id }))
      );
    if (catError) {
      console.error('SUPABASE CATEGORY LINK ERROR:', catError, '| IDs:', cloudCategoryIds, '| recipe', recipeId);
      await rollback(catError);
    }
  }
}
