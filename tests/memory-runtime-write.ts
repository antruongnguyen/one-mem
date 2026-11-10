import assert from "node:assert/strict";
import { openMemory } from "../dist/index.js";
import { provider } from "./memory-fixtures.js";

const memory = await openMemory({ path: process.argv[2], namespace: "fixture", embeddings: provider() });
try {
  assert.equal((await memory.get("a"))?.text, "red apple");
  await memory.upsert([{ id: "b", sourceId: "other-runtime", text: "blue ocean" }]);
  assert.equal(await memory.remove(["a", "a", "missing"]), 1);
} finally { await memory.close(); }
