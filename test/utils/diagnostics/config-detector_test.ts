/**
 * Tests for diagnostics module - config detector
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  getMirrors,
  getMirrorsForUrl,
  getPipMirrorEnv,
  getUvMirrorEnv,
} from "../../../src/utils/diagnostics/config-detector.ts";

// ============ getMirrors Tests ============

Deno.test("getMirrors - returns PyPI mirrors", () => {
  const mirrors = getMirrors("pypi");
  assertEquals(mirrors.length >= 1, true);
  assertEquals(mirrors[0].includes("tuna.tsinghua"), true);
});

Deno.test("getMirrors - returns Huggingface mirrors", () => {
  const mirrors = getMirrors("huggingface");
  assertEquals(mirrors.length >= 1, true);
  assertEquals(mirrors[0].includes("hf-mirror"), true);
});

Deno.test("getMirrors - returns npm mirrors", () => {
  const mirrors = getMirrors("npm");
  assertEquals(mirrors.length >= 1, true);
  assertEquals(mirrors[0].includes("npmmirror"), true);
});

Deno.test("getMirrors - returns GitHub mirrors", () => {
  const mirrors = getMirrors("github");
  assertEquals(mirrors.length >= 1, true);
  assertEquals(mirrors[0].includes("ghproxy"), true);
});

// ============ getMirrorsForUrl Tests ============

Deno.test("getMirrorsForUrl - returns mirrors for pypi.org", () => {
  const mirrors = getMirrorsForUrl("https://pypi.org/simple/requests");
  assertEquals(mirrors.length >= 1, true);
});

Deno.test("getMirrorsForUrl - returns mirrors for files.pythonhosted.org", () => {
  const mirrors = getMirrorsForUrl("https://files.pythonhosted.org/packages/abc.whl");
  assertEquals(mirrors.length >= 1, true);
});

Deno.test("getMirrorsForUrl - returns mirrors for huggingface.co", () => {
  const mirrors = getMirrorsForUrl("https://huggingface.co/models");
  assertEquals(mirrors.length >= 1, true);
});

Deno.test("getMirrorsForUrl - returns empty for unknown domain", () => {
  const mirrors = getMirrorsForUrl("https://example.com/something");
  assertEquals(mirrors.length, 0);
});

Deno.test("getMirrorsForUrl - handles invalid URL gracefully", () => {
  const mirrors = getMirrorsForUrl("not-a-valid-url");
  assertEquals(mirrors.length, 0);
});

// ============ getPipMirrorEnv Tests ============

Deno.test("getPipMirrorEnv - returns correct env vars", () => {
  const env = getPipMirrorEnv("https://pypi.tuna.tsinghua.edu.cn/simple");

  assertEquals(env.PIP_INDEX_URL, "https://pypi.tuna.tsinghua.edu.cn/simple");
  assertEquals(env.PIP_TRUSTED_HOST, "pypi.tuna.tsinghua.edu.cn");
});

Deno.test("getPipMirrorEnv - extracts hostname correctly", () => {
  const env = getPipMirrorEnv("https://mirrors.aliyun.com/pypi/simple/");

  assertEquals(env.PIP_TRUSTED_HOST, "mirrors.aliyun.com");
});

// ============ getUvMirrorEnv Tests ============

Deno.test("getUvMirrorEnv - returns correct env vars", () => {
  const env = getUvMirrorEnv("https://pypi.tuna.tsinghua.edu.cn/simple");

  assertEquals(env.UV_INDEX_URL, "https://pypi.tuna.tsinghua.edu.cn/simple");
});
