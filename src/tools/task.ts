/**
 * Task tool - spawn subagents for complex tasks
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";
import type { TaskOutput } from "../types/agent.ts";
import type { Message } from "../types/message.ts";
import { LLMClient } from "../llm/client.ts";
import { query, type QueryContext } from "../core/query.ts";
import { createUserMessage } from "../core/messages.ts";
import { getAllTools } from "./mod.ts";
import {
  filterToolsForAgent,
  getAgentByType,
  getAgentDescriptions,
  getAvailableAgentTypes,
} from "../utils/agent-loader.ts";
import {
  createBackgroundTask,
  generateTaskId,
} from "../utils/background-tasks.ts";
import { loggerService } from "../services/mod.ts";

const inputSchema = z.object({
  description: z
    .string()
    .min(1)
    .describe("A short (3-5 word) description of the task"),
  prompt: z.string().min(1).describe("The task for the agent to perform"),
  subagent_type: z
    .string()
    .min(1)
    .describe("The type of specialized agent to use"),
  run_in_background: z
    .boolean()
    .optional()
    .describe("Set to true to run this agent in the background"),
});

type Input = z.infer<typeof inputSchema>;

/**
 * Get LLM config - use provided config or fall back to environment variables
 */
function getLLMConfig(contextConfig?: import("../types/llm.ts").LLMConfig) {
  if (contextConfig) {
    return contextConfig;
  }
  // Fallback to environment variables
  const apiKey = Deno.env.get("PANPAN_API_KEY") ||
    Deno.env.get("OPENAI_API_KEY") || "";
  const baseUrl = Deno.env.get("PANPAN_BASE_URL") ||
    Deno.env.get("OPENAI_BASE_URL") ||
    "https://api.openai.com/v1";
  const model = Deno.env.get("PANPAN_MODEL") || "gpt-4o";

  return { apiKey, baseUrl, model, maxTokens: 8192, temperature: 0.7 };
}

/**
 * Run subagent query and collect final text result
 */
async function runSubagent(
  prompt: string,
  systemPrompt: string,
  tools: Tool[],
  abortSignal: AbortSignal,
  cwd: string,
  llmConfig?: import("../types/llm.ts").LLMConfig,
): Promise<string> {
  const config = getLLMConfig(llmConfig);
  const llmClient = new LLMClient(config);

  const messages: Message[] = [createUserMessage(prompt)];

  const context: QueryContext = {
    abortController: { signal: abortSignal } as AbortController,
    tools,
    readFileTimestamps: {},
    cwd,
    llmConfig: config, // Pass config for nested subagents
  };

  let result = "";

  for await (
    const message of query(messages, [systemPrompt], llmClient, context)
  ) {
    if (message.type === "assistant") {
      // Extract text content from assistant messages
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          result = block.text; // Keep last text response
        }
      }
    }
  }

  return result || "(No response from agent)";
}

/**
 * Task tool - spawns subagents for complex tasks
 */
export const TaskTool: Tool<typeof inputSchema, TaskOutput> = {
  name: "Task",
  description:
    `Launch a specialized agent to handle complex, multi-step tasks autonomously.

Available agent types:
${getAgentDescriptions()}

Usage:
- Provide a short description (3-5 words) summarizing what the agent will do
- Give a detailed prompt with all necessary context
- The agent will work autonomously and return results
- Use run_in_background: true for long-running tasks, then use TaskOutput to retrieve results`,

  inputSchema,

  isReadOnly: () => true, // Task itself doesn't modify files

  isConcurrencySafe: () => false, // Only one task at a time

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<TaskOutput>> {
    const { description, prompt, subagent_type, run_in_background } = input;

    // Validate agent type
    const agentConfig = getAgentByType(subagent_type);
    if (!agentConfig) {
      const available = getAvailableAgentTypes().join(", ");
      yield {
        type: "result",
        data: {
          taskId: "",
          status: "completed",
          error:
            `Unknown agent type "${subagent_type}". Available types: ${available}`,
        },
      };
      return;
    }

    // Filter tools for this agent
    const allTools = getAllTools();
    const allowedToolNames = filterToolsForAgent(
      allTools.map((t) => t.name),
      agentConfig,
    );
    const filteredTools = allTools.filter((t) =>
      allowedToolNames.includes(t.name)
    );

    const taskId = generateTaskId();

    if (run_in_background) {
      // Background execution
      const { markComplete, abortController } = createBackgroundTask(
        taskId,
        subagent_type,
        description,
        prompt,
      );

      const hooks = loggerService.getHooks();

      // Start background execution
      (async () => {
        hooks.onSAInvoke(subagent_type, prompt);
        try {
          const result = await runSubagent(
            prompt,
            agentConfig.systemPrompt,
            filteredTools,
            abortController.signal,
            context.cwd,
            context.llmConfig,
          );
          hooks.onSAComplete(subagent_type, result);
          markComplete(result);
        } catch (error) {
          hooks.onToolError(`SA:${subagent_type}`, error instanceof Error ? error : new Error(String(error)));
          markComplete(
            undefined,
            error instanceof Error ? error.message : String(error),
          );
        }
      })();

      yield {
        type: "result",
        data: {
          taskId,
          status: "async_launched",
        },
        resultForAssistant:
          `Agent launched in background with task ID: ${taskId}\nUse TaskOutput tool with this ID to retrieve results when ready.`,
      };
    } else {
      // Synchronous execution
      yield { type: "progress", content: `Running ${subagent_type} agent...` };

      const hooks = loggerService.getHooks();
      hooks.onSAInvoke(subagent_type, prompt);

      try {
        const result = await runSubagent(
          prompt,
          agentConfig.systemPrompt,
          filteredTools,
          context.abortController.signal,
          context.cwd,
          context.llmConfig,
        );

        hooks.onSAComplete(subagent_type, result);

        yield {
          type: "result",
          data: {
            taskId,
            status: "completed",
            result,
          },
        };
      } catch (error) {
        hooks.onToolError(`SA:${subagent_type}`, error instanceof Error ? error : new Error(String(error)));

        yield {
          type: "result",
          data: {
            taskId,
            status: "completed",
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
  },

  renderResultForAssistant(output: TaskOutput): string {
    if (output.status === "async_launched") {
      return `Agent launched in background with task ID: ${output.taskId}\nUse TaskOutput tool with this ID to retrieve results when ready.`;
    }

    if (output.error) {
      return `Agent error: ${output.error}`;
    }

    return output.result || "(No result)";
  },

  renderToolUseMessage(input) {
    const { description, subagent_type, run_in_background } = input;
    const bg = run_in_background ? " [background]" : "";
    return `${subagent_type}: ${description}${bg}`;
  },
};
