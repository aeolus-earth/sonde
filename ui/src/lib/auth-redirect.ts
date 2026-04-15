/** Safe in-app path only (open redirect hardening). */
export function safeAuthRedirect(redirect: string | undefined): string {
  if (!redirect || typeof redirect !== "string") return "/";
  const t = redirect.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return "/";
  return t;
}

export function currentAuthReturnPath(
  locationLike:
    | Pick<Location, "pathname" | "search">
    | null
    | undefined = typeof window !== "undefined" ? window.location : undefined,
): string {
  if (!locationLike) return "/";
  return safeAuthRedirect(`${locationLike.pathname}${locationLike.search}`);
}
