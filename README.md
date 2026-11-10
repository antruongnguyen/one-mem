# one-mem

An independent TypeScript implementation inspired by [Zero-Mem: Zero-Token Memory Operations for LLM Agents](https://arxiv.org/pdf/2607.29377), targeting Node.js and Bun with SQLite and [sqlite-vec](https://alexgarcia.xyz/sqlite-vec/js.html).

**Status: Phase 0 — native storage foundation.** The package has an internal shared SQLite connection and reproducible compatibility tests. The entry point has no public API yet. Durable memory ingestion, retrieval, and final question answering remain planned.

## Direction

Build a local, persistent memory system whose indexing and retrieval do not call a generative LLM. Preserve original passages and their provenance, combine vector and lexical retrieval, and expand context using explicit session metadata. Entity graphs and richer temporal structures are optional experiments that must outperform this baseline before adoption. An optional final reader may call an LLM using retrieved evidence.

“Zero-token” does not mean zero embedding cost, computation, storage, or final-reader cost. This project does not claim to reproduce the paper's benchmark results.

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

The suites use the same compiled `node:test` fixtures with Node's test runner and Bun's `bun test` runner. Install both runtimes: persistence tests exchange database files through child processes and fail if the other runtime is unavailable. The last two commands check that the empty public entry point loads; they produce no output. The package remains private, with no application server or CLI. Commit `bun.lock` when changing dependencies.

## Runtime and Storage Targets

| Runtime | Pinned shared driver | Extension |
| --- | --- | --- |
| Node.js | `better-sqlite3` 13.0.3 | `sqlite-vec` 0.1.9 |
| Bun | `better-sqlite3` 13.0.3 | `sqlite-vec` 0.1.9 |

Internal storage uses this single driver, loads sqlite-vec, preserves bigint row keys, enables foreign keys and a 5,000 ms busy timeout, and uses WAL for local file databases. Native loading failures preserve their cause and do not fall back to lexical search. Inline vector BLOBs with filtered scalar cosine queries are the baseline; fixture schemas are not a durable memory format.

CI is configured for Windows x64, Linux glibc x64/ARM64, and macOS x64/ARM64. Configuration alone is not verified support; see [limitations](docs/LIMITATIONS.md) for actual evidence. Windows ARM64 is excluded. See [benchmarks](docs/BENCHMARKS.md) for existing layout comparisons and the reproducible file-backed Phase 0 measurement.

## Repository Map

- `src/` — TypeScript source; internal storage and an empty public entry point.
- `dist/` — generated JavaScript and declarations, ignored by Git.
- `tests/` — native compatibility fixtures; compiled into ignored `.test-dist/`.
- `scripts/` — shared test launcher and file-backed storage benchmark.
- [Architecture](docs/ARCHITECTURE.md) — proposed components, data flow, and invariants.
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
