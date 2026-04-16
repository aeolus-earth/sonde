import { createClient } from "@supabase/supabase-js";
import { ACTIVATION_STORAGE_KEY, clearActivationStorage } from "./activation-session";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment"
  );
}

export { ACTIVATION_STORAGE_KEY };

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
  clearActivationStorage();
}
