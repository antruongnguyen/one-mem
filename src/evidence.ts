import type { RankedCandidate } from "./retrieval.js";
import type { EvidenceItem, MemoryRecord } from "./types.js";

export function selectEvidence(candidates: readonly (RankedCandidate & { record: MemoryRecord })[],
  limit: number, maxEvidenceBytes: number,
): { items: EvidenceItem[]; usedBytes: number; budgetOmitted: number } {
  const items: EvidenceItem[] = [];
  let usedBytes = 0;
  let budgetOmitted = 0;
  for (const candidate of candidates) {
    if (items.length === limit) break;
    const bytes = Buffer.byteLength(candidate.record.text, "utf8");
    if (bytes > maxEvidenceBytes - usedBytes) { budgetOmitted++; continue; }
    items.push({ record: candidate.record, role: "match", score: candidate.score, ranks: candidate.ranks });
    usedBytes += bytes;
  }
  return { items, usedBytes, budgetOmitted };
}
