/**
 * OpenAI embedding provider.
 *
 * Uses OpenAI's embedding API for high-quality embeddings.
 * Default model: text-embedding-3-small (1536 dimensions)
 */

import type { EmbeddingProvider } from "./mod.ts";

/** Model dimensions */
const MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

/**
 * OpenAI embedding provider
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimension: number;

  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private ready = false;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model || "text-embedding-3-small";
    this.baseUrl = baseUrl || "https://api.openai.com/v1";
    this.dimension = MODEL_DIMENSIONS[this.model] || 1536;
  }

  async initialize(): Promise<void> {
    // No initialization needed for API-based provider
    // Just verify the API key works
    try {
      // Make a minimal test request
      await this.embed("test");
      this.ready = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize OpenAI embedding provider: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async embed(text: string): Promise<Float32Array> {
    const result = await this.callApi([text]);
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // OpenAI API supports batch requests
    // But there's a limit on total tokens, so we batch carefully
    const maxBatchSize = 100;
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += maxBatchSize) {
      const batch = texts.slice(i, i + maxBatchSize);
      const batchResults = await this.callApi(batch);
      results.push(...batchResults);
    }

    return results;
  }

  isReady(): boolean {
    return this.ready;
  }

  dispose(): void {
    this.ready = false;
  }

  private async callApi(texts: string[]): Promise<Float32Array[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to preserve order
    const sorted = data.data.sort((a, b) => a.index - b.index);

    return sorted.map((item) => new Float32Array(item.embedding));
  }
}
