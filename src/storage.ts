import type Database from "better-sqlite3";
import { createRequire } from "node:module";
import { MemoryError } from "./errors.js";
import { fuseRanks } from "./retrieval.js";
import { selectEvidence } from "./evidence.js";
import type { EmbeddingSpace, MemoryInput, MemoryRecord, Scope } from "./types.js";

const require = createRequire(import.meta.url);

export function openStorage(path: string, useWal = true): Database.Database {
  let Driver: typeof Database;
  try {
    Driver = require("better-sqlite3") as typeof Database;
  } catch (cause) {
    throw nativeError("better-sqlite3", cause);
  }

  let db: Database.Database;
  try {
    // Wait up to five seconds for a competing SQLite writer.
    db = new Driver(path, { timeout: 5000 });
  } catch (cause) {
    if (cause instanceof Error && (
      ("code" in cause && ["MODULE_NOT_FOUND", "ERR_DLOPEN_FAILED"].includes(String(cause.code)))
      || /\.node\b/.test(cause.message)
    )) {
      throw nativeError("better-sqlite3", cause);
    }
    throw cause;
  }

  try {
    db.defaultSafeIntegers(true);
    db.pragma("foreign_keys = ON");
    if (useWal && !db.memory) db.pragma("journal_mode = WAL");
    try {
      const sqliteVec = require("sqlite-vec") as typeof import("sqlite-vec");
      sqliteVec.load(db);
      db.prepare("SELECT vec_version()").get();
    } catch (cause) {
      throw nativeError("sqlite-vec", cause);
    }
    return db;
  } catch (cause) {
    try {
      db.close();
    } catch {
      // Preserve the initialization failure if cleanup also fails.
    }
    throw cause;
  }
}

function nativeError(component: string, cause: unknown): Error {
  return new MemoryError(
    "SQLITE_UNAVAILABLE",
    `Cannot load ${component} on ${process.platform}-${process.arch}. `
    + "Reinstall dependencies with bun install --frozen-lockfile, retaining platform optional packages, "
    + "and use a supported Node.js or Bun runtime.",
    { cause },
  );
}

export function sqliteError(cause: unknown): unknown {
  if (cause instanceof MemoryError) return cause;
  const code = cause instanceof Error && "code" in cause ? String(cause.code) : "";
  if (/^SQLITE_(BUSY|LOCKED)(_|$)/.test(code)) {
    return new MemoryError("BUSY", "SQLite is busy; retry the operation when the writer completes.", { cause });
  }
  return cause;
}

export function initializeMemory(db: Database.Database, namespace: string, space: EmbeddingSpace): void {
  const validate = () => {
    const version = db.pragma("user_version", { simple: true });
    if (version !== 0n && version !== 1n) {
      throw new MemoryError("UNSUPPORTED_SCHEMA", "This database requires a newer schema implementation.");
    }
    if (version === 0n) {
      if (db.prepare("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' LIMIT 1").get()) {
        throw new MemoryError("DATABASE_MISMATCH", "An unversioned database must have an empty user schema.");
      }
      return false;
    }
    let settings: Map<string, string>;
    try {
      settings = new Map(db.prepare<[], { key: string; value: string }>(
        "SELECT key, value FROM settings",
      ).all().map(row => [row.key, row.value]));
    } catch (cause) {
      throw new MemoryError("DATABASE_MISMATCH", "The database settings are missing or malformed.", { cause });
    }
    if (settings.size !== 5 || settings.get("namespace") !== namespace
      || settings.get("vector_encoding") !== "float32-le-normalized"
      || !settings.has("embedding_space_id") || !settings.has("embedding_dimensions")
      || !settings.has("embedding_metric")
      || !settings.get("embedding_space_id")?.trim()
      || !/^[1-9]\d*$/.test(settings.get("embedding_dimensions") ?? "")
      || Number(settings.get("embedding_dimensions")) > 8192) {
      throw new MemoryError("DATABASE_MISMATCH", "The database namespace or settings do not match.");
    }
    if (settings.get("embedding_space_id") !== space.id
      || settings.get("embedding_dimensions") !== String(space.dimensions)
      || settings.get("embedding_metric") !== space.metric) {
      throw new MemoryError("EMBEDDING_MISMATCH", "The provider does not match the persisted embedding space.");
    }
    return true;
  };
  // Check before any persistent PRAGMA, then repeat under the migration lock.
  if (!validate()) {
    db.transaction(() => {
      if (validate()) return;
      db.exec(`
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE records (
          row_id INTEGER PRIMARY KEY,
          id TEXT NOT NULL UNIQUE,
          source_id TEXT NOT NULL,
          text TEXT NOT NULL,
          session_id TEXT,
          sequence INTEGER,
          speaker TEXT,
          observed_at TEXT,
          event_at TEXT,
          revision TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          embedding BLOB NOT NULL CHECK(length(embedding) > 0 AND length(embedding) % 4 = 0),
          CHECK ((session_id IS NULL AND sequence IS NULL) OR
                 (session_id IS NOT NULL AND sequence IS NOT NULL AND sequence >= 0)),
          UNIQUE(source_id, session_id, sequence)
        ) STRICT;
        CREATE INDEX records_session ON records(source_id, session_id, sequence);
        CREATE VIRTUAL TABLE records_fts USING fts5(
          text, content='records', content_rowid='row_id',
          tokenize='unicode61 remove_diacritics 0'
        );
        CREATE TRIGGER records_insert AFTER INSERT ON records BEGIN
          INSERT INTO records_fts(rowid, text) VALUES (new.row_id, new.text);
        END;
        CREATE TRIGGER records_delete AFTER DELETE ON records BEGIN
          INSERT INTO records_fts(records_fts, rowid, text) VALUES ('delete', old.row_id, old.text);
        END;
        CREATE TRIGGER records_update AFTER UPDATE ON records BEGIN
          INSERT INTO records_fts(records_fts, rowid, text) VALUES ('delete', old.row_id, old.text);
          INSERT INTO records_fts(rowid, text) VALUES (new.row_id, new.text);
        END;
        INSERT INTO records_fts(records_fts) VALUES ('rebuild');
      `);
      const insert = db.prepare("INSERT INTO settings(key, value) VALUES (?, ?)");
      for (const [key, value] of [
        ["namespace", namespace], ["embedding_space_id", space.id],
        ["embedding_dimensions", String(space.dimensions)], ["embedding_metric", space.metric],
        ["vector_encoding", "float32-le-normalized"],
      ]) insert.run(key, value);
      db.pragma("user_version = 1");
    }).exclusive();
  }
  if (!db.memory) db.pragma("journal_mode = WAL");
}

