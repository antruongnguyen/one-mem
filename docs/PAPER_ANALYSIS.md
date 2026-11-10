# Reading the Zero-Mem paper for one-mem

## Source and interpretation

- Paper: Yilin Xiao et al., **Zero-Mem: Zero-Token Memory Operations for LLM Agents**, [arXiv:2607.29377v1](https://arxiv.org/abs/2607.29377v1), dated 2026-07-31.
- Reviewed on 2026-11-10: the supplied nine-page v1 PDF, with visual checks of the method, equations, tables, and figures. Page references below mean PDF pages.
- PDF SHA-256: `5510ec5fb9b9b456dc4d004c79237d9d523d74d47c124a4b40feec59e1be0589`.
- **Paper** means the v1 preprint's described method and authors' reported experiments. **Reference** means the separately inspected Python revision `e1b2f8ef98a3d023478ddb2049aba11753296d42`, documented in [REFERENCE_ANALYSIS.md](REFERENCE_ANALYSIS.md). **Proposal** means unimplemented one-mem choices in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
- The paper is research evidence, not an implementation specification or proof of one-mem performance. Its abstract links a different repository path from the inspected checkout; v1 does not identify that checkout's commit as the experimental artifact.

The paper strengthens three choices already proposed for one-mem: keep original evidence, separate memory operations from generation, and combine exact lexical access with semantic retrieval.
It also challenges a possible overinterpretation of the small baseline: hybrid retrieval plus adjacent turns does not implement the paper's relational graph, temporal hierarchy, routing, closure, or calibration.
Keep the simpler first release, but evaluate distributed evidence explicitly and give graph retrieval a concrete promotion gate.

## What "zero-token" covers

The definition excludes generative LLM calls and LLM input/output tokens from **all operations outside final QA**: construction, organization, routing, retrieval, evidence closure, pre-reader calibration, and post-reader calibration.
Encoder computation and final-QA inference are accounted for separately; zero-token does not mean zero computation, free embedding APIs, or zero end-to-end tokens.
The formal boundary is `R(q) = Memory(q, H)` followed by `a = Reader(q, R(q))` (Eqs. 1-2).
See [Introduction and Preliminaries, p. 2](https://arxiv.org/pdf/2607.29377v1#page=2).

**Proposal:** retain a retrieval API that cannot invoke a generative reader internally. The initial package injects an embedding provider and returns evidence; callers own final QA.
The library cannot certify arbitrary provider internals. A provider that secretly rewrites inputs through a generative model falls outside this operating regime, even if the library calls its method `embed`.
Evaluation must separate document/query embedding, optional NER/reranking, local storage/retrieval, and final reader costs, including actual network attempts where observable.

## The paper's memory substrate

Every derived unit retains original text and available source identifier, session time, boundary identifier, and other metadata.
Both retrieval views resolve to provenance-bearing traces, instead of replacing those traces with generated summaries or extracted memory statements.
The intended benefit is retaining details that compression may omit, merge, or detach from their source; the paper does not isolate a rare-fact preservation experiment.
See [Method, Figure 2 and substrate, p. 3](https://arxiv.org/pdf/2607.29377v1#page=3).

| Paper component | Mechanism | Consequence for one-mem |
| --- | --- | --- |
| Entity-context graph | NER produces entity nodes; context nodes connect through entity occurrence and context adjacency | Connectivity is observed co-occurrence, not a verified semantic or causal relation |
| Temporal hierarchy | Turns, short windows, episodes grouped by semantic continuity and available boundaries, plus local spans | A hierarchy offers coarse-to-fine retrieval; fetching adjacent turns supplies only local context |
| Lexical access | BM25 and phrase/exact-match signals for names, dates, numbers, titles, and quotations | Preserve a lexical branch and test rare identifiers; embeddings alone may blur exact details |
| Dense access | BGE-M3 embeddings support indexing, seeding, and scoring | Injecting another model is an independent choice requiring its own quality and cost evaluation |

The graph is `G = (V_d union V_e, E_de union E_dd)` (Eq. 3). Its context-entity edge weight is the entity's occurrence count divided by the total detected-entity occurrence count in that context (Eq. 4).
The hierarchy is `T(H) = U_turn union U_window union U_episode union U_local` (Eq. 5).
These equations specify useful organization principles, not SQLite tables, transaction semantics, revision identifiers, or incremental update/delete behavior.

**Proposal:** preserve caller-defined atomic records, exact text, and explicit metadata in transactional SQLite. Do not deduplicate independent observations merely because their text matches.
Record IDs identify observed interactions, not mutable entity/fact slots. A later statement gets a new ID so both old and new evidence remain available; `upsert` corrects/replaces the same source record and does not retain revision history.
Do not silently resolve conflicting statements by latest-write-wins. Return the original statements and supplied times; semantic current/as-of interpretation belongs to the caller or optional reader.
The initial contract preserves the complete input record, not an upstream document that the caller already discarded or compressed.
Callers that chunk documents must retain the original document and map record IDs to its immutable revision and exact spans themselves.
Any future built-in chunking, graph mentions, extractive spans, or hierarchy units must define offset units, underlying record IDs/revisions, and exact span reconstruction; keep the uncompressed originals authoritative.

## Query routing and retrieval

The paper's deterministic query profile contains subject, keywords, answer type, temporal cues, and available boundary information (Eq. 6).
Question form, temporal/aggregation requirements, and subject anchors determine which view is primary (Eq. 7).
**Both views still execute in the full model.** Routing changes their fusion weights; it is not a choice to skip one entire retrieval branch.
See [Query-Conditioned Evidence Routing, p. 4](https://arxiv.org/pdf/2607.29377v1#page=4).

Graph retrieval has several distinct stages:

1. Align each query entity with the most similar observed graph entity; cosine similarity initializes activation (Eq. 8).
2. Propagate activation through shared entity-bearing sentences, weighted by sentence/query similarity (Eq. 9).
3. Combine propagated activations and dense context priors into a normalized reset distribution `r_q`.
4. Apply personalized PageRank: `pi_q = (1 - gamma) r_q + gamma P^T pi_q`, with row-normalized transitions `P` (Eq. 10).
5. Rank context nodes and refine using lexical/phrase signals. Dense context retrieval supplies a fallback when no query entity is detected.

Nearest-entity matching is not proof that an entity is relevant; Eq. 8 does not specify a rejection threshold.
Equation 9 does not fully settle propagation termination, weak/negative similarities, or repeated paths. A future implementation must declare these semantics and test them independently.
The inspected reference's BFS and vectorized variants already differ; a translation cannot assume algorithmic equivalence from their common intent.

Hierarchy retrieval proceeds from episodes to windows to turns and then supporting local spans (Eq. 11).
Semantic relevance is refined with subject, temporal, boundary, answer-type, and lexical compatibility. It is more than chronological sorting or a fixed neighbor radius.
See [Dual-View Evidence Retrieval, p. 4](https://arxiv.org/pdf/2607.29377v1#page=4).

**Proposal:** keep explicit scope filters ahead of every candidate limit. Query text must not create an isolation boundary.
Start with dense + FTS5 retrieval and bounded same-source/session neighbors; this avoids a required NER runtime and additional derived indexes.
Do not claim the baseline solves distant relations, causal chains, list completeness, or temporal state resolution. Use these as evaluation slices and inspect which required evidence is missing.
For distributed relational failures, prioritize an attributed entity/context graph experiment; for context-region failures, evaluate windows/episodes instead.

## Fusion, closure, and calibration

The paper normalizes scores separately within each query/view using min-max normalization; an absent candidate receives 0, while a present candidate in a constant-score view receives 1 (Eq. 12).
It then combines the primary and secondary views as `rho * primary + (1 - rho) * secondary` (Eq. 13).
The reported experimental values are `rho = 0.6` and PageRank damping `gamma = 0.6`; they are paper settings, not the inspected code's resolved defaults or one-mem defaults.
See [fusion, p. 4](https://arxiv.org/pdf/2607.29377v1#page=4) and [Implementation Details, p. 6](https://arxiv.org/pdf/2607.29377v1#page=6).

**Proposal:** equal-weight reciprocal rank fusion of dense and lexical rankings is a different algorithm over different branches.
It is a small baseline that avoids raw cosine/BM25 scale mixing; the paper does not show that RRF is better, equivalent, or sufficient.

Evidence closure forms `C(q) = Dedup(M(q) union N_g(M(q)) union N_h(M(q)))` (Eq. 14).
`M(q)` contains the main fused evidence; graph support supplies relational bridges and hierarchy support supplies neighbors/local spans. Additions are bounded and query-conditioned; either support set may be empty.
Deduplication uses shared unit identity or provenance where available. This does not justify merging distinct sources with identical text.
See [Dual-View Evidence Closure, p. 4](https://arxiv.org/pdf/2607.29377v1#page=4).

Pre-reader calibration filters provenance/boundary violations and ranks admissible evidence by query compatibility, without rewriting it (Eq. 15).
Post-reader calibration checks supported answer forms using evidence-local candidates: normalization, extractive shortening, list pruning, or replacement by a unique type-compatible scalar candidate. If no deterministic correction exists, the original answer remains (Eq. 16).
This is not a universal factual verifier or an additional LLM judge. See [Deterministic Evidence Calibration, p. 5](https://arxiv.org/pdf/2607.29377v1#page=5).

**Proposal:** hard provenance/scope validation, stable source citations, and literal budgets belong in the core.
Keep optional reader behavior separate; citation membership alone does not prove support for every answer claim.
Do not adopt automatic answer replacement without separately testing false corrections, abstention, and raw-reader versus calibrated outcomes.
Cross-encoders occur in the inspected Python reference, but the v1 method does not specify one as a required module or isolate its contribution.

## Reported experimental evidence

LoCoMo covers single-hop, multi-hop, temporal, and open-domain questions over multi-session conversations.
HotpotQA uses a curated memory-evaluation variant with supporting documents plus distractors at 56K, 224K, and 448K context tokens.
Readers are GPT-4o-mini and Qwen2.5-14B-Instruct; the authors state identical readers and equivalent context budgets within each setting, with NVIDIA RTX 4090 hardware.
See [Experimental Setup, pp. 5-6](https://arxiv.org/pdf/2607.29377v1#page=5).

| Result | Paper reports | Interpretation |
| --- | --- | --- |
| LoCoMo average, GPT-4o-mini | Zero-Mem 59.15 F1 / 52.96 BLEU-1; GAM 53.75 / 47.51 | +5.40 / +5.45 percentage points; Zero-Mem is not best on every slice |
| LoCoMo multi-hop, GPT-4o-mini | Zero-Mem 41.61 F1 / 32.92 BLEU-1; GAM 42.29 / 34.44 | The strongest average does not establish universal superiority |
| LoCoMo average, Qwen | Zero-Mem 57.57 F1 / 51.41 BLEU-1; GAM 52.70 / 46.55 | +4.87 / +4.86 points with this reader |
| HotpotQA, GPT-4o-mini | Zero-Mem F1 72.07 / 66.43 / 65.04 at 56K / 224K / 448K | Higher than reported baselines in these settings |
| HotpotQA, Qwen | Zero-Mem F1 68.58 / 65.47 / 61.02 at the same lengths | Evidence under another reader, not a cross-platform library result |
| Memory-operation overhead | Zero-Mem 334.77 s total / 0.22 s per query; LightMem 788.76 s / 0.51 s | 57.6% reduction from total times, excluding shared final QA |
| Memory-operation LLM tokens | Zero-Mem 0; LightMem 877,086 | The zero-token boundary excludes encoder and final-reader accounting |

Sources: [Table 1, p. 5](https://arxiv.org/pdf/2607.29377v1#page=5), [Tables 2-3, p. 6](https://arxiv.org/pdf/2607.29377v1#page=6).
Table 2 uses four concurrent threads with GPT-4o-mini; its 10.0% F1 and 11.5% BLEU-1 gains compare against GAM, while its time reduction compares against LightMem.
The rounded 0.22/0.51 per-query values cannot reproduce 57.6% exactly; use the totals. These are reported averages, not p95 measurements or one-mem timings.
The table does not provide a stage breakdown or enough cold-start/indexing-amortization detail to treat its per-query number as an interactive retrieval latency guarantee.

### Ablations and budget sensitivity

| HotpotQA 56K, GPT-4o-mini | F1 | BLEU-1 |
| --- | ---: | ---: |
| Full model | 72.07 | 69.66 |
| Graph only | 62.50 | 59.90 |
| Hierarchy only | 54.88 | 51.40 |
| Without closure | 67.90 | 65.43 |
| Without calibration | 70.13 | 66.45 |

[Figure 3 and Ablation Study, p. 7](https://arxiv.org/pdf/2607.29377v1#page=7) support complementary views and useful closure/calibration in that experimental setting.
The stronger graph-only result makes distant relational retrieval a serious follow-up candidate, not dispensable complexity by assumption.
It does not prove that every graph component is necessary, that the same gains transfer to one-mem, or that graph retrieval beats the proposed FTS5 + RRF baseline.
The shown ablations do not isolate routing, NER, PPR, the two calibration stages, or a reranker individually.

[Figure 4 and budget discussion, p. 7](https://arxiv.org/pdf/2607.29377v1#page=7) define Top-K as **primary candidates before closure**.
LoCoMo averages rise from 52.59 F1 / 46.79 BLEU-1 at top-1 to 59.15 / 52.96 at top-5; top-10 is best, 0.65 F1 / 0.83 BLEU-1 above top-5, with little further gain.
Equal primary K does not establish equal final evidence size: graph support, neighbors, and varying unit lengths can change reader context.
one-mem must report primary matches, expanded items, unique source records, final evidence bytes, and actual reader-input tokens when a reader is evaluated.

### Limits of this evidence

- The paper reports F1/BLEU-1 answer quality, not one-mem retrieval recall or provenance correctness. Reader and deterministic answer processing remain part of the measured system.
- The RAG baseline is semantic retrieval over 2,048-token chunks; it is not the proposed lexical+dense RRF+neighbor implementation. No direct superiority claim between those systems follows.
- The authors state equivalent context budgets, but v1 does not give the numeric final-reader token cap or sufficiently detailed post-closure budget accounting for independent verification.
- The nine-page file has references on pp. 8-9 and no appendix, despite the p. 6 pointer to additional baseline descriptions there. It does not specify exact evaluated sample counts/splits, confidence intervals, repeated-run variance, or stage-level p95 measurements; do not infer an experimental sample count from rounded per-query ratios.
- GPU benchmark context lengths are not storage row counts. They do not select scalar BLOBs versus `vec0`, validate 10k/100k capacity, or establish Node/Bun and Windows/Linux/macOS compatibility.
- Long-memory QA evidence does not establish production update/delete/concurrency correctness, multilingual quality, or universal causal/aggregation reasoning. These require independent tests.

## Changes justified for the implementation plan

1. **Keep the first release small.** Durable originals, injected embeddings, FTS5 + dense RRF, and bounded neighbors remain a useful independently testable baseline. The paper does not choose a SQLite driver or vector layout.
2. **Make provenance precise.** Whole-record evidence must equal the supplied text and carry its source, record ID, and revision. Derived or extracted evidence later needs exact source-span mappings; compression cannot become the only retained source.
3. **Broaden the evaluation before promoting complexity.** Include rare names/numbers, distant relational bridges across allowed sources, explicit causal evidence, temporal state changes/current-versus-as-of questions, multi-item aggregation, no-answer cases, independent repeated text, and English/Vietnamese slices. Do not describe untested reasoning as a supported feature.
4. **Score all required evidence.** Recall@k and MRR alone can hide a missing second hop or omitted list item. Report complete-support coverage and evidence recall after the real final budget, with per-slice failures.
5. **Separate retrieval failures from ranking failures.** Try a reranker when support already enters the candidate pool; test a graph when distributed support never enters it; test hierarchy units when local neighbors cannot locate the required event region.
6. **Keep costs and comparisons auditable.** Record source/model/configuration versions, candidate and final budgets, stage timings, and each model-call class. Compare extensions with a frozen held-out set and equal final evidence budgets. For separate final-QA evaluation, also freeze the reader, tokenizer, prompt, decoding settings, and output budget; count the final context after closure/deduplication without adding a tokenizer dependency to the initial byte-bounded core.

These are traceability and evaluation improvements to the existing plan. They do not turn the initial library into a full Zero-Mem reproduction, add a required reader, or justify importing reference code or prompts.
