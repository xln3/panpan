/**
 * Tool registry
 */

import type { Tool } from "../types/tool.ts";
import { GlobTool } from "./glob.ts";
import { FileReadTool } from "./file-read.ts";
import { FileEditTool } from "./file-edit.ts";
import { FileWriteTool } from "./file-write.ts";
import { GrepTool } from "./grep.ts";
import { BashTool } from "./bash.ts";
import { WebFetchTool } from "./web-fetch.ts";
import { WebSearchTool } from "./web-search.ts";
import { TodoWriteTool } from "./todo-write.ts";
import { EnterPlanModeTool } from "./enter-plan-mode.ts";
import { ExitPlanModeTool } from "./exit-plan-mode.ts";
import { TaskTool } from "./task.ts";
import { TaskOutputTool } from "./task-output.ts";
import { LspTool } from "./lsp.ts";
import { CondaTool, PipTool, UvTool, PixiTool } from "./package-managers/mod.ts";
import { DatasetDownloadTool } from "./dataset-download.ts";

/**
 * Get all available tools
 */
export function getAllTools(): Tool[] {
  return [
    BashTool as unknown as Tool,
    FileReadTool as unknown as Tool,
    FileWriteTool as unknown as Tool,
    FileEditTool as unknown as Tool,
    GlobTool as unknown as Tool,
    GrepTool as unknown as Tool,
    LspTool as unknown as Tool,
    WebFetchTool as unknown as Tool,
    WebSearchTool as unknown as Tool,
    TodoWriteTool as unknown as Tool,
    EnterPlanModeTool as unknown as Tool,
    ExitPlanModeTool as unknown as Tool,
    TaskTool as unknown as Tool,
    TaskOutputTool as unknown as Tool,
    // Package manager tools
    CondaTool as unknown as Tool,
    PipTool as unknown as Tool,
    UvTool as unknown as Tool,
    PixiTool as unknown as Tool,
    // Dataset download tool
    DatasetDownloadTool as unknown as Tool,
  ];
}

/**
 * Get a tool by name
 */
export function getToolByName(name: string): Tool | undefined {
  return getAllTools().find((t) => t.name === name);
}

// Re-export individual tools
export { BashTool } from "./bash.ts";
export { FileEditTool } from "./file-edit.ts";
export { FileReadTool } from "./file-read.ts";
export { FileWriteTool } from "./file-write.ts";
export { GlobTool } from "./glob.ts";
export { GrepTool } from "./grep.ts";
export { LspTool } from "./lsp.ts";
export { WebFetchTool } from "./web-fetch.ts";
export { WebSearchTool } from "./web-search.ts";
export { TodoWriteTool } from "./todo-write.ts";
export { EnterPlanModeTool } from "./enter-plan-mode.ts";
export { ExitPlanModeTool } from "./exit-plan-mode.ts";
export { TaskTool } from "./task.ts";
export { TaskOutputTool } from "./task-output.ts";
// Package manager tools
export { CondaTool, PipTool, UvTool, PixiTool } from "./package-managers/mod.ts";
// Dataset download tool
export { DatasetDownloadTool } from "./dataset-download.ts";
