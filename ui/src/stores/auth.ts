import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";
import { artifactContentCache } from "@/lib/artifact-content-cache";
import { supabase } from "@/lib/supabase";

const AEOLUS_DOMAIN_MSG = "Only @aeolus.earth Google accounts are allowed.";

function parseAuthErrorFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const { search, hash } = window.location;
  const params = new URLSearchParams(search);
  let err = params.get("error_description") ?? params.get("error");
  if (!err && hash.length > 1) {
    const h = new URLSearchParams(hash.replace(/^#/, ""));
    err = h.get("error_description") ?? h.get("error");
  }
  if (!err) return null;
  try {
    return decodeURIComponent(err.replace(/\+/g, " "));
  } catch {
    return err;
  }
}

function normalizeAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (
    m.includes("aeolus.earth") ||
    m.includes("only @aeolus") ||
    (m.includes("403") && m.includes("allowed"))
  ) {
    return AEOLUS_DOMAIN_MSG;
  }
  return msg;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: (options?: { returnPath?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  initialize: () => () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  authError: null,

  clearAuthError: () => set({ authError: null }),

  signInWithGoogle: async (options?: { returnPath?: string }) => {
    set({ authError: null });
    const path = options?.returnPath;
    if (path && path !== "/login") {
      sessionStorage.setItem("sonde-post-login", path);
    } else {
      sessionStorage.removeItem("sonde-post-login");
    }
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        // Keep in sync with cli/src/sonde/auth.py sign_in_with_oauth query_params.hd
        queryParams: {
          hd: "aeolus.earth",
        },
      },
    });
    if (error) {
      set({ authError: normalizeAuthError(error.message) });
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    artifactContentCache.clear();
    set({ user: null, session: null, authError: null });
  },

  initialize: () => {
    const urlErr = parseAuthErrorFromUrl();
    if (urlErr) {
      set({ authError: normalizeAuthError(urlErr) });
      void supabase.auth.signOut();
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        set({
          session: null,
          user: null,
          loading: false,
          authError: normalizeAuthError(error.message),
        });
        return;
      }
      set({
        session,
        user: session?.user ?? null,
        loading: false,
        authError: session ? null : get().authError,
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        user: session?.user ?? null,
        loading: false,
        authError: session ? null : get().authError,
      });
    });

    return () => subscription.unsubscribe();
  },
}));
