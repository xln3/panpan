# 模块 E: Watcher 监控器

## 整体背景

> 本模块是 SA 扩展项目的一部分。完整架构见 `00-overview.md`。

本模块实现 WatcherSA 的核心服务层，提供可扩展的资源监控器架构，支持
GPU/CPU/Memory/Disk/Network 等监控。

## 设计要点

- **插件式架构**: Monitor 接口统一，易于扩展新监控类型
- **本地+远程**: 通过 RemoteSA 监控远程服务器
- **阈值告警**: 支持自定义告警规则

## 依赖关系

- **依赖**: 无（可立即开始）
- **类型依赖**: `src/types/watcher.ts`
- **被依赖**: Sprint 2 的 tools/watcher (I)
- **可选依赖**: RemoteSA（远程监控功能）

## 文件结构

```
src/services/watcher/
├── mod.ts                  # 统一导出
├── monitor-registry.ts     # 监控器注册表
├── alert-manager.ts        # 告警管理
├── aggregator.ts           # 聚合本地+远程数据
└── monitors/
    ├── base.ts             # Monitor 基类
    ├── gpu.ts              # GPU 监控 (nvidia-smi)
    ├── cpu.ts              # CPU 监控
    ├── memory.ts           # 内存监控
    ├── disk.ts             # 磁盘监控 (含 inodes)
    ├── network.ts          # 网络监控
    └── custom.ts           # 自定义监控
```

## 详细设计

### 1. src/services/watcher/monitors/base.ts

```typescript
import type {
  Monitor,
  MonitorReading,
  MonitorType,
} from "../../../types/watcher.ts";

/**
 * Monitor 基类，提供通用功能
 */
export abstract class BaseMonitor implements Monitor {
  abstract type: MonitorType;
  abstract name: string;
  abstract description: string;

  /**
   * 检查监控器是否可用
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * 采样一次
   */
  abstract sample(): Promise<MonitorReading>;

  /**
   * 获取采样命令（用于远程执行）
   */
  abstract getCommand(): string;

  /**
   * 解析命令输出
   */
  abstract parseOutput(stdout: string): MonitorReading;

  /**
   * 创建标准读数对象
   */
  protected createReading(
    values: Record<string, number | string>,
    target: string = "local",
  ): MonitorReading {
    return {
      monitorId: `${this.type}-${target}`,
      type: this.type,
      target,
      timestamp: Date.now(),
      values,
    };
  }

  /**
   * 执行本地命令
   */
  protected async executeCommand(command: string): Promise<string> {
    const cmd = new Deno.Command("bash", {
      args: ["-c", command],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, stderr, success } = await cmd.output();
    if (!success) {
      throw new Error(new TextDecoder().decode(stderr));
    }

    return new TextDecoder().decode(stdout);
  }
}
```

### 2. src/services/watcher/monitors/gpu.ts

```typescript
import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * GPU 监控器 (NVIDIA)
 */
export class GPUMonitor extends BaseMonitor {
  type: MonitorType = "gpu";
  name = "NVIDIA GPU Monitor";
  description = "Monitor NVIDIA GPU utilization, memory, and temperature";

  async isAvailable(): Promise<boolean> {
    try {
      await this.executeCommand("which nvidia-smi");
      return true;
    } catch {
      return false;
    }
  }

  getCommand(): string {
    return "nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits";
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const lines = stdout.trim().split("\n");
    const gpus: Record<string, unknown>[] = [];

    for (const line of lines) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length >= 6) {
        gpus.push({
          index: parseInt(parts[0]),
          name: parts[1],
          utilization: parseInt(parts[2]),
          memoryUsed: parseInt(parts[3]),
          memoryTotal: parseInt(parts[4]),
          temperature: parseInt(parts[5]),
        });
      }
    }

    // 聚合值
    const totalUtil =
      gpus.reduce((sum, g) => sum + (g.utilization as number), 0) / gpus.length;
    const totalMemUsed = gpus.reduce(
      (sum, g) => sum + (g.memoryUsed as number),
      0,
    );
    const totalMemTotal = gpus.reduce(
      (sum, g) => sum + (g.memoryTotal as number),
      0,
    );
    const maxTemp = Math.max(...gpus.map((g) => g.temperature as number));

    return this.createReading({
      gpuCount: gpus.length,
      avgUtilization: Math.round(totalUtil),
      totalMemoryUsed: totalMemUsed,
      totalMemoryTotal: totalMemTotal,
      memoryUsagePercent: Math.round((totalMemUsed / totalMemTotal) * 100),
      maxTemperature: maxTemp,
      gpus: JSON.stringify(gpus),
    });
  }
}
```

