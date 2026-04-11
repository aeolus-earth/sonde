/**
 * Production UI origin (see repo README). Used for "Copy link" when the app runs on localhost.
 * Override with `VITE_PUBLIC_APP_ORIGIN` if the canonical host changes (e.g. custom domain).
 */
export const DEFAULT_PUBLIC_APP_ORIGIN = "https://sonde-neon.vercel.app";

function isLocalDevHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Origin for shareable links: optional env override, else production when on localhost,
 * else the current window origin (deployed preview or prod).
 */
export function getShareableAppOrigin(): string {
  const raw = import.meta.env.VITE_PUBLIC_APP_ORIGIN;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.replace(/\/$/, "");
  }
  if (typeof window === "undefined") {
    return "";
  }
  if (isLocalDevHostname(window.location.hostname)) {
    return DEFAULT_PUBLIC_APP_ORIGIN;
  }
  return window.location.origin;
}

export function experimentDetailShareUrl(experimentId: string): string {
  const origin = getShareableAppOrigin();
  const path = `/experiments/${encodeURIComponent(experimentId)}`;
  return origin ? `${origin}${path}` : path;
}

export function projectDetailShareUrl(projectId: string): string {
  const origin = getShareableAppOrigin();
  const path = `/projects/${encodeURIComponent(projectId)}`;
  return origin ? `${origin}${path}` : path;
}

export function directionDetailShareUrl(directionId: string): string {
  const origin = getShareableAppOrigin();
  const path = `/directions/${encodeURIComponent(directionId)}`;
  return origin ? `${origin}${path}` : path;
}
