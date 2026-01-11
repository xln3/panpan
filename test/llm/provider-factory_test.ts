/**
 * Tests for src/llm/provider-factory.ts
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  createProvider,
  createProviderByType,
  detectProviderType,
} from "../../src/llm/provider-factory.ts";
import { OpenAIProvider } from "../../src/llm/providers/openai.ts";
import { AnthropicProvider } from "../../src/llm/providers/anthropic.ts";

// =============================================================================
// detectProviderType tests
// =============================================================================

Deno.test("detectProviderType - returns anthropic for claude-* models", () => {
  assertEquals(detectProviderType("claude-3-opus"), "anthropic");
  assertEquals(detectProviderType("claude-3-sonnet"), "anthropic");
  assertEquals(detectProviderType("claude-haiku-4-5-20251001"), "anthropic");
  assertEquals(detectProviderType("claude-opus-4-5-20251101"), "anthropic");
});

Deno.test("detectProviderType - returns anthropic for models containing 'claude'", () => {
  assertEquals(detectProviderType("my-claude-model"), "anthropic");
  assertEquals(detectProviderType("some-claude-variant"), "anthropic");
});

Deno.test("detectProviderType - is case insensitive", () => {
  assertEquals(detectProviderType("CLAUDE-3-OPUS"), "anthropic");
  assertEquals(detectProviderType("Claude-3-Sonnet"), "anthropic");
  assertEquals(detectProviderType("CLAUDE-HAIKU"), "anthropic");
});

Deno.test("detectProviderType - returns openai for glm-* models", () => {
  assertEquals(detectProviderType("glm-4"), "openai");
  assertEquals(detectProviderType("glm-4-flash"), "openai");
  assertEquals(detectProviderType("glm-4-plus"), "openai");
});

Deno.test("detectProviderType - returns openai for gpt-* models", () => {
  assertEquals(detectProviderType("gpt-4"), "openai");
  assertEquals(detectProviderType("gpt-4-turbo"), "openai");
  assertEquals(detectProviderType("gpt-4o"), "openai");
  assertEquals(detectProviderType("gpt-3.5-turbo"), "openai");
});

Deno.test("detectProviderType - returns openai for o1-* models", () => {
  assertEquals(detectProviderType("o1-preview"), "openai");
  assertEquals(detectProviderType("o1-mini"), "openai");
});

Deno.test("detectProviderType - returns openai for deepseek models", () => {
  assertEquals(detectProviderType("deepseek-chat"), "openai");
  assertEquals(detectProviderType("deepseek-coder"), "openai");
});

Deno.test("detectProviderType - returns openai for qwen models", () => {
  assertEquals(detectProviderType("qwen-turbo"), "openai");
  assertEquals(detectProviderType("qwen-plus"), "openai");
});

Deno.test("detectProviderType - returns openai as default for unknown models", () => {
  assertEquals(detectProviderType("some-unknown-model"), "openai");
  assertEquals(detectProviderType("custom-model"), "openai");
  assertEquals(detectProviderType(""), "openai");
});

// =============================================================================
// createProvider tests
// =============================================================================

const baseConfig = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "test-key",
  model: "",
};

Deno.test("createProvider - creates AnthropicProvider for claude models", () => {
  const provider = createProvider({ ...baseConfig, model: "claude-3-opus" });
  assertEquals(provider instanceof AnthropicProvider, true);
  assertEquals(provider.providerType, "anthropic");
});

Deno.test("createProvider - creates OpenAIProvider for gpt models", () => {
  const provider = createProvider({ ...baseConfig, model: "gpt-4" });
  assertEquals(provider instanceof OpenAIProvider, true);
  assertEquals(provider.providerType, "openai");
});

Deno.test("createProvider - creates OpenAIProvider for glm models", () => {
  const provider = createProvider({ ...baseConfig, model: "glm-4" });
  assertEquals(provider instanceof OpenAIProvider, true);
  assertEquals(provider.providerType, "openai");
});

Deno.test("createProvider - uses explicit providerType over auto-detection", () => {
  // Force anthropic even for gpt model name
  const provider = createProvider({
    ...baseConfig,
    model: "gpt-4",
    providerType: "anthropic",
  });
  assertEquals(provider instanceof AnthropicProvider, true);
  assertEquals(provider.providerType, "anthropic");
});

Deno.test("createProvider - uses explicit openai for claude model name", () => {
  // Force openai even for claude model name
  const provider = createProvider({
    ...baseConfig,
    model: "claude-3-opus",
    providerType: "openai",
  });
  assertEquals(provider instanceof OpenAIProvider, true);
  assertEquals(provider.providerType, "openai");
});

// =============================================================================
// createProviderByType tests
// =============================================================================

Deno.test("createProviderByType - creates AnthropicProvider for anthropic type", () => {
  const provider = createProviderByType(baseConfig, "anthropic");
  assertEquals(provider instanceof AnthropicProvider, true);
});

Deno.test("createProviderByType - creates OpenAIProvider for openai type", () => {
  const provider = createProviderByType(baseConfig, "openai");
  assertEquals(provider instanceof OpenAIProvider, true);
});

Deno.test("createProviderByType - defaults to OpenAI for unknown type", () => {
  // @ts-expect-error Testing unknown type behavior
  const provider = createProviderByType(baseConfig, "unknown");
  assertEquals(provider instanceof OpenAIProvider, true);
});
