import { MemoryError } from "./errors.js";
import type { EmbeddingProvider, EmbeddingSpace } from "./types.js";

export function snapshotSpace(provider: EmbeddingProvider): Readonly<EmbeddingSpace> {
  const space = provider.space;
  if (!space || typeof space !== "object" || Array.isArray(space)
    || Reflect.ownKeys(space).some(key => !["id", "dimensions", "metric"].includes(String(key)))
    || typeof space.id !== "string" || space.id.trim().length === 0
    || Buffer.from(space.id, "utf8").toString("utf8") !== space.id
    || !Number.isSafeInteger(space.dimensions) || space.dimensions < 1 || space.dimensions > 8192
    || space.metric !== "cosine") {
    throw new MemoryError("INVALID_INPUT", "An embedding space requires an ID, dimensions 1..8192, and cosine metric.");
  }
  return Object.freeze({ id: space.id, dimensions: space.dimensions, metric: space.metric });
}

export function checkSpace(provider: EmbeddingProvider, space: Readonly<EmbeddingSpace>): void {
  const current = provider.space;
  if (!current || current.id !== space.id || current.dimensions !== space.dimensions
    || current.metric !== space.metric
    || Reflect.ownKeys(current).some(key => !["id", "dimensions", "metric"].includes(String(key)))) {
    throw new MemoryError("EMBEDDING_MISMATCH", "The provider embedding space changed after opening this database.");
  }
}

export async function embedDocuments(provider: EmbeddingProvider, space: Readonly<EmbeddingSpace>,
  texts: readonly string[], signal?: AbortSignal,
): Promise<Buffer[]> {
  signal?.throwIfAborted();
  checkSpace(provider, space);
  let vectors: readonly Float32Array[];
  try {
    vectors = await provider.embed(Object.freeze([...texts]), { purpose: "document", ...(signal ? { signal } : {}) });
  } catch (cause) {
    signal?.throwIfAborted();
    throw new MemoryError("PROVIDER_FAILURE", "The embedding provider failed.", { cause });
  }
  signal?.throwIfAborted();
  checkSpace(provider, space);
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new MemoryError("EMBEDDING_MISMATCH", "The provider returned an unexpected number of embeddings.");
  }
  return Array.from(vectors, vector => {
    if (!(vector instanceof Float32Array) || vector.length !== space.dimensions) {
      throw new MemoryError("EMBEDDING_MISMATCH", "A provider vector has the wrong type or dimensions.");
    }
    const values = Float32Array.from(vector);
    let squaredNorm = 0;
    for (const value of values) {
      if (!Number.isFinite(value)) throw new MemoryError("EMBEDDING_MISMATCH", "A provider vector contains a nonfinite value.");
      squaredNorm += value * value;
    }
    if (squaredNorm === 0 || !Number.isFinite(squaredNorm)) {
      throw new MemoryError("EMBEDDING_MISMATCH", "A provider vector must have a finite nonzero norm.");
    }
    const norm = Math.sqrt(squaredNorm);
    const bytes = Buffer.alloc(space.dimensions * 4);
    let normalizedNorm = 0;
    for (let index = 0; index < values.length; index++) {
      values[index] = values[index] / norm;
      const value = values[index];
      if (!Number.isFinite(value)) throw new MemoryError("EMBEDDING_MISMATCH", "Normalization produced a nonfinite value.");
      normalizedNorm += value * value;
      bytes.writeFloatLE(value, index * 4);
    }
    if (normalizedNorm === 0 || !Number.isFinite(normalizedNorm)) {
      throw new MemoryError("EMBEDDING_MISMATCH", "Normalization produced an invalid vector norm.");
    }
    return bytes;
  });
}
