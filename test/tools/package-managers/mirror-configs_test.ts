/**
 * Tests for mirror-configs module
 */

import { assertEquals } from "@std/assert";
import {
  getMirrorConfig,
  MIRROR_CONFIGS,
  type PackageManagerTool,
} from "../../../src/tools/package-managers/mirror-configs.ts";

// ============ MIRROR_CONFIGS Tests ============

Deno.test("MIRROR_CONFIGS - pip config generates correct args", () => {
  const config = MIRROR_CONFIGS.pip;
  assertEquals(config.service, "pypi");

  const args = config.getMirrorArgs("https://pypi.tuna.tsinghua.edu.cn/simple");
  assertEquals(args.includes("-i"), true);
  assertEquals(args.includes("https://pypi.tuna.tsinghua.edu.cn/simple"), true);
  assertEquals(args.includes("--trusted-host"), true);
  assertEquals(args.includes("pypi.tuna.tsinghua.edu.cn"), true);
});

Deno.test("MIRROR_CONFIGS - uv config generates correct args", () => {
  const config = MIRROR_CONFIGS.uv;
  assertEquals(config.service, "pypi");

  const args = config.getMirrorArgs("https://mirrors.aliyun.com/pypi/simple");
  assertEquals(args, ["--index-url", "https://mirrors.aliyun.com/pypi/simple"]);
});

Deno.test("MIRROR_CONFIGS - conda config generates correct args", () => {
  const config = MIRROR_CONFIGS.conda;
  assertEquals(config.service, "conda");

  const args = config.getMirrorArgs(
    "https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main",
  );
  assertEquals(args.includes("-c"), true);
  assertEquals(args.includes("--override-channels"), true);
  assertEquals(
    args.includes("https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main"),
    true,
  );
});

Deno.test("MIRROR_CONFIGS - pixi config generates correct args", () => {
  const config = MIRROR_CONFIGS.pixi;
  assertEquals(config.service, "conda");

  const args = config.getMirrorArgs(
    "https://mirrors.aliyun.com/anaconda/pkgs/main",
  );
  assertEquals(args, [
    "--channel",
    "https://mirrors.aliyun.com/anaconda/pkgs/main",
  ]);
});

// ============ getMirrorConfig Tests ============

Deno.test("getMirrorConfig - returns pip config", () => {
  const config = getMirrorConfig("pip");
  assertEquals(config.service, "pypi");
});

Deno.test("getMirrorConfig - returns uv config", () => {
  const config = getMirrorConfig("uv");
  assertEquals(config.service, "pypi");
});

Deno.test("getMirrorConfig - returns conda config", () => {
  const config = getMirrorConfig("conda");
  assertEquals(config.service, "conda");
});

Deno.test("getMirrorConfig - returns pixi config", () => {
  const config = getMirrorConfig("pixi");
  assertEquals(config.service, "conda");
});

// ============ Hostname Extraction Tests ============

Deno.test("MIRROR_CONFIGS - pip extracts hostname correctly", () => {
  const args = MIRROR_CONFIGS.pip.getMirrorArgs(
    "https://pypi.tuna.tsinghua.edu.cn/simple",
  );
  // --trusted-host should be followed by hostname
  const hostIdx = args.indexOf("--trusted-host");
  assertEquals(args[hostIdx + 1], "pypi.tuna.tsinghua.edu.cn");
});

Deno.test("MIRROR_CONFIGS - pip handles URL without path", () => {
  const args = MIRROR_CONFIGS.pip.getMirrorArgs("https://example.com");
  const hostIdx = args.indexOf("--trusted-host");
  assertEquals(args[hostIdx + 1], "example.com");
});

Deno.test("MIRROR_CONFIGS - pip handles URL with port", () => {
  const args = MIRROR_CONFIGS.pip.getMirrorArgs(
    "https://localhost:8080/simple",
  );
  const hostIdx = args.indexOf("--trusted-host");
  assertEquals(args[hostIdx + 1], "localhost");
});

// ============ All Tools Coverage ============

Deno.test("MIRROR_CONFIGS - all package managers have config", () => {
  const tools: PackageManagerTool[] = ["pip", "conda", "uv", "pixi"];
  for (const tool of tools) {
    const config = getMirrorConfig(tool);
    assertEquals(typeof config.service, "string");
    assertEquals(typeof config.getMirrorArgs, "function");
  }
});
