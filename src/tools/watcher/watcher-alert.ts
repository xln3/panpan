/**
 * WatcherAlert Tool - Configure alert rules
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import type { AlertConfig } from "../../types/watcher.ts";
import { alertManager, monitorRegistry } from "../../services/watcher/mod.ts";

const inputSchema = z.object({
  action: z.enum(["add", "remove", "list", "clear", "acknowledge"]).describe(
    "Action: add (create alert), remove (delete by ID), list (show all), clear (remove all), acknowledge (ack all)",
  ),
  // For add action
  alert_id: z.string().optional().describe("Unique alert ID (required for add/remove)"),
  monitor_id: z.string().optional().describe("Monitor ID to watch (required for add)"),
  metric: z.string().optional().describe("Metric name to check, e.g., 'utilization', 'used_percent' (required for add)"),
  operator: z.enum([">", "<", ">=", "<=", "=="]).optional().describe("Comparison operator (required for add)"),
  threshold: z.number().optional().describe("Threshold value (required for add)"),
  message: z.string().optional().describe("Alert message when triggered (required for add)"),
  cooldown: z.number().default(60000).describe("Cooldown between repeated alerts in ms (default: 60000)"),
});

type Input = z.infer<typeof inputSchema>;

interface AlertOutput {
  action: string;
  success: boolean;
  configs?: AlertConfig[];
  stats?: {
    totalConfigs: number;
    totalAlerts: number;
    unacknowledged: number;
  };
  error?: string;
}

export const WatcherAlertTool: Tool<typeof inputSchema, AlertOutput> = {
  name: "WatcherAlert",
  description: `Configure alert rules for resource monitoring.

Actions:
- add: Create a new alert rule (requires alert_id, monitor_id, metric, operator, threshold, message)
- remove: Remove an alert by ID
- list: Show all configured alerts and their status
- clear: Remove all alert configurations
- acknowledge: Acknowledge all triggered alerts

Example alert metrics:
- CPU: utilization (0-100)
- Memory: used_percent (0-100), available_bytes
- GPU: utilization (0-100), memory_used_percent, temperature
- Disk: used_percent (0-100)`,

  inputSchema,

  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<AlertOutput>> {
    // Ensure monitors are registered for validation
    if (monitorRegistry.size === 0) {
      monitorRegistry.registerBuiltinMonitors();
    }

    switch (input.action) {
      case "add": {
        // Validate required fields
        if (!input.alert_id || !input.monitor_id || !input.metric || !input.operator || input.threshold === undefined || !input.message) {
          yield {
            type: "result",
            data: {
              action: "add",
              success: false,
              error: "Missing required fields: alert_id, monitor_id, metric, operator, threshold, message",
            },
          };
          return;
        }

        const config: AlertConfig = {
          id: input.alert_id,
          monitorId: input.monitor_id,
          metric: input.metric,
          operator: input.operator,
          threshold: input.threshold,
          message: input.message,
          cooldown: input.cooldown,
        };

        alertManager.addConfig(config);

        yield {
          type: "result",
          data: {
            action: "add",
            success: true,
            configs: [config],
            stats: alertManager.getStats(),
          },
          resultForAssistant: `Alert "${input.alert_id}" added: ${input.metric} ${input.operator} ${input.threshold}`,
        };
        break;
      }

      case "remove": {
        if (!input.alert_id) {
          yield {
            type: "result",
            data: { action: "remove", success: false, error: "alert_id is required" },
          };
          return;
        }

        const existed = alertManager.getConfig(input.alert_id);
        alertManager.removeConfig(input.alert_id);

        yield {
          type: "result",
          data: {
            action: "remove",
            success: !!existed,
            stats: alertManager.getStats(),
          },
          resultForAssistant: existed
            ? `Alert "${input.alert_id}" removed`
            : `Alert "${input.alert_id}" not found`,
        };
        break;
      }

      case "list": {
        const configs = alertManager.getConfigs();
        const stats = alertManager.getStats();
        const unacked = alertManager.getUnacknowledged();

        let summary = `## Alert Configuration\n\n`;
        summary += `**Stats**: ${stats.totalConfigs} rules, ${stats.totalAlerts} total alerts, ${stats.unacknowledged} unacknowledged\n\n`;

        if (configs.length > 0) {
          summary += `### Rules\n`;
          for (const c of configs) {
            summary += `- **${c.id}**: ${c.monitorId}.${c.metric} ${c.operator} ${c.threshold} → "${c.message}"\n`;
          }
        } else {
          summary += `No alert rules configured.\n`;
        }

        if (unacked.length > 0) {
          summary += `\n### Unacknowledged Alerts\n`;
          for (const a of unacked) {
            const time = new Date(a.triggeredAt).toISOString();
            summary += `- [${time}] ${a.alertConfig.message}\n`;
          }
        }

        yield {
          type: "result",
          data: { action: "list", success: true, configs, stats },
          resultForAssistant: summary,
        };
        break;
      }

      case "clear": {
        const prevStats = alertManager.getStats();
        alertManager.clearAll();

        yield {
          type: "result",
          data: {
            action: "clear",
            success: true,
            stats: alertManager.getStats(),
          },
          resultForAssistant: `Cleared ${prevStats.totalConfigs} alert rules and ${prevStats.totalAlerts} alerts`,
        };
        break;
      }

      case "acknowledge": {
        const unackedCount = alertManager.getUnacknowledged().length;
        alertManager.acknowledgeAll();

        yield {
          type: "result",
          data: {
            action: "acknowledge",
            success: true,
            stats: alertManager.getStats(),
          },
          resultForAssistant: `Acknowledged ${unackedCount} alerts`,
        };
        break;
      }
    }
  },

  renderResultForAssistant(output: AlertOutput): string {
    if (output.error) return `Error: ${output.error}`;
    if (output.stats) {
      return `${output.action}: ${output.stats.totalConfigs} rules, ${output.stats.unacknowledged} unacked`;
    }
    return `${output.action}: ${output.success ? "success" : "failed"}`;
  },
};
