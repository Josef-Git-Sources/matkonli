-- ============================================================
-- Migration: RLS policies for the categories table
-- System categories (user_id IS NULL) are read-only for everyone.
-- Users can manage only their own custom categories.
-- ============================================================

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read system categories and their own
DROP POLICY IF EXISTS "categories_select" ON categories;
CREATE POLICY "categories_select"
  ON categories FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- Allow users to create their own custom categories
DROP POLICY IF EXISTS "categories_insert_own" ON categories;
CREATE POLICY "categories_insert_own"
  ON categories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow users to rename their own custom categories
DROP POLICY IF EXISTS "categories_update_own" ON categories;
CREATE POLICY "categories_update_own"
  ON categories FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow users to delete their own custom categories (not system ones)
DROP POLICY IF EXISTS "categories_delete_own" ON categories;
CREATE POLICY "categories_delete_own"
  ON categories FOR DELETE
  USING (auth.uid() = user_id AND user_id IS NOT NULL);
