/**
 * LSP Tool - Language Server Protocol operations for code intelligence
 * Provides IDE-like features: go to definition, find references, hover, etc.
 */

import { z } from "zod";
import { extname, isAbsolute, relative, resolve } from "@std/path";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";

// We'll use Deno's built-in TypeScript
// @deno-types="typescript"
import ts from "typescript";

const OPERATIONS = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
] as const;

type Operation = typeof OPERATIONS[number];

const inputSchema = z.object({
  operation: z
    .enum(OPERATIONS)
    .describe("The LSP operation to perform"),
  filePath: z
    .string()
    .describe("The absolute or relative path to the file"),
  line: z
    .number()
    .int()
    .positive()
    .describe("The line number (1-based, as shown in editors)"),
  character: z
    .number()
    .int()
    .positive()
    .describe("The character offset (1-based, as shown in editors)"),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  operation: Operation;
  filePath: string;
  result: string;
  resultCount?: number;
}

// Supported file extensions
const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

// Project cache to avoid re-creating language service
interface ProjectState {
  languageService: ts.LanguageService;
  rootFiles: Set<string>;
  versions: Map<string, string>;
}

const projectCache = new Map<string, ProjectState>();

/**
 * Get or create TypeScript language service for a project
 */
function getOrCreateProject(cwd: string): ProjectState {
  const existing = projectCache.get(cwd);
  if (existing) return existing;

  let compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };

  let rootFileNames: string[] = [];

  // Try to find and parse tsconfig.json
  try {
    const configPath = ts.findConfigFile(
      cwd,
      ts.sys.fileExists,
      "tsconfig.json",
    );
    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          cwd,
        );
        compilerOptions = { ...compilerOptions, ...parsed.options };
        rootFileNames = parsed.fileNames;
      }
    }
  } catch {
    // Use defaults
  }

  const rootFiles = new Set(rootFileNames);
  const versions = new Map<string, string>();

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => Array.from(rootFiles),
    getScriptVersion: (fileName: string) => {
      try {
        const stat = Deno.statSync(fileName);
        const version = String(stat.mtime?.getTime() ?? Date.now());
        versions.set(fileName, version);
        return version;
      } catch {
        return versions.get(fileName) ?? "0";
      }
    },
    getScriptSnapshot: (fileName: string) => {
      try {
        const content = Deno.readTextFileSync(fileName);
        const stat = Deno.statSync(fileName);
        versions.set(fileName, String(stat.mtime?.getTime() ?? Date.now()));
        return ts.ScriptSnapshot.fromString(content);
      } catch {
        return undefined;
      }
    },
    getCurrentDirectory: () => cwd,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (path) => {
      try {
        return Deno.statSync(path).isFile;
      } catch {
        return false;
      }
    },
    readFile: (path) => {
      try {
        return Deno.readTextFileSync(path);
      } catch {
        return undefined;
      }
    },
    readDirectory: ts.sys.readDirectory,
    directoryExists: (path) => {
      try {
        return Deno.statSync(path).isDirectory;
      } catch {
        return false;
      }
    },
    getDirectories: ts.sys.getDirectories,
  };

  const languageService = ts.createLanguageService(
    host,
    ts.createDocumentRegistry(),
  );

  const state: ProjectState = {
    languageService,
    rootFiles,
    versions,
  };

  projectCache.set(cwd, state);
  return state;
}

/**
 * Format a location as file:line:character
 */
function formatLocation(
  fileName: string,
  line0: number,
  char0: number,
  cwd: string,
): string {
  const rel = relative(cwd, fileName);
  const display = rel.startsWith("..") ? fileName : rel;
  return `${display}:${line0 + 1}:${char0 + 1}`;
}

/**
 * Get position in file from line/character
 */
function getPosition(content: string, line1: number, char1: number): number {
  const lines = content.split("\n");
  let pos = 0;
  for (let i = 0; i < line1 - 1 && i < lines.length; i++) {
    pos += lines[i].length + 1; // +1 for newline
  }
  return pos + char1 - 1;
}

/**
 * Execute go to definition
 */
function goToDefinition(
  ls: ts.LanguageService,
  filePath: string,
  position: number,
  cwd: string,
): { result: string; count: number } {
  const definitions = ls.getDefinitionAtPosition(filePath, position);

  if (!definitions || definitions.length === 0) {
    return { result: "No definition found", count: 0 };
  }

  const lines: string[] = [];
  for (const def of definitions) {
    const sourceFile = ls.getProgram()?.getSourceFile(def.fileName);
    if (!sourceFile) continue;

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      def.textSpan.start,
    );
    lines.push(formatLocation(def.fileName, line, character, cwd));
  }

  return {
    result: lines.join("\n"),
    count: definitions.length,
  };
}

/**
 * Execute find references
 */
function findReferences(
  ls: ts.LanguageService,
  filePath: string,
  position: number,
  cwd: string,
): { result: string; count: number } {
  const references = ls.getReferencesAtPosition(filePath, position);

  if (!references || references.length === 0) {
    return { result: "No references found", count: 0 };
  }

  const lines: string[] = [];
  for (const ref of references) {
    const sourceFile = ls.getProgram()?.getSourceFile(ref.fileName);
    if (!sourceFile) continue;

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      ref.textSpan.start,
    );
    const loc = formatLocation(ref.fileName, line, character, cwd);

    // Get the line content for context
    const lineContent = sourceFile.text.split("\n")[line]?.trim() || "";
    const preview = lineContent.length > 60
      ? lineContent.slice(0, 57) + "..."
      : lineContent;

    lines.push(`${loc}  ${preview}`);
  }

  return {
    result: lines.join("\n"),
    count: references.length,
  };
}

