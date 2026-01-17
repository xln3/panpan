/**
 * Embeddings module - text-to-vector conversion for semantic search.
 *
 * Provides an abstraction layer for different embedding providers:
 * - Local: Uses transformers.js with a small model (runs on CPU)
 * - OpenAI: Uses OpenAI's embedding API (requires API key)
 */

/** Embedding provider interface */
export interface EmbeddingProvider {
  /** Provider name for logging/debugging */
  readonly name: string;

  /** Embedding dimension */
  readonly dimension: number;

  /** Initialize the provider (load model, etc.) */
  initialize(): Promise<void>;

  /** Generate embedding for a single text */
  embed(text: string): Promise<Float32Array>;

  /** Generate embeddings for multiple texts (batch) */
  embedBatch(texts: string[]): Promise<Float32Array[]>;

  /** Check if provider is ready */
  isReady(): boolean;

  /** Cleanup resources */
  dispose(): void;
}

/** Configuration for embedding providers */
export interface EmbeddingConfig {
  /** Provider type */
  provider: "local" | "openai";
  /** OpenAI API key (required for openai provider) */
  apiKey?: string;
  /** OpenAI model name (default: text-embedding-3-small) */
  model?: string;
  /** Local model name (default: Xenova/all-MiniLM-L6-v2) */
  localModel?: string;
}

/** Default configuration */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "local",
  localModel: "Xenova/all-MiniLM-L6-v2",
  model: "text-embedding-3-small",
};

// Re-export providers
export { LocalEmbeddingProvider } from "./local.ts";

/**
 * Create an embedding provider based on configuration.
 */
export async function createEmbeddingProvider(
  config: Partial<EmbeddingConfig> = {},
): Promise<EmbeddingProvider> {
  const fullConfig = { ...DEFAULT_EMBEDDING_CONFIG, ...config };

  if (fullConfig.provider === "local") {
    const { LocalEmbeddingProvider } = await import("./local.ts");
    const provider = new LocalEmbeddingProvider(fullConfig.localModel);
    await provider.initialize();
    return provider;
  }

  if (fullConfig.provider === "openai") {
    if (!fullConfig.apiKey) {
      throw new Error("OpenAI API key required for openai embedding provider");
    }
    const { OpenAIEmbeddingProvider } = await import("./openai.ts");
    const provider = new OpenAIEmbeddingProvider(
      fullConfig.apiKey,
      fullConfig.model,
    );
    await provider.initialize();
    return provider;
  }

  throw new Error(`Unknown embedding provider: ${fullConfig.provider}`);
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same dimension");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Serialize a Float32Array to a Uint8Array for storage.
 */
export function serializeEmbedding(embedding: Float32Array): Uint8Array {
  return new Uint8Array(embedding.buffer);
}

/**
 * Deserialize a Uint8Array back to a Float32Array.
 */
export function deserializeEmbedding(data: Uint8Array): Float32Array {
  return new Float32Array(data.buffer);
}
