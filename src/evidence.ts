import type { RankedCandidate } from "./retrieval.js";
import type { EvidenceItem, MemoryRecord } from "./types.js";

export function selectEvidence(candidates: readonly (RankedCandidate & { record: MemoryRecord })[],
  limit: number, maxEvidenceBytes: number,
  readNeighbors?: (record: MemoryRecord) => readonly MemoryRecord[],
): { items: EvidenceItem[]; usedBytes: number; budgetOmitted: number } {
  const items: EvidenceItem[] = [];
  let usedBytes = 0;
  const omittedIds = new Set<string>();
  for (const candidate of candidates) {
    if (items.length === limit) break;
    const bytes = Buffer.byteLength(candidate.record.text, "utf8");
    if (bytes > maxEvidenceBytes - usedBytes) { omittedIds.add(candidate.id); continue; }
    items.push({ record: candidate.record, role: "match", score: candidate.score, ranks: candidate.ranks, anchorIds: [] });
    usedBytes += bytes;
  }
  if (readNeighbors) {
    const matches = [...items];
    const byId = new Map(items.map(item => [item.record.id, item]));
    for (const match of matches) {
      const neighbors = [...readNeighbors(match.record)].sort((a, b) => a.sequence! - b.sequence!
        || Buffer.compare(Buffer.from(a.id, "utf8"), Buffer.from(b.id, "utf8")));
      for (const record of neighbors) {
        const existing = byId.get(record.id);
        if (existing) {
          if (existing.role === "context" && !existing.anchorIds.includes(match.record.id)) {
            existing.anchorIds = [...existing.anchorIds, match.record.id];
          }
          continue;
        }
        const bytes = Buffer.byteLength(record.text, "utf8");
        if (bytes > maxEvidenceBytes - usedBytes) { omittedIds.add(record.id); continue; }
        const item: EvidenceItem = { record, role: "context", score: null, ranks: {}, anchorIds: [match.record.id] };
        items.push(item);
        byId.set(record.id, item);
        usedBytes += bytes;
      }
    }
  }
  return { items, usedBytes, budgetOmitted: omittedIds.size };
}
