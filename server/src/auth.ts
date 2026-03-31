import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseAnonKey =
  process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY (or VITE_ prefixed variants)"
  );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface VerifiedUser {
  id: string;
  email?: string;
  name?: string;
}

export async function verifyToken(
  accessToken: string
): Promise<VerifiedUser | null> {
  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) {
      if (process.env.NODE_ENV !== "production" && error) {
        console.error("[sonde-server] auth.getUser failed:", error.message);
      }
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email,
      name:
        (data.user.user_metadata?.full_name as string | undefined) ??
        data.user.email,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[sonde-server] auth.verifyToken exception:", err);
    }
    return null;
  }
}
