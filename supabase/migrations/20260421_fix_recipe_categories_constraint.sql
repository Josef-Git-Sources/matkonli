-- ============================================================
-- Migration: fix recipe_categories junction table
--
-- Root cause of the "same custom category fails on 2nd recipe" bug:
-- An accidental UNIQUE constraint on the category_id column alone
-- prevents the same category from being linked to more than one recipe.
-- The correct key is the COMPOSITE (recipe_id, category_id).
--
-- This migration also enables RLS and adds the minimum correct
-- policies so PostgREST can manage category links on behalf of
-- the recipe owner.
-- ============================================================

-- ── 1. Drop the incorrect single-column UNIQUE constraint ────────
--
-- Postgres auto-names a single-column UNIQUE as
-- "<table>_<column>_key", e.g. recipe_categories_category_id_key.
-- We use a DO block to find and drop it regardless of its name, so
-- the migration is safe to run even after a rename.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM   pg_constraint  con
    JOIN   pg_class       cls ON cls.oid = con.conrelid
    JOIN   pg_namespace   nsp ON nsp.oid = cls.relnamespace
    WHERE  nsp.nspname = 'public'
    AND    cls.relname = 'recipe_categories'
    AND    con.contype = 'u'                -- UNIQUE (not primary key, not FK)
    AND    array_length(con.conkey, 1) = 1  -- single-column constraint
    AND    EXISTS (
             SELECT 1
             FROM   pg_attribute att
             WHERE  att.attrelid = cls.oid
             AND    att.attnum   = con.conkey[1]
             AND    att.attname  = 'category_id'
           )
  LOOP
    RAISE NOTICE 'Dropping incorrect unique constraint: %', r.conname;
    EXECUTE format('ALTER TABLE recipe_categories DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

-- Also drop any standalone unique index that may have been created
-- outside of a constraint (e.g. via CREATE UNIQUE INDEX in the dashboard).
DROP INDEX IF EXISTS public.recipe_categories_category_id_key;
DROP INDEX IF EXISTS public.recipe_categories_category_id_idx;
DROP INDEX IF EXISTS public.recipe_categories_category_id_unique;

-- ── 2. Ensure the correct composite PRIMARY KEY exists ───────────
--
-- If no PK exists at all (table was created bare), add the composite one.
-- If a composite PK already exists, this block is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint con
    JOIN   pg_class      cls ON cls.oid = con.conrelid
    JOIN   pg_namespace  nsp ON nsp.oid = cls.relnamespace
    WHERE  nsp.nspname = 'public'
    AND    cls.relname = 'recipe_categories'
    AND    con.contype = 'p'               -- PRIMARY KEY
  ) THEN
    ALTER TABLE recipe_categories ADD PRIMARY KEY (recipe_id, category_id);
    RAISE NOTICE 'Added composite PRIMARY KEY (recipe_id, category_id)';
  ELSE
    RAISE NOTICE 'PRIMARY KEY already exists — no change needed';
  END IF;
END;
$$;

-- ── 3. Enable RLS and add correct policies ───────────────────────
--
-- PostgREST requires at least SELECT + INSERT + DELETE policies so
-- that recipe owners can manage their own category links.
-- The policy predicate checks the recipes table to confirm ownership
-- rather than storing user_id redundantly in recipe_categories.

ALTER TABLE recipe_categories ENABLE ROW LEVEL SECURITY;

-- SELECT: recipe owner can see their own links (used in nested joins)
DROP POLICY IF EXISTS "recipe_categories_select_own" ON recipe_categories;
CREATE POLICY "recipe_categories_select_own"
  ON recipe_categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE  recipes.id      = recipe_id
      AND    recipes.user_id = auth.uid()
    )
  );

-- INSERT: recipe owner can add category links to their own recipes
DROP POLICY IF EXISTS "recipe_categories_insert_own" ON recipe_categories;
CREATE POLICY "recipe_categories_insert_own"
  ON recipe_categories FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE  recipes.id      = recipe_id
      AND    recipes.user_id = auth.uid()
    )
  );

-- DELETE: recipe owner can remove category links from their own recipes
DROP POLICY IF EXISTS "recipe_categories_delete_own" ON recipe_categories;
CREATE POLICY "recipe_categories_delete_own"
  ON recipe_categories FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE  recipes.id      = recipe_id
      AND    recipes.user_id = auth.uid()
    )
  );
