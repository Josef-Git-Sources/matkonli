// ============================================================
// MATKONLI — Supabase Database Types
// Keep in sync with the SQL schema in Supabase.
// ============================================================

// ── Enums ────────────────────────────────────────────────────

export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type RecipeSource    = 'manual' | 'ocr' | 'speech' | 'url';

// ── JSONB shapes ─────────────────────────────────────────────

export interface RecipeStep {
  step:      number;
  text:      string;
  image_url: string | null;
}

// ── Row types (what SELECT returns) ──────────────────────────

export interface ProfileRow {
  id:         string;
  username:   string | null;
  full_name:  string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id:         string;
  /** null = system default; uuid = user-created custom tag */
  user_id:    string | null;
  slug:       string;
  name_en:    string;
  name_he:    string;
  icon:       string | null;
  created_at: string;
}

export interface RecipeRow {
  id:           string;
  user_id:      string;
  title:        string;
  description:  string | null;
  image_url:    string | null;
  instructions: RecipeStep[];
  prep_time:    number | null;
  cook_time:    number | null;
  servings:     number | null;
  difficulty:   DifficultyLevel | null;
  is_public:    boolean;
  source_url:   string | null;
  source_type:  RecipeSource;
  language:     string;
  created_at:   string;
  updated_at:   string;
}

export interface IngredientRow {
  id:          string;
  recipe_id:   string;
  name:        string;
  amount:      number | null;
  unit:        string | null;
  notes:       string | null;
  order_index: number;
  created_at:  string;
}

export interface RecipeCategoryRow {
  recipe_id:   string;
  category_id: string;
}

export interface UserFavoriteRow {
  user_id:    string;
  recipe_id:  string;
  created_at: string;
}

// ── Insert types (omit DB-generated fields) ───────────────────

export type ProfileInsert = Omit<ProfileRow, 'created_at' | 'updated_at'>;

export type CategoryInsert = Omit<CategoryRow, 'id' | 'created_at'>;

export type RecipeInsert = Omit<RecipeRow, 'id' | 'created_at' | 'updated_at'>;

export type IngredientInsert = Omit<IngredientRow, 'id' | 'created_at'>;

export type RecipeCategoryInsert = RecipeCategoryRow;

export type UserFavoriteInsert = Omit<UserFavoriteRow, 'created_at'>;

// ── Update types (all fields optional except id) ─────────────

export type ProfileUpdate    = Partial<Omit<ProfileRow,    'id' | 'created_at'>>;
export type CategoryUpdate   = Partial<Omit<CategoryRow,   'id' | 'created_at' | 'user_id'>>;
export type RecipeUpdate     = Partial<Omit<RecipeRow,     'id' | 'created_at' | 'user_id'>>;
export type IngredientUpdate = Partial<Omit<IngredientRow, 'id' | 'created_at' | 'recipe_id'>>;

// ── Supabase Database definition (for typed client) ───────────

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row:    ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
      };
      categories: {
        Row:    CategoryRow;
        Insert: CategoryInsert;
        Update: CategoryUpdate;
      };
      recipes: {
        Row:    RecipeRow;
        Insert: RecipeInsert;
        Update: RecipeUpdate;
      };
      ingredients: {
        Row:    IngredientRow;
        Insert: IngredientInsert;
        Update: IngredientUpdate;
      };
      recipe_categories: {
        Row:    RecipeCategoryRow;
        Insert: RecipeCategoryInsert;
        Update: Partial<RecipeCategoryRow>;
      };
      user_favorites: {
        Row:    UserFavoriteRow;
        Insert: UserFavoriteInsert;
        Update: never;
      };
    };
    Enums: {
      difficulty_level: DifficultyLevel;
      recipe_source:    RecipeSource;
    };
  };
};

// ── Convenience joined types (for common queries) ────────────

/** Recipe with its ingredients and categories pre-joined */
export interface RecipeWithDetails extends RecipeRow {
  ingredients: IngredientRow[];
  categories:  CategoryRow[];
}

/** Recipe with the author's profile pre-joined */
export interface RecipeWithAuthor extends RecipeRow {
  profiles: Pick<ProfileRow, 'id' | 'username' | 'avatar_url'>;
}