### 3. src/services/watcher/monitors/cpu.ts

```typescript
import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * CPU 监控器
 */
export class CPUMonitor extends BaseMonitor {
  type: MonitorType = "cpu";
  name = "CPU Monitor";
  description = "Monitor CPU utilization and load average";

  async isAvailable(): Promise<boolean> {
    return true; // CPU 信息总是可用的
  }

  getCommand(): string {
    // 使用 top 获取 CPU 使用率，使用 uptime 获取负载
    return `top -bn1 | grep "Cpu(s)" | awk '{print $2}' && cat /proc/loadavg && nproc`;
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const lines = stdout.trim().split("\n");

    // 解析 CPU 使用率
    const cpuUsage = parseFloat(lines[0]) || 0;

    // 解析负载
    const loadParts = lines[1]?.split(" ") || [];
    const load1 = parseFloat(loadParts[0]) || 0;
    const load5 = parseFloat(loadParts[1]) || 0;
    const load15 = parseFloat(loadParts[2]) || 0;

    // CPU 核心数
    const cores = parseInt(lines[2]) || 1;

    return this.createReading({
      utilization: Math.round(cpuUsage),
      load1: load1.toFixed(2),
      load5: load5.toFixed(2),
      load15: load15.toFixed(2),
      cores,
      loadPerCore: (load1 / cores).toFixed(2),
    });
  }
}
```

### 4. src/services/watcher/monitors/memory.ts

```typescript
import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * 内存监控器
 */
export class MemoryMonitor extends BaseMonitor {
  type: MonitorType = "memory";
  name = "Memory Monitor";
  description = "Monitor RAM usage";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getCommand(): string {
    return "free -b | grep Mem";
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const parts = stdout.trim().split(/\s+/);
    // Mem: total used free shared buff/cache available

    const total = parseInt(parts[1]) || 0;
    const used = parseInt(parts[2]) || 0;
    const free = parseInt(parts[3]) || 0;
    const available = parseInt(parts[6]) || 0;

    return this.createReading({
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      availableBytes: available,
      usagePercent: Math.round((used / total) * 100),
      totalGB: (total / 1024 / 1024 / 1024).toFixed(2),
      usedGB: (used / 1024 / 1024 / 1024).toFixed(2),
      availableGB: (available / 1024 / 1024 / 1024).toFixed(2),
    });
  }
}
```

### 5. src/services/watcher/monitors/disk.ts

```typescript
import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * 磁盘监控器（含 inodes）
 */
export class DiskMonitor extends BaseMonitor {
  type: MonitorType = "disk";
  name = "Disk Monitor";
  description = "Monitor disk space and inodes";

  private path: string;

  constructor(path: string = "/") {
    super();
    this.path = path;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getCommand(): string {
    return `df -B1 ${this.path} | tail -1 && df -i ${this.path} | tail -1`;
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const lines = stdout.trim().split("\n");

    // 磁盘空间
    const spaceParts = lines[0].split(/\s+/);
    const totalBytes = parseInt(spaceParts[1]) || 0;
    const usedBytes = parseInt(spaceParts[2]) || 0;
    const availableBytes = parseInt(spaceParts[3]) || 0;

    // Inodes
    const inodeParts = lines[1].split(/\s+/);
    const totalInodes = parseInt(inodeParts[1]) || 0;
    const usedInodes = parseInt(inodeParts[2]) || 0;
    const availableInodes = parseInt(inodeParts[3]) || 0;

    return this.createReading({
      path: this.path,
      totalBytes,
      usedBytes,
      availableBytes,
      usagePercent: Math.round((usedBytes / totalBytes) * 100),
      totalGB: (totalBytes / 1024 / 1024 / 1024).toFixed(2),
      availableGB: (availableBytes / 1024 / 1024 / 1024).toFixed(2),
      totalInodes,
      usedInodes,
      availableInodes,
      inodeUsagePercent: Math.round((usedInodes / totalInodes) * 100),
    });
  }
}
```

### 6. src/services/watcher/monitors/network.ts

