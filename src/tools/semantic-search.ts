/**
 * Semantic Search tool - natural language code search using embeddings.
 *
 * Uses vector embeddings to find code that is semantically similar to
 * a natural language query, even if the exact words don't match.
 *
 * Example queries:
 * - "function that handles user authentication"
 * - "error handling for network requests"
 * - "code that parses JSON configuration"
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";
import { getSearchIndexService } from "../services/search-index/mod.ts";

const inputSchema = z.object({
  query: z.string().describe(
    "Natural language description of the code you're looking for",
  ),
  limit: z.number().optional().default(10).describe(
    "Maximum number of results to return (default: 10)",
  ),
  min_score: z.number().optional().default(0.5).describe(
    "Minimum similarity score (0-1, default: 0.5)",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  matches: Array<{
    file: string;
    score: number;
    preview: string;
  }>;
  numFiles: number;
  available: boolean;
}

export const SemanticSearchTool: Tool<typeof inputSchema, Output> = {
  name: "SemanticSearch",
  description:
    "Search code using natural language. Finds semantically similar code even when exact keywords don't match. Requires vector index to be enabled.",
  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const indexService = getSearchIndexService();

    // Check if vector search is available
    if (!indexService?.isInitialized()) {
      yield {
        type: "result",
        data: {
          matches: [],
          numFiles: 0,
          available: false,
        },
        resultForAssistant:
          "Semantic search is not available. The search index has not been initialized.",
      };
      return;
    }

    const config = indexService.getConfig();
    if (!config.enableVectors) {
      yield {
        type: "result",
        data: {
          matches: [],
          numFiles: 0,
          available: false,
        },
        resultForAssistant:
          "Semantic search is not available. Vector indexing is not enabled in the configuration.",
      };
      return;
    }

    try {
      // Perform semantic search
      const results = await indexService.semanticSearch(input.query, {
        limit: input.limit,
        minScore: input.min_score,
      });

      const matches = results.map((r) => ({
        file: r.filePath,
        score: r.score,
        preview: r.chunkText?.substring(0, 200) ?? "",
      }));

      yield {
        type: "result",
        data: {
          matches,
          numFiles: matches.length,
          available: true,
        },
        resultForAssistant: this.renderResultForAssistant({
          matches,
          numFiles: matches.length,
          available: true,
        }),
      };
    } catch (error) {
      yield {
        type: "result",
        data: {
          matches: [],
          numFiles: 0,
          available: false,
        },
        resultForAssistant: `Semantic search failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },

  renderResultForAssistant(output: Output): string {
    if (!output.available) {
      return "Semantic search is not available.";
    }

    if (output.matches.length === 0) {
      return "No semantically similar code found.";
    }

    const results = output.matches.map(
      (m) => `${m.file} (score: ${m.score.toFixed(3)})\n  ${m.preview}`,
    ).join("\n\n");

    return `Found ${output.numFiles} matching files:\n\n${results}`;
  },

  renderToolUseMessage(input, _options) {
    return `query: "${input.query}", limit: ${input.limit}`;
  },
};
