# Backup, Restore, and Model-Space Rebuild

one-mem currently uses schema version 1 in a private, experimental package. It supports reopen with the same namespace and embedding space, but does not promise compatibility across releases. There is no version-1-to-version-2 migration yet. Never change `user_version` manually to bypass an error.

## Back Up a Local Database

Stop every process using the database and `await memory.close()` on every handle. Keep them stopped until the backup finishes. A main-file copy while another connection is writing can omit committed WAL data or produce an inconsistent backup. Network filesystems and live filesystem snapshots are not verified here.

The following repository maintenance script uses the pinned driver already installed by `bun install`. Save it as `backup.mjs` and run `node backup.mjs source.sqlite snapshot.sqlite` or the equivalent Bun command. Both parent directories must already exist. It refuses to create a missing source or overwrite an existing backup.

```js
import Database from "better-sqlite3";
import { constants, copyFileSync } from "node:fs";

const [source, backup] = process.argv.slice(2);
if (!source || !backup) throw new Error("Provide source and new backup paths");
const db = new Database(source, { fileMustExist: true });
try {
  const [checkpoint] = db.pragma("wal_checkpoint(TRUNCATE)");
  if (checkpoint.busy !== 0) throw new Error("Close all database users before backup");
} finally {
  db.close();
}
copyFileSync(source, backup, constants.COPYFILE_EXCL);
```

Record the namespace, exact embedding-space ID/dimensions/metric, package version/commit, schema version, and an ID/count manifest with the backup. The checkpoint-and-copy procedure is tested locally on macOS ARM64 in Node and Bun; it is not a power-loss or filesystem durability guarantee. For online backups, use a separately verified SQLite backup procedure rather than copying a live main file.

## Restore Without Replacing the Original

1. Keep all users of the destination stopped. Copy the backup to a **new** path; do not overwrite the original database or reuse a path with old WAL/SHM sidecars.
2. Open the copy using the recorded namespace and the same embedding-space descriptor. `DATABASE_MISMATCH`, `EMBEDDING_MISMATCH`, or `UNSUPPORTED_SCHEMA` is a reason to investigate, not to edit settings or force a downgrade.
3. Verify the expected IDs/count, original text, revisions, and a few known lexical/vector/context queries. A SQLite `PRAGMA integrity_check` is useful in addition to application checks, but does not validate model semantics.
4. Close the verified copy, switch the application's configured path explicitly, then restart it. Retain the original and backup until the new path is verified in normal use.

The migration fixtures exercise this procedure with schema-v1 records, vectors, FTS content, and a newly committed record. Deletion is logical; backups, WAL, and free pages may retain old content.

## Rebuild for a Different Embedding Space

Changing model ID/revision, dimensions, pooling, preprocessing, normalization, or metric requires a separate database. Opening the old database with a different descriptor fails; the library never silently re-embeds it.

1. Make and verify a backup first. Obtain the complete authoritative `MemoryInput` records and an ID manifest from the caller's retained inputs. Preserve source/session/sequence, speaker, and explicit observation/event timestamps. Do not reconstruct text from summaries or infer new dates.
2. Configure the new provider with a distinct stable space ID. Use a new database path and the intended namespace; retain the old database unchanged.
3. Upsert the complete original records, in bounded batches appropriate for the provider. Provider cost, retries, rate limits, and privacy remain caller responsibilities. Treat any failed batch as a failure to finish the rebuild; do not switch paths with a partial corpus.
4. Verify every expected ID and exact canonical record fields, the total count from the manifest, new space identity, and held-out retrieval cases before switching paths. New revisions are expected; old citations must not silently resolve as the same revision.
5. Close the new database and explicitly switch the application path after verification. Keep the old database and manifest for rollback until the new model is accepted.

The public API reads known IDs with `get`; it has no bulk export/list method. If the database is the only remaining copy of the corpus, first back it up and perform an explicitly reviewed schema-v1 export of original record fields. Do not add a speculative public migration API or rely on unversioned internal columns in a production upgrade script.

The tests demonstrate a rebuild from the frozen authoritative fixture into a separate database with a new three-dimensional space, preserving source fields while assigning new revisions. They do not establish the quality of any real replacement model.

## Before the First Future Schema Change

Keep `tests/fixtures/schema-v1.sql` frozen. It is an independently authored snapshot with exact IDs, revisions, source text, FTS triggers, and vector bytes; do not regenerate it from the new initializer. A future migration must prove:

- Old schema fixtures upgrade while preserving IDs/text/vectors and applicable revisions.
- Failure after real migration work rolls back the whole transaction.
- Newer unsupported schemas are rejected without changing the database or journal mode.
- Backup/restore and package-consumer behavior pass under both runtimes and the supported native lanes.

Current tests cover opening the frozen v1 fixture, initialization rollback after real DDL, newer-version rejection, checkpointed backup/restore, and separate-model rebuilding. They do not claim a nonexistent v1→v2 upgrade. Keep publication disabled until native coverage, release compatibility policy, and the open performance gate have been addressed.
