# Architecture

## Scope and Status

one-mem is an independent TypeScript implementation informed by Zero-Mem. Phase 0 established internal `openStorage(path)` and native compatibility fixtures. Phase 1 adds a private, experimental version-1 schema and the `openMemory`, `upsert`, `get`, `remove`, and `close` lifecycle. Durable record writes are functional, but neither the API nor the schema has a stable cross-release compatibility promise. Search, scope filters, evidence, neighbors, and readers are not part of this phase.

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

Retrieval remains a later phase. The planned dense + FTS5 rank fusion, explicit scope, byte-bounded evidence, session neighbors, and optional reader do not describe current product behavior. The Phase 0 100,000-record unfiltered and 50%-selected synthetic warm-hybrid cases missed the provisional p95 threshold; representative workload and budget validation remain open. Continuing to this schema phase does not freeze a production format or establish capacity claims. Inline normalized vector BLOBs with filtered scalar cosine remain the baseline.

## Component Boundaries

| Area | Responsibility | Initial location when implemented |
| --- | --- | --- |
| Public entry | Expose the private Phase 1 lifecycle and types | `src/index.ts`, `src/types.ts` |
| Storage | Initialize and validate version-1 settings; atomically maintain records, vector BLOBs, and FTS5 | `src/storage.ts` |
| Ingestion | Validate provider and record data, preserve provenance revisions | `src/memory.ts`, `src/embeddings.ts` |
| Retrieval | Planned dense/lexical ranking and rank fusion | Later phase |
| Evidence | Planned bounded evidence and session neighbors | Later phase |
| Reader | Optional final QA using selected evidence | Separate follow-up after retrieval evaluation |

Keep concrete storage operations and one driver, without a general database plugin framework. The current provider contract is injected and uses document embeddings; it does not choose a model runtime. No NER package, query embedding path, retrieval API, or LLM provider is included in Phase 1. Follow the plan's file map as later components are implemented; the table above is a responsibility map, not a request to create empty directories.

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

The [implementation plan](IMPLEMENTATION_PLAN.md) defines lifecycle semantics and later retrieval phases. Phase 1 owns a private version-1 schema and retains inline vector BLOBs. The 100,000-record broad / 50%-selective synthetic warm-hybrid performance gate remains open; Phase 1 does not freeze a production schema. Neither scalar cosine nor `vec0` should be described as approximate nearest-neighbor search.

## Runtime Boundary

The internal connection enables safe bigint integers, foreign keys, and a 5,000 ms busy timeout. Phase 1 validates schema ownership/version before enabling persistent WAL, so a rejected database is not changed by the open path. It loads sqlite-vec before returning and closes on initialization failure. `src/storage.ts` now owns the durable tables and lifecycle SQL; Phase 0 compatibility fixtures remain for native driver checks. Native availability errors retain their cause; ordinary filesystem and SQLite operational errors remain actionable.

Package fixtures verify the shared driver locally on macOS ARM64 with Node.js 22.23.3 and Bun 1.4.4, including file exchange in both directions. Configured Windows/Linux/macOS x64 lanes have not been executed by this local task. See [limitations](LIMITATIONS.md).

If `bun:sqlite` is later adopted, its macOS extension loading needs a custom SQLite library selected before any connection opens; shared code must not eagerly import Bun-only modules in Node.js. See [limitations](LIMITATIONS.md) for platform constraints and [decisions](DECISIONS.md) for alternatives.

## Sources

- [Paper, v1](https://arxiv.org/pdf/2607.29377v1), Yilin Xiao et al., 2026; see [paper analysis](PAPER_ANALYSIS.md) for page-level evidence and experimental limits.
- Reference at `e1b2f8ef98a3d023478ddb2049aba11753296d42`: [orchestration](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/ZeroMem.py#L22), [indexing](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L417), [embedding storage](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/embedding_store.py#L23), [graph retrieval](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L256), [reader](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/reader.py#L1006).
