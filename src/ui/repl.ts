/**
 * REPL (Read-Eval-Print Loop) for panpan
 * Interactive terminal interface using Cliffy
 */

import { Input } from "@cliffy/prompt";
import * as colors from "@std/fmt/colors";
import { query, type QueryContext } from "../core/query.ts";
import { LLMClient } from "../llm/client.ts";
import { getAllTools } from "../tools/mod.ts";
import { createUserMessage } from "../core/messages.ts";
import type { Config } from "../config/config.ts";
import type { ContentBlock, Message, TokenUsage } from "../types/message.ts";
import type { Tool } from "../types/tool.ts";
import { formatCost, formatDuration } from "./render.ts";
import { clearTodos, renderTodos } from "../utils/todo-storage.ts";
import {
  getPlanFilePath,
  isPlanMode,
  readPlanFile,
} from "../utils/plan-mode.ts";
import { resetReminderSession } from "../services/system-reminder.ts";
import { OutputDisplayController } from "./output-display.ts";

const BANNER = `
╔═══════════════════════════════════════╗
║             ${colors.cyan("panpan")}                    ║
║   A Porting Agent for NN migration    ║
╚═══════════════════════════════════════╝
`;

/** Interrupt handler for processing - listens for ESC and Ctrl+O keys */
class InterruptHandler {
  private isProcessing = false;
  private onInterrupt: (() => void) | null = null;
  private onToggleOutput: (() => void) | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  startProcessing(
    onInterrupt: () => void,
    onToggleOutput?: () => void,
  ): void {
    this.isProcessing = true;
    this.onInterrupt = onInterrupt;
    this.onToggleOutput = onToggleOutput ?? null;

    // Start key listener only if stdin is a terminal
    if (Deno.stdin.isTerminal()) {
      this.startKeyListener();
    }
  }

  private async startKeyListener(): Promise<void> {
    try {
      Deno.stdin.setRaw(true);
      this.reader = Deno.stdin.readable.getReader();

      while (this.isProcessing && this.reader) {
        const { value, done } = await this.reader.read();
        if (done || !this.isProcessing) break;

        if (value) {
          // Ctrl+O is byte 15
          if (value[0] === 15) {
            if (this.onToggleOutput) {
              this.onToggleOutput();
            }
            continue; // Keep listening after toggle
          }

          // Bare ESC key (byte 27), not escape sequence (ESC + [ + ...)
          // Escape sequences like arrow keys send: ESC (27) + [ (91) + code
          if (value[0] === 27 && (value.length === 1 || value[1] !== 91)) {
            if (this.isProcessing && this.onInterrupt) {
              this.onInterrupt();
            }
            break;
          }
        }
      }
    } catch {
      // Expected when reader is cancelled
    } finally {
      if (this.reader) {
        try {
          this.reader.releaseLock();
        } catch {
          // Ignore - might already be released
        }
        this.reader = null;
      }
      try {
        Deno.stdin.setRaw(false);
      } catch {
        // Ignore
      }
    }
  }

  stopProcessing(): void {
    this.isProcessing = false;
    this.onInterrupt = null;
    this.onToggleOutput = null;

    if (this.reader) {
      this.reader.cancel().catch(() => {});
    }

    // Ensure raw mode is off
    if (Deno.stdin.isTerminal()) {
      try {
        Deno.stdin.setRaw(false);
      } catch {
        // Ignore
      }
    }
  }

  cleanup(): void {
    this.stopProcessing();
  }
}

/**
 * Run the interactive REPL
 */
