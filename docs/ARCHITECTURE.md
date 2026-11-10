# Architecture

## Scope and Status

one-mem is an independent TypeScript implementation informed by Zero-Mem. Only the package bootstrap exists today. Every runtime component below is a proposed design; this document does not describe an implemented API.

Use one package and a shared TypeScript core for Node.js and Bun. Start with the same better-sqlite3 integration in both runtimes; introduce a second driver only if compatibility or measured benefits justify it. The [reference analysis](REFERENCE_ANALYSIS.md) records what to retain and change; the [implementation plan](IMPLEMENTATION_PLAN.md) defines the recommended contracts, tasks, and verification gates.

## Reference Findings

The inspected Python reference orchestrates indexing, query profiling, graph and temporal retrieval, evidence selection, and a final reader through mixins. It persists embeddings in Parquet, graph data in GraphML, and supporting metadata in JSON. Its graph path uses entity activation and personalized PageRank; dense retrieval provides a fallback when query entities are unavailable.

These observations guide independent design, not line-by-line translation. In particular, reference graph activation variants differ, numeric passage adjacency does not establish temporal relationships, and overlapping hierarchy units can duplicate evidence. SQLite storage, rank fusion, and explicit metadata are one-mem choices. Graphs, English-specific heuristics, and model choices require separate evaluation before adoption.

## Proposed Data Flow

```text
Text + source/session metadata
  -> validation and stable record identity
  -> caller-supplied embedding provider
  -> atomic SQLite write: original record + vector + FTS5 index

Query
  -> embedding + safe lexical terms + explicit metadata filters
  -> vector candidates + FTS5 candidates
  -> reciprocal rank fusion
  -> bounded same-source/session neighbors + evidence selection
  -> evidence with source references
  -> optional final LLM reader
```

The first useful retrieval release combines dense and lexical evidence. Dense search alone is an internal milestone and evaluation baseline. A reader must not be required to retrieve evidence. Entity graphs, NER, stored windows/episodes, and cross-encoder reranking are experiments with explicit promotion gates, not prerequisites.

## Component Boundaries

| Area | Responsibility | Initial location when implemented |
| --- | --- | --- |
| Public entry | Export the supported API | `src/index.ts` |
| Storage | Open connections, migrations, atomic records/vectors/FTS updates | `src/storage.ts` |
| Ingestion | Validate records and vectors, preserve provenance | `src/memory.ts`, `src/embeddings.ts` |
| Retrieval | Filter before top-k, rank vectors and lexical matches, fuse ranks | `src/retrieval.ts` |
| Evidence | Expand scoped neighbors, deduplicate, enforce an explicit budget | `src/evidence.ts` |
| Reader | Optional final QA using selected evidence | Separate follow-up after retrieval evaluation |

Start with concrete storage operations and one driver, without a general database plugin framework. The initial provider contract covers document/query embedding and stable embedding-space identity; it does not choose a model runtime. No NER package or LLM provider is required. Follow the plan's file map as components are implemented; the table above is a responsibility map, not a request to create empty directories.

## Storage Invariants

- Original text and explicit source/session/speaker/order metadata remain authoritative. Derived units retain references to their originals.
- Identical text from different sources must not lose provenance through deduplication.
- Persist schema version, embedding-space identity, vector dimension, and distance metric. Reject incompatible, nonfinite, and zero-norm vectors before writes or queries.
- Compute embeddings before entering synchronous transactions. Commit a record and its vector/FTS changes atomically; failures must not leave partial indexes.
- Recommend one namespace and embedding space per database initially. This isolates FTS corpus statistics; multiple namespaces require separate files, and cross-namespace queries are outside the initial API.
- Apply source/session filters before each branch selects top-k. Fuse ranks, not incomparable raw cosine and BM25 scores.
- Define update/delete behavior and migrations before exposing a durable public API.
- Use parameterized SQL and configured extension paths. Never load arbitrary extensions supplied with ingested content.

The [implementation plan](IMPLEMENTATION_PLAN.md) proposes the relational schema and lifecycle semantics. Inline vector BLOBs with exact filtered distance search are the simpler baseline; benchmark `vec0` at realistic corpus sizes before selecting a more complex index layout. Neither approach should be described as approximate nearest-neighbor search.

## Runtime Boundary

An isolated macOS ARM64 probe verified better-sqlite3 13.0.3 and sqlite-vec 0.1.9 under Node.js 22.23.3 and Bun 1.4.4, including files exchanged between runtimes. This supports one shared driver as the initial recommendation. It does not replace Windows/Linux/macOS x64 CI or tests of the eventual package implementation.

If `bun:sqlite` is later adopted, its macOS extension loading needs a custom SQLite library selected before any connection opens; shared code must not eagerly import Bun-only modules in Node.js. See [limitations](LIMITATIONS.md) for platform constraints and [decisions](DECISIONS.md) for alternatives.

## Sources

- [Paper](https://arxiv.org/abs/2607.29377), Yilin Xiao et al., 2026.
- Reference at `e1b2f8ef98a3d023478ddb2049aba11753296d42`: [orchestration](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/ZeroMem.py#L22), [indexing](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L417), [embedding storage](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/embedding_store.py#L23), [graph retrieval](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L256), [reader](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/reader.py#L1006).