interface StoredRow {
  id: string;
  source_id: string;
  text: string;
  session_id: string | null;
  sequence: bigint | null;
  speaker: string | null;
  observed_at: string | null;
  event_at: string | null;
  revision: string;
  content_hash: string;
  embedding: Buffer;
}

export interface StoredRecord {
  record: MemoryRecord;
  contentHash: string;
  embedding: Buffer;
}

export function readStoredRecord(db: Database.Database, id: string): StoredRecord | undefined {
  let row: StoredRow | undefined;
  try {
    row = db.prepare<[string], StoredRow>("SELECT * FROM records WHERE id = ?").get(id);
  } catch (cause) { throw sqliteError(cause); }
  if (!row) return undefined;
  const record: MemoryRecord = {
    id: row.id, sourceId: row.source_id, text: row.text, revision: row.revision,
  };
  if (row.session_id !== null) record.sessionId = row.session_id;
  if (row.sequence !== null) {
    const sequence = Number(row.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new MemoryError("DATABASE_MISMATCH", "A stored sequence is outside the supported integer range.");
    }
    record.sequence = sequence;
  }
  if (row.speaker !== null) record.speaker = row.speaker;
  if (row.observed_at !== null) record.observedAt = row.observed_at;
  if (row.event_at !== null) record.eventAt = row.event_at;
  return { record, contentHash: row.content_hash, embedding: Buffer.from(row.embedding) };
}

export function readSnapshot(db: Database.Database, ids: readonly string[]): (StoredRecord | undefined)[] {
  try {
    return db.transaction(() => ids.map(id => readStoredRecord(db, id)))();
  } catch (cause) { throw sqliteError(cause); }
}

export interface Replacement {
  input: MemoryInput;
  contentHash: string;
  revision: string;
  embedding: Buffer;
}

