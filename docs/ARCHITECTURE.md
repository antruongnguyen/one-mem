# Architecture

## Scope and Status

one-mem is an independent TypeScript implementation informed by Zero-Mem. Phase 0 established internal `openStorage(path)` and native compatibility fixtures. Phase 1 adds a private, experimental version-1 schema and the `openMemory`, `upsert`, `get`, `remove`, and `close` lifecycle. Phase 2 adds scoped dense and lexical retrieval through `search`, with rank-fused whole-record evidence under a UTF-8 text-byte budget. Phase 3 adds optional bounded session-neighbor context under that same budget without changing schema version 1 or adding dependencies. Neither the API nor schema has a stable cross-release compatibility promise. Readers and graph retrieval remain separate, evaluation-gated follow-ups.

Use one package and a shared TypeScript core for Node.js and Bun. Both runtimes use pinned better-sqlite3 13.0.3 with sqlite-vec 0.1.9. The [reference analysis](REFERENCE_ANALYSIS.md) records what to retain and change; the [implementation plan](IMPLEMENTATION_PLAN.md) defines the recommended contracts, tasks, and verification gates.

## Paper-Informed Boundaries

The [paper analysis](PAPER_ANALYSIS.md) separately examines the supplied v1 manuscript. Its dual views are an entity-context graph and a temporal hierarchy; lexical and dense retrieval are access signals within that system, not substitutes for those two structures. The paper uses query-conditioned, normalized-score fusion; one-mem's RRF is an independent baseline choice ([method, pp. 3-4](https://arxiv.org/pdf/2607.29377v1#page=3)).

The paper's ablation supports complementary structural evidence on its evaluated multi-hop workload. Keep graph retrieval with bounded relational support as the first structural follow-up to evaluate when hybrid plus neighbors misses distributed evidence. Do not assume that simpler retrieval preserves the full model's quality, or adopt the paper's thresholds as validated one-mem defaults ([Figure 3, p. 7](https://arxiv.org/pdf/2607.29377v1#page=7)).

Separate primary matches, expanded support, and final evidence when evaluating retrieval. The paper's top-k counts primary candidates before closure. Compare final evidence at equal byte budgets in the core; later reader comparisons also fix tokenizer, final prompt-token budget, reader, and prompt. Provenance and scope constraints must hold after every expansion, not only for initial matches.

## Reference Findings

The inspected Python reference orchestrates indexing, query profiling, graph and temporal retrieval, evidence selection, and a final reader through mixins. It persists embeddings in Parquet, graph data in GraphML, and supporting metadata in JSON. Its graph path uses entity activation and personalized PageRank; dense retrieval provides a fallback when query entities are unavailable.

These observations guide independent design, not line-by-line translation. In particular, reference graph activation variants differ, numeric passage adjacency does not establish temporal relationships, and overlapping hierarchy units can duplicate evidence. SQLite storage, rank fusion, and explicit metadata are one-mem choices. Graphs, English-specific heuristics, and model choices require separate evaluation before adoption.

## Phase 1 Record Lifecycle

```text
Open path + namespace + embedding space
  -> schema-v1 initialization or ownership/settings validation

Text + source/session metadata
  -> validation and revision snapshot
  -> injected document embedding provider
  -> atomic SQLite write: record + normalized vector BLOB + FTS5 index
  -> per-ID revision/status returned by upsert; full record returned by get
```

The database owns one namespace and one embedding space. The provider declares a nonempty stable space ID, a safe integer dimension from 1 through 8192, and cosine distance. Open-time checks reject namespace or embedding-space mismatches. Record validation, provider outputs, record replacements, vector BLOBs, and FTS5 maintenance are coordinated so failed batches do not leave partial writes. Embedding work happens outside synchronous SQLite transactions; a per-handle operation queue serializes lifecycle calls, and revision checks detect conflicting changes from another handle.

The caller assigns a new ID to each observed statement or event. `upsert` with an existing ID is an explicit correction or replacement of that same source record: it assigns a new UUID revision, while unchanged input keeps its revision. Previous content is not archived. Preserve separate IDs for conflicting observations; timestamps do not imply a latest-wins policy.

`close()` stops accepting operations, drains those already accepted, and closes the connection once. Repeated close calls are allowed; later lifecycle calls fail with `CLOSED`. `MemoryError` exposes stable error codes for input, embedding, database, conflict, availability, busy, and closed conditions while retaining causes. SQLite I/O/corruption errors remain actionable rather than becoming empty results.

