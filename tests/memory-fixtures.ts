import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddingProvider, Memory, OpenMemoryOptions } from "../dist/index.js";
import { openMemory } from "../dist/index.js";

export function provider(): EmbeddingProvider & { inputs: string[] } {
  return {
    space: { id: "fixture-v1", dimensions: 2, metric: "cosine" },
    inputs: [],
    async embed(texts, options) {
      if (options.purpose !== "document") throw new Error("Unexpected embedding purpose");
      this.inputs.push(...texts);
      return texts.map(text => new Float32Array(
        text === "blue ocean" ? [0, 1] : text === "green leaf" ? [-1, 0] : [1, 0],
      ));
    },
  };
}

export function temporaryMemory() {
  const directory = mkdtempSync(join(tmpdir(), "one-mem Phase 1 tiếng Việt "));
  const path = join(directory, "memory.sqlite");
  const embeddings = provider();
  const handles: Memory[] = [];
  return {
    directory, path, embeddings,
    async open(overrides: Partial<OpenMemoryOptions> = {}) {
      const memory = await openMemory({ path, namespace: "fixture", embeddings, ...overrides });
      handles.push(memory);
      return memory;
    },
    async cleanup() {
      for (const handle of handles) await handle.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