export async function runREPL(config: Config): Promise<void> {
  // Clear todos from previous session and reset reminder session
  await clearTodos();
  resetReminderSession();

  const llmClient = new LLMClient(config);
  const tools = getAllTools();
  const messages: Message[] = [];
  const systemPrompt = getSystemPrompt();

  // Check if stdin is interactive
  const isInteractive = Deno.stdin.isTerminal();

  // Print banner only in interactive mode
  if (isInteractive) {
    console.log(BANNER);
    console.log(colors.dim(`Model: ${config.model}`));
    console.log(colors.dim(`API: ${config.baseUrl}`));
    console.log(colors.dim("Type exit to quit, /help for commands\n"));
  }

  let totalCost = 0;
  const interruptHandler = new InterruptHandler();

  try {
    while (true) {
      // Get user input
      let userInput: string;

      if (isInteractive) {
        // Interactive mode: use Cliffy prompt
        const modeIndicator = isPlanMode()
          ? colors.magenta("⏸ ")
          : colors.green("❯ ");

        try {
          userInput = await Input.prompt({
            message: "",
            prefix: modeIndicator,
          });
        } catch {
          // Ctrl+C during input - show hint and continue
          console.log(colors.dim("\n(Type exit to quit)"));
          continue;
        }
      } else {
        // Non-interactive mode: read line from stdin
        const buf = new Uint8Array(4096);
        const n = await Deno.stdin.read(buf);
        if (n === null) {
          // EOF - exit gracefully
          break;
        }
        userInput = new TextDecoder().decode(buf.subarray(0, n)).trim();
      }

      // Handle commands
      if (userInput.startsWith("/")) {
        const handled = handleCommand(userInput, messages, totalCost);
        if (handled === "exit") break;
        if (handled) continue;
      }

      // Handle bare exit commands (without /)
      const bareCmd = userInput.trim().toLowerCase();
      if (bareCmd === "exit" || bareCmd === "quit" || bareCmd === "q") {
        console.log(colors.dim(`\nTotal cost: ${formatCost(totalCost)}`));
        console.log(colors.dim("Goodbye!"));
        break;
      }

      // Skip empty input
      if (!userInput.trim()) continue;

      // Create user message and add to history
      const userMessage = createUserMessage(userInput);
      messages.push(userMessage);

      // Create abort controller and output display
      const abortController = new AbortController();
      const outputDisplay = new OutputDisplayController();

      // Start interrupt handler with toggle output callback
      interruptHandler.startProcessing(
        () => {
          abortController.abort();
          outputDisplay.stop();
          console.log(colors.yellow("\n[Interrupted]"));
        },
        () => {
          outputDisplay.toggle();
        },
      );

      // Query context
      const context: QueryContext = {
        abortController,
        tools,
        readFileTimestamps: {},
        cwd: Deno.cwd(),
        llmConfig: config, // Pass config for subagent tools
        outputDisplay, // For streaming output display
      };

      // Track start time for error cases
      const startTime = Date.now();

      try {
        for await (
          const message of query(messages, systemPrompt, llmClient, context)
        ) {
          if (message.type === "assistant") {
            messages.push(message);
            totalCost += message.costUSD;

            // Render assistant message
            for (const block of message.message.content) {
              if (block.type === "thinking") {
                renderThinking(block);
              } else if (block.type === "text" && block.text) {
                console.log(block.text);
              } else if (block.type === "tool_use") {
                trackToolUse(block);
                renderToolUse(block, tools, config.verbose, context.cwd);
              }
            }

            // Always show stats (time + tokens + cost)
            const statsStr = formatStats(
              message.durationMs,
              message.usage,
              message.costUSD,
            );
            console.log(colors.dim(statsStr));
          } else if (message.type === "user") {
            messages.push(message);

            // Render tool results
            const content = message.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "tool_result") {
                  renderToolResult(block);
                }
              }
            }
          } else if (message.type === "progress") {
            console.log(colors.dim(`[Progress: ${message.content}]`));
          }
        }
      } catch (error) {
        outputDisplay.stop();
        const durationMs = Date.now() - startTime;
        if (!abortController.signal.aborted) {
          console.log(
            colors.red(
              `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
          // Show duration even on error
          console.log(colors.dim(`[${formatDuration(durationMs)}]`));
        }
      } finally {
        outputDisplay.stop();
        interruptHandler.stopProcessing();
      }

      console.log(""); // Blank line between exchanges
    }
  } finally {
    interruptHandler.cleanup();
  }
}

/**
 * Handle slash commands
 */
function handleCommand(
  input: string,
  messages: Message[],
  totalCost: number,
): string | boolean {
  const trimmed = input.trim();
  const cmd = trimmed.toLowerCase();

  // Handle /export with optional filename
  if (cmd === "/export" || cmd.startsWith("/export ")) {
    const filename = trimmed.slice(7).trim() || generateExportFilename();
    exportConversation(messages, filename, totalCost);
    return true;
  }

  switch (cmd) {
    case "/exit":
    case "/quit":
    case "/q":
      console.log(colors.dim(`\nTotal cost: ${formatCost(totalCost)}`));
      console.log(colors.dim("Goodbye!"));
      return "exit";

    case "/help":
    case "/h":
      console.log(`
${colors.cyan("Commands:")}
  /exit, /quit, /q  - Exit panpan
  /clear            - Clear conversation history
  /cost             - Show total cost
  /todos            - Show task list
  /plan             - Show current plan (in plan mode)
  /export [file]    - Export conversation to file
  /help, /h         - Show this help
`);
      return true;

    case "/clear":
      messages.length = 0;
      console.log(colors.dim("Conversation cleared."));
      return true;

    case "/cost":
      console.log(colors.dim(`Total cost: ${formatCost(totalCost)}`));
      return true;

    case "/todos":
      console.log(colors.cyan("\nTodos:"));
      console.log(renderTodos());
      console.log("");
      return true;

    case "/plan": {
      if (!isPlanMode()) {
        console.log(colors.dim("Not in plan mode."));
        return true;
      }
      const planPath = getPlanFilePath();
      const planContent = readPlanFile();
      console.log(colors.cyan(`\nPlan file: ${planPath}\n`));
      if (planContent) {
        console.log(planContent);
      } else {
        console.log(colors.dim("(empty)"));
      }
      console.log("");
      return true;
    }

    default:
      console.log(colors.yellow(`Unknown command: ${input}`));
      return true;
  }
}

/**
 * Generate default export filename
 */
function generateExportFilename(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().split(" ")[0].replace(/:/g, "-");
  return `panpan-${date}-${time}.md`;
}

/**
 * Export conversation to a file
 */
function exportConversation(
  messages: Message[],
  filename: string,
  totalCost: number,
): void {
  const lines: string[] = [];

  lines.push("# Panpan Conversation Export");
  lines.push("");
  lines.push(`**Exported:** ${new Date().toISOString()}`);
  lines.push(`**Total Cost:** ${formatCost(totalCost)}`);
  lines.push(`**Messages:** ${messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    if (msg.type === "user") {
      const content = msg.message.content;
      if (typeof content === "string") {
        lines.push(`## User`);
        lines.push("");
        lines.push(content);
        lines.push("");
      } else {
        // Tool results
        for (const block of content) {
          if (block.type === "text") {
            lines.push(`## User`);
            lines.push("");
            lines.push(block.text);
            lines.push("");
          } else if (block.type === "tool_result") {
            lines.push(`### Tool Result: ${block.tool_use_id}`);
            lines.push("");
            if (block.is_error) {
              lines.push("**Error:**");
            }
            lines.push("```");
            lines.push(block.content);
            lines.push("```");
            lines.push("");
          }
        }
      }
    } else if (msg.type === "assistant") {
      lines.push(`## Assistant`);
      lines.push("");

      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) {
          lines.push(block.text);
          lines.push("");
        } else if (block.type === "tool_use") {
          lines.push(`### Tool: ${block.name}`);
          lines.push("");
          lines.push("```json");
          lines.push(JSON.stringify(block.input, null, 2));
          lines.push("```");
          lines.push("");
        }
      }
    }
  }

  try {
    Deno.writeTextFileSync(filename, lines.join("\n"));
    console.log(colors.green(`Exported to: ${filename}`));
  } catch (error) {
    console.log(
      colors.red(
        `Export failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
  }
}

/**
 * Render a tool use block
 */
function renderToolUse(
  block: ContentBlock,
  tools: Tool[],
  verbose: boolean,
  cwd: string,
): void {
  if (block.type !== "tool_use") return;

  const tool = tools.find((t) => t.name === block.name);

  // Try to use renderToolUseMessage if available
  let message: string | null = null;
  if (tool?.renderToolUseMessage && !verbose) {
    try {
      message = tool.renderToolUseMessage(block.input, { verbose, cwd });
    } catch {
      // Fall back to JSON
    }
  }

  // If message is null, tool is hidden (like TodoWrite)
  if (message === null && tool?.renderToolUseMessage && !verbose) {
    return;
  }

  // If we have a concise message, show it
  if (message !== null && message !== undefined) {
    if (message === "") {
      // Empty message = just show tool name
      console.log(colors.yellow(`\n[${block.name}]`));
    } else {
      console.log(
        colors.yellow(`\n[${block.name}]`) + colors.dim(` ${message}`),
      );
    }
    return;
  }

  // Verbose mode or fallback: show full JSON
  console.log(colors.yellow(`\n[Tool: ${block.name}]`));
  const inputStr = JSON.stringify(block.input, null, 2);
  const lines = inputStr.split("\n");
  if (lines.length > 8 && !verbose) {
    console.log(colors.dim(lines.slice(0, 8).join("\n") + "\n..."));
  } else {
    console.log(colors.dim(inputStr));
  }
}

// Track last tool_use to know what type of result we're rendering
let lastToolUseName: string | null = null;

/**
 * Track tool use for result rendering
 */
function trackToolUse(block: ContentBlock): void {
  if (block.type === "tool_use") {
    lastToolUseName = block.name;
  }
}

/**
 * Render a tool result
 */
function renderToolResult(block: ContentBlock): void {
  if (block.type !== "tool_result") return;

  // Format duration suffix
  const durationSuffix = block.durationMs
    ? colors.dim(` [${formatDuration(block.durationMs)}]`)
    : "";

  // Special handling for TodoWrite - show the todo list
  if (lastToolUseName === "TodoWrite") {
    console.log(colors.cyan("\n[Todos]") + durationSuffix);
    console.log(renderTodos());
    lastToolUseName = null;
    return;
  }

  lastToolUseName = null;

  // Show full content (no truncation)
  if (block.is_error) {
    console.log(
      colors.red(`\n[Error]`) + durationSuffix + `\n${block.content}`,
    );
  } else {
    console.log(
      colors.dim(`\n[Result]`) + durationSuffix +
        colors.dim(`\n${block.content}`),
    );
  }
}

/**
 * Render thinking/reasoning content
 */
function renderThinking(block: ContentBlock): void {
  if (block.type !== "thinking") return;

  const thinking = block.thinking;
  if (!thinking) return;

  console.log(
    colors.magenta("\n┌─ Thinking ─────────────────────────────────"),
  );

  // Split into lines and add border
  const lines = thinking.split("\n");
  const maxLines = 50; // Limit display length

  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    console.log(colors.magenta("│ ") + colors.dim(lines[i]));
  }

  if (lines.length > maxLines) {
    console.log(
      colors.magenta("│ ") +
        colors.dim(`... (${lines.length - maxLines} more lines)`),
    );
  }

  console.log(
    colors.magenta("└────────────────────────────────────────────\n"),
  );
}

/**
 * Format stats for display (time, tokens, cost)
 */
function formatStats(
  durationMs: number,
  usage: TokenUsage | undefined,
  costUSD: number,
): string {
  const parts: string[] = [];

  // Duration
  parts.push(formatDuration(durationMs));

  // Tokens
  if (usage) {
    const inTokens = usage.prompt_tokens;
    const outTokens = usage.completion_tokens;
    let tokenStr = `${inTokens}→${outTokens} tokens`;

    // Add cache stats if available (Anthropic prompt caching)
    if (usage.cache_read_input_tokens && usage.cache_read_input_tokens > 0) {
      tokenStr += ` (${usage.cache_read_input_tokens} cached)`;
    } else if (
      usage.cache_creation_input_tokens && usage.cache_creation_input_tokens > 0
    ) {
      tokenStr += ` (${usage.cache_creation_input_tokens} cache write)`;
    }

    parts.push(tokenStr);
  }

  // Cost
  parts.push(formatCost(costUSD));

  return `[${parts.join(" | ")}]`;
}

/**
 * Get system prompt
 */
function getSystemPrompt(): string[] {
  const cwd = Deno.cwd();
  const date = new Date().toISOString().split("T")[0];

  return [
    `You are panpan, an AI-powered coding assistant running in the terminal.

You have access to tools for:
- Reading and editing files (Read, Edit, Write)
- Searching code (Glob, Grep)
- Running LOCAL shell commands (Bash)
- Fetching web content (WebFetch, WebSearch)
- Task tracking (TodoWrite)
- Spawning subagents (Task) - for remote ops, complex tasks, exploration, resource monitoring

## CRITICAL: When to use the Task tool with different subagents

### Remote SA (subagent_type="Remote")
**IMPORTANT**: When the user asks you to:
- Connect to remote servers via SSH
- Run commands on remote machines
- Check remote server status (GPU, disk, processes)
- Transfer files to/from remote servers

You **MUST** use \`Task({ subagent_type: "Remote", prompt: "..." })\` instead of \`Bash\` + ssh/sshpass.
Remote SA handles:
- Connection management (avoids hostname typos)
- Credential storage (no passwords in command line)
- Automatic reconnection on failure

**NEVER** use Bash to run ssh/sshpass commands directly. ALWAYS delegate to Remote SA.

### PM SA (subagent_type="PM")
**IMPORTANT**: When the user asks you to:
- Complete a multi-stage task (e.g., "reproduce this paper", "implement this feature")
- Execute tasks that need verification/testing
- Work on complex projects with unclear requirements

You **SHOULD** use \`Task({ subagent_type: "PM", prompt: "..." })\` to:
- Clarify requirements before implementation (ask questions like "which checkpoints?", "what's the fallback plan?")
- Generate acceptance tests
- Track budget and attempts
- Switch to alternative approaches when blocked

### Watcher SA (subagent_type="Watcher")
**IMPORTANT**: Before long-running operations:
- Check disk space before large downloads (models, datasets)
- Monitor GPU/CPU usage during training
- Detect resource bottlenecks

You **SHOULD** use \`Task({ subagent_type: "Watcher", prompt: "..." })\` to avoid resource exhaustion.

### Explore SA (subagent_type="Explore")
When the user asks "explain X", "how does X work", or "what is the architecture":
Use \`Task({ subagent_type: "Explore", prompt: "..." })\` instead of calling Read/Glob/Grep directly.

### When NOT to use Task:
- Simple file reads where you know the exact path
- Single grep/glob search
- Direct edits to specific files

## CRITICAL: Task Management with TodoWrite

You MUST use TodoWrite for any task with 2+ steps. This is NOT optional.

When to use TodoWrite:
- User asks to implement a feature → Create todos for each step
- User asks to fix multiple issues → Create todos for each fix
- User asks to refactor code → Create todos for each file/change

How to use TodoWrite:
1. **Create todos FIRST** before doing any work
2. **Mark as in_progress** the task you're about to start
3. **Mark as completed** immediately after finishing (don't batch!)
4. **Only ONE task** should be in_progress at a time

## CRITICAL: Package Manager Isolation

When setting up Python projects, follow these rules STRICTLY:

1. **State your choice explicitly**: Before any package installation, explicitly state:
   - Which package manager you will use (uv, pip, conda, or pixi)
   - The virtual environment name/path

2. **ONE package manager only**: Pick ONE package manager and use it exclusively:
   - uv (fastest, recommended) - uses \`uv venv\` + \`uv pip install\`
   - pip (standard) - uses \`python -m venv\` + \`pip install\`
   - conda (for complex deps) - uses \`conda create\` + \`conda install\`
   - pixi (Rust-based conda) - uses \`pixi init\` + \`pixi add\`

   NEVER mix them (e.g., don't use pip in a conda env, don't use conda in a uv env)

3. **ALWAYS use virtual environments**:
   - NEVER install packages to system Python
   - NEVER use \`pip install\` without an active venv
   - NEVER use \`--user\` flag
   - Every \`pip\`/\`uv pip\` command must target a specific venv

4. **Virtual environment NAMING and PLACEMENT** (CRITICAL - prevents import shadowing):
   - **Inside a project**: ALWAYS use \`.venv\` as the name
     - \`.venv\` is hidden and won't shadow installed packages
     - Example: \`cd /path/project && python -m venv .venv\`
   - **NEVER** create a venv with a custom name inside a directory containing setup.py/pyproject.toml
     - BAD: \`cd /project && python -m venv myproject\` (creates /project/myproject/ which shadows source!)
     - GOOD: \`cd /project && python -m venv .venv\`
   - **Custom venv names**: Must be OUTSIDE the project directory
     - Clone to: \`/path/project-src/\`
     - Venv at: \`/path/project-venv/\`
   - **ASK for clarification** if task specifies same name for repo path and venv name
     - Example: "clone to /test-proj with venv test-proj" → ASK which structure user prefers

5. **Verify venv activation before EVERY operation**:
   - Before installing: verify you're in the correct venv
   - Check paths: \`which python\`, \`which pip\` should point to venv
   - For uv: use \`uv pip install --python /path/to/venv/bin/python\`
   - For pip: use \`/path/to/venv/bin/pip install\` (full path)

6. **Keep venvs self-contained**:
   - All dependencies go into the project's venv
   - If the project has a requirements.txt, setup.py, or pyproject.toml, use that
   - Document the venv location in your response

Environment:
- Working directory: ${cwd}
- Date: ${date}
- Platform: ${Deno.build.os}`,
  ];
}