## Phase 2 Hybrid Search and Evidence

The public search call is `search(query, { sourceId?, sessionId?, limit?, maxEvidenceBytes?, neighbors?, signal? })`. `sessionId` requires `sourceId`. `limit` defaults to 10 and accepts safe integers from 1 through 100; it counts selected matches. `maxEvidenceBytes` defaults to 16,384 and accepts a nonnegative safe integer for the UTF-8 text-byte budget of all returned match and context records. `neighbors` defaults to 0 and accepts safe integers from 0 through 2, defining a radius on each side of a selected match.

Search validates the query and options, checks cancellation and provider embedding-space compatibility, then checks for eligible rows. If no records qualify under the scope filters, it returns empty evidence without embedding the query. Otherwise the existing injected provider receives the query with `purpose: "query"` and the optional abort signal. The provider descriptor is checked against the frozen embedding-space snapshot before and after provider work, and validated vectors use the same normalization contract as document embeddings. Embedding work stays outside synchronous SQLite transactions. After inference, candidate ranks, current records, context neighbors, and detached evidence are materialized in one synchronous read transaction. Writes or metadata moves during inference are visible in that later snapshot; changes after it only affect later searches. Search participates in the per-handle operation queue, so accepted calls drain before `close()` completes.

Both ranking branches apply source/session filters before candidate limits. Each branch returns up to `min(500, max(50, 5 * limit))` candidates. Dense retrieval orders by filtered scalar cosine distance ascending. FTS5 uses `bm25` ascending over input compiled into at most 32 distinct Unicode letter/number/underscore tokens; each token is quoted as a literal phrase, and terms are joined with `OR`. Raw query syntax never reaches `MATCH`. Punctuation-only queries have no lexical candidates but may still return dense matches. This tokenizer preserves accents but is not a Vietnamese word segmenter or a complete code-symbol analyzer.

Each branch assigns one-based ranks, with caller ID breaking ties. Reciprocal rank fusion sorts by score descending, then caller ID ascending, using `RRF(id) = Σ 1 / (60 + branchRank(id))`. Missing branch hits contribute no rank. Match evidence exposes the original record and its source/revision provenance, role, RRF score, and available dense/lexical ranks. Diagnostics report dense and lexical candidate counts, lexical term count and truncation, returned text bytes, and budget omissions.

Evidence selection keeps records whole and follows fused match order. It selects matches first, skipping a record that does not fit and continuing until the match limit is reached or candidates end. Text is never silently truncated. Deduplication is by record ID so identical text from independent sources retains provenance. `usedBytes` is the sum of `TextEncoder().encode(record.text).byteLength` for every returned record. Record metadata, the query, prompt syntax, and model-token counts are outside this budget.

## Phase 3 Bounded Session Context

Context expands only the selected matches, with `neighbors` consecutive sequence values on either side of each one. The neighbor must have the exact same source and session. A missing session/order means no context, and an absent sequence value stops that direction's walk; timestamps never establish sequence order. A present neighbor still establishes continuity if its text does not fit the byte budget. Expansion is not recursive. Since `limit` counts selected matches, returned items can exceed it after context is added.

Matches have byte priority. After all selected matches are considered, fitting context records are appended in selected-match rank, then ascending sequence, then UTF-8 binary ID order. Each ID appears once; when context is shared, it keeps its first position and its `anchorIds` list contains the responsible selected match IDs in match-rank order, deduplicated. Every match has `anchorIds: []`; context has `score: null` and `ranks: {}`. `budgetOmitted` counts distinct IDs skipped for bytes once across match and context selection. Context uses only remaining bytes and cannot push `usedBytes` above `maxEvidenceBytes`.

The expansion reads current source/session/sequence metadata on each search, so changing or deleting a turn affects the next search without a rebuild. Returned records remain detached snapshots with their revisions and supplied `observedAt` and `eventAt` values; neither timestamp is reinterpreted as the other.

The Phase 0 100,000-record unfiltered and 50%-selected synthetic warm-hybrid cases missed the provisional p95 threshold; representative workload and budget validation remain open. Phases 2 and 3 add no performance experiment or capacity claim. Continuing to retrieval does not freeze a production format. Inline normalized vector BLOBs with filtered scalar cosine remain the baseline.

## Component Boundaries

