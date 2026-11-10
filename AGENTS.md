# Repository Guidelines

## Project Scope and Structure

one-mem is an independent strict TypeScript package using ES modules. The sibling `../zero-mem` is a read-only reference for high-level ideas, not a dependency or a source for copied code or prompts. User-facing conversation must be Vietnamese; documentation, code prompts, and subagent prompts must be English. Windows x64, Linux, and macOS are targets; Windows ARM64 is out of scope. Only the local macOS bootstrap has been verified. No memory engine, SQLite adapter, test framework, or formatter is configured yet.

Keep TypeScript source in `src/`, build output in `dist/`, and future tests in `tests/*.test.ts`. The overview is in root `README.md`; project notes belong in `docs/TODO.md`, `docs/DECISIONS.md`, `docs/LIMITATIONS.md`, and `docs/ARCHITECTURE.md`. Git ignores `docs/superpowers/`; do not force-add its contents.

## Setup and Commands

Use Bun for reproducible installs and package scripts:

- `bun install --frozen-lockfile` — install locked dependency versions.
- `bun run typecheck` — check TypeScript types.
- `bun run build` — compile to `dist/`.

Both Node.js and Bun must load the built entry point `dist/index.js`. No test command is configured yet. Once a runner is added, tests should cover real behavior in both runtimes.

## Style and Delegation

Use strict TypeScript, ES modules, and two-space indentation. Use `camelCase` for functions and variables, `PascalCase` for types, and `kebab-case` for file names. Keep modules focused and avoid speculative abstractions or dependencies.

Use subagents for independent work. Route architecture or complex planning to `gpt-6-astra`, implementation or review to `gpt-6.1-sol`, and simple tasks to `gpt-6-luna`. Use high reasoning effort by default; adjust it to balance task needs, cost, and correctness.

## Verification and Review

For package changes, run `bun run typecheck` and `bun run build`; check `dist/index.js` in both runtimes when it changes. Record checks and limitations in the pull request. Use Conventional Commits and short branches in `type/description` form, such as `feat/sqlite-storage` or `fix/vector-loading`. Never add `Co-authored-by` or other co-author trailers. Keep pull requests focused.

## Agent Instructions

State assumptions before implementation and keep edits surgical. Use `rg` for searches. If `.codegraph/` exists, consult CodeGraph before locating or inspecting code; never create an index automatically. Update these guidelines when project structure or tools change.
