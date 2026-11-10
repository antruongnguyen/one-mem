import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "one mem Ω package "));
const environment = { ...process.env };
delete environment.NODE_PATH;
delete environment.NODE_OPTIONS;
const node = process.execPath;
const failures = [];

function run(command, args, cwd, collectFailure = false) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    const error = result.error ?? new Error(`${command} ${args.join(" ")} exited ${result.status} (${result.signal ?? "no signal"})`);
    if (!collectFailure) throw error;
    failures.push(error);
  }
}

function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? files(join(directory, entry.name), name + "/") : [name];
  }).sort();
}

try {
  assert.equal(process.versions.bun, undefined, "Run this harness through the test:package Node script");
  run(node, ["--version"], root, true);
  run("bun", ["--version"], root, true);
  if (failures.length) throw new AggregateError(failures, "Both Node.js and Bun are required");
  run("bun", ["run", "build"], root);
  run("bun", ["pm", "pack", "--destination", temporary], root);
  const tarballs = readdirSync(temporary).filter(name => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  const tarball = join(temporary, tarballs[0]);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.private, true, "Publication must remain disabled");
  const expected = files(join(root, "dist")).map(name => `dist/${name}`).concat(["LICENSE", "README.md", "package.json"]).sort();
  assert(expected.filter(name => name.startsWith("dist/")).every(name => /^dist\/[a-z-]+\.(?:js|d\.ts)$/.test(name)), "Only compiled modules and declarations belong in dist");
  const archive = spawnSync("bun", ["--no-install", "-e",
    "const files = await new Bun.Archive(await Bun.file(process.argv.at(-1)).arrayBuffer()).files(); console.log(JSON.stringify([...files.keys()].sort()));",
    tarball], { cwd: temporary, env: environment, encoding: "utf8" });
  if (archive.error) throw archive.error;
  assert.equal(archive.status, 0, archive.stderr);
  assert.deepEqual(JSON.parse(archive.stdout), expected.map(name => `package/${name}`), "Tarball must contain only compiled modules/declarations, license, readme, and manifest");
  console.log(`Package contents (${statSync(tarball).size} tarball bytes): ${expected.join(", ")}`);
  writeFileSync(join(temporary, "package.json"), JSON.stringify({
    name: "one-mem-package-consumer", private: true, type: "module",
    dependencies: { [manifest.name]: `file:${tarball}` },
  }, null, 2));
  run("bun", ["install", "--linker", "hoisted"], temporary);
  const installed = join(temporary, "node_modules", manifest.name);
  const installedManifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.deepEqual(installedManifest.exports, { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } });
  assert.deepEqual(installedManifest.dependencies, manifest.dependencies);
  // Bun adds this installation marker after extracting the archive.
  assert.deepEqual(files(installed).filter(name => name !== ".bun-tag"), expected);
  copyFileSync(join(root, "scripts/package-consumer.mjs"), join(temporary, "consumer.mjs"));
  writeFileSync(join(temporary, "consumer.ts"), `import { openMemory, MemoryError, type EmbeddingProvider, type Evidence, type Memory, type MemoryInput, type SearchOptions } from "one-mem";
const embeddings: EmbeddingProvider = {
  space: { id: "strict-consumer", dimensions: 2, metric: "cosine" },
  async embed(texts, { purpose, signal }) {
    signal?.throwIfAborted();
    const validPurpose: "document" | "query" = purpose;
    return texts.map(() => Float32Array.from(validPurpose === "document" ? [1, 0] : [0, 1]));
  },
};
const memory: Memory = await openMemory({ path: "consumer.db", namespace: "consumer", embeddings });
const input: MemoryInput = { id: "record", sourceId: "source", sessionId: "session", sequence: 0, text: "text" };
const options: SearchOptions = { sourceId: "source", sessionId: "session", limit: 1, neighbors: 1, maxEvidenceBytes: 32 };
await memory.upsert([input]);
const revision: string | undefined = (await memory.get(input.id))?.revision;
const evidence: Evidence = await memory.search("text", options);
const anchors: readonly string[] | undefined = evidence.items[0]?.anchorIds;
const removed: number = await memory.remove([input.id]);
await memory.close();
const error: Error = new MemoryError("CLOSED", "closed");
// @ts-expect-error Evaluation modes must not become public search options.
const internal: SearchOptions = { mode: "dense" };
// @ts-expect-error Internal implementation modules are not package exports.
await import("one-mem/dist/storage.js");
// @ts-expect-error Internal evaluation entry points are not package exports.
await import("one-mem/evaluation");
`);
  writeFileSync(join(temporary, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      noEmit: true, skipLibCheck: false, types: [], lib: ["ES2022", "DOM"] },
    files: ["consumer.ts"],
  }));
  run(node, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(temporary, "tsconfig.json")], temporary);
  for (const [command, prefix, runtime] of [[node, [], "node"], ["bun", ["--no-install"], "bun"]]) {
    run(command, [...prefix, "consumer.mjs", "exercise", join(temporary, `${runtime} lifecycle 🙂.db`)], temporary, true);
  }
  const crossRuntime = join(temporary, "cross runtime é.db");
  run(node, ["consumer.mjs", "write", crossRuntime, "node"], temporary, true);
  run("bun", ["--no-install", "consumer.mjs", "read", crossRuntime, "node"], temporary, true);
  run("bun", ["--no-install", "consumer.mjs", "write", crossRuntime, "bun"], temporary, true);
  run(node, ["consumer.mjs", "read", crossRuntime, "bun"], temporary, true);
  if (failures.length) throw new AggregateError(failures, "Installed-package consumers failed");
  console.log("Installed-package declarations, native lifecycle, and cross-runtime persistence passed");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