```typescript
import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * 网络监控器
 */
export class NetworkMonitor extends BaseMonitor {
  type: MonitorType = "network";
  name = "Network Monitor";
  description = "Monitor network I/O";

  private interface: string;
  private lastReading?: { rx: number; tx: number; timestamp: number };

  constructor(iface: string = "eth0") {
    super();
    this.interface = iface;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.executeCommand(
        `cat /sys/class/net/${this.interface}/statistics/rx_bytes`,
      );
      return true;
    } catch {
      return false;
    }
  }

  getCommand(): string {
    return `cat /sys/class/net/${this.interface}/statistics/rx_bytes /sys/class/net/${this.interface}/statistics/tx_bytes`;
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const lines = stdout.trim().split("\n");
    const rxBytes = parseInt(lines[0]) || 0;
    const txBytes = parseInt(lines[1]) || 0;
    const now = Date.now();

    let rxSpeed = 0;
    let txSpeed = 0;

    if (this.lastReading) {
      const elapsed = (now - this.lastReading.timestamp) / 1000;
      if (elapsed > 0) {
        rxSpeed = (rxBytes - this.lastReading.rx) / elapsed;
        txSpeed = (txBytes - this.lastReading.tx) / elapsed;
      }
    }

    this.lastReading = { rx: rxBytes, tx: txBytes, timestamp: now };

    return this.createReading({
      interface: this.interface,
      rxBytes,
      txBytes,
      rxSpeedBps: Math.round(rxSpeed),
      txSpeedBps: Math.round(txSpeed),
      rxSpeedMbps: (rxSpeed / 1024 / 1024).toFixed(2),
      txSpeedMbps: (txSpeed / 1024 / 1024).toFixed(2),
    });
  }
}
```

### 7. src/services/watcher/monitor-registry.ts

```typescript
import type { Monitor, MonitorType } from "../../types/watcher.ts";
import { GPUMonitor } from "./monitors/gpu.ts";
import { CPUMonitor } from "./monitors/cpu.ts";
import { MemoryMonitor } from "./monitors/memory.ts";
import { DiskMonitor } from "./monitors/disk.ts";
import { NetworkMonitor } from "./monitors/network.ts";

/**
 * 监控器注册表
 */
class MonitorRegistry {
  private monitors = new Map<string, Monitor>();

  /**
   * 注册内置监控器
   */
  registerBuiltinMonitors(): void {
    this.register("gpu", new GPUMonitor());
    this.register("cpu", new CPUMonitor());
    this.register("memory", new MemoryMonitor());
    this.register("disk-root", new DiskMonitor("/"));
    this.register(
      "disk-home",
      new DiskMonitor(Deno.env.get("HOME") || "/home"),
    );
    this.register("network-eth0", new NetworkMonitor("eth0"));
  }

  /**
   * 注册监控器
   */
  register(id: string, monitor: Monitor): void {
    this.monitors.set(id, monitor);
  }

  /**
   * 获取监控器
   */
  get(id: string): Monitor | undefined {
    return this.monitors.get(id);
  }

  /**
   * 获取可用的监控器
   */
  async getAvailable(): Promise<Monitor[]> {
    const available: Monitor[] = [];

    for (const monitor of this.monitors.values()) {
      if (await monitor.isAvailable()) {
        available.push(monitor);
      }
    }

    return available;
  }

  /**
   * 按类型获取监控器
   */
  getByType(type: MonitorType): Monitor[] {
    return Array.from(this.monitors.values()).filter((m) => m.type === type);
  }

  /**
   * 列出所有监控器
   */
  list(): { id: string; monitor: Monitor }[] {
    return Array.from(this.monitors.entries()).map(([id, monitor]) => ({
      id,
      monitor,
    }));
  }

  /**
   * 停止所有监控
   */
  stopAll(): void {
    // 目前监控器是无状态的，无需特别清理
    this.monitors.clear();
  }
}

// 单例导出
export const monitorRegistry = new MonitorRegistry();
```

### 8. src/services/watcher/alert-manager.ts

