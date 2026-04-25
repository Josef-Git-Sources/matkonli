import { supabase } from './supabase';

export interface UserProfile {
  is_premium: boolean;
  ai_quota:   number;
}

/** Reads is_premium and ai_quota from the profiles DB table. Defaults: false / 3. */
export async function getUserProfile(): Promise<UserProfile> {
  // getSession() returns the cached session without a network round-trip.
  // getUser() would make a server call on every invocation which can return
  // null on mobile before AsyncStorage hydration completes.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) return { is_premium: false, ai_quota: 0 };

  const { data, error } = await supabase
    .from('profiles')
    .select('is_premium, ai_quota')
    .eq('id', user.id)
    .single();

  if (error || !data) return { is_premium: false, ai_quota: 3 };
  return {
    is_premium: data.is_premium ?? false,
    ai_quota:   typeof data.ai_quota === 'number' ? data.ai_quota : 3,
  };
}

/**
 * Atomically decrements the signed-in user's AI quota by 1 via a
 * SECURITY DEFINER RPC. The server enforces that quota only decreases;
 * clients cannot bypass this by calling the profiles table directly.
 * Returns the new quota value. Throws if not signed in.
 */
export async function deductAiQuota(): Promise<number> {
  const { data, error } = await supabase.rpc('decrement_ai_quota');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}
