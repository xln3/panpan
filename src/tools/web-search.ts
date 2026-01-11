/**
 * WebSearch tool - search the web
 * Note: This is a placeholder that returns a message about needing an API key.
 * In production, you'd integrate with a search API like Brave, Google, or Bing.
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";

const inputSchema = z.object({
  query: z.string().min(2).describe("The search query to use"),
  allowed_domains: z.array(z.string()).optional().describe(
    "Only include search results from these domains",
  ),
  blocked_domains: z.array(z.string()).optional().describe(
    "Never include search results from these domains",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface Output {
  query: string;
  results: SearchResult[];
}

export const WebSearchTool: Tool<typeof inputSchema, Output> = {
  name: "WebSearch",
  description:
    "Search the web and use the results to inform responses. Provides up-to-date information for current events and recent data.",
  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    // Check for search API configuration
    const searchApiKey = Deno.env.get("PANPAN_SEARCH_API_KEY");
    const searchApiUrl = Deno.env.get("PANPAN_SEARCH_API_URL");

    if (!searchApiKey || !searchApiUrl) {
      // Return a message about needing configuration
      const output: Output = {
        query: input.query,
        results: [{
          title: "Web Search Not Configured",
          url: "",
          snippet:
            "Web search requires PANPAN_SEARCH_API_KEY and PANPAN_SEARCH_API_URL environment variables. You can use services like Brave Search API, Google Custom Search, or Bing Search API.",
        }],
      };

      yield {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output),
      };
      return;
    }

    // If configured, make the actual search request
    try {
      const url = new URL(searchApiUrl);
      url.searchParams.set("q", input.query);

      const response = await fetch(url.toString(), {
        headers: {
          "Authorization": `Bearer ${searchApiKey}`,
          "Accept": "application/json",
        },
        signal: context.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }

      const data = await response.json();

      // Adapt response to our format (you'll need to adjust based on your search API)
      const results: SearchResult[] = (data.results || data.web?.results || [])
        .slice(0, 10)
        .map((r: Record<string, string>) => ({
          title: r.title || r.name || "",
          url: r.url || r.link || "",
          snippet: r.snippet || r.description || "",
        }));

      // Apply domain filters
      let filtered = results;
      if (input.allowed_domains?.length) {
        filtered = filtered.filter((r) =>
          input.allowed_domains!.some((d) => r.url.includes(d))
        );
      }
      if (input.blocked_domains?.length) {
        filtered = filtered.filter((r) =>
          !input.blocked_domains!.some((d) => r.url.includes(d))
        );
      }

      const output: Output = {
        query: input.query,
        results: filtered,
      };

      yield {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output),
      };
    } catch (error) {
      const output: Output = {
        query: input.query,
        results: [{
          title: "Search Error",
          url: "",
          snippet: error instanceof Error ? error.message : String(error),
        }],
      };

      yield {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output),
      };
    }
  },

  renderResultForAssistant(output: Output): string {
    if (output.results.length === 0) {
      return `No results found for "${output.query}"`;
    }

    return output.results.map((r) => {
      if (!r.url) {
        return r.snippet;
      }
      return `**${r.title}**\n${r.url}\n${r.snippet}`;
    }).join("\n\n");
  },

  renderToolUseMessage(input) {
    const { query, allowed_domains, blocked_domains } = input;
    const parts = [`"${query}"`];
    if (allowed_domains?.length) {
      parts.push(`allowed: ${allowed_domains.join(", ")}`);
    }
    if (blocked_domains?.length) {
      parts.push(`blocked: ${blocked_domains.join(", ")}`);
    }
    return parts.join(" | ");
  },
};
