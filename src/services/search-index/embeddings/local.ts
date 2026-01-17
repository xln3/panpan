/**
 * Local embedding provider using transformers.js.
 *
 * Uses a lightweight sentence transformer model that runs on CPU.
 * Default model: Xenova/all-MiniLM-L6-v2 (384 dimensions, ~30MB)
 *
 * Note: First run will download the model, which may take a few minutes.
 */

import type { EmbeddingProvider } from "./mod.ts";

/** Pipeline and model types from transformers.js */
// deno-lint-ignore no-explicit-any
type Pipeline = any;

/**
 * Local embedding provider using transformers.js
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";
  readonly dimension: number;

  private modelName: string;
  private pipeline: Pipeline | null = null;
  private ready = false;

  constructor(modelName?: string) {
    this.modelName = modelName || "Xenova/all-MiniLM-L6-v2";
    // all-MiniLM-L6-v2 outputs 384 dimensions
    this.dimension = this.modelName.includes("MiniLM") ? 384 : 768;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;

    try {
      // Dynamically import transformers.js
      // This is lazy-loaded to avoid downloading the model unless needed
      const { pipeline } = await import("@xenova/transformers");

      // Create feature-extraction pipeline
      this.pipeline = await pipeline("feature-extraction", this.modelName, {
        // Use quantized model for faster inference and smaller size
        quantized: true,
      });

      this.ready = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize local embedding model: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.ready || !this.pipeline) {
      throw new Error("Provider not initialized. Call initialize() first.");
    }

    // Truncate text if too long (model has max context length)
    const truncatedText = text.substring(0, 8192);

    // Generate embeddings
    const output = await this.pipeline(truncatedText, {
      pooling: "mean", // Use mean pooling for sentence embeddings
      normalize: true, // Normalize to unit vector
    });

    // Extract the embedding data
    const embedding = output.data as Float32Array;

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.ready || !this.pipeline) {
      throw new Error("Provider not initialized. Call initialize() first.");
    }

    // Truncate texts
    const truncatedTexts = texts.map((t) => t.substring(0, 8192));

    // Generate embeddings in batch
    const results: Float32Array[] = [];

    // Process in batches to avoid memory issues
    const batchSize = 32;
    for (let i = 0; i < truncatedTexts.length; i += batchSize) {
      const batch = truncatedTexts.slice(i, i + batchSize);

      const outputs = await this.pipeline(batch, {
        pooling: "mean",
        normalize: true,
      });

      // Handle both single and batch outputs
      if (batch.length === 1) {
        results.push(outputs.data as Float32Array);
      } else {
        // Multi-item batch returns tensor with shape [batch, dimension]
        const data = outputs.data as Float32Array;
        for (let j = 0; j < batch.length; j++) {
          const start = j * this.dimension;
          const end = start + this.dimension;
          results.push(data.slice(start, end));
        }
      }
    }

    return results;
  }

  isReady(): boolean {
    return this.ready;
  }

  dispose(): void {
    this.pipeline = null;
    this.ready = false;
  }
}
