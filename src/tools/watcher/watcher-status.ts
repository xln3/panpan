/**
 * WatcherStatus Tool - Sample current resource status
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import type { MonitorType } from "../../types/watcher.ts";
import { alertManager, monitorRegistry } from "../../services/watcher/mod.ts";

const inputSchema = z.object({
  monitors: z.array(z.enum(["gpu", "cpu", "memory", "disk", "network", "all"]))
    .default(["all"]).describe(
      "Which monitors to sample: gpu, cpu, memory, disk, network, or all",
    ),
  check_alerts: z.boolean().default(true).describe(
    "Check readings against configured alerts",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface StatusOutput {
  readings: Array<{
    monitorId: string;
    type: MonitorType;
    values: Record<string, number | string>;
    timestamp: number;
  }>;
  alerts: Array<{
    alertId: string;
    message: string;
    metric: string;
    value: number | string;
    threshold: number;
  }>;
  summary: string;
}

export const WatcherStatusTool: Tool<typeof inputSchema, StatusOutput> = {
  name: "WatcherStatus",
  description: `Sample current system resource status.

Returns readings from available monitors:
- gpu: GPU utilization, memory, temperature (requires nvidia-smi)
- cpu: CPU utilization percentage
- memory: Used/total/available memory
- disk: Disk usage for / and $HOME
- network: Network interface statistics

Also checks readings against any configured alerts.`,

  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<StatusOutput>> {
    // Ensure monitors are registered
    if (monitorRegistry.size === 0) {
      monitorRegistry.registerBuiltinMonitors();
    }

    yield { type: "progress", content: "Sampling monitors..." };

    const readings: StatusOutput["readings"] = [];
    const alerts: StatusOutput["alerts"] = [];
    const wantAll = input.monitors.includes("all");

    // Get available monitors
    const available = await monitorRegistry.getAvailable();

    for (const monitor of available) {
      // Filter by requested types
      if (
        !wantAll &&
        !input.monitors.includes(monitor.type as typeof input.monitors[number])
      ) {
        continue;
      }

      try {
        const reading = await monitor.sample();

        // Find the monitor ID
        const entry = monitorRegistry.list().find((e) => e.monitor === monitor);
        const monitorId = entry?.id || reading.monitorId;

        readings.push({
          monitorId,
          type: reading.type,
          values: reading.values,
          timestamp: reading.timestamp,
        });

        // Check alerts if enabled
        if (input.check_alerts) {
          const triggered = alertManager.check(reading);
          for (const alert of triggered) {
            alerts.push({
              alertId: alert.alertConfig.id,
              message: alert.alertConfig.message,
              metric: alert.alertConfig.metric,
              value: reading.values[alert.alertConfig.metric],
              threshold: alert.alertConfig.threshold,
            });
          }
        }
      } catch {
        // Skip failed monitors
      }
    }

    const summary = formatStatusSummary(readings, alerts);

    yield {
      type: "result",
      data: { readings, alerts, summary },
      resultForAssistant: summary,
    };
  },

  renderResultForAssistant(output: StatusOutput): string {
    return output.summary;
  },
};

function formatStatusSummary(
  readings: StatusOutput["readings"],
  alerts: StatusOutput["alerts"],
): string {
  if (readings.length === 0) {
    return "No monitors available on this system.";
  }

  const lines: string[] = ["## Resource Status\n"];

  for (const r of readings) {
    lines.push(`### ${r.type.toUpperCase()} (${r.monitorId})`);
    for (const [key, value] of Object.entries(r.values)) {
      const formatted = typeof value === "number" && key.includes("percent")
        ? `${value.toFixed(1)}%`
        : typeof value === "number" &&
            (key.includes("bytes") || key.includes("memory"))
        ? formatBytes(value)
        : String(value);
      lines.push(`- ${key}: ${formatted}`);
    }
    lines.push("");
  }

  if (alerts.length > 0) {
    lines.push("### ⚠️ Alerts Triggered");
    for (const a of alerts) {
      lines.push(
        `- **${a.alertId}**: ${a.message} (${a.metric}=${a.value}, threshold=${a.threshold})`,
      );
    }
  }

  return lines.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ============================================================================
// WatcherList - List available monitors
// ============================================================================

const listInputSchema = z.object({});

interface ListOutput {
  monitors: Array<{
    id: string;
    type: MonitorType;
    name: string;
    description: string;
    available: boolean;
  }>;
}

export const WatcherListTool: Tool<typeof listInputSchema, ListOutput> = {
  name: "WatcherList",
  description:
    "List all registered monitors and their availability on this system.",

  inputSchema: listInputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    _input: z.infer<typeof listInputSchema>,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<ListOutput>> {
    // Ensure monitors are registered
    if (monitorRegistry.size === 0) {
      monitorRegistry.registerBuiltinMonitors();
    }

    const summary = await monitorRegistry.getSummary();
    const list = monitorRegistry.list();

    const monitors = summary.map((s) => {
      const entry = list.find((l) => l.id === s.id);
      return {
        id: s.id,
        type: s.type,
        name: s.name,
        description: entry?.monitor.description || "",
        available: s.available,
      };
    });

    const availableCount = monitors.filter((m) => m.available).length;

    yield {
      type: "result",
      data: { monitors },
      resultForAssistant:
        `${availableCount}/${monitors.length} monitors available:\n${
          monitors.map((m) => `- ${m.id}: ${m.name} ${m.available ? "✓" : "✗"}`)
            .join("\n")
        }`,
    };
  },

  renderResultForAssistant(output: ListOutput): string {
    const available = output.monitors.filter((m) => m.available);
    return `${available.length}/${output.monitors.length} monitors available`;
  },
};