| Area | Responsibility | Initial location when implemented |
| --- | --- | --- |
| Public entry | Expose the private lifecycle, search, and evidence types | `src/index.ts`, `src/types.ts` |
| Storage | Initialize and validate version-1 settings; atomically maintain records, vector BLOBs, and FTS5 | `src/storage.ts` |
| Ingestion | Validate provider and record data, preserve provenance revisions | `src/memory.ts`, `src/embeddings.ts` |
| Retrieval | Scoped dense/lexical candidates, literal query compilation, branch ranks, and RRF | `src/retrieval.ts`, `src/memory.ts` |
| Evidence | Whole-record match priority, bounded session neighbors, byte budget, and match provenance | `src/evidence.ts` |
| Reader | Optional final QA using selected evidence | Separate follow-up after retrieval evaluation |

Keep concrete storage operations and one driver, without a general database plugin framework. The provider contract is injected and does not choose a model runtime; Phase 2 uses that provider for query embeddings as well as document embeddings. Phase 1 includes no retrieval API, and Phase 2 adds no NER package or LLM provider. Follow the plan's file map as components are implemented; the table above is a responsibility map, not a request to create empty directories.

## Storage Invariants

- Original text and explicit source/session/speaker/order metadata remain authoritative. Derived units retain references to their originals.
- New observations receive new trace IDs, including statements that update an earlier fact. Upsert corrects or replaces the same source record; it is not a fact-merging policy or an archive of prior revisions. Preserve conflicting statements and their times instead of silently applying a latest-wins rule.
- Identical text from different sources must not lose provenance through deduplication.
- Persist schema version 1, namespace, embedding-space ID, vector dimension, cosine metric, and vector encoding. Reject incompatible spaces and invalid, nonfinite, or zero-norm provider vectors before writes.
- Compute embeddings before entering synchronous transactions. Commit a record and its normalized vector BLOB/FTS changes atomically; failures must not leave partial indexes.
- Each database owns one namespace and embedding space. This isolates FTS corpus statistics; multiple namespaces require separate files, and cross-namespace operations are outside the current API.
- Serialize lifecycle operations per handle, drain accepted work on close, and compare revisions before committing across-handle updates.
- Initialize schema version 1 only for an empty database, validate namespace and embedding settings before persistent WAL setup, and reject unsupported or foreign schemas without modifying them.
- Use parameterized SQL and configured extension paths. Never load arbitrary extensions supplied with ingested content.

The [implementation plan](IMPLEMENTATION_PLAN.md) defines lifecycle and retrieval semantics. Phases 2 and 3 own no schema migration: they use the private version-1 schema and retain inline vector BLOBs. Phase 3 adds no dependency or performance experiment. The 100,000-record broad / 50%-selective synthetic warm-hybrid performance gate remains open; retrieval does not freeze a production schema. Only local macOS ARM64 native execution is verified; configured CI lanes are not verification evidence. Neither scalar cosine nor `vec0` should be described as approximate nearest-neighbor search.

## Runtime Boundary

The internal connection enables safe bigint integers, foreign keys, and a 5,000 ms busy timeout. Phase 1 validates schema ownership/version before enabling persistent WAL, so a rejected database is not changed by the open path. It loads sqlite-vec before returning and closes on initialization failure. `src/storage.ts` now owns the durable tables and lifecycle SQL; Phase 0 compatibility fixtures remain for native driver checks. Native availability errors retain their cause; ordinary filesystem and SQLite operational errors remain actionable.

Package fixtures verify the shared driver locally on macOS ARM64 with Node.js 22.23.3 and Bun 1.4.4, including file exchange in both directions. Configured Windows/Linux/macOS x64 lanes have not been executed by this local task. See [limitations](LIMITATIONS.md).

If `bun:sqlite` is later adopted, its macOS extension loading needs a custom SQLite library selected before any connection opens; shared code must not eagerly import Bun-only modules in Node.js. See [limitations](LIMITATIONS.md) for platform constraints and [decisions](DECISIONS.md) for alternatives.

## Sources

- [Paper, v1](https://arxiv.org/pdf/2607.29377v1), Yilin Xiao et al., 2026; see [paper analysis](PAPER_ANALYSIS.md) for page-level evidence and experimental limits.
- Reference at `e1b2f8ef98a3d023478ddb2049aba11753296d42`: [orchestration](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/ZeroMem.py#L22), [indexing](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L417), [embedding storage](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/embedding_store.py#L23), [graph retrieval](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L256), [reader](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/reader.py#L1006).
