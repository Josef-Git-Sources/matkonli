import { supabase } from './supabase';

export interface UserProfile {
  is_premium: boolean;
  ai_quota:   number;
}

/** Reads is_premium and ai_quota from Supabase user metadata. Defaults: false / 3. */
export async function getUserProfile(): Promise<UserProfile> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { is_premium: false, ai_quota: 0 };
  const meta = user.user_metadata ?? {};
  return {
    is_premium: meta.is_premium === true,
    ai_quota:   typeof meta.ai_quota === 'number' ? meta.ai_quota : 3,
  };
}

/**
 * Deducts one AI quota use for the signed-in free user.
 * Returns the new quota value. Throws if not signed in.
 */
export async function deductAiQuota(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const current = typeof user.user_metadata?.ai_quota === 'number'
    ? user.user_metadata.ai_quota
    : 3;
  const next = Math.max(0, current - 1);
  const { error } = await supabase.auth.updateUser({ data: { ai_quota: next } });
  if (error) throw error;
  return next;
}
