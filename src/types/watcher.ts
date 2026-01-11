/**
 * Watcher types for resource monitoring.
 * Used by WatcherSA to monitor GPU, CPU, disk, and other system resources.
 */

/**
 * Types of resources that can be monitored
 */
export type MonitorType =
  | "gpu"
  | "cpu"
  | "memory"
  | "disk"
  | "network"
  | "io"
  | "inodes"
  | "custom";

/**
 * Configuration for a monitor instance
 */
export interface MonitorConfig {
  /** Unique identifier for this monitor */
  id: string;
  /** Type of resource being monitored */
  type: MonitorType;
  /** Target to monitor: local or a specific remote connection */
  target: "local" | { remote: string };
  /** Sampling interval in milliseconds */
  interval: number;
  /** Whether this monitor is active */
  enabled: boolean;
  /** Custom command to execute (for custom type) */
  customCommand?: string;
  /** Custom parser function name (for custom type) */
  customParser?: string;
}

/**
 * A single reading from a monitor
 */
export interface MonitorReading {
  /** ID of the monitor that produced this reading */
  monitorId: string;
  /** Type of the monitor */
  type: MonitorType;
  /** Target that was monitored */
  target: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Key-value pairs of metric values */
  values: Record<string, number | string>;
}

/**
 * Configuration for an alert rule
 */
export interface AlertConfig {
  /** Unique identifier for this alert */
  id: string;
  /** ID of the monitor to watch */
  monitorId: string;
  /** Metric name to check */
  metric: string;
  /** Comparison operator */
  operator: ">" | "<" | ">=" | "<=" | "==";
  /** Threshold value to compare against */
  threshold: number;
  /** Message to display when alert triggers */
  message: string;
  /** Minimum time between repeated alerts in milliseconds */
  cooldown: number;
}

/**
 * An instance of a triggered alert
 */
export interface Alert {
  /** Configuration that triggered this alert */
  alertConfig: AlertConfig;
  /** Reading that triggered the alert */
  reading: MonitorReading;
  /** Unix timestamp when alert was triggered */
  triggeredAt: number;
  /** Whether this alert has been acknowledged */
  acknowledged: boolean;
}

/**
 * Interface that monitor plugins must implement
 */
export interface Monitor {
  /** Type of resource this monitor handles */
  type: MonitorType;
  /** Human-readable name */
  name: string;
  /** Description of what this monitor measures */
  description: string;
  /** Check if this monitor can run on the current system */
  isAvailable(): Promise<boolean>;
  /** Take a single sample */
  sample(): Promise<MonitorReading>;
  /** Get the command used for sampling (for remote execution) */
  getCommand(): string;
  /** Parse command output into a reading */
  parseOutput(stdout: string): MonitorReading;
}
