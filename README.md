# one-mem

An independent TypeScript implementation inspired by [Zero-Mem: Zero-Token Memory Operations for LLM Agents](https://arxiv.org/pdf/2607.29377), targeting Node.js and Bun with SQLite and [sqlite-vec](https://alexgarcia.xyz/sqlite-vec/js.html).

**Status: project bootstrap.** The repository provides documentation and TypeScript build tooling. The entry point has no public API yet. Memory ingestion, retrieval, SQLite integration, and final question answering are planned, not implemented.

## Direction

Build a local, persistent memory system whose indexing and retrieval do not call a generative LLM. Preserve original passages and their provenance, combine vector and lexical retrieval, and expand context using explicit session metadata. Entity graphs and richer temporal structures are optional experiments that must outperform this baseline before adoption. An optional final reader may call an LLM using retrieved evidence.

“Zero-token” does not mean zero embedding cost, computation, storage, or final-reader cost. This project does not claim to reproduce the paper's benchmark results.

## Development

Use Node.js 22 or newer and Bun 1.4 or newer. The bootstrap is checked locally on macOS with Node.js 22.23.3 and Bun 1.4.4. Bun manages dependencies; generated ES modules run in either runtime.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
node dist/index.js
bun dist/index.js
```

The last two commands check that the currently empty entry point loads; they produce no output. There is no application server, CLI, or behavioral test suite yet. The package is private during development. Commit `bun.lock` when changing dependencies.

## Runtime and Storage Targets

| Runtime | Recommended initial driver | Extension |
| --- | --- | --- |
| Node.js | `better-sqlite3` | `sqlite-vec` |
| Bun | `better-sqlite3` | `sqlite-vec` |

These dependencies are not installed in the package yet. An isolated macOS ARM64 probe verified the shared driver in both runtimes, including extension loading and cross-runtime persistence. Windows x64 and Linux still require native tests; Windows ARM64 is outside project scope. Keep `bun:sqlite` as an alternative if compatibility or measurements justify a second driver. See [limitations](docs/LIMITATIONS.md).

## Repository Map

- `src/` — TypeScript source; currently an empty package entry point.
- `dist/` — generated JavaScript and declarations, ignored by Git.
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
