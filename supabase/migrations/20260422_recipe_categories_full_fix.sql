-- ============================================================
-- Migration: recipe_categories — full repair
--
-- Why this exists alongside 20260421_fix_recipe_categories_constraint.sql:
-- QA confirmed older recipes still fail to save categories while newer
-- ones succeed.  Root cause: the previous migration was never applied to
-- the live DB, so the single-column UNIQUE(category_id) constraint still
-- exists.  Recipe A succeeded only because it was the FIRST recipe to use
-- those category IDs; editing recipes B & C fails with a UNIQUE violation
-- because Recipe A's row already holds those category_id values.
--
-- This migration supersedes the previous one and is safe to re-run.
-- ============================================================


-- ── STEP 1: Remove the bad single-column UNIQUE constraint ───────
--
-- Dynamically find and drop any single-column UNIQUE on category_id,
-- regardless of how Postgres named it.

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
    AND    con.contype = 'u'
    AND    array_length(con.conkey, 1) = 1
    AND    EXISTS (
             SELECT 1 FROM pg_attribute att
             WHERE  att.attrelid = cls.oid
             AND    att.attnum   = con.conkey[1]
             AND    att.attname  = 'category_id'
           )
  LOOP
    RAISE NOTICE 'Dropping incorrect UNIQUE constraint: %', r.conname;
    EXECUTE format('ALTER TABLE recipe_categories DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

-- Also drop any standalone unique index that may exist independently
DROP INDEX IF EXISTS public.recipe_categories_category_id_key;
DROP INDEX IF EXISTS public.recipe_categories_category_id_idx;
DROP INDEX IF EXISTS public.recipe_categories_category_id_unique;


-- ── STEP 2: Remove orphaned / duplicate rows before adding PK ────
--
-- If the old UNIQUE constraint was the only guard, the table may contain
-- (recipe_id, category_id) duplicates.  Deduplicate by keeping only the
-- row with the lowest ctid (physical order) per pair.

DELETE FROM recipe_categories rc1
WHERE ctid NOT IN (
  SELECT MIN(rc2.ctid)
  FROM   recipe_categories rc2
  GROUP  BY rc2.recipe_id, rc2.category_id
);

-- Also purge dangling rows whose recipe no longer exists (prevents FK errors
-- when the PK constraint is added).
DELETE FROM recipe_categories
WHERE  recipe_id NOT IN (SELECT id FROM recipes);


-- ── STEP 3: Drop any existing PRIMARY KEY, then add the correct one ──
--
-- We drop first so the migration is idempotent: if the previous migration
-- already added a PK we remove it and re-add it cleanly.

DO $$
DECLARE
  pk_name TEXT;
BEGIN
  SELECT con.conname INTO pk_name
  FROM   pg_constraint  con
  JOIN   pg_class       cls ON cls.oid = con.conrelid
  JOIN   pg_namespace   nsp ON nsp.oid = cls.relnamespace
  WHERE  nsp.nspname = 'public'
  AND    cls.relname = 'recipe_categories'
  AND    con.contype = 'p';

  IF pk_name IS NOT NULL THEN
    RAISE NOTICE 'Dropping existing PK: %', pk_name;
    EXECUTE format('ALTER TABLE recipe_categories DROP CONSTRAINT %I', pk_name);
  END IF;

  ALTER TABLE recipe_categories ADD PRIMARY KEY (recipe_id, category_id);
  RAISE NOTICE 'Added composite PRIMARY KEY (recipe_id, category_id)';
END;
$$;


-- ── STEP 4: Enable RLS and rebuild all policies ───────────────────
--
-- Re-creating policies ensures they are current even if the previous
-- migration was partially applied.

ALTER TABLE recipe_categories ENABLE ROW LEVEL SECURITY;

-- SELECT — recipe owner can read their own category links
DROP POLICY IF EXISTS "recipe_categories_select_own" ON recipe_categories;
CREATE POLICY "recipe_categories_select_own"
  ON recipe_categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE  recipes.id      = recipe_categories.recipe_id
      AND    recipes.user_id = auth.uid()
    )
  );

-- INSERT — recipe owner can add category links to their own recipes
DROP POLICY IF EXISTS "recipe_categories_insert_own" ON recipe_categories;
CREATE POLICY "recipe_categories_insert_own"
  ON recipe_categories FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE  recipes.id      = recipe_categories.recipe_id
      AND    recipes.user_id = auth.uid()
    )
  );

-- DELETE — recipe owner can remove category links from their own recipes
DROP POLICY IF EXISTS "recipe_categories_delete_own" ON recipe_categories;
CREATE POLICY "recipe_categories_delete_own"
  ON recipe_categories FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE  recipes.id      = recipe_categories.recipe_id
      AND    recipes.user_id = auth.uid()
    )
  );


-- ── STEP 5: Data-normalization audit ─────────────────────────────
--
-- Recipes with user_id IS NULL will never satisfy the RLS predicates above,
-- making category management impossible for them.  This block logs them as
-- warnings so they can be fixed manually if found.

DO $$
DECLARE
  r   RECORD;
  cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt FROM recipes WHERE user_id IS NULL;

  IF cnt > 0 THEN
    RAISE WARNING
      'DATA PROBLEM: % recipe(s) have user_id IS NULL — '
      'category links for these recipes will be blocked by RLS. '
      'Set their user_id to the owning user''s auth.uid() to fix.', cnt;

    FOR r IN
      SELECT id, title, created_at
      FROM   recipes
      WHERE  user_id IS NULL
      ORDER  BY created_at
    LOOP
      RAISE WARNING '  Affected recipe — id: %, title: %, created: %',
        r.id, r.title, r.created_at;
    END LOOP;
  ELSE
    RAISE NOTICE 'Data check passed: all recipes have a valid user_id.';
  END IF;
END;
$$;
