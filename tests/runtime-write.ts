import assert from "node:assert/strict";
import { openStorage } from "../dist/storage.js";
import { denseRows, insertFixture, lexicalIds, vectorBytes } from "./fixtures.js";

const path = process.argv[2];
assert.ok(path, "A database path is required");
const db = openStorage(path);
try {
  assert.equal(db.prepare("SELECT vec_version()").pluck().get(), "v0.1.9");
  assert.deepEqual(lexicalIds(db, "first"), ["shared"]);
  assert.equal(db.prepare("SELECT row_id FROM fixture_records WHERE id = ?")
    .pluck().get("shared"), 9007199254740993n);
  assert.deepEqual(denseRows(db, [1, 0]), [
    { id: "shared", distance: 0 }, { id: "removed", distance: 2 },
  ]);
  db.transaction(() => {
    db.prepare("UPDATE fixture_records SET text = ?, embedding = ? WHERE id = ?")
      .run("second amber", vectorBytes([0, 1]), "shared");
    db.prepare("DELETE FROM fixture_records WHERE id = ?").run("removed");
    insertFixture(db, { id: "added", sourceId: "source", text: "fresh evidence",
      vector: [1, 0] });
  })();
} finally {
  db.close();
}
