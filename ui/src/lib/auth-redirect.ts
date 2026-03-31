/** Safe in-app path only (open redirect hardening). */
export function safeAuthRedirect(redirect: string | undefined): string {
  if (!redirect || typeof redirect !== "string") return "/";
  const t = redirect.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return "/";
  return t;
}