/**
 * Execute hover (get quick info)
 */
function hover(
  ls: ts.LanguageService,
  filePath: string,
  position: number,
): { result: string; count: number } {
  const info = ls.getQuickInfoAtPosition(filePath, position);

  if (!info) {
    return { result: "No hover information available", count: 0 };
  }

  const lines: string[] = [];

  if (info.displayParts) {
    lines.push(info.displayParts.map((p) => p.text).join(""));
  }

  if (info.documentation && info.documentation.length > 0) {
    lines.push("");
    lines.push(info.documentation.map((d) => d.text).join("\n"));
  }

  return {
    result: lines.join("\n") || "No information available",
    count: 1,
  };
}

/**
 * Execute document symbol (get all symbols in file)
 */
function documentSymbol(
  ls: ts.LanguageService,
  filePath: string,
  _cwd: string,
): { result: string; count: number } {
  const navTree = ls.getNavigationTree(filePath);

  if (!navTree) {
    return { result: "No symbols found", count: 0 };
  }

  const symbols: string[] = [];

  function walk(item: ts.NavigationTree, indent: number = 0) {
    // Skip the root "file" node
    if (item.kind !== ts.ScriptElementKind.moduleElement) {
      const prefix = "  ".repeat(indent);
      const kindLabel = item.kind.replace("Element", "");
      symbols.push(`${prefix}${kindLabel}: ${item.text}`);
    }

    if (item.childItems) {
      for (const child of item.childItems) {
        walk(
          child,
          item.kind === ts.ScriptElementKind.moduleElement ? 0 : indent + 1,
        );
      }
    }
  }

  walk(navTree);

  return {
    result: symbols.join("\n") || "No symbols found",
    count: symbols.length,
  };
}

/**
 * Execute go to implementation
 */
function goToImplementation(
  ls: ts.LanguageService,
  filePath: string,
  position: number,
  cwd: string,
): { result: string; count: number } {
  const implementations = ls.getImplementationAtPosition(filePath, position);

  if (!implementations || implementations.length === 0) {
    return { result: "No implementations found", count: 0 };
  }

  const lines: string[] = [];
  for (const impl of implementations) {
    const sourceFile = ls.getProgram()?.getSourceFile(impl.fileName);
    if (!sourceFile) continue;

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      impl.textSpan.start,
    );
    lines.push(formatLocation(impl.fileName, line, character, cwd));
  }

  return {
    result: lines.join("\n"),
    count: implementations.length,
  };
}

/**
 * LSP Tool implementation
 */
export const LspTool: Tool<typeof inputSchema, Output> = {
  name: "LSP",
  description: `Language Server Protocol tool for code intelligence.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get type information and documentation
- documentSymbol: List all symbols in a file
- goToImplementation: Find implementations of interfaces/abstract methods

Supports TypeScript/JavaScript files (.ts, .tsx, .js, .jsx, .mts, .cts, .mjs, .cjs).
Line and character numbers are 1-based (as shown in editors).`,

  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async validateInput({ filePath, operation: _operation }, context) {
    const fullPath = isAbsolute(filePath)
      ? filePath
      : resolve(context.cwd, filePath);

    try {
      const stat = await Deno.stat(fullPath);
      if (!stat.isFile) {
        return { result: false, message: `Path is not a file: ${filePath}` };
      }
    } catch {
      return { result: false, message: `File does not exist: ${filePath}` };
    }

    const ext = extname(fullPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return {
        result: false,
        message: `Unsupported file type: ${ext}. Supported: ${
          [...SUPPORTED_EXTENSIONS].join(", ")
        }`,
      };
    }

    return { result: true };
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const { operation, filePath, line, character } = input;
    const fullPath = isAbsolute(filePath)
      ? filePath
      : resolve(context.cwd, filePath);

    // Ensure file is in root files
    const project = getOrCreateProject(context.cwd);
    project.rootFiles.add(fullPath);

    // Read file and get position
    const content = await Deno.readTextFile(fullPath);
    const position = getPosition(content, line, character);

    let result: { result: string; count: number };

    switch (operation) {
      case "goToDefinition":
        result = goToDefinition(
          project.languageService,
          fullPath,
          position,
          context.cwd,
        );
        break;
      case "findReferences":
        result = findReferences(
          project.languageService,
          fullPath,
          position,
          context.cwd,
        );
        break;
      case "hover":
        result = hover(project.languageService, fullPath, position);
        break;
      case "documentSymbol":
        result = documentSymbol(project.languageService, fullPath, context.cwd);
        break;
      case "goToImplementation":
        result = goToImplementation(
          project.languageService,
          fullPath,
          position,
          context.cwd,
        );
        break;
      case "workspaceSymbol":
        // Simplified: just show document symbols for now
        result = documentSymbol(project.languageService, fullPath, context.cwd);
        break;
      default:
        result = { result: `Unknown operation: ${operation}`, count: 0 };
    }

    const output: Output = {
      operation,
      filePath: fullPath,
      result: result.result,
      resultCount: result.count,
    };

    yield {
      type: "result",
      data: output,
      resultForAssistant: this.renderResultForAssistant(output),
    };
  },

  renderResultForAssistant(output: Output): string {
    const header = `[${output.operation}] ${
      output.resultCount ?? 0
    } result(s)\n`;
    return header + output.result;
  },

  renderToolUseMessage(input, { verbose, cwd }) {
    const { operation, filePath, line, character } = input;
    const display = verbose ? filePath : relative(cwd, filePath);
    return `${operation}: ${display}:${line}:${character}`;
  },
};
