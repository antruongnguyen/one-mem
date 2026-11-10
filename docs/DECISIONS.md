# Decisions

Recorded on 2026-11-10. Accepted decisions govern this repository; provisional choices require implementation evidence.

## D001 — Independent Implementation

**Status: Accepted.** one-mem is the main project. The sibling zero-mem checkout is a read-only reference, not a runtime dependency. Write code and prompts independently. Preserve links to the paper and inspected reference revision; do not claim official status or benchmark parity.

## D002 — One TypeScript ESM Package

**Status: Accepted.** Use strict TypeScript, standard ES modules, and `tsc` to generate JavaScript and declarations. Bun manages development dependencies and the lockfile. Baselines are Node.js 22+ and Bun 1.4+; Windows x64, Linux, and macOS are verification targets, not compatibility claims based on compilation. Windows ARM64 is out of scope.

Prefer standard JavaScript and Node-compatible APIs in shared code. Keep dependencies minimal. The bootstrap has no public API, server, CLI, or monorepo. Package publishing is disabled with `private: true` until the API and release process exist.

## D003 — SQLite and sqlite-vec

**Status: Accepted direction; driver selection provisional.** Use SQLite for durable source records and derived metadata, with sqlite-vec for vector search. This replaces the reference's file formats and requires a new storage design.

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| `better-sqlite3` on Node; `bun:sqlite` on Bun | Uses each runtime's documented integration | Two thin adapters; custom SQLite required on macOS Bun |
| `better-sqlite3` on both | Potentially one adapter | Exact package/Bun version compatibility must be verified |
| `node:sqlite` on Node | Removes a Node driver dependency | Changes the integration baseline and requires separate validation |

Start by testing the dual-driver approach. Accept it only after loading the extension, querying known vectors, transaction rollback, and close/reopen persistence succeed in both runtimes. Measure before claiming performance superiority. Do not add SQLite dependencies during documentation-only bootstrap.

## D004 — Incremental Memory Pipeline

**Status: Accepted direction.** Implement durable ingestion and dense retrieval first. Add graph and temporal context independently, then fusion and bounded evidence. Keep generative LLM calls outside ingestion and retrieval. Defer model/provider selection and final QA integration until their milestones.

## D005 — Documentation and Collaboration

**Status: Accepted.** User-facing conversation is Vietnamese. Repository documents, code prompts, and subagent prompts are English. Use subagents with model and effort matched to task difficulty, as defined in [AGENTS.md](../AGENTS.md).

Use Conventional Commits and branches such as `feat/sqlite-storage`. Never add co-author trailers. Keep durable decisions in `docs/`; ignore `docs/superpowers/` scratch plans. License independently authored material under MIT, as selected by the project owner.

## Evidence

- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite)
- [sqlite-vec JavaScript integrations](https://alexgarcia.xyz/sqlite-vec/js.html)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Node.js 22 SQLite documentation](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)
