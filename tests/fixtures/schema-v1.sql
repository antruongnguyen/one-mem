-- Frozen schema-v1 fixture, independently authored for one-mem.
-- Do not regenerate from the current initializer: future migrations must read this old shape.
BEGIN;
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
  text, content='records', content_rowid='row_id', tokenize='unicode61 remove_diacritics 0'
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
INSERT INTO settings VALUES
  ('namespace', 'fixture-v1'), ('embedding_space_id', 'fixture-space-v1'),
  ('embedding_dimensions', '2'), ('embedding_metric', 'cosine'),
  ('vector_encoding', 'float32-le-normalized');
INSERT INTO records VALUES (9007199254740993, 'old-a', 'source:legacy', 'Cobalt ZX-81 repair', 'session:legacy', 0, 'user', '2020-01-02T03:04:05.000Z', '2019-12-01T00:00:00.000Z', '00000000-0000-4000-8000-000000000001', '69a13ec08b8df305d872910ff0fdfc954e4148978761910d82dab369d5d69ee2', X'0000803F00000000');
INSERT INTO records VALUES (9007199254740994, 'old-b', 'source:legacy', 'Tài liệu gốc — α
line two', 'session:legacy', 1, NULL, NULL, NULL, '00000000-0000-4000-8000-000000000002', 'd161613a5331a21957f70f8ace4fd011bc10c82316c381e858cf9f4bbaceb0c6', X'000000000000803F');
PRAGMA user_version = 1;
COMMIT;
