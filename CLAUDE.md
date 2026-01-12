# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

panpan is a Deno-based CLI tool that automates reproduction of codebases and
migration of ML projects between servers. It uses LLM with tool-calling for
interactive assistance.

## Architecture Overview

```
src/
├── core/           # Query loop and tool execution
│   ├── query.ts         # Recursive async generator - heart of LLM interaction
│   ├── tool-executor.ts # Executes tools with concurrency management
│   └── messages.ts      # Message creation and normalization
├── tools/          # All available tools
│   ├── mod.ts           # Tool registry (getAllTools)
│   ├── bash.ts          # Shell command execution
│   ├── file-*.ts        # File operations (read, edit, write)
│   ├── glob.ts, grep.ts # Search tools
│   ├── task.ts          # Subagent spawning
│   └── package-managers/ # Package management tools
│       ├── common.ts    # Streaming execution, adaptive timeouts
│       ├── pip.ts, conda.ts, uv.ts, pixi.ts
│       └── mod.ts       # Exports all package tools
├── ui/             # User interface
│   ├── repl.ts          # Main REPL loop, interrupt handling (ESC, Ctrl+O)
│   ├── output-display.ts # Streaming output with fold/expand toggle
│   └── render.ts        # Formatting utilities
├── llm/            # LLM client
│   ├── client.ts        # Provider-agnostic LLM client
│   ├── provider-factory.ts # Auto-detects provider from model name
│   ├── stream-parser.ts # SSE stream parsing
│   └── providers/       # Provider implementations
│       ├── openai.ts    # OpenAI-compatible API
│       ├── anthropic.ts # Native Anthropic API with caching & thinking
│       └── mod.ts       # Provider exports
├── types/          # TypeScript interfaces
│   ├── tool.ts          # Tool, ToolContext, ToolYield types
│   ├── message.ts       # Message types
│   └── llm.ts           # LLM config and API types
├── config/         # Configuration
│   └── config.ts        # Loads from env vars and CLI options
├── utils/          # Utilities
│   ├── plan-mode.ts     # Read-only exploration mode
│   ├── todo-storage.ts  # Task tracking persistence
│   └── background-tasks.ts
└── services/
    └── system-reminder.ts # Context injection based on events
```

## Key Patterns

### Tool Implementation

Tools are async generators yielding `ToolYield<T>`:

```typescript
async *call(input: Input, context: ToolContext): AsyncGenerator<ToolYield<Output>> {
  // For streaming operations:
  yield { type: "streaming_output", line: { stream: "stdout", line, timestamp } };

  // Final result:
  yield { type: "result", data: output, resultForAssistant: "..." };
}
```

### Streaming Output (Package Managers)

- `executeCommandStreaming()` in `common.ts` yields lines as they arrive
- `OutputDisplayController` manages folded/expanded display
- Ctrl+O toggles between preview (last 3 lines) and full output
- Adaptive timeouts: uv/pixi 5min, pip 10min, conda 15min

### Interrupt Handling

- ESC key (byte 27) triggers abort via AbortController
- Ctrl+O (byte 15) toggles output expansion
- Raw terminal mode during processing in `repl.ts`

### Query Loop (`query.ts`)

1. Normalize messages for API
2. Call LLM with tools
3. If tool_use blocks: execute tools, yield results, recurse
4. If no tools: yield final response, return

### Concurrency

- `isConcurrencySafe(input)` on tools determines parallel execution
- Read-only tools (Glob, Grep, Read) can run concurrently
- Mutating tools run sequentially

## Multi-Provider LLM Support

panpan supports multiple LLM providers with automatic detection based on model
name.

### Provider Detection

- Models starting with `claude-*` → Anthropic native API
- All other models → OpenAI-compatible API

### Anthropic-Specific Features

**Prompt Caching**: Automatically enabled for system prompt and tool
definitions.

- Caches ~6600 tokens (system prompt + tools) for 5 minutes
- 90% cost reduction on cache hits
- Stats shown in output: `(X cached)` or `(X cache write)`

**Extended Thinking**: Shows model's reasoning process.

```bash
panpan --model claude-opus-4-5-20251101 --thinking
panpan --model claude-opus-4-5-20251101 --thinking --thinking-budget 20000
```

Constraints when thinking is enabled:

- Temperature forced to 1 (Anthropic requirement)
- Tool schemas cleaned to remove `anyOf/oneOf/allOf` (beta validation)

### API Differences Handled

| Aspect        | OpenAI                  | Anthropic                           |
| ------------- | ----------------------- | ----------------------------------- |
| Endpoint      | `/chat/completions`     | `/messages`                         |
| Auth          | `Authorization: Bearer` | `x-api-key`                         |
| System prompt | Message with role       | Separate `system` field             |
| Tool schema   | `parameters`            | `input_schema`                      |
| Tool results  | `role: "tool"`          | Content block `type: "tool_result"` |

## Environment Variables

```
PANPAN_API_KEY / OPENAI_API_KEY  - Required
PANPAN_BASE_URL / OPENAI_BASE_URL - Required (OpenAI-compatible endpoint)
PANPAN_MODEL - Required (model name)
```

## Running

```bash
deno task dev      # Development with watch
deno task run      # Production run
deno task check    # Type check via mod.ts
deno task fmt      # Format code
deno task lint     # Lint code
deno task setup    # Install playwright for web tools
deno task test     # Run all tests
deno task test:watch # Run tests in watch mode
```

## Testing

panpan uses Deno's native testing framework with 200+ test cases covering:

```
test/
├── _helpers/       # collectGenerator, withTempDir, createMockToolContext
├── _mocks/         # Mock LLMClient, fetch
├── core/           # messages, tool-executor tests
├── llm/            # provider-factory, stream-parser tests
├── tools/          # glob, grep, file-read tests
├── utils/          # plan-mode, todo-storage tests
└── config/         # config priority tests
```

### Running Tests

```bash
deno task test           # All tests
deno task test:unit      # Unit tests only
deno task test:tools     # Tool tests only
deno task test:coverage  # With coverage report
```

See `docs/testing.md` for detailed testing guide.

### CLI Options

```bash
panpan [options]

Options:
  -m, --model <model>         Model to use (default: claude-haiku-4-5-20251001)
  --base-url <url>            API base URL (default: https://aihubmix.com/v1/)
  --api-key <key>             API key (or use PANPAN_API_KEY env)
  -v, --verbose               Show verbose output
  --thinking                  Enable extended thinking (Anthropic only)
  --thinking-budget <tokens>  Thinking token budget (default: 10000)
```

### Examples

```bash
# Use Claude Opus with thinking
panpan --model claude-opus-4-5-20251101 --thinking

# Pipe input (non-interactive mode)
echo "explain this code" | panpan --model claude-haiku-4-5-20251001

# Use different API endpoint
panpan --base-url https://api.openai.com/v1 --model gpt-4o
```

## Dependencies

- `@cliffy/*` - CLI framework (commands, prompts, ANSI)
- `zod` - Schema validation for tool inputs
- `openai` - API client (used for OpenAI-compatible endpoints)
- `playwright` - Browser automation for web tools
- `jsdom` + `@mozilla/readability` - HTML parsing

## Additional Documentation

Detailed tool documentation in `docs/`:

- `docs/testing.md` - Testing guide: test patterns, helpers, running tests
- `docs/web-fetch.md` - WebFetch tool: Playwright stealth, SSRF protection,
  content extraction
- `docs/dataset-download.md` - DatasetDownload tool: two-phase workflow,
  background downloads
- `docs/venv-convention-fix.md` - Python venv naming conventions to prevent
  import shadowing