```typescript
import type {
  Alert,
  AlertConfig,
  MonitorReading,
} from "../../types/watcher.ts";

/**
 * 告警管理器
 */
class AlertManager {
  private configs = new Map<string, AlertConfig>();
  private alerts: Alert[] = [];
  private lastTrigger = new Map<string, number>();

  /**
   * 添加告警配置
   */
  addConfig(config: AlertConfig): void {
    this.configs.set(config.id, config);
  }

  /**
   * 移除告警配置
   */
  removeConfig(id: string): void {
    this.configs.delete(id);
  }

  /**
   * 获取所有配置
   */
  getConfigs(): AlertConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * 检查读数是否触发告警
   */
  check(reading: MonitorReading): Alert[] {
    const triggered: Alert[] = [];

    for (const config of this.configs.values()) {
      if (config.monitorId !== reading.monitorId) continue;

      const value = reading.values[config.metric];
      if (value === undefined) continue;

      const numValue = typeof value === "number"
        ? value
        : parseFloat(value as string);
      if (isNaN(numValue)) continue;

      // 检查条件
      let matches = false;
      switch (config.operator) {
        case ">":
          matches = numValue > config.threshold;
          break;
        case "<":
          matches = numValue < config.threshold;
          break;
        case ">=":
          matches = numValue >= config.threshold;
          break;
        case "<=":
          matches = numValue <= config.threshold;
          break;
        case "==":
          matches = numValue === config.threshold;
          break;
      }

      if (matches) {
        // 检查冷却时间
        const lastTime = this.lastTrigger.get(config.id) || 0;
        if (Date.now() - lastTime < config.cooldown) {
          continue;
        }

        const alert: Alert = {
          alertConfig: config,
          reading,
          triggeredAt: Date.now(),
          acknowledged: false,
        };

        this.alerts.push(alert);
        this.lastTrigger.set(config.id, Date.now());
        triggered.push(alert);
      }
    }

    return triggered;
  }

  /**
   * 获取未确认的告警
   */
  getUnacknowledged(): Alert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /**
   * 确认告警
   */
  acknowledge(index: number): void {
    if (this.alerts[index]) {
      this.alerts[index].acknowledged = true;
    }
  }

  /**
   * 清除所有告警
   */
  clear(): void {
    this.alerts = [];
  }
}

// 单例导出
export const alertManager = new AlertManager();
```

### 9. src/services/watcher/mod.ts

```typescript
export { monitorRegistry } from "./monitor-registry.ts";
export { alertManager } from "./alert-manager.ts";
export { BaseMonitor } from "./monitors/base.ts";
export { GPUMonitor } from "./monitors/gpu.ts";
export { CPUMonitor } from "./monitors/cpu.ts";
export { MemoryMonitor } from "./monitors/memory.ts";
export { DiskMonitor } from "./monitors/disk.ts";
export { NetworkMonitor } from "./monitors/network.ts";
```

## 终点状态（验收标准）

### 必须满足

- [ ] 所有内置监控器（GPU/CPU/Memory/Disk/Network）实现完成
- [ ] `isAvailable()` 能正确检测监控器可用性
- [ ] `sample()` 能返回正确格式的读数
- [ ] `getCommand()` + `parseOutput()` 能用于远程监控
- [ ] 告警管理器能正确触发和管理告警

### 测试场景

```typescript
// 1. 注册内置监控器
monitorRegistry.registerBuiltinMonitors();

// 2. 获取可用监控器
const available = await monitorRegistry.getAvailable();
console.log(`可用监控器: ${available.length}`);

// 3. CPU 采样
const cpuMonitor = monitorRegistry.get("cpu");
if (cpuMonitor) {
  const reading = await cpuMonitor.sample();
  assert(reading.values.utilization !== undefined);
  assert(reading.values.cores !== undefined);
}

// 4. 远程监控模式
const cmd = cpuMonitor.getCommand();
// 假设通过 RemoteSA 执行 cmd 得到 stdout
const remoteReading = cpuMonitor.parseOutput(stdout);
assert(remoteReading.values.utilization !== undefined);

// 5. 告警测试
alertManager.addConfig({
  id: "cpu-high",
  monitorId: "cpu-local",
  metric: "utilization",
  operator: ">",
  threshold: 90,
  message: "CPU 使用率过高",
  cooldown: 60000,
});

const alerts = alertManager.check(reading);
// 如果 CPU > 90%，应该触发告警
```

### 交付物

1. `src/services/watcher/monitors/base.ts` - Monitor 基类
2. `src/services/watcher/monitors/gpu.ts` - GPU 监控器
3. `src/services/watcher/monitors/cpu.ts` - CPU 监控器
4. `src/services/watcher/monitors/memory.ts` - 内存监控器
5. `src/services/watcher/monitors/disk.ts` - 磁盘监控器
6. `src/services/watcher/monitors/network.ts` - 网络监控器
7. `src/services/watcher/monitor-registry.ts` - 监控器注册表
8. `src/services/watcher/alert-manager.ts` - 告警管理器
9. `src/services/watcher/mod.ts` - 统一导出

## 预估时间

2 天
