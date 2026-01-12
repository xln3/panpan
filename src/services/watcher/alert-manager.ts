import type {
  Alert,
  AlertConfig,
  MonitorReading,
} from "../../types/watcher.ts";

/**
 * Event listener for alert events.
 */
export type AlertListener = (alert: Alert) => void;

/**
 * Manager for monitoring alerts.
 * Handles alert configuration, threshold checking, and cooldown management.
 */
class AlertManager {
  private configs = new Map<string, AlertConfig>();
  private alerts: Alert[] = [];
  private lastTrigger = new Map<string, number>();
  private listeners: AlertListener[] = [];

  /**
   * Add an alert configuration.
   * @param config - Alert configuration to add
   */
  addConfig(config: AlertConfig): void {
    this.configs.set(config.id, config);
  }

  /**
   * Remove an alert configuration by ID.
   * @param id - Alert config ID to remove
   */
  removeConfig(id: string): void {
    this.configs.delete(id);
    this.lastTrigger.delete(id);
  }

  /**
   * Get an alert configuration by ID.
   * @param id - Alert config ID
   */
  getConfig(id: string): AlertConfig | undefined {
    return this.configs.get(id);
  }

  /**
   * Get all alert configurations.
   */
  getConfigs(): AlertConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Check a monitor reading against all relevant alert configs.
   * @param reading - Monitor reading to check
   * @returns Array of triggered alerts
   */
  check(reading: MonitorReading): Alert[] {
    const triggered: Alert[] = [];

    for (const config of this.configs.values()) {
      // Only check configs for this monitor
      if (config.monitorId !== reading.monitorId) continue;

      // Get the metric value from the reading
      const value = reading.values[config.metric];
      if (value === undefined) continue;

      // Convert to number if needed
      const numValue = typeof value === "number"
        ? value
        : parseFloat(value as string);
      if (isNaN(numValue)) continue;

      // Check the threshold condition
      const matches = this.checkCondition(
        numValue,
        config.operator,
        config.threshold,
      );

      if (matches) {
        // Check cooldown period
        const lastTime = this.lastTrigger.get(config.id) || 0;
        const now = Date.now();

        if (now - lastTime < config.cooldown) {
          continue; // Still in cooldown
        }

        // Create alert
        const alert: Alert = {
          alertConfig: config,
          reading,
          triggeredAt: now,
          acknowledged: false,
        };

        this.alerts.push(alert);
        this.lastTrigger.set(config.id, now);
        triggered.push(alert);

        // Notify listeners
        this.notifyListeners(alert);
      }
    }

    return triggered;
  }

  /**
   * Check if a value matches a condition.
   */
  private checkCondition(
    value: number,
    operator: AlertConfig["operator"],
    threshold: number,
  ): boolean {
    switch (operator) {
      case ">":
        return value > threshold;
      case "<":
        return value < threshold;
      case ">=":
        return value >= threshold;
      case "<=":
        return value <= threshold;
      case "==":
        return value === threshold;
      default:
        return false;
    }
  }

  /**
   * Get all unacknowledged alerts.
   */
  getUnacknowledged(): Alert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /**
   * Get all alerts.
   */
  getAll(): Alert[] {
    return [...this.alerts];
  }

  /**
   * Acknowledge an alert by index.
   * @param index - Alert index in the alerts array
   */
  acknowledge(index: number): void {
    if (this.alerts[index]) {
      this.alerts[index].acknowledged = true;
    }
  }

  /**
   * Acknowledge all unacknowledged alerts.
   */
  acknowledgeAll(): void {
    for (const alert of this.alerts) {
      alert.acknowledged = true;
    }
  }

  /**
   * Clear all alerts (keeps configurations).
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * Clear all configurations and alerts.
   */
  clearAll(): void {
    this.configs.clear();
    this.alerts = [];
    this.lastTrigger.clear();
  }

  /**
   * Add a listener for new alerts.
   * @param listener - Function to call when an alert is triggered
   */
  addListener(listener: AlertListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a listener.
   * @param listener - Listener to remove
   */
  removeListener(listener: AlertListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /**
   * Notify all listeners of a new alert.
   */
  private notifyListeners(alert: Alert): void {
    for (const listener of this.listeners) {
      try {
        listener(alert);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Get statistics about alerts.
   */
  getStats(): {
    totalConfigs: number;
    totalAlerts: number;
    unacknowledged: number;
  } {
    return {
      totalConfigs: this.configs.size,
      totalAlerts: this.alerts.length,
      unacknowledged: this.getUnacknowledged().length,
    };
  }
}

// Export singleton instance
export const alertManager = new AlertManager();

// Also export the class for testing
export { AlertManager };
