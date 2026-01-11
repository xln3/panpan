/**
 * panpan - AI-powered coding assistant
 *
 * A Deno CLI tool for interacting with LLMs using OpenAI-compatible APIs.
 * Supports tool use for file operations, shell commands, and web access.
 *
 * Usage:
 *   deno run --allow-all mod.ts [options]
 *
 * Options:
 *   -m, --model <model>     Model to use (default: gpt-4o)
 *   --base-url <url>        API base URL (default: https://api.openai.com/v1)
 *   --api-key <key>         API key (or use PANPAN_API_KEY env)
 *   -v, --verbose           Show verbose output
 *   -h, --help              Show this help
 *   -V, --version           Show version
 */

import { Command } from "@cliffy/command";
import { loadConfig } from "./src/config/config.ts";
import { runREPL } from "./src/ui/repl.ts";

const VERSION = "0.1.0";

// Parse command line arguments
const { options } = await new Command()
  .name("panpan")
  .version(VERSION)
  .description("AI-powered coding assistant for the terminal")
  .option("-m, --model <model:string>", "Model to use")
  .option("--base-url <url:string>", "API base URL")
  .option("--api-key <key:string>", "API key (or use PANPAN_API_KEY env)")
  .option("-v, --verbose", "Show verbose output")
  .option("--thinking", "Enable extended thinking (Anthropic only)")
  .option("--thinking-budget <tokens:number>", "Thinking token budget")
  .option("--provider <provider:string>", "Provider type (openai|anthropic)")
  .example(
    "Basic usage",
    "panpan",
  )
  .example(
    "Use different model",
    "panpan --model claude-haiku-4-5",
  )
  .example(
    "Use custom API endpoint",
    "panpan --base-url https://aihubmix.com/v1 --api-key sk-xxx",
  )
  .example(
    "Use ZhipuAI (GLM models)",
    "panpan --model glm-4.7 --base-url https://open.bigmodel.cn/api/paas/v4/",
  )
  .parse(Deno.args);

// Load configuration
const config = loadConfig({
  model: options.model,
  baseUrl: options.baseUrl,
  apiKey: options.apiKey,
  verbose: options.verbose,
  thinking: options.thinking,
  thinkingBudget: options.thinkingBudget,
  provider: options.provider,
});

// Run the REPL
await runREPL(config);

// Ensure clean exit (Cliffy may leave stdin listeners)
Deno.exit(0);
