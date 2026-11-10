# one-mem

An independent TypeScript implementation inspired by [Zero-Mem: Zero-Token Memory Operations for LLM Agents](https://arxiv.org/abs/2607.29377), targeting Node.js and Bun with SQLite and [sqlite-vec](https://alexgarcia.xyz/sqlite-vec/js.html).

**Status: project bootstrap.** The repository provides documentation and TypeScript build tooling. The entry point has no public API yet. Memory ingestion, retrieval, SQLite integration, and final question answering are planned, not implemented.

## Direction

Build a local, persistent memory system whose indexing and retrieval do not call a generative LLM. Preserve original passages and their provenance, then add dense retrieval, entity relationships, temporal context, and evidence selection incrementally. An optional final reader may call an LLM using retrieved evidence.

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

| Runtime | Proposed driver | Extension |
| --- | --- | --- |
| Node.js | `better-sqlite3` | `sqlite-vec` |
| Bun | `bun:sqlite` | `sqlite-vec` |

These drivers are not installed yet. Confirm extension loading and persistence before accepting the storage design. On macOS, Bun requires a custom SQLite library for extension loading. one-mem targets Node.js and Bun on Windows x64, Linux, and macOS. Windows ARM64 is outside project scope. The bootstrap checks do not establish native SQLite compatibility. See [limitations](docs/LIMITATIONS.md).

## Repository Map

- `src/` — TypeScript source; currently an empty package entry point.
- `dist/` — generated JavaScript and declarations, ignored by Git.
- [Architecture](docs/ARCHITECTURE.md) — proposed components, data flow, and invariants.
- [Decisions](docs/DECISIONS.md) — accepted constraints and provisional choices.
- [TODO](docs/TODO.md) — ordered milestones with completion checks.
- [Limitations](docs/LIMITATIONS.md) — current gaps and compatibility caveats.
- `docs/llms/` — local Markdown copies of `llms.txt` and `llms-full.txt` references, including the [Bun index](docs/llms/bun.md) and [full Bun guide](docs/llms/bun-full.md). Prefer these for Bun guidance.
- [Repository guidelines](AGENTS.md) — contributor and agent instructions.
- [Changelog](CHANGELOG.md) — project changes.

## Reference and License

The sibling `../zero-mem` checkout is reference-only. It is not required to install, build, or run this project. Research used [Zero-Mem/Zero-mem](https://github.com/Zero-Mem/Zero-mem) at commit `e1b2f8ef98a3d023478ddb2049aba11753296d42`; its Python implementation uses Parquet, GraphML, and JSON rather than SQLite.

Independently authored one-mem material is licensed under [MIT](LICENSE). No license file was found in the inspected reference commit. Do not copy its code, prompts, or assets without establishing the applicable rights. This license does not cover third-party papers, datasets, models, or reference material.
