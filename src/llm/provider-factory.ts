/**
 * Provider factory and detection
 */

import type { LLMProvider, ProviderConfig, ProviderType } from "../types/provider.ts";
import { OpenAIProvider } from "./providers/openai.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";

/**
 * Detect provider type from model name
 */
export function detectProviderType(model: string): ProviderType {
  const m = model.toLowerCase();

  // Claude models use Anthropic API
  if (m.startsWith("claude-") || m.includes("claude")) {
    return "anthropic";
  }

  // GLM models (ZhipuAI) use OpenAI-compatible API
  if (m.startsWith("glm-")) {
    return "openai";
  }

  // Default to OpenAI for everything else (gpt-*, o1-*, deepseek-*, qwen-*, etc.)
  return "openai";
}

/**
 * Create provider instance based on config
 * Uses explicit providerType if provided, otherwise auto-detects from model name
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  const providerType = config.providerType || detectProviderType(config.model);
  return createProviderByType(config, providerType);
}

/**
 * Create provider with explicit type (for overriding auto-detection)
 */
export function createProviderByType(
  config: ProviderConfig,
  providerType: ProviderType,
): LLMProvider {
  switch (providerType) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
    default:
      return new OpenAIProvider(config);
  }
}
