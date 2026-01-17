/**
 * .gitignore pattern parser and matcher.
 *
 * Supports standard gitignore syntax:
 * - Glob patterns (*, **, ?)
 * - Negation with leading !
 * - Directory-only patterns with trailing /
 * - Comments with leading #
 * - Rooted patterns with leading /
 */

import { join } from "@std/path";

/** A single gitignore rule */
interface IgnoreRule {
  pattern: string;
  regex: RegExp;
  negation: boolean;
  directoryOnly: boolean;
  rooted: boolean;
}

/** Default patterns to always ignore */
const DEFAULT_IGNORES = [
  ".git",
  ".panpan",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".env",
  "*.pyc",
  "*.pyo",
  ".DS_Store",
  "Thumbs.db",
  "*.swp",
  "*.swo",
  "*~",
];

/**
 * Parses and matches gitignore patterns.
 */
export class GitignoreParser {
  private rules: IgnoreRule[] = [];
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    // Add default ignore patterns
    for (const pattern of DEFAULT_IGNORES) {
      this.addPattern(pattern);
    }
  }

  /** Load patterns from a .gitignore file */
  async loadFile(path: string): Promise<void> {
    try {
      const content = await Deno.readTextFile(path);
      this.parse(content);
    } catch {
      // File doesn't exist or can't be read - that's okay
    }
  }

  /** Load from the project's .gitignore */
  async loadProjectGitignore(): Promise<void> {
    await this.loadFile(join(this.baseDir, ".gitignore"));
  }

  /** Parse gitignore content and add rules */
  parse(content: string): void {
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      this.addPattern(trimmed);
    }
  }

  /** Add a single pattern */
  addPattern(pattern: string): void {
    let negation = false;
    let directoryOnly = false;
    let rooted = false;
    let cleanPattern = pattern;

    // Check for negation
    if (cleanPattern.startsWith("!")) {
      negation = true;
      cleanPattern = cleanPattern.slice(1);
    }

    // Check for directory-only pattern
    if (cleanPattern.endsWith("/")) {
      directoryOnly = true;
      cleanPattern = cleanPattern.slice(0, -1);
    }

    // Check for rooted pattern (starts with /)
    if (cleanPattern.startsWith("/")) {
      rooted = true;
      cleanPattern = cleanPattern.slice(1);
    }

    // Convert gitignore pattern to regex
    const regex = this.patternToRegex(cleanPattern, rooted);

    this.rules.push({
      pattern: cleanPattern,
      regex,
      negation,
      directoryOnly,
      rooted,
    });
  }

  /** Convert a gitignore pattern to a regex */
  private patternToRegex(pattern: string, rooted: boolean): RegExp {
    let regexStr = "";

    // If rooted, pattern must match from start
    if (rooted) {
      regexStr = "^";
    } else {
      // Can match anywhere in path (including start)
      regexStr = "(^|/)";
    }

    // Escape special regex characters except glob wildcards
    let i = 0;
    while (i < pattern.length) {
      const char = pattern[i];

      if (char === "*") {
        if (pattern[i + 1] === "*") {
          // ** matches everything including /
          if (pattern[i + 2] === "/") {
            // **/ matches zero or more directories
            regexStr += "(.*/)?";
            i += 3;
          } else if (i + 2 === pattern.length) {
            // ** at end matches everything
            regexStr += ".*";
            i += 2;
          } else {
            // ** in middle
            regexStr += ".*";
            i += 2;
          }
        } else {
          // * matches anything except /
          regexStr += "[^/]*";
          i++;
        }
      } else if (char === "?") {
        // ? matches any single character except /
        regexStr += "[^/]";
        i++;
      } else if (char === "[") {
        // Character class - find closing bracket
        const closeIdx = pattern.indexOf("]", i + 1);
        if (closeIdx !== -1) {
          regexStr += pattern.slice(i, closeIdx + 1);
          i = closeIdx + 1;
        } else {
          regexStr += "\\[";
          i++;
        }
      } else if (".+^${}|()\\".includes(char)) {
        // Escape regex special characters
        regexStr += "\\" + char;
        i++;
      } else {
        regexStr += char;
        i++;
      }
    }

    // Pattern should match to end or be followed by /
    regexStr += "(/|$)";

    return new RegExp(regexStr);
  }

  /**
   * Check if a path should be ignored.
   * @param relativePath - Path relative to the base directory
   * @param isDirectory - Whether the path is a directory
   * @returns true if the path should be ignored
   */
  shouldIgnore(relativePath: string, isDirectory: boolean = false): boolean {
    // Normalize path separators
    const normalizedPath = relativePath.replace(/\\/g, "/");

    let ignored = false;

    for (const rule of this.rules) {
      // Skip directory-only rules for files
      if (rule.directoryOnly && !isDirectory) {
        continue;
      }

      if (rule.regex.test(normalizedPath)) {
        ignored = !rule.negation;
      }
    }

    return ignored;
  }

  /**
   * Check if a path component (single directory/file name) matches default ignores.
   * Faster check for common cases.
   */
  shouldIgnoreComponent(name: string, isDirectory: boolean = false): boolean {
    // Quick check against common patterns
    const quickIgnores = [
      ".git",
      ".panpan",
      "node_modules",
      "__pycache__",
      ".venv",
      "venv",
      ".DS_Store",
      "Thumbs.db",
    ];

    if (quickIgnores.includes(name)) {
      return true;
    }

    // Check file extensions
    if (!isDirectory) {
      const extensionIgnores = [".pyc", ".pyo", ".swp", ".swo"];
      for (const ext of extensionIgnores) {
        if (name.endsWith(ext)) {
          return true;
        }
      }
      // Backup files ending with ~
      if (name.endsWith("~")) {
        return true;
      }
    }

    return false;
  }

  /** Get all rules for debugging */
  getRules(): ReadonlyArray<Readonly<IgnoreRule>> {
    return this.rules;
  }

  /** Clear all rules except defaults */
  reset(): void {
    this.rules = [];
    for (const pattern of DEFAULT_IGNORES) {
      this.addPattern(pattern);
    }
  }
}

/**
 * Create a GitignoreParser and load the project's .gitignore.
 */
export async function createGitignoreParser(
  baseDir: string,
): Promise<GitignoreParser> {
  const parser = new GitignoreParser(baseDir);
  await parser.loadProjectGitignore();
  return parser;
}
