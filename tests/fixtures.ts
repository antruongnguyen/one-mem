import type Database from "better-sqlite3";

export function vectorBytes(values: readonly number[]): Buffer {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}

// Phase 0 characterization schema; this is not a library migration.
export function createFixtureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE fixture_records (
      row_id INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      source_id TEXT NOT NULL,
      session_id TEXT,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL
    ) STRICT;
    CREATE INDEX fixture_scope ON fixture_records(source_id, session_id);
    CREATE VIRTUAL TABLE fixture_fts USING fts5(
      text, content='fixture_records', content_rowid='row_id',
      tokenize='unicode61 remove_diacritics 0'
    );
    CREATE TRIGGER fixture_insert AFTER INSERT ON fixture_records BEGIN
      INSERT INTO fixture_fts(rowid, text) VALUES (new.row_id, new.text);
    END;
    CREATE TRIGGER fixture_delete AFTER DELETE ON fixture_records BEGIN
      INSERT INTO fixture_fts(fixture_fts, rowid, text)
        VALUES ('delete', old.row_id, old.text);
    END;
    CREATE TRIGGER fixture_update AFTER UPDATE ON fixture_records BEGIN
      INSERT INTO fixture_fts(fixture_fts, rowid, text)
        VALUES ('delete', old.row_id, old.text);
      INSERT INTO fixture_fts(rowid, text) VALUES (new.row_id, new.text);
    END;
  `);
}

export function insertFixture(db: Database.Database, record: {
  rowId?: bigint;
  id: string;
  sourceId: string;
  sessionId?: string;
  text: string;
  vector: readonly number[];
}): void {
  db.prepare(`
    INSERT INTO fixture_records(row_id, id, source_id, session_id, text, embedding)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(record.rowId ?? null, record.id, record.sourceId,
    record.sessionId ?? null, record.text, vectorBytes(record.vector));
}

export function lexicalIds(db: Database.Database, query: string): string[] {
  return db.prepare<[string], { id: string }>(`
    SELECT r.id FROM fixture_fts f
    JOIN fixture_records r ON r.row_id = f.rowid
    WHERE fixture_fts MATCH ? ORDER BY r.id COLLATE BINARY
  `).all(query).map(row => row.id);
}

export function denseRows(db: Database.Database, query: readonly number[],
  scope: { sourceId?: string; sessionId?: string } = {}, limit = 10,
): { id: string; distance: number }[] {
  return db.prepare<unknown[], { id: string; distance: number }>(`
    SELECT id, vec_distance_cosine(embedding, ?) AS distance
    FROM fixture_records
    WHERE (? IS NULL OR source_id = ?) AND (? IS NULL OR session_id = ?)
    ORDER BY distance, id COLLATE BINARY LIMIT ?
  `).all(vectorBytes(query), scope.sourceId ?? null, scope.sourceId ?? null,
    scope.sessionId ?? null, scope.sessionId ?? null, limit);
}
