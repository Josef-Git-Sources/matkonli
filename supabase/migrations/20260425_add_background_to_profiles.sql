-- ============================================================
-- Migration: add background_image_url and background_opacity
--            to the profiles table for cross-device persistence.
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- or via: supabase db push
-- ============================================================

-- 1. Add the two new nullable columns --------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS background_image_url TEXT             DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS background_opacity   DOUBLE PRECISION DEFAULT NULL;

-- 2. No RLS changes needed ------------------------------------
--    The existing "profiles_update_own" policy only restricts
--    ai_quota and is_premium.  All other columns (including these
--    new ones) are freely writable by the row owner.

-- 3. Verify ---------------------------------------------------
-- SELECT id, background_image_url, background_opacity FROM profiles LIMIT 5;
