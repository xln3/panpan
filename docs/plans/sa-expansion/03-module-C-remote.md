# 模块 C: Remote 服务

## 整体背景
> 本模块是 SA 扩展项目的一部分。完整架构见 `00-overview.md`。

本模块实现 RemoteSA 的核心服务层，包括 SSH 引导、Daemon 通信、连接池管理。采用混合模式：SSH bootstrap 安装 daemon，之后通过 daemon 通信。

## 设计要点
- **避免重复认证**: SSH 只用于初始引导，之后通过 daemon 通信
- **避免命令转义问题**: daemon 使用 HTTP API，不需要 shell 转义
- **上下文隔离**: 每个命令输出都标记主机名，避免混淆本地/远程

## 依赖关系
- **依赖**: 无（可立即开始）
- **类型依赖**: `src/types/remote.ts`
- **被依赖**: Sprint 2 的 tools/remote (G)

## 文件结构
```
src/services/remote/
├── mod.ts                  # 统一导出
├── connection-manager.ts   # 连接池管理
├── daemon-client.ts        # 与 daemon HTTP 通信
├── ssh-bootstrap.ts        # SSH 引导安装 daemon
└── daemon-binary.ts        # 内嵌的 daemon 源码
```

## 通信流程
```
┌──────────┐         ┌─────────────┐         ┌──────────────┐
│  panpan  │   SSH   │   Target    │  HTTP/  │   panpan     │
│  client  │────────▶│   Server    │  WS     │   daemon     │
│          │         │             │◀────────│              │
└──────────┘         └─────────────┘         └──────────────┘

1. SSH Bootstrap:
   - SSH 连接
   - 上传 daemon 脚本
   - 启动 daemon (返回 port + token)
   - 断开 SSH

2. Daemon 通信:
   - HTTP 请求 + Bearer token
   - WebSocket (可选，用于流式输出)

3. 清理:
   - 发送 shutdown 信号
   - daemon 超时自动关闭
```

## 详细设计

### 1. src/services/remote/daemon-binary.ts
```typescript
/**
 * 内嵌的 daemon 源码
 * 这是一个轻量级 HTTP 服务器，部署到远程服务器
 */
export const DAEMON_SOURCE = `
// panpan-daemon.ts - 远程执行 daemon
// 使用方式: deno run --allow-all panpan-daemon.ts <port> <token> <timeout_seconds>

const port = parseInt(Deno.args[0]) || 0;  // 0 = 随机端口
const token = Deno.args[1] || crypto.randomUUID();
const timeoutSeconds = parseInt(Deno.args[2]) || 1800;  // 默认 30 分钟

let lastActivity = Date.now();

// 自动关闭定时器
const shutdownTimer = setInterval(() => {
  if (Date.now() - lastActivity > timeoutSeconds * 1000) {
    console.log("Daemon timeout, shutting down...");
    Deno.exit(0);
  }
}, 60000);

