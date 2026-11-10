export interface EmbeddingSpace {
  id: string;
  dimensions: number;
  metric: "cosine";
}

export interface EmbeddingProvider {
  space: EmbeddingSpace;
  embed(texts: readonly string[], options: {
    purpose: "document" | "query";
    signal?: AbortSignal;
  }): Promise<readonly Float32Array[]>;
}

export interface MemoryInput {
  id: string;
  sourceId: string;
  text: string;
  sessionId?: string;
  sequence?: number;
  speaker?: string;
  observedAt?: string;
  eventAt?: string;
}

export interface MemoryRecord extends MemoryInput {
  revision: string;
}

export interface UpsertResult {
  records: readonly {
    id: string;
    revision: string;
    status: "inserted" | "updated" | "unchanged";
  }[];
}

export interface UpsertOptions {
  signal?: AbortSignal;
}

export interface OpenMemoryOptions {
  path: string;
  namespace: string;
  embeddings: EmbeddingProvider;
}

export interface Memory {
  upsert(records: readonly MemoryInput[], options?: UpsertOptions): Promise<UpsertResult>;
  get(id: string): Promise<MemoryRecord | undefined>;
  remove(ids: readonly string[]): Promise<number>;
  close(): Promise<void>;
}
