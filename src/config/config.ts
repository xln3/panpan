/**
 * Configuration management for panpan
 */

import type { LLMConfig } from "../types/llm.ts";
import type { ProviderType } from "../types/provider.ts";

export interface Config extends LLMConfig {
  verbose: boolean;
}

export interface CLIOptions {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  verbose?: boolean;
  thinking?: boolean;
  thinkingBudget?: number;
  provider?: string;
}

/**
 * Load configuration from environment and CLI options
 * CLI options override environment variables
 */
export function loadConfig(options: CLIOptions): Config {
  const apiKey = options.apiKey ||
    Deno.env.get("PANPAN_API_KEY") ||
    Deno.env.get("OPENAI_API_KEY") ||
    "";

  if (!apiKey) {
    console.error(
      "Error: API key required. Set PANPAN_API_KEY or use --api-key",
    );
    Deno.exit(1);
  }

  // Base URL: CLI > env > default
  const baseUrl = options.baseUrl ||
    Deno.env.get("PANPAN_BASE_URL") ||
    Deno.env.get("OPENAI_BASE_URL") ||
    "https://aihubmix.com/v1/";

  // Model: CLI > env > default
  const model = options.model ||
    Deno.env.get("PANPAN_MODEL") ||
    "claude-haiku-4-5-20251001";

  // Handle provider option (explicit provider type override)
  const provider = options.provider || Deno.env.get("PANPAN_PROVIDER");
  const providerType: ProviderType | undefined =
    provider === "openai" || provider === "anthropic"
      ? provider as ProviderType
      : undefined;

  return {
    baseUrl,
    apiKey,
    model,
    maxTokens: 8192,
    temperature: 0.7,
    verbose: options.verbose ?? false,
    thinking: options.thinking
      ? { enabled: true, budgetTokens: options.thinkingBudget ?? 10000 }
      : undefined,
    providerType,
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config): void {
  if (!config.apiKey) {
    throw new Error("API key is required");
  }
  if (!config.baseUrl) {
    throw new Error("Base URL is required");
  }
  if (!config.model) {
    throw new Error("Model is required");
  }
}
