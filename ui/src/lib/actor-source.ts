export function actorSourceFromEmail(
  email: string | null | undefined,
): string | null {
  const handle = email?.split("@")[0]?.trim().toLowerCase();
  return handle ? `human/${handle}` : null;
}

export function actorHandle(source: string | null | undefined): string | null {
  if (!source) return null;
  const slashIndex = source.indexOf("/");
  const handle = slashIndex >= 0 ? source.slice(slashIndex + 1) : source;
  return handle || null;
}

export function displaySourceLabel(
  source: string | null | undefined,
  currentActorSource?: string | null,
): string {
  if (!source) return "unknown";
  if (currentActorSource && source === currentActorSource) return "you";
  return actorHandle(source) ?? source;
}
