/**
 * Agent types for subagent/Task functionality
 */

/**
 * Model selection for agents
 */
export type AgentModel = "haiku" | "sonnet" | "opus" | "inherit";

/**
 * Agent configuration (matches Kode-cli design)
 */
export interface AgentConfig {
  name: string;
  whenToUse: string; // Detailed description of when to use this agent
  tools: string[] | "*";
  disallowedTools?: string[];
  model?: AgentModel; // Model to use, defaults to "inherit"
  systemPrompt: string;
}

/**
 * Background task status
 */
export type BackgroundTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "killed";

/**
 * Background agent task
 */
export interface BackgroundAgentTask {
  taskId: string;
  agentType: string;
  description: string;
  prompt: string;
  status: BackgroundTaskStatus;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

/**
 * Task tool input
 */
export interface TaskInput {
  description: string;
  prompt: string;
  subagent_type: string;
  run_in_background?: boolean;
}

/**
 * Task tool output
 */
export interface TaskOutput {
  taskId: string;
  status: "completed" | "async_launched";
  result?: string;
  error?: string;
}

/**
 * TaskOutput tool input
 */
export interface TaskOutputInput {
  task_id: string;
  block?: boolean;
  timeout?: number;
}

/**
 * TaskOutput tool result
 */
export interface TaskOutputResult {
  retrieval_status: "success" | "timeout" | "not_ready" | "not_found";
  task?: BackgroundAgentTask;
}
