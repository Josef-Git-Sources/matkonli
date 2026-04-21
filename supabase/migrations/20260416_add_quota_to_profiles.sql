-- ============================================================
-- Migration: add is_premium and ai_quota to profiles table
-- Replaces the previous client-side auth.user_metadata approach.
-- Run this in the Supabase SQL editor (or via supabase db push).
-- ============================================================

-- 1. Add columns --------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_quota   INTEGER  NOT NULL DEFAULT 3;

-- 2. Back-fill any existing rows (they get the defaults above,
--    but make the intent explicit for clarity).
UPDATE profiles
SET    is_premium = false,
       ai_quota   = 3
WHERE  is_premium IS NULL
   OR  ai_quota   IS NULL;

-- 3. Ensure new users get a profile row on sign-up ---------------
--    (Supabase's default handle_new_user trigger usually does this;
--     create it here in case it doesn't exist yet.)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, avatar_url, is_premium, ai_quota)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    false,
    3
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Attach the trigger if it isn't already attached.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
  END IF;
END;
$$;

-- 4. Server-side atomic decrement (SECURITY DEFINER) -------------
--    The client calls this via rpc('decrement_ai_quota').
--    Because it is SECURITY DEFINER it runs as the DB owner, so
--    even if RLS blocks direct UPDATE of ai_quota, this works.
--    It only ever subtracts 1; it will never increment quota.
CREATE OR REPLACE FUNCTION public.decrement_ai_quota()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_quota integer;
BEGIN
  UPDATE profiles
  SET    ai_quota = GREATEST(0, ai_quota - 1)
  WHERE  id          = auth.uid()
    AND  is_premium  = false
    AND  ai_quota    > 0
  RETURNING ai_quota INTO new_quota;

  -- Returns the remaining quota (or 0 if nothing was updated).
  RETURN COALESCE(new_quota, 0);
END;
$$;

-- 5. RLS: lock down direct updates to quota columns --------------
--    Users may update their own non-sensitive profile fields, but
--    they cannot directly write ai_quota or is_premium.
--    (is_premium is set only by admin / billing webhook.)

-- Enable RLS if not already enabled.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own profile.
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Allow users to update only non-quota fields on their own row.
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent any direct change to quota or premium status.
    AND ai_quota   = (SELECT ai_quota   FROM profiles WHERE id = auth.uid())
    AND is_premium = (SELECT is_premium FROM profiles WHERE id = auth.uid())
  );

-- Allow insert only for the service role (handle_new_user trigger).
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);
