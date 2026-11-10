# Repository Guidelines

## Project Scope and Structure

one-mem is an independent strict TypeScript package using ES modules. The sibling `../zero-mem` is a read-only reference for high-level ideas, not a dependency or a source for copied code or prompts. User-facing conversation must be Vietnamese; documentation, code prompts, and subagent prompts must be English. Windows x64, Linux, and macOS are targets; Windows ARM64 is out of scope. Phase 0 provides the shared better-sqlite3/sqlite-vec driver and compiled `node:test` compatibility fixtures. Phase 1 provides a private version-1 storage schema and the `openMemory`, `upsert`, `get`, `remove`, and `close` lifecycle with an injected embedding provider. Phase 2 introduced `search(query, { sourceId?, sessionId?, limit?, maxEvidenceBytes?, signal? })` with scoped scalar-cosine and literal-token FTS5 candidates fused by reciprocal rank, then returned as whole-record evidence within a UTF-8 text-byte budget. Phase 3 extends search with `neighbors?` (default 0, integer 0–2) for contiguous records from the same source/session using explicit sequence metadata; gaps stop expansion and timestamps do not define order. `limit` counts selected matches, while context can increase the returned item count. Only selected matches expand, matches have byte priority, and context shares the same whole-record UTF-8 byte budget with shared-match attribution. Search materializes matches and context in one read transaction after query embedding; later updates, deletes, or metadata moves affect later searches, while returned snapshots retain their revisions and supplied timestamps. Phase 4 adds an offline synthetic retrieval evaluator, installed-tarball consumer checks, version-1 initialization/rollback and backup/rebuild coverage, and CI evaluation report artifacts. Its evaluator compares internal retrieval variants and adds no public mode, schema change, or dependency. The private API and schema remain experimental without a stable cross-release compatibility promise. Graph and reader APIs, real-model retrieval quality, and production performance remain future work. Only local macOS ARM64 native execution has been verified; configured CI lanes are not verification evidence. The Phase 0 performance gate remains open.

Keep TypeScript source in `src/`, build output in `dist/`, and tests in `tests/*.test.ts`, compiled into ignored `.test-dist/`. The durable version-1 schema is owned by `src/storage.ts`; keep Phase 0 compatibility fixtures for native driver checks. The overview is in root `README.md`; project notes belong in `docs/TODO.md`, `docs/DECISIONS.md`, `docs/LIMITATIONS.md`, `docs/ARCHITECTURE.md`, `docs/EVALUATION.md`, and `docs/UPGRADING.md`. Git ignores `docs/superpowers/`; do not force-add its contents.

`docs/llms/` contains Markdown copies of `llms.txt` and `llms-full.txt` references. For Bun guidance, start with [bun.md](docs/llms/bun.md), then search [bun-full.md](docs/llms/bun-full.md) for details. Consult [official docs](https://bun.com/docs) when local references are missing or outdated.

## Setup and Commands

Use Bun for reproducible installs and package scripts:

- `bun install --frozen-lockfile` — install locked dependency versions.
- `bun run typecheck` — check TypeScript types.
- `bun run build` — compile to `dist/`.
- `bun run test:build` — build package and compile shared tests.
- `bun run test:node` — run compiled fixtures under Node.js.
- `bun run test:bun` — run the same fixtures under Bun.
- `bun run test:package` — pack the private package into a temporary consumer and check declarations, native loading, lifecycle behavior, and cross-runtime persistence.
- `bun run eval:node` and `bun run eval:bun` — run the offline synthetic evaluator under each runtime and emit JSON reports. Run after `bun run test:build`; these fixtures test evaluation plumbing and evidence retrieval, not real-model quality or production capacity.

Both Node.js and Bun must load the built entry point `dist/index.js`. Both runtimes must be installed for cross-runtime persistence tests. Preserve optional native dependencies during installation. See `docs/BENCHMARKS.md` for the opt-in file-backed benchmark; do not run performance measurements concurrently with other tests or benchmarks.

## Style and Delegation

Use strict TypeScript, ES modules, and two-space indentation. Use `camelCase` for functions and variables, `PascalCase` for types, and `kebab-case` for file names. Keep modules focused and avoid speculative abstractions or dependencies.

Use subagents for independent work. Route architecture or complex planning to `gpt-6-astra`, implementation or review to `gpt-6.1-sol`, and simple tasks to `gpt-6-luna`. Use high reasoning effort by default; adjust it to balance task needs, cost, and correctness.

## Verification and Review

For package changes, run `bun run typecheck`, `bun run build`, `bun run test:build`, `bun run test:node`, `bun run test:bun`, `bun run test:package`, `bun run eval:node`, and `bun run eval:bun`; check `dist/index.js` in both runtimes when it changes. Run the evaluator after `test:build`. Record checks and limitations in the pull request. Use Conventional Commits and short branches in `type/description` form, such as `feat/sqlite-storage` or `fix/vector-loading`. Never add `Co-authored-by` or other co-author trailers. Keep pull requests focused.

## Agent Instructions

State assumptions before implementation and keep edits surgical. Use `rg` for searches. If `.codegraph/` exists, consult CodeGraph before locating or inspecting code; never create an index automatically. Update these guidelines when project structure or tools change.
