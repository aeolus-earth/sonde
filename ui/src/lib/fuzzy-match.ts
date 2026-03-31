/**
 * Simple subsequence fuzzy matcher.
 * Returns a score (0 = no match) and the indices of matched characters.
 */
export function fuzzyMatch(
  query: string,
  text: string
): { score: number; indices: number[] } {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let lastMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      // Bonus for consecutive matches
      if (lastMatchIndex === ti - 1) score += 3;
      // Bonus for matching at word boundary
      if (ti === 0 || /[\s\-_./]/.test(t[ti - 1])) score += 5;
      // Base match score
      score += 1;
      lastMatchIndex = ti;
      qi++;
    }
  }

  // All characters must match
  if (qi < q.length) return { score: 0, indices: [] };

  // Penalize by text length (shorter matches rank higher)
  score -= text.length * 0.1;

  return { score: Math.max(score, 0.1), indices };
}

/**
 * Filter and rank items by fuzzy match score.
 */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getText: (item: T) => string
): T[] {
  if (!query) return items;

  return items
    .map((item) => ({ item, ...fuzzyMatch(query, getText(item)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
