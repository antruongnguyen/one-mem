# one-mem

An independent TypeScript implementation inspired by [Zero-Mem: Zero-Token Memory Operations for LLM Agents](https://arxiv.org/pdf/2607.29377), targeting Node.js and Bun with SQLite and [sqlite-vec](https://alexgarcia.xyz/sqlite-vec/js.html).

**Status: Phase 1 — durable record lifecycle.** The private package now provides `openMemory`, `upsert`, `get`, `remove`, and `close`, backed by an experimental version-1 schema. The API requires an injected cosine embedding provider. Durable writes work, but the API and schema do not have a stable cross-release compatibility promise. Search, scope filters, evidence, neighbors, and reader APIs are planned later phases.

## Direction

The longer-term direction is a local, persistent memory system whose indexing and retrieval do not call a generative LLM. The current Phase 1 API stores records with provenance; later phases may add vector and lexical retrieval, explicit session context, and an optional final reader. Entity graphs and richer temporal structures are experiments that require evaluation before adoption.

“Zero-token” does not mean zero embedding cost, computation, storage, or final-reader cost. This project does not claim to reproduce the paper's benchmark results.

## Record Lifecycle

After `bun run build`, this example can run from a TypeScript file in the repository root. It demonstrates deterministic injected embeddings; it does not query or generate answers.

```ts
import { openMemory } from "./dist/index.js";

const vectors = new Map<string, Float32Array>([
  ["red apple", new Float32Array([1, 0])],
  ["blue ocean", new Float32Array([0, 1])],
]);
const embeddings = {
  space: { id: "demo-v1", dimensions: 2, metric: "cosine" as const },
  async embed(texts: readonly string[]) {
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
  await memory.upsert([{ id: "apple-1", sourceId: "notes", text: "red apple" }]);
  console.log(await memory.get("apple-1"));
} finally {
  await memory.close();
}
```

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
- `tests/` — native compatibility, ingestion, input, and lifecycle fixtures; compiled into ignored `.test-dist/`.
- `scripts/` — shared test launcher and file-backed storage benchmark.
- [Architecture](docs/ARCHITECTURE.md) — current record lifecycle, storage invariants, and later retrieval direction.
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
