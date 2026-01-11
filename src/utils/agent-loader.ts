/**
 * Agent configuration loader
 * Matches Kode-cli design for subagent management
 */

import type { AgentConfig } from "../types/agent.ts";

/**
 * Built-in agent configurations (aligned with Kode-cli)
 */
const BUILTIN_AGENTS: Record<string, AgentConfig> = {
  "general-purpose": {
    name: "general-purpose",
    whenToUse:
      "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries, use this agent.",
    tools: "*",
    disallowedTools: ["Task", "TaskOutput", "EnterPlanMode", "ExitPlanMode"],
    systemPrompt:
      `You are a general-purpose agent. Given the user's task, use the tools available to complete it efficiently and thoroughly.

When to use your capabilities:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: Use Grep or Glob when you need to search broadly. Use Read when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- Complete tasks directly using your capabilities.`,
  },

  Explore: {
    name: "Explore",
    whenToUse:
      'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how does X work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis.',
    tools: "*",
    disallowedTools: [
      "Task",
      "TaskOutput",
      "EnterPlanMode",
      "ExitPlanMode",
      "Edit",
      "Write",
    ],
    model: "haiku",
    systemPrompt:
      `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Use Bash for read-only operations (ls, git status, git log, git diff, find)
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response

NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:
- Make efficient use of the tools: be smart about how you search for files and implementations
- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files

Complete the user's search request efficiently and report your findings clearly.`,
  },

  Plan: {
    name: "Plan",
    whenToUse:
      "Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.",
    tools: "*",
    disallowedTools: [
      "Task",
      "TaskOutput",
      "EnterPlanMode",
      "ExitPlanMode",
      "Edit",
      "Write",
    ],
    model: "inherit",
    systemPrompt:
      `You are a software architect and planning specialist. Your role is to explore the codebase and design implementation plans.

## Your Process

1. **Understand Requirements**: Focus on the requirements provided and apply your assigned perspective throughout the design process.

2. **Explore Thoroughly**:
   - Read any files provided to you in the initial prompt
   - Find existing patterns and conventions using Glob, Grep, and Read
   - Understand the current architecture
   - Identify similar features as reference
   - Trace through relevant code paths

3. **Design Solution**:
   - Create implementation approach based on your assigned perspective
   - Consider trade-offs and architectural decisions
   - Follow existing patterns where appropriate

4. **Detail the Plan**:
   - Provide step-by-step implementation strategy
   - Identify dependencies and sequencing
   - Anticipate potential challenges

## Required Output

End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- path/to/file1.ts - [Brief reason: e.g., "Core logic to modify"]
- path/to/file2.ts - [Brief reason: e.g., "Interfaces to implement"]
- path/to/file3.ts - [Brief reason: e.g., "Pattern to follow"]`,
  },
};

/**
 * Tools that subagents are never allowed to use
 */
export const SUBAGENT_DISALLOWED_TOOLS = [
  "Task",
  "TaskOutput",
  "EnterPlanMode",
  "ExitPlanMode",
];

/**
 * Get agent configuration by type
 */
export function getAgentByType(agentType: string): AgentConfig | undefined {
  return BUILTIN_AGENTS[agentType];
}

/**
 * Get all available agent types
 */
export function getAvailableAgentTypes(): string[] {
  return Object.keys(BUILTIN_AGENTS);
}

/**
 * Get agent descriptions for tool documentation
 */
export function getAgentDescriptions(): string {
  return Object.values(BUILTIN_AGENTS)
    .map((agent) => `- ${agent.name}: ${agent.whenToUse}`)
    .join("\n");
}

/**
 * Filter tools based on agent configuration
 */
export function filterToolsForAgent(
  allToolNames: string[],
  agentConfig: AgentConfig,
): string[] {
  let allowedTools: string[];

  if (agentConfig.tools === "*") {
    allowedTools = [...allToolNames];
  } else {
    allowedTools = agentConfig.tools.filter((t) => allToolNames.includes(t));
  }

  // Remove disallowed tools
  const disallowed = new Set([
    ...SUBAGENT_DISALLOWED_TOOLS,
    ...(agentConfig.disallowedTools || []),
  ]);

  return allowedTools.filter((t) => !disallowed.has(t));
}
