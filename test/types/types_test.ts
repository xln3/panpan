/**
 * Tests for types module exports
 * Verifies all SA extension types are properly exported
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";

// Import all types to verify they're exported correctly
import type {
  // Diagnostics types
  NetworkDiagnosis,
  ErrorDiagnosis,
  ErrorType,
  Fix,
  FixAction,
  // Logger types
  LogLevel,
  LogEntryType,
  LogEntry,
  SummaryLogEntry,
  ToolLogEntry,
  LLMLogEntry,
  FailurePoint,
  LoggerHooks,
  // Remote types
  RemoteHost,
  RemoteConnection,
  DaemonInfo,
  RemoteExecInput,
  RemoteExecOutput,
  RemoteFileInput,
  // Watcher types
  MonitorType,
  MonitorConfig,
  MonitorReading,
  AlertConfig,
  Alert,
  Monitor,
  // PM types
  Requirement,
  QA,
  TestPlan,
  TestCase,
  PMBudget,
  AlternativePlan,
  PMClarifyInput,
  PMTestPlanInput,
  PMVerifyInput,
  PMStatusInput,
  // Agent types (extended)
  AgentConfig,
} from "../../src/types/mod.ts";

Deno.test("types/diagnostics - exports NetworkDiagnosis", () => {
  const diagnosis: NetworkDiagnosis = {
    networkReachable: true,
    dnsWorking: true,
    proxyConfigured: false,
    availableMirrors: [],
    sslValid: true,
  };
  assertEquals(diagnosis.networkReachable, true);
});

Deno.test("types/diagnostics - exports ErrorDiagnosis", () => {
  const diagnosis: ErrorDiagnosis = {
    type: "timeout",
    autoFixable: true,
    suggestedFixes: [],
    requiresUserInput: false,
  };
  assertEquals(diagnosis.type, "timeout");
});

Deno.test("types/diagnostics - exports Fix with FixAction", () => {
  const fix: Fix = {
    id: "test-fix",
    description: "Test fix",
    confidence: 0.9,
    action: { type: "set_env", key: "HTTP_PROXY", value: "http://proxy:8080" },
  };
  assertEquals(fix.action.type, "set_env");
});

Deno.test("types/logger - exports LogEntry types", () => {
  const entry: LogEntry = {
    id: "entry-1",
    level: "tool",
    timestamp: Date.now(),
    type: "tool_call",
    data: {},
    success: true,
  };
  assertEquals(entry.type, "tool_call");
});

Deno.test("types/logger - exports LoggerHooks interface shape", () => {
  // Verify the interface shape compiles
  const hooks: Partial<LoggerHooks> = {
    onToolStart: (_name, _input) => {},
    onToolComplete: (_name, _result, _duration) => {},
  };
  assertExists(hooks.onToolStart);
});

Deno.test("types/remote - exports RemoteHost", () => {
  const host: RemoteHost = {
    id: "test-server",
    hostname: "192.168.1.1",
    port: 22,
    username: "user",
    authMethod: "key",
    keyPath: "~/.ssh/id_rsa",
  };
  assertEquals(host.authMethod, "key");
});

Deno.test("types/remote - exports RemoteConnection", () => {
  const conn: RemoteConnection = {
    host: {
      id: "test",
      hostname: "localhost",
      port: 22,
      username: "user",
      authMethod: "agent",
    },
    status: "ready",
    daemonPort: 8080,
  };
  assertEquals(conn.status, "ready");
});

Deno.test("types/remote - exports RemoteExecOutput", () => {
  const output: RemoteExecOutput = {
    stdout: "hello",
    stderr: "",
    exitCode: 0,
    durationMs: 100,
    host: "localhost",
  };
  assertEquals(output.host, "localhost");
});

Deno.test("types/watcher - exports MonitorConfig", () => {
  const config: MonitorConfig = {
    id: "gpu-monitor",
    type: "gpu",
    target: "local",
    interval: 5000,
    enabled: true,
  };
  assertEquals(config.type, "gpu");
});

Deno.test("types/watcher - exports AlertConfig", () => {
  const alert: AlertConfig = {
    id: "high-gpu",
    monitorId: "gpu-monitor",
    metric: "utilization",
    operator: ">",
    threshold: 90,
    message: "GPU usage high",
    cooldown: 60000,
  };
  assertEquals(alert.operator, ">");
});

Deno.test("types/pm - exports Requirement", () => {
  const req: Requirement = {
    id: "req-1",
    original: "Add login feature",
    clarified: "Add OAuth login with Google",
    acceptance: ["User can login with Google"],
    questions: [],
    status: "clarified",
  };
  assertEquals(req.status, "clarified");
});

Deno.test("types/pm - exports TestPlan", () => {
  const plan: TestPlan = {
    requirements: ["req-1"],
    tests: [],
    generatedAt: Date.now(),
  };
  assertEquals(plan.requirements.length, 1);
});

Deno.test("types/pm - exports PMBudget", () => {
  const budget: PMBudget = {
    tokenLimit: 10000,
    tokenUsed: 500,
    timeLimit: 300000,
    timeUsed: 10000,
    attemptsLimit: 3,
    attemptsUsed: 1,
  };
  assertEquals(budget.attemptsUsed, 1);
});

Deno.test("types/agent - AgentConfig includes SA extension fields", () => {
  const config: AgentConfig = {
    name: "RemoteSA",
    whenToUse: "For remote execution",
    tools: "*",
    systemPrompt: "You are a remote execution agent",
    // SA extension fields
    persistent: true,
    hasBackgroundServices: true,
    requiresInit: true,
  };
  assertEquals(config.persistent, true);
  assertEquals(config.hasBackgroundServices, true);
  assertEquals(config.requiresInit, true);
});
