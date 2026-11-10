import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { MemoryError } from "./errors.js";
import { checkSpace, embedDocuments, snapshotSpace } from "./embeddings.js";
import {
  commitRecords, initializeMemory, openStorage, readSnapshot, readStoredRecord,
  removeRecords, sqliteError,
} from "./storage.js";
import type { Replacement } from "./storage.js";
import type { Memory, MemoryInput, OpenMemoryOptions, UpsertOptions, UpsertResult } from "./types.js";

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key))) {
    throw new MemoryError("INVALID_INPUT", `${label} must be an object with supported fields.`);
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0
    || Buffer.from(value, "utf8").toString("utf8") !== value) {
    throw new MemoryError("INVALID_INPUT", `${label} must be a nonblank, well-formed Unicode string.`);
  }
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string") throw new MemoryError("INVALID_INPUT", "Timestamps must be ISO instants with an explicit offset.");
  const match = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw new MemoryError("INVALID_INPUT", "Timestamps must be ISO instants with an explicit offset.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const date = new Date(value);
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59
    || Number(match[9] ?? 0) > 23 || Number(match[10] ?? 0) > 59
    || !Number.isFinite(date.getTime())) {
    throw new MemoryError("INVALID_INPUT", "The timestamp has an invalid calendar date, time, or offset.");
  }
  return date.toISOString();
}

function inputs(records: readonly MemoryInput[]): MemoryInput[] {
  if (!Array.isArray(records)) throw new MemoryError("INVALID_INPUT", "Records must be an array.");
  const ids = new Set<string>();
  return Array.from(records, value => {
    const raw = object(value, ["id", "sourceId", "text", "sessionId", "sequence", "speaker", "observedAt", "eventAt"], "A record");
    const input: MemoryInput = { id: identifier(raw.id, "id"), sourceId: identifier(raw.sourceId, "sourceId"),
      text: identifier(raw.text, "text") };
    if (ids.has(input.id)) throw new MemoryError("INVALID_INPUT", "Duplicate IDs are not allowed in an upsert batch.");
    ids.add(input.id);
    if ((raw.sessionId === undefined) !== (raw.sequence === undefined)) {
      throw new MemoryError("INVALID_INPUT", "sessionId and sequence must be supplied together.");
    }
    if (raw.sessionId !== undefined) {
      input.sessionId = identifier(raw.sessionId, "sessionId");
      if (!Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 0) {
        throw new MemoryError("INVALID_INPUT", "sequence must be a nonnegative safe integer.");
      }
      input.sequence = raw.sequence as number;
    }
    if (raw.speaker !== undefined) {
      if (typeof raw.speaker !== "string" || Buffer.from(raw.speaker, "utf8").toString("utf8") !== raw.speaker) {
        throw new MemoryError("INVALID_INPUT", "speaker must be a well-formed Unicode string.");
      }
      input.speaker = raw.speaker;
    }
    if (raw.observedAt !== undefined) input.observedAt = instant(raw.observedAt);
    if (raw.eventAt !== undefined) input.eventAt = instant(raw.eventAt);
    return input;
  });
}

function upsertSignal(options?: UpsertOptions): AbortSignal | undefined {
  if (options === undefined) return undefined;
  const raw = object(options, ["signal"], "Upsert options");
  if (raw.signal !== undefined && !(raw.signal instanceof AbortSignal)) {
    throw new MemoryError("INVALID_INPUT", "signal must be an AbortSignal.");
  }
  return raw.signal as AbortSignal | undefined;
}

export async function openMemory(options: OpenMemoryOptions): Promise<Memory> {
  const raw = object(options, ["path", "namespace", "embeddings"], "Open options");
  const path = identifier(raw.path, "path");
  const namespace = identifier(raw.namespace, "namespace");
  const provider = raw.embeddings;
  if (!provider || typeof provider !== "object" || typeof (provider as OpenMemoryOptions["embeddings"]).embed !== "function") {
    throw new MemoryError("INVALID_INPUT", "embeddings must provide a space and an embed function.");
  }
  const embeddings = provider as OpenMemoryOptions["embeddings"];
  const space = snapshotSpace(embeddings);
  let db: Database.Database | undefined;
  try {
    db = openStorage(path, false);
    initializeMemory(db, namespace, space);
  } catch (cause) {
    try { db?.close(); } catch { /* Preserve the initialization failure. */ }
    throw sqliteError(cause);
  }
  const connection = db;
  let tail: Promise<void> = Promise.resolve();
  let closing: Promise<void> | undefined;
  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new MemoryError("CLOSED", "This memory handle is closed."));
    const pending = tail.then(operation);
    tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
  return {
    upsert(records, options) {
      return enqueue(async () => {
        const canonical = inputs(records);
        const signal = upsertSignal(options);
        signal?.throwIfAborted();
        checkSpace(embeddings, space);
        const ids = canonical.map(input => input.id);
        const snapshot = readSnapshot(connection, ids);
        const hashes = canonical.map(input => createHash("sha256").update(JSON.stringify([
          input.id, input.sourceId, input.text, input.sessionId ?? null, input.sequence ?? null,
          input.speaker ?? null, input.observedAt ?? null, input.eventAt ?? null,
        ])).digest("hex"));
        const changed = canonical.map((_, index) => index).filter(index => snapshot[index]?.contentHash !== hashes[index]);
        const needsEmbedding = changed.filter(index => snapshot[index]?.record.text !== canonical[index].text);
        const vectors = needsEmbedding.length === 0 ? [] : await embedDocuments(embeddings, space,
          needsEmbedding.map(index => canonical[index].text), signal);
        signal?.throwIfAborted();
        checkSpace(embeddings, space);
        const byIndex = new Map(needsEmbedding.map((index, vectorIndex) => [index, vectors[vectorIndex]]));
        const replacements: Replacement[] = changed.map(index => {
          const embedding = byIndex.get(index) ?? snapshot[index]!.embedding;
          if (embedding.length !== space.dimensions * 4) {
            throw new MemoryError("EMBEDDING_MISMATCH", "The stored vector length does not match the embedding space.");
          }
          return { input: canonical[index], contentHash: hashes[index], revision: randomUUID(), embedding };
        });
        commitRecords(connection, ids, snapshot, replacements);
        const revisionById = new Map(replacements.map(item => [item.input.id, item.revision]));
        const result: UpsertResult = { records: canonical.map((input, index) => ({
          id: input.id,
          revision: revisionById.get(input.id) ?? snapshot[index]!.record.revision,
          status: revisionById.has(input.id) ? (snapshot[index] ? "updated" : "inserted") : "unchanged",
        })) };
        return result;
      });
    },
    get(id) {
      return enqueue(() => readStoredRecord(connection, identifier(id, "id"))?.record);
    },
    remove(ids) {
      return enqueue(() => {
        if (!Array.isArray(ids)) throw new MemoryError("INVALID_INPUT", "IDs must be an array.");
        const unique = [...new Set(Array.from(ids, id => identifier(id, "id")))];
        return removeRecords(connection, unique);
      });
    },
    close() {
      closing ??= tail.then(() => { connection.close(); }).catch(cause => { throw sqliteError(cause); });
      return closing;
    },
  };
}
