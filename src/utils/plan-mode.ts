/**
 * Plan mode state management
 * Handles plan file creation and plan mode state
 */

import { ensureDirSync, existsSync } from "@std/fs";
import { join } from "@std/path";

// State
let planModeEnabled = false;
let planFilePath: string | null = null;

// Word lists for slug generation
const ADJECTIVES = [
  "happy",
  "calm",
  "bright",
  "swift",
  "gentle",
  "bold",
  "quiet",
  "warm",
  "cool",
  "fresh",
  "light",
  "dark",
  "soft",
  "loud",
  "kind",
  "wise",
  "brave",
  "fair",
  "true",
  "pure",
  "keen",
  "neat",
  "quick",
  "smart",
];

const VERBS = [
  "running",
  "jumping",
  "dancing",
  "singing",
  "flying",
  "walking",
  "swimming",
  "climbing",
  "reading",
  "writing",
  "thinking",
  "dreaming",
  "playing",
  "working",
  "building",
  "growing",
  "learning",
  "teaching",
  "helping",
  "creating",
];

const NOUNS = [
  "river",
  "mountain",
  "forest",
  "ocean",
  "meadow",
  "garden",
  "sunset",
  "sunrise",
  "rainbow",
  "thunder",
  "breeze",
  "cloud",
  "storm",
  "flower",
  "tree",
  "bird",
  "wolf",
  "bear",
  "eagle",
  "dolphin",
  "tiger",
  "lion",
];

/**
 * Generate a random slug like "happy-running-river"
 */
function generateSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${verb}-${noun}`;
}

/**
 * Get the plan directory path
 */
function getPlanDirectory(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
  return join(home, ".panpan", "plans");
}

/**
 * Enter plan mode and create plan file
 */
export function enterPlanMode(): { planFilePath: string } {
  if (planModeEnabled) {
    return { planFilePath: planFilePath! };
  }

  const planDir = getPlanDirectory();
  ensureDirSync(planDir);

  // Generate unique slug
  let slug = generateSlug();
  let path = join(planDir, `${slug}.md`);
  let attempts = 0;

  while (existsSync(path) && attempts < 10) {
    slug = generateSlug();
    path = join(planDir, `${slug}.md`);
    attempts++;
  }

  // Create empty plan file
  Deno.writeTextFileSync(path, `# Implementation Plan\n\n`);

  planModeEnabled = true;
  planFilePath = path;

  return { planFilePath: path };
}

/**
 * Exit plan mode
 */
export function exitPlanMode():
  | { planFilePath: string; planContent: string }
  | { error: string } {
  if (!planModeEnabled || !planFilePath) {
    return { error: "Not in plan mode" };
  }

  // Validate plan file exists and has content
  if (!existsSync(planFilePath)) {
    return { error: `Plan file not found: ${planFilePath}` };
  }

  const content = Deno.readTextFileSync(planFilePath);
  if (content.trim().length < 50) {
    return {
      error: "Plan file is empty or too short. Please write a plan first.",
    };
  }

  const result = { planFilePath, planContent: content };

  planModeEnabled = false;
  planFilePath = null;

  return result;
}

/**
 * Check if currently in plan mode
 */
export function isPlanMode(): boolean {
  return planModeEnabled;
}

/**
 * Get current plan file path
 */
export function getPlanFilePath(): string | null {
  return planFilePath;
}

/**
 * Read plan file content
 */
export function readPlanFile(): string | null {
  if (!planFilePath || !existsSync(planFilePath)) {
    return null;
  }
  return Deno.readTextFileSync(planFilePath);
}

/**
 * Check if a file path is the current plan file
 */
export function isPlanFile(filePath: string): boolean {
  if (!planFilePath) return false;
  // Normalize paths for comparison
  const normalizedPlan = planFilePath.replace(/\\/g, "/");
  const normalizedFile = filePath.replace(/\\/g, "/");
  return normalizedPlan === normalizedFile;
}

/**
 * List of tools allowed in plan mode (non-readonly)
 */
export const PLAN_MODE_ALLOWED_TOOLS = new Set([
  "TodoWrite",
  "ExitPlanMode",
]);

/**
 * Check if a tool is allowed in plan mode
 */
export function isToolAllowedInPlanMode(
  toolName: string,
  isReadOnly: boolean,
  filePath?: string,
): boolean {
  // All read-only tools are allowed
  if (isReadOnly) return true;

  // Special allowed tools
  if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) return true;

  // FileEdit is allowed only for the plan file
  if (toolName === "Edit" && filePath && isPlanFile(filePath)) {
    return true;
  }

  return false;
}