export function commitRecords(db: Database.Database, ids: readonly string[],
  snapshot: readonly (StoredRecord | undefined)[], replacements: readonly Replacement[],
): void {
  try {
    db.transaction(() => {
      const revision = db.prepare<[string], { revision: string }>("SELECT revision FROM records WHERE id = ?");
      ids.forEach((id, index) => {
        if (revision.get(id)?.revision !== snapshot[index]?.record.revision) {
          throw new MemoryError("CONFLICT", "A record changed while this operation was being prepared.");
        }
      });
      const remove = db.prepare("DELETE FROM records WHERE id = ?");
      for (const { input } of replacements) remove.run(input.id);
      const insert = db.prepare(`
        INSERT INTO records(id, source_id, text, session_id, sequence, speaker, observed_at,
          event_at, revision, content_hash, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const { input, contentHash, revision: nextRevision, embedding } of replacements) {
        insert.run(input.id, input.sourceId, input.text, input.sessionId ?? null,
          input.sequence === undefined ? null : BigInt(input.sequence), input.speaker ?? null,
          input.observedAt ?? null, input.eventAt ?? null, nextRevision, contentHash, embedding);
      }
    }).immediate();
  } catch (cause) {
    const code = cause instanceof Error && "code" in cause ? String(cause.code) : "";
    if (code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new MemoryError("CONFLICT", "The batch conflicts with an existing source/session sequence.", { cause });
    }
    throw sqliteError(cause);
  }
}

export function removeRecords(db: Database.Database, ids: readonly string[]): number {
  try {
    return db.transaction(() => {
      const remove = db.prepare("DELETE FROM records WHERE id = ?");
      let count = 0;
      for (const id of ids) count += Number(remove.run(id).changes);
      if (!Number.isSafeInteger(count)) throw new MemoryError("DATABASE_MISMATCH", "Deletion count exceeds the supported range.");
      return count;
    }).immediate();
  } catch (cause) { throw sqliteError(cause); }
}

function scopeFilter(scope: Scope): { sql: string; parameters: string[] } {
  const conditions: string[] = [];
  const parameters: string[] = [];
  if (scope.sourceId !== undefined) { conditions.push("r.source_id = ?"); parameters.push(scope.sourceId); }
  if (scope.sessionId !== undefined) { conditions.push("r.session_id = ?"); parameters.push(scope.sessionId); }
  return { sql: conditions.length === 0 ? "1" : conditions.join(" AND "), parameters };
}

export function hasScopedRecords(db: Database.Database, scope: Scope): boolean {
  const filter = scopeFilter(scope);
  try {
    return db.prepare(`SELECT 1 FROM records r WHERE ${filter.sql} LIMIT 1`).get(...filter.parameters) !== undefined;
  } catch (cause) { throw sqliteError(cause); }
}

function readSessionNeighbors(db: Database.Database, anchor: MemoryRecord, radius: number): MemoryRecord[] {
  if (anchor.sessionId === undefined || anchor.sequence === undefined) return [];
  const lookup = db.prepare<[string, string, bigint], { id: string }>(`
    SELECT id FROM records WHERE source_id = ? AND session_id = ? AND sequence = ?
  `);
  const records: MemoryRecord[] = [];
  for (const direction of [-1n, 1n]) {
    for (let distance = 1; distance <= radius; distance++) {
      const sequence = BigInt(anchor.sequence) + direction * BigInt(distance);
      if (sequence < 0n || sequence > BigInt(Number.MAX_SAFE_INTEGER)) break;
      const row = lookup.get(anchor.sourceId, anchor.sessionId, sequence);
      if (!row) break;
      const stored = readStoredRecord(db, row.id);
      if (!stored) throw new MemoryError("DATABASE_MISMATCH", "A neighbor has no source record.");
      records.push(stored.record);
    }
  }
  return records;
}

export function searchStoredRecords(db: Database.Database, vector: Buffer | null, match: string | null,
  scope: Scope, candidateLimit: number, limit: number, maxEvidenceBytes: number, neighbors = 0,
) {
  const filter = scopeFilter(scope);
  try {
    return db.transaction(() => {
      if (vector !== null && db.prepare(`SELECT 1 FROM records r WHERE ${filter.sql} AND length(r.embedding) != ? LIMIT 1`)
        .get(...filter.parameters, vector.length)) {
        throw new MemoryError("EMBEDDING_MISMATCH", "A stored vector length does not match the embedding space.");
      }
      const dense = vector === null ? [] : db.prepare<unknown[], { id: string; distance: number | null }>(`
        SELECT r.id, vec_distance_cosine(r.embedding, ?) AS distance FROM records r
        WHERE ${filter.sql} ORDER BY distance ASC, r.id COLLATE BINARY ASC LIMIT ?
      `).all(vector, ...filter.parameters, candidateLimit);
      if (dense.some(row => row.distance === null || !Number.isFinite(row.distance))) {
        throw new MemoryError("DATABASE_MISMATCH", "A stored vector produced an invalid cosine distance.");
      }
      const lexical = match === null ? [] : db.prepare<unknown[], { id: string }>(`
        SELECT r.id FROM records_fts JOIN records r ON r.row_id = records_fts.rowid
        WHERE records_fts MATCH ? AND ${filter.sql}
        ORDER BY bm25(records_fts) ASC, r.id COLLATE BINARY ASC LIMIT ?
      `).all(match, ...filter.parameters, candidateLimit);
      const candidates = fuseRanks(dense.map(row => row.id), lexical.map(row => row.id)).map(candidate => {
        const stored = readStoredRecord(db, candidate.id);
        if (!stored) throw new MemoryError("DATABASE_MISMATCH", "A candidate has no source record.");
        return { ...candidate, record: stored.record };
      });
      const neighborCandidateIds = new Set<string>();
      const evidence = selectEvidence(candidates, limit, maxEvidenceBytes,
        neighbors === 0 ? undefined : record => {
          const adjacent = readSessionNeighbors(db, record, neighbors);
          adjacent.forEach(neighbor => neighborCandidateIds.add(neighbor.id));
          return adjacent;
        });
      return { ...evidence, denseCandidates: dense.length, lexicalCandidates: lexical.length,
        // Internal evaluation traces; Memory.search exposes only its explicit public diagnostics.
        denseIds: dense.map(row => row.id), lexicalIds: lexical.map(row => row.id),
        rankedIds: candidates.map(candidate => candidate.id),
        primaryTopKIds: candidates.slice(0, limit).map(candidate => candidate.id),
        selectedMatchIds: evidence.items.filter(item => item.role === "match").map(item => item.record.id),
        neighborCandidateIds: [...neighborCandidateIds],
        returnedContextIds: evidence.items.filter(item => item.role === "context").map(item => item.record.id) };
    })();
  } catch (cause) { throw sqliteError(cause); }
}
