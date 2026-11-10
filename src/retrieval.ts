export interface RankedCandidate {
  id: string;
  score: number;
  ranks: { dense?: number; lexical?: number };
}

export function compileLexicalQuery(query: string): {
  match: string | null; termsUsed: number; truncated: boolean;
} {
  const terms = new Set<string>();
  let truncated = false;
  for (const [token] of query.matchAll(/[\p{L}\p{N}_]+/gu)) {
    const term = token.toLowerCase();
    if (terms.has(term)) continue;
    if (terms.size === 32) { truncated = true; break; }
    terms.add(term);
  }
  return { match: terms.size === 0 ? null : [...terms].map(term => `"${term}"`).join(" OR "),
    termsUsed: terms.size, truncated };
}

export function fuseRanks(denseIds: readonly string[], lexicalIds: readonly string[]): RankedCandidate[] {
  const candidates = new Map<string, RankedCandidate>();
  for (const [branch, ids] of [["dense", denseIds], ["lexical", lexicalIds]] as const) {
    ids.forEach((id, index) => {
      const item = candidates.get(id) ?? { id, score: 0, ranks: {} };
      item.ranks[branch] = index + 1;
      item.score += 1 / (60 + index + 1);
      candidates.set(id, item);
    });
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score
    || Buffer.compare(Buffer.from(a.id, "utf8"), Buffer.from(b.id, "utf8")));
}
