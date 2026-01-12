/**
 * Output display controller for streaming tool output
 * Handles folded/expanded display modes with Ctrl+O toggle
 */

import * as colors from "@std/fmt/colors";

/**
 * Streaming output line
 */
export interface StreamingLine {
  stream: "stdout" | "stderr";
  line: string;
  timestamp: number;
}

/**
 * Controls the display of streaming output from tools
 * Supports folded (preview) and expanded (full) modes
 */
export class OutputDisplayController {
  private expanded = false;
  private lineBuffer: StreamingLine[] = [];
  private readonly maxBufferLines = 100;
  private readonly previewLines = 3;
  private toolName = "";
  private startTime = 0;
  private timeout = 0;
  private spinnerFrameIndex = 0;
  private intervalId: number | null = null;
  private lastRenderLines = 0;
  private active = false;

  private static readonly spinnerFrames = [
    "⠋",
    "⠙",
    "⠹",
    "⠸",
    "⠼",
    "⠴",
    "⠦",
    "⠧",
    "⠇",
    "⠏",
  ];

  /**
   * Start displaying output for a tool
   */
  start(toolName: string, timeout: number): void {
    this.toolName = toolName;
    this.startTime = Date.now();
    this.timeout = timeout;
    this.lineBuffer = [];
    this.expanded = false;
    this.lastRenderLines = 0;
    this.active = true;
    this.startRenderLoop();
  }

  /**
   * Stop displaying and clean up
   */
  stop(): void {
    this.active = false;
    this.stopRenderLoop();
    this.clearDisplay();
  }

  /**
   * Toggle between folded and expanded modes
   */
  toggle(): void {
    if (!this.active) return;
    this.expanded = !this.expanded;
    this.render();
  }

  /**
   * Check if currently in expanded mode
   */
  isExpanded(): boolean {
    return this.expanded;
  }

  /**
   * Add a new output line
   */
  addLine(line: StreamingLine): void {
    this.lineBuffer.push(line);
    if (this.lineBuffer.length > this.maxBufferLines) {
      this.lineBuffer.shift();
    }
    // Don't re-render on every line - let the render loop handle it
  }

  /**
   * Get the current line buffer
   */
  getLines(): StreamingLine[] {
    return [...this.lineBuffer];
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.lineBuffer = [];
    this.lastRenderLines = 0;
  }

  /**
   * Render the current display state
   */
  private render(): void {
    if (!this.active) return;

    // Clear previous render
    this.clearDisplay();

    if (this.expanded) {
      this.renderExpanded();
    } else {
      this.renderFolded();
    }
  }

  /**
   * Render folded view (preview mode)
   */
  private renderFolded(): void {
    const encoder = new TextEncoder();
    const lines: string[] = [];

    // Header with spinner and time remaining
    const frame = OutputDisplayController.spinnerFrames[
      this.spinnerFrameIndex % OutputDisplayController.spinnerFrames.length
    ];
    const elapsed = Date.now() - this.startTime;
    const remaining = Math.max(0, this.timeout - elapsed);
    const remainingStr = this.formatDuration(remaining);

    lines.push(
      `${colors.cyan(frame)} ${colors.yellow(`[${this.toolName}]`)} ${
        colors.dim(`(${remainingStr} remaining)`)
      }`,
    );

    // Hidden lines indicator
    const totalLines = this.lineBuffer.length;
    const hiddenLines = Math.max(0, totalLines - this.previewLines);
    if (hiddenLines > 0) {
      lines.push(colors.dim(`... (${hiddenLines} more lines above)`));
    }

    // Preview lines (last N)
    const previewStart = Math.max(0, totalLines - this.previewLines);
    for (let i = previewStart; i < totalLines; i++) {
      const line = this.lineBuffer[i];
      const text = line.stream === "stderr"
        ? colors.red(line.line)
        : colors.dim(line.line);
      lines.push(text);
    }

    // Hint
    lines.push(colors.dim("(esc interrupt | ctrl+o expand)"));

    // Write all lines
    for (const line of lines) {
      Deno.stdout.writeSync(encoder.encode(line + "\n"));
    }

    this.lastRenderLines = lines.length;
  }

  /**
   * Render expanded view (full output)
   */
  private renderExpanded(): void {
    const encoder = new TextEncoder();
    const lines: string[] = [];

    // Header
    lines.push(colors.yellow(`[${this.toolName}]`) + colors.dim(" (expanded)"));

    // All buffered lines
    for (const bufLine of this.lineBuffer) {
      const text = bufLine.stream === "stderr"
        ? colors.red(bufLine.line)
        : bufLine.line;
      lines.push(text);
    }

    // Hint
    lines.push(colors.dim("(esc interrupt | ctrl+o fold)"));

    // Write all lines
    for (const line of lines) {
      Deno.stdout.writeSync(encoder.encode(line + "\n"));
    }

    this.lastRenderLines = lines.length;
  }

  /**
   * Clear the display area
   */
  private clearDisplay(): void {
    if (this.lastRenderLines === 0) return;

    const encoder = new TextEncoder();
    // Move cursor up and clear each line
    for (let i = 0; i < this.lastRenderLines; i++) {
      // Move up one line and clear it
      Deno.stdout.writeSync(encoder.encode("\x1b[A\x1b[2K"));
    }
    // Return to beginning of line
    Deno.stdout.writeSync(encoder.encode("\r"));

    this.lastRenderLines = 0;
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  /**
   * Start the render loop (updates spinner and display)
   */
  private startRenderLoop(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.spinnerFrameIndex++;
      this.render();
    }, 100); // 100ms = 10fps, smooth enough without too much CPU
  }

  /**
   * Stop the render loop
   */
  private stopRenderLoop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
