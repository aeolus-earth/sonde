/**
 * Detect Sonde artifact ids in assistant or user text (e.g. ART-0010).
 * Returns stable, deduplicated order of first occurrence.
 */
export function extractArtifactIdsFromText(text: string): string[] {
  const re = /\b(ART-[A-Z0-9]+)\b/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1]!.toUpperCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
