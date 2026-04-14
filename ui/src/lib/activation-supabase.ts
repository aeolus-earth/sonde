import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment"
  );
}

export const ACTIVATION_STORAGE_KEY = "sonde-activation-auth";

export const activationSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: "pkce",
    storageKey: ACTIVATION_STORAGE_KEY,
  },
});

export async function clearActivationSession(): Promise<void> {
  await activationSupabase.auth.signOut();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ACTIVATION_STORAGE_KEY);
  }
}
