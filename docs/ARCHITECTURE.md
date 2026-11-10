# Architecture

## Scope and Status

one-mem is an independent TypeScript implementation informed by Zero-Mem. Only the package bootstrap exists today. Every runtime component below is a proposed design; this document does not describe an implemented API.

Use one package and a shared TypeScript core for Node.js and Bun. Isolate runtime-specific SQLite loading in small driver modules. Add modules when their first behavior is implemented, rather than creating empty subsystem directories.

## Reference Findings

The inspected Python reference orchestrates indexing, query profiling, graph and temporal retrieval, evidence selection, and a final reader through mixins. It persists embeddings in Parquet, graph data in GraphML, and supporting metadata in JSON. Its graph path uses entity activation and personalized PageRank; dense retrieval provides a fallback when query entities are unavailable.

These observations guide independent design, not line-by-line translation. SQLite storage and the TypeScript component boundaries are one-mem choices. English-specific heuristics and model choices require separate evaluation before claiming comparable behavior.

## Proposed Data Flow

```text
Text + source/session metadata
  -> validation and stable record identity
  -> embeddings and entity extraction
  -> SQLite: original passages + derived vectors/entities/edges/time metadata

Query
  -> embedding + deterministic query analysis
  -> dense retrieval / entity graph / temporal context
  -> ranking, fusion, and bounded evidence selection
  -> evidence with source references
  -> optional final LLM reader
```

The first functional milestone ends at persistent dense retrieval. Graph and temporal retrieval follow separately, then fusion. A reader must not be required to retrieve evidence.

## Component Boundaries

| Area | Responsibility | Initial location when implemented |
| --- | --- | --- |
| Public entry | Export the supported API | `src/index.ts` |
| Storage | Open connections, migrations, transactions, vector queries | `src/storage/` |
| Ingestion | Validate records, preserve provenance, build derived views | `src/ingestion/` |
| Retrieval | Dense ranking, graph traversal, temporal expansion, fusion | `src/retrieval/` |
| Evidence | Deduplicate and bound context while retaining citations | `src/evidence/` |
| Reader | Optional final QA using selected evidence | `src/reader/` |

Start with concrete storage operations shared by two thin driver modules, not a general database plugin framework. Introduce embedding and entity-extraction contracts with the first caller. No embedding model, NER package, or LLM provider has been selected.

## Storage Invariants

- Original text and explicit source/session/speaker/order metadata remain authoritative. Derived units retain references to their originals.
- Identical text from different sources must not lose provenance through deduplication.
- Persist schema version, embedding model identity, vector dimension, and distance metric. Reject incompatible vectors before writes or queries.
- Commit a passage and its derived records atomically; failures must not leave partial indexes.
- Define namespace isolation, update/delete behavior, and migrations before exposing a durable public API.
- Use parameterized SQL and configured extension paths. Never load arbitrary extensions supplied with ingested content.

The relational schema is intentionally deferred until the SQLite compatibility milestone validates the required operations.

## Runtime Boundary

Proposed drivers are `better-sqlite3` under Node.js and `bun:sqlite` under Bun. Shared code must not eagerly import Bun-only modules when running in Node.js. Both drivers should use the same SQL and `sqlite-vec` representation, with tests checking equivalent results and persistence.

macOS Bun extension loading needs a custom SQLite library selected before opening any connection. See [limitations](LIMITATIONS.md) for platform constraints and [decisions](DECISIONS.md) for alternatives.

## Sources

- [Paper](https://arxiv.org/abs/2607.29377), Yilin Xiao et al., 2026.
- Reference at `e1b2f8ef98a3d023478ddb2049aba11753296d42`: [orchestration](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/ZeroMem.py#L22), [indexing](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L417), [embedding storage](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/embedding_store.py#L23), [graph retrieval](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L256), [reader](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/reader.py#L1006).
