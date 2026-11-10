import type Database from "better-sqlite3";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function openStorage(path: string): Database.Database {
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
    if (!db.memory) db.pragma("journal_mode = WAL");
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
  return new Error(
    `Cannot load ${component} on ${process.platform}-${process.arch}. `
    + "Reinstall dependencies with bun install --frozen-lockfile, retaining platform optional packages, "
    + "and use a supported Node.js or Bun runtime.",
    { cause },
  );
}