// HTTP 服务器
const server = Deno.serve({ port }, async (req) => {
  lastActivity = Date.now();

  // 验证 token
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== \`Bearer \${token}\`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);

  // GET /health - 健康检查
  if (url.pathname === "/health" && req.method === "GET") {
    return Response.json({
      status: "ok",
      pid: Deno.pid,
      uptime: Date.now() - (lastActivity - timeoutSeconds * 1000),
    });
  }

  // POST /exec - 执行命令
  if (url.pathname === "/exec" && req.method === "POST") {
    try {
      const body = await req.json();
      const { command, cwd, env, timeout = 60000 } = body;

      const cmd = new Deno.Command("bash", {
        args: ["-c", command],
        cwd: cwd || Deno.cwd(),
        env: { ...Deno.env.toObject(), ...env },
        stdout: "piped",
        stderr: "piped",
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const process = cmd.spawn();
      const [stdout, stderr] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);
      const status = await process.status;

      clearTimeout(timeoutId);

      return Response.json({
        stdout,
        stderr,
        exitCode: status.code,
      });
    } catch (error) {
      return Response.json({
        error: error.message,
        exitCode: -1,
      }, { status: 500 });
    }
  }

  // POST /file/read - 读取文件
  if (url.pathname === "/file/read" && req.method === "POST") {
    try {
      const { path } = await req.json();
      const content = await Deno.readTextFile(path);
      return Response.json({ content });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /file/write - 写入文件
  if (url.pathname === "/file/write" && req.method === "POST") {
    try {
      const { path, content } = await req.json();
      await Deno.writeTextFile(path, content);
      return Response.json({ success: true });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /shutdown - 关闭 daemon
  if (url.pathname === "/shutdown" && req.method === "POST") {
    clearInterval(shutdownTimer);
    setTimeout(() => Deno.exit(0), 100);
    return Response.json({ message: "Shutting down" });
  }

  return new Response("Not Found", { status: 404 });
});

// 输出启动信息（供 SSH bootstrap 捕获）
console.log(\`DAEMON_STARTED:{"port":\${server.addr.port},"token":"\${token}","pid":\${Deno.pid}}\`);
`;

/**
 * 获取 daemon 版本
 */
export const DAEMON_VERSION = "0.1.0";

/**
 * 检查远程是否安装了 Deno
 */
export function getDenoCheckCommand(): string {
  return "which deno || echo 'DENO_NOT_FOUND'";
}

/**
 * 获取 Deno 安装命令
 */
export function getDenoInstallCommand(): string {
  return "curl -fsSL https://deno.land/install.sh | sh";
}
```

### 2. src/services/remote/ssh-bootstrap.ts
```typescript
import type { RemoteHost, DaemonInfo } from "../../types/remote.ts";
import { DAEMON_SOURCE, getDenoCheckCommand, getDenoInstallCommand } from "./daemon-binary.ts";

/**
 * SSH 引导选项
 */
export interface SSHBootstrapOptions {
  installDeno?: boolean;  // 如果 Deno 不存在，是否安装
  daemonTimeout?: number; // daemon 超时时间（秒）
}

/**
 * SSH 引导结果
 */
export interface SSHBootstrapResult {
  success: boolean;
  daemonInfo?: DaemonInfo;
  error?: string;
}

/**
 * 通过 SSH 引导安装并启动 daemon
 */
export async function bootstrapDaemon(
  host: RemoteHost,
  options: SSHBootstrapOptions = {}
): Promise<SSHBootstrapResult> {
  const { installDeno = true, daemonTimeout = 1800 } = options;

  try {
    // 1. 构建 SSH 命令基础
    const sshBase = buildSSHCommand(host);

    // 2. 检查 Deno 是否安装
    const denoCheck = await executeSSH(sshBase, getDenoCheckCommand());
    if (denoCheck.stdout.includes("DENO_NOT_FOUND")) {
      if (!installDeno) {
        return {
          success: false,
          error: "Deno not installed on remote host and installDeno is false",
        };
      }

      // 安装 Deno
      const installResult = await executeSSH(sshBase, getDenoInstallCommand());
      if (installResult.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to install Deno: ${installResult.stderr}`,
        };
      }
    }

    // 3. 上传 daemon 脚本
    const daemonPath = "/tmp/panpan-daemon.ts";
    await uploadFile(host, DAEMON_SOURCE, daemonPath);

    // 4. 生成 token
    const token = crypto.randomUUID();

    // 5. 启动 daemon
    const startCmd = `nohup ~/.deno/bin/deno run --allow-all ${daemonPath} 0 ${token} ${daemonTimeout} > /tmp/panpan-daemon.log 2>&1 & sleep 1 && cat /tmp/panpan-daemon.log | grep DAEMON_STARTED`;

    const startResult = await executeSSH(sshBase, startCmd);
    if (startResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to start daemon: ${startResult.stderr}`,
      };
    }

    // 6. 解析 daemon 信息
    const match = startResult.stdout.match(/DAEMON_STARTED:({.*})/);
    if (!match) {
      return {
        success: false,
        error: "Failed to parse daemon startup info",
      };
    }

    const daemonInfo: DaemonInfo = {
      ...JSON.parse(match[1]),
      version: "0.1.0",
      startedAt: Date.now(),
      capabilities: ["exec", "file"],
    };

    return { success: true, daemonInfo };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 构建 SSH 命令
 */
function buildSSHCommand(host: RemoteHost): string[] {
  const args = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-p", String(host.port),
  ];

  if (host.authMethod === "key" && host.keyPath) {
    args.push("-i", host.keyPath);
  }

  args.push(`${host.username}@${host.hostname}`);

  return ["ssh", ...args];
}

/**
 * 执行 SSH 命令
 */
async function executeSSH(
  sshBase: string[],
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cmd = new Deno.Command(sshBase[0], {
    args: [...sshBase.slice(1), command],
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  const status = await process.status;

  return { stdout, stderr, exitCode: status.code };
}

/**
 * 上传文件到远程
 */
async function uploadFile(
  host: RemoteHost,
  content: string,
  remotePath: string
): Promise<void> {
  // 使用 cat 通过 SSH 写入文件
  const sshBase = buildSSHCommand(host);
  const cmd = new Deno.Command(sshBase[0], {
    args: [...sshBase.slice(1), `cat > ${remotePath}`],
    stdin: "piped",
    stdout: "null",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(content));
  await writer.close();
  await process.status;
}
```

### 3. src/services/remote/daemon-client.ts
```typescript
import type { RemoteExecInput, RemoteExecOutput, RemoteFileInput } from "../../types/remote.ts";

/**
 * Daemon 客户端
 */
export class DaemonClient {
  private baseUrl: string;
  private token: string;
  private hostname: string;

  constructor(
    hostname: string,
    port: number,
    token: string
  ) {
    this.baseUrl = `http://${hostname}:${port}`;
    this.token = token;
    this.hostname = hostname;
  }

  /**
   * 健康检查
   */
  async health(): Promise<{ status: string; pid: number; uptime: number }> {
    const response = await this.fetch("/health", { method: "GET" });
    return response.json();
  }

  /**
   * 执行命令
   */
  async exec(input: Omit<RemoteExecInput, "connectionId">): Promise<RemoteExecOutput> {
    const startTime = Date.now();
    const response = await this.fetch("/exec", {
      method: "POST",
      body: JSON.stringify({
        command: input.command,
        cwd: input.cwd,
        env: input.env,
        timeout: input.timeout,
      }),
    });

    const result = await response.json();
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode ?? -1,
      durationMs: Date.now() - startTime,
      host: this.hostname,  // 始终标记主机名
    };
  }

  /**
   * 读取文件
   */
  async readFile(path: string): Promise<string> {
    const response = await this.fetch("/file/read", {
      method: "POST",
      body: JSON.stringify({ path }),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(`[${this.hostname}] ${result.error}`);
    }
    return result.content;
  }

  /**
   * 写入文件
   */
  async writeFile(path: string, content: string): Promise<void> {
    const response = await this.fetch("/file/write", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(`[${this.hostname}] ${result.error}`);
    }
  }

  /**
   * 关闭 daemon
   */
  async shutdown(): Promise<void> {
    try {
      await this.fetch("/shutdown", { method: "POST" });
    } catch {
      // 忽略关闭时的连接错误
    }
  }

  /**
   * 内部 fetch 封装
   */
  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok && response.status !== 200) {
      const text = await response.text();
      throw new Error(`[${this.hostname}] Daemon error: ${response.status} ${text}`);
    }

    return response;
  }
}
```

### 4. src/services/remote/connection-manager.ts
```typescript
import type { RemoteHost, RemoteConnection, DaemonInfo, RemoteExecInput, RemoteExecOutput } from "../../types/remote.ts";
import { bootstrapDaemon, type SSHBootstrapOptions } from "./ssh-bootstrap.ts";
import { DaemonClient } from "./daemon-client.ts";

/**
 * 连接管理器 - 管理所有远程连接
 */
class ConnectionManager {
  private connections = new Map<string, {
    connection: RemoteConnection;
    client?: DaemonClient;
  }>();

  /**
   * 连接到远程主机
   */
  async connect(
    host: RemoteHost,
    options?: SSHBootstrapOptions
  ): Promise<string> {
    const connectionId = host.id || `${host.username}@${host.hostname}:${host.port}`;

    // 检查是否已连接
    const existing = this.connections.get(connectionId);
    if (existing?.connection.status === "ready") {
      return connectionId;
    }

    // 创建连接记录
    const connection: RemoteConnection = {
      host,
      status: "connecting",
    };
    this.connections.set(connectionId, { connection });

    try {
      // SSH 引导
      connection.status = "bootstrapping";
      const result = await bootstrapDaemon(host, options);

      if (!result.success || !result.daemonInfo) {
        connection.status = "error";
        connection.error = result.error;
        throw new Error(result.error);
      }

      // 创建 daemon 客户端
      const client = new DaemonClient(
        host.hostname,
        result.daemonInfo.port,
        result.daemonInfo.token
      );

      // 验证连接
      await client.health();

      // 更新连接状态
      connection.status = "ready";
      connection.daemonPort = result.daemonInfo.port;
      connection.daemonPid = result.daemonInfo.pid;
      connection.connectedAt = Date.now();
      connection.lastActivity = Date.now();

      this.connections.set(connectionId, { connection, client });

      return connectionId;
    } catch (error) {
      connection.status = "error";
      connection.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * 执行命令
   */
  async execute(
    connectionId: string,
    input: Omit<RemoteExecInput, "connectionId">
  ): Promise<RemoteExecOutput> {
    const entry = this.connections.get(connectionId);
    if (!entry?.client) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    if (entry.connection.status !== "ready") {
      throw new Error(`Connection not ready: ${connectionId} (${entry.connection.status})`);
    }

    entry.connection.lastActivity = Date.now();
    return entry.client.exec(input);
  }

  /**
   * 读取远程文件
   */
  async readFile(connectionId: string, path: string): Promise<string> {
    const entry = this.connections.get(connectionId);
    if (!entry?.client) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    entry.connection.lastActivity = Date.now();
    return entry.client.readFile(path);
  }

  /**
   * 写入远程文件
   */
  async writeFile(connectionId: string, path: string, content: string): Promise<void> {
    const entry = this.connections.get(connectionId);
    if (!entry?.client) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    entry.connection.lastActivity = Date.now();
    return entry.client.writeFile(path, content);
  }

  /**
   * 断开连接
   */
  async disconnect(connectionId: string): Promise<void> {
    const entry = this.connections.get(connectionId);
    if (!entry) return;

    if (entry.client) {
      await entry.client.shutdown();
    }

    this.connections.delete(connectionId);
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys());
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }

  /**
   * 获取连接状态
   */
  getStatus(connectionId: string): RemoteConnection | undefined {
    return this.connections.get(connectionId)?.connection;
  }

  /**
   * 列出所有连接
   */
  listConnections(): RemoteConnection[] {
    return Array.from(this.connections.values()).map((e) => e.connection);
  }

  /**
   * 重连
   */
  async reconnect(connectionId: string): Promise<void> {
    const entry = this.connections.get(connectionId);
    if (!entry) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    await this.disconnect(connectionId);
    await this.connect(entry.connection.host);
  }
}

// 单例导出
export const connectionManager = new ConnectionManager();
```

### 5. src/services/remote/mod.ts
```typescript
export { connectionManager } from "./connection-manager.ts";
export { DaemonClient } from "./daemon-client.ts";
export { bootstrapDaemon, type SSHBootstrapOptions, type SSHBootstrapResult } from "./ssh-bootstrap.ts";
export { DAEMON_SOURCE, DAEMON_VERSION } from "./daemon-binary.ts";
```

## 终点状态（验收标准）

### 必须满足
- [ ] 能通过 SSH 连接到远程服务器并启动 daemon
- [ ] daemon 能响应 /health, /exec, /file/read, /file/write, /shutdown
- [ ] connectionManager 能管理多个连接
- [ ] 所有命令输出都包含主机名（避免混淆）
- [ ] daemon 超时后能自动关闭

### 测试场景
```typescript
// 1. 连接测试（需要可用的 SSH 服务器）
const host: RemoteHost = {
  id: "test-server",
  hostname: "localhost",
  port: 22,
  username: "testuser",
  authMethod: "key",
  keyPath: "~/.ssh/id_rsa",
};

const connectionId = await connectionManager.connect(host);
assert(connectionId === "test-server");

// 2. 执行命令
const result = await connectionManager.execute(connectionId, {
  command: "echo 'hello world'",
});
assert(result.stdout.includes("hello world"));
assert(result.host === "localhost");  // 输出包含主机名

// 3. 文件操作
await connectionManager.writeFile(connectionId, "/tmp/test.txt", "content");
const content = await connectionManager.readFile(connectionId, "/tmp/test.txt");
assert(content === "content");

// 4. 断开连接
await connectionManager.disconnect(connectionId);
```

### 交付物
1. `src/services/remote/daemon-binary.ts` - daemon 源码
2. `src/services/remote/ssh-bootstrap.ts` - SSH 引导逻辑
3. `src/services/remote/daemon-client.ts` - daemon HTTP 客户端
4. `src/services/remote/connection-manager.ts` - 连接池管理
5. `src/services/remote/mod.ts` - 统一导出

## 预估时间
3 天
