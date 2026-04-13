import type { User } from "@supabase/supabase-js";

export function isAdminUser(user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }

  return user.app_metadata?.is_admin === true || user.app_metadata?.isAdmin === true;
}
