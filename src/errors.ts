export type MemoryErrorCode = "INVALID_INPUT" | "EMBEDDING_MISMATCH" | "PROVIDER_FAILURE"
  | "DATABASE_MISMATCH" | "UNSUPPORTED_SCHEMA" | "CONFLICT" | "SQLITE_UNAVAILABLE"
  | "BUSY" | "CLOSED";

export class MemoryError extends Error {
  constructor(public readonly code: MemoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MemoryError";
  }
}
