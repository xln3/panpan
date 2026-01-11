# panpan 🐼

A Deno-based CLI tool that automates ML project migration between servers using LLM-powered assistance.

## Features

- **Multi-Provider LLM Support** - Works with Anthropic Claude and OpenAI-compatible APIs
- **20+ Built-in Tools** - File operations, shell commands, web scraping, package management
- **Package Manager Integration** - pip, conda, uv, pixi with streaming output
- **Interactive REPL** - Real-time streaming, ESC to abort, Ctrl+O to expand output
- **Plan Mode** - Read-only exploration before making changes
- **Web Scraping** - Playwright-based with stealth mode to bypass bot detection

## Quick Start

### Prerequisites

- [Deno](https://deno.land/) v1.40+
- API key for your LLM provider

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/panpan.git
cd panpan
deno task setup  # Install Playwright for web tools (optional)
```

### Configuration

Set environment variables:

```bash
export PANPAN_API_KEY="your-api-key"
export PANPAN_MODEL="claude-haiku-4-5-20251001"  # or any model
```

### Usage

```bash
# Interactive mode
deno task run

# With specific model
deno task run --model claude-opus-4-5-20251101

# Enable extended thinking (Anthropic only)
deno task run --model claude-opus-4-5-20251101 --thinking

# Pipe input (non-interactive)
echo "explain this code" | deno task run
```

## CLI Options

| Option | Description |
|--------|-------------|
| `-m, --model <model>` | Model to use |
| `--base-url <url>` | API base URL |
| `--api-key <key>` | API key |
| `-v, --verbose` | Verbose output |
| `--thinking` | Enable extended thinking (Anthropic) |
| `--thinking-budget <n>` | Thinking token budget (default: 10000) |

## Architecture

```
src/
├── core/           # Query loop and tool execution
├── tools/          # 20+ tools (bash, file ops, web, package managers)
├── llm/            # Multi-provider LLM client
├── ui/             # REPL and output rendering
├── types/          # TypeScript interfaces
└── utils/          # Utilities (plan mode, browser manager, etc.)
```

See [CLAUDE.md](./CLAUDE.md) for detailed architecture documentation.

## Development

```bash
deno task dev      # Development with watch
deno task check    # Type check
deno task fmt      # Format code
deno task lint     # Lint code
```

## License

MIT
