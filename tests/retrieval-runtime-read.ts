import { openMemory } from "../dist/index.js";

const memory = await openMemory({ path: process.argv[2], namespace: "fixture", embeddings: {
  space: { id: "fixture-v1", dimensions: 2, metric: "cosine" },
  async embed(texts, options) {
    if (options.purpose !== "query") throw new Error("Expected a query embedding.");
    return texts.map(() => new Float32Array([1, 0]));
  },
} });
try { console.log(JSON.stringify(await memory.search("apple"))); }
finally { await memory.close(); }
