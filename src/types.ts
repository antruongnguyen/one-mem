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

export interface Scope {
  sourceId?: string;
  sessionId?: string;
}

export interface SearchOptions extends Scope {
  limit?: number;
  maxEvidenceBytes?: number;
  signal?: AbortSignal;
}

export interface EvidenceItem {
  record: MemoryRecord;
  role: "match";
  score: number;
  ranks: { dense?: number; lexical?: number };
}

export interface Evidence {
  namespace: string;
  query: string;
  embeddingSpace: EmbeddingSpace;
  items: readonly EvidenceItem[];
  diagnostics: {
    denseCandidates: number;
    lexicalCandidates: number;
    lexicalTermsUsed: number;
    lexicalTermsTruncated: boolean;
    usedBytes: number;
    budgetOmitted: number;
  };
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
  search(query: string, options?: SearchOptions): Promise<Evidence>;
  close(): Promise<void>;
}
