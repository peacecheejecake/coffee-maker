/**
 * Build-time configuration. Without Supabase settings the app runs local-only (one device, IndexedDB),
 * which is also what the demo and most e2e tests use.
 */
export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  /** Public half of the VAPID key pair used by the notify Edge Function. Optional. */
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined,
};

export const syncEnabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);
