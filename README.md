# one-mem

An independent TypeScript implementation inspired by [Zero-Mem: Zero-Token Memory Operations for LLM Agents](https://arxiv.org/pdf/2607.29377), targeting Node.js and Bun with SQLite and [sqlite-vec](https://alexgarcia.xyz/sqlite-vec/js.html).

**Status: Phase 3 — scoped hybrid search and bounded session context.** The private package provides `openMemory`, `upsert`, `get`, `remove`, `search`, and `close`, backed by an experimental version-1 schema. The API requires an injected cosine embedding provider. Search can add up to two consecutive records on either side of selected matches from the same source and session. Matches retain priority under the existing whole-record UTF-8 text-byte budget. The API and schema have no stable cross-release compatibility promise; Phase 3 does not change schema version 1. Graph retrieval, a reader, and retrieval-quality claims remain evaluation-gated.

## Direction

The longer-term direction is a local, persistent memory system whose indexing and retrieval do not call a generative LLM. Phase 2 combines scoped scalar cosine ranking with FTS5 lexical ranking; Phase 3 can expand selected matches to nearby session records within the same text-byte budget. An optional final reader remains a later phase. Entity graphs and richer temporal structures are experiments that require evaluation before adoption.

“Zero-token” does not mean zero embedding cost, computation, storage, or final-reader cost. This project does not claim to reproduce the paper's benchmark results.

## Record Lifecycle

After `bun run build`, this example can run from a TypeScript file in the repository root. It demonstrates deterministic injected document and query embeddings, and returns evidence without a network call or generative model.

```ts
import { openMemory } from "./dist/index.js";

const vectors = new Map<string, Float32Array>([
  ["red apple", new Float32Array([1, 0])],
  ["blue ocean", new Float32Array([0, 1])],
  ["green leaf", new Float32Array([-1, 0])],
]);
const embeddings = {
  space: { id: "demo-v1", dimensions: 2, metric: "cosine" as const },
  async embed(texts: readonly string[], options: { purpose: "document" | "query"; signal?: AbortSignal }) {
    options.signal?.throwIfAborted();
    if (options.purpose === "query") return texts.map(() => new Float32Array([1, 0]));
    return texts.map(text => {
      const vector = vectors.get(text);
      if (!vector) throw new Error(`No demo vector for ${text}`);
      return vector;
    });
  },
};

const memory = await openMemory({
  path: "./demo.sqlite",
  namespace: "example",
  embeddings,
});
try {
  await memory.upsert([
    { id: "turn-1", sourceId: "notes", sessionId: "day1", sequence: 1, text: "blue ocean" },
    { id: "turn-2", sourceId: "notes", sessionId: "day1", sequence: 2, text: "red apple" },
    { id: "turn-3", sourceId: "notes", sessionId: "day1", sequence: 3, text: "green leaf" },
  ]);
  const evidence = await memory.search("apple", {
    sourceId: "notes",
    sessionId: "day1",
    limit: 1,
    neighbors: 1,
  });
  console.log(evidence.items.map(({ record, role }) => ({
    id: record.id,
    role,
    text: record.text,
  })));
  // [{ id: "turn-2", role: "match", text: "red apple" },
  //  { id: "turn-1", role: "context", text: "blue ocean" },
  //  { id: "turn-3", role: "context", text: "green leaf" }]
} finally {
  await memory.close();
}
```

`search(query, { sourceId?, sessionId?, limit?, maxEvidenceBytes?, neighbors?, signal? })` embeds the query with `purpose: "query"`. A session filter requires a source filter. The default `limit` is 10 selected matches, and the accepted range is 1–100. `neighbors` defaults to 0 and accepts integers from 0 through 2, applying that radius on each side of a selected match. Expansion follows consecutive sequence values only within the exact same source and session; an ordinal gap stops the walk. Timestamps do not establish order, and only selected matches expand. `maxEvidenceBytes` defaults to 16,384 and counts only the UTF-8 bytes of complete returned record texts, including context; it does not count metadata, prompts, or model tokens. Matches are selected before context and have byte priority. Oversized records are skipped whole, and later smaller records may still fit; context can make the returned item count exceed `limit`.

Each match retains its source-bearing record, revision, dense and lexical ranks when present, and RRF score. Context records retain their own source and revision provenance; context shared by selected matches keeps attribution to those matches and appears only once. Evidence diagnostics report branch candidate counts, lexical terms used and whether token extraction was truncated, bytes used, and distinct records omitted by the evidence budget. Search filters are applied before each ranking branch's candidate cap. Dense candidates use scalar cosine distance; lexical input is compiled into up to 32 distinct Unicode letter/number/underscore tokens as literal FTS5 phrases. Punctuation-only queries can still use dense retrieval. Reciprocal rank fusion uses constant 60. An empty eligible corpus returns empty evidence without calling the query provider. Cancellation, embedding-space validation, and per-handle operation queuing follow the same lifecycle rules as writes.

Matches, their adjacent context, and detached evidence are materialized in one read transaction after query embedding. Updates, deletes, or source/session/sequence moves take effect on the next search; already returned items keep their revision and supplied timestamps. Phase 3 adds no schema or dependency and makes no graph, reader, multilingual retrieval-quality, or production-capacity claim. The Phase 0 performance gate remains open; this phase adds no new performance experiment.

Use a new record ID for each observation so conflicting statements remain separately attributable. Reuse an ID only to explicitly correct that same source record; its replacement gets a new revision, and the old content is not retained.

## Development

Use Node.js 22 or newer and Bun 1.4 or newer. Local verification uses macOS ARM64, Node.js 22.23.3, and Bun 1.4.4. Other versions and platforms require their own native results. Bun manages dependencies; generated ES modules run in either runtime. Keep optional dependencies enabled: sqlite-vec distributes its platform binaries through optional packages.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run test:build
bun run test:node
bun run test:bun
node dist/index.js
bun dist/index.js
```

The suites use the same compiled `node:test` fixtures with Node's test runner and Bun's `bun test` runner. Install both runtimes: persistence tests exchange database files through child processes and fail if the other runtime is unavailable. The last two commands check that the public entry module loads; they produce no output. The package remains private, with no application server or CLI. Commit `bun.lock` when changing dependencies.

## Runtime and Storage Targets

| Runtime | Pinned shared driver | Extension |
| --- | --- | --- |
| Node.js | `better-sqlite3` 13.0.3 | `sqlite-vec` 0.1.9 |
| Bun | `better-sqlite3` 13.0.3 | `sqlite-vec` 0.1.9 |

Internal storage uses this single driver, loads sqlite-vec, preserves bigint row keys, enables foreign keys and a 5,000 ms busy timeout, and uses WAL for local file databases. Native loading failures preserve their cause. Phase 1 stores records, normalized vector BLOBs, and FTS5 entries in one private versioned schema; namespace and embedding-space settings are checked when opening it. Phase 0 compatibility fixtures remain for native driver checks, while durable schema ownership now belongs to storage. The schema is experimental and does not promise compatibility across releases.

CI is configured for Windows x64, Linux glibc x64/ARM64, and macOS x64/ARM64. Configuration alone is not verified support; see [limitations](docs/LIMITATIONS.md) for actual evidence. Windows ARM64 is excluded. See [benchmarks](docs/BENCHMARKS.md) for existing layout comparisons and the reproducible file-backed Phase 0 measurement.

## Repository Map

- `src/` — TypeScript source; private record lifecycle and internal SQLite storage.
- `dist/` — generated JavaScript and declarations, ignored by Git.
- `tests/` — native compatibility, ingestion, input, lifecycle, retrieval, and evidence fixtures; compiled into ignored `.test-dist/`.
- `scripts/` — shared test launcher and file-backed storage benchmark.
- [Architecture](docs/ARCHITECTURE.md) — record lifecycle, hybrid retrieval, evidence bounds, and storage invariants.
- [Reference analysis](docs/REFERENCE_ANALYSIS.md) — lessons from Zero-Mem and alternatives.
- [Paper analysis](docs/PAPER_ANALYSIS.md) — paper findings, experimental limits, and implications for one-mem.
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) — recommended design, tasks, and acceptance checks.
- [Decisions](docs/DECISIONS.md) — accepted constraints and provisional choices.
- [TODO](docs/TODO.md) — ordered milestones with completion checks.
- [Limitations](docs/LIMITATIONS.md) — current gaps and compatibility caveats.
- [Repository guidelines](AGENTS.md) — contributor and agent instructions.
- [Changelog](CHANGELOG.md) — project changes.

## Acknowledgements

We thank Yilin Xiao, Zhehan Zhu, Yujing Zhang, Jin Chen, Zijin Hong, Luyao Zhuang, Qinggang Zhang, Shengyuan Chen, Xiaocao Ouyang, Lingfei Ren, and Xiao Huang for the research and ideas behind Zero-Mem. Their work on preserving original interaction traces, combining relational and temporal evidence, and avoiding generative memory operations informs one-mem's architecture and evaluation. one-mem is an independent implementation and does not claim the paper's results.

## Reference and License

The sibling `../zero-mem` checkout is reference-only. It is not required to install, build, or run this project. Research used [Zero-Mem/Zero-mem](https://github.com/Zero-Mem/Zero-mem) at commit `e1b2f8ef98a3d023478ddb2049aba11753296d42`; its Python implementation uses Parquet, GraphML, and JSON rather than SQLite.

Independently authored one-mem material is licensed under [MIT](LICENSE). No license file was found in the inspected reference commit. Do not copy its code, prompts, or assets without establishing the applicable rights. This license does not cover third-party papers, datasets, models, or reference material.
