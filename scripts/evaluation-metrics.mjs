const unique = ids => [...new Set(ids)];

// Gold annotations stay in this evaluator; retrieval and providers receive only inputs.
export function measureQuery({ gold, candidateIds, rankedIds, primaryIds, evidenceIds, k }) {
  const expected = Array.isArray(gold) ? unique(gold) : null;
  const candidates = new Set(candidateIds);
  const fullRanking = unique(rankedIds);
  const ranked = fullRanking.slice(0, k);
  const primary = new Set(primaryIds);
  const evidence = new Set(evidenceIds);
  const annotated = expected !== null && expected.length > 0;
  const annotation = expected === null ? "unannotated" : annotated ? "support" : "no-answer";
  const hitCount = ids => expected.filter(id => ids.has(id)).length;
  const rank = annotated ? ranked.findIndex(id => expected.includes(id)) : -1;
  const candidateRank = annotated ? fullRanking.findIndex(id => expected.includes(id)) : -1;
  return {
    annotation, requiredSupportIds: expected,
    firstCandidateSupportRank: candidateRank === -1 ? null : candidateRank + 1,
    recallAtK: annotated ? hitCount(new Set(ranked)) / expected.length : null,
    reciprocalRankAtK: annotated ? rank === -1 ? 0 : 1 / (rank + 1) : null,
    evidenceRecall: annotated ? hitCount(evidence) / expected.length : null,
    completeSupport: annotated ? Number(expected.every(id => evidence.has(id))) : null,
    candidateMissIds: annotated ? expected.filter(id => !candidates.has(id)) : [],
    rankCutoffIds: annotated ? expected.filter(id => candidates.has(id) && !ranked.includes(id)) : [],
    budgetLostPrimaryIds: annotated ? expected.filter(id => ranked.includes(id) && !primary.has(id)) : [],
    contextRecoveredIds: annotated ? expected.filter(id => evidence.has(id) && !primary.has(id)) : [],
    missingEvidenceIds: annotated ? expected.filter(id => !evidence.has(id)) : [],
    noAnswerExposureRecords: annotation === "no-answer" ? evidence.size : null,
  };
}

export function summarizeQueries(rows) {
  const support = rows.filter(row => row.annotation === "support");
  const noAnswer = rows.filter(row => row.annotation === "no-answer");
  const average = field => support.length === 0 ? null
    : support.reduce((total, row) => total + row[field], 0) / support.length;
  return {
    queries: rows.length,
    annotatedQueries: support.length,
    noAnswerQueries: noAnswer.length,
    unannotatedQueries: rows.filter(row => row.annotation === "unannotated").length,
    recallAtK: average("recallAtK"),
    mrrAtK: average("reciprocalRankAtK"),
    evidenceRecall: average("evidenceRecall"),
    completeSupportCoverage: average("completeSupport"),
    noAnswerExposureRate: noAnswer.length === 0 ? null
      : noAnswer.filter(row => row.noAnswerExposureRecords > 0).length / noAnswer.length,
    noAnswerExposureRecords: noAnswer.reduce((total, row) => total + row.noAnswerExposureRecords, 0),
  };
}

export function latencySummary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = p => sorted.length === 0 ? null : sorted[Math.ceil(p * sorted.length) - 1];
  return { samplesMs: samples, count: samples.length,
    meanMs: samples.length === 0 ? null : samples.reduce((a, b) => a + b, 0) / samples.length,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95) };
}
