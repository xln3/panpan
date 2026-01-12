/**
 * Tests for src/config/config.ts
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  type Config,
  loadConfig,
  validateConfig,
} from "../../src/config/config.ts";

// =============================================================================
// Helper to mock environment variables
// =============================================================================

function withEnv(
  vars: Record<string, string>,
  fn: () => void,
): void {
  const originalValues: Record<string, string | undefined> = {};

  // Save original values and set new ones
  for (const [key, value] of Object.entries(vars)) {
    originalValues[key] = Deno.env.get(key);
    Deno.env.set(key, value);
  }

  try {
    fn();
  } finally {
    // Restore original values
    for (const [key, originalValue] of Object.entries(originalValues)) {
      if (originalValue === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, originalValue);
      }
    }
  }
}

// Note: loadConfig calls Deno.exit(1) when API key is missing
// We can't easily test that without process isolation
// So we focus on cases where API key is provided

// =============================================================================
// loadConfig API key priority tests
// =============================================================================

Deno.test("loadConfig - CLI apiKey takes priority", () => {
  withEnv({ PANPAN_API_KEY: "env-key", OPENAI_API_KEY: "openai-key" }, () => {
    const config = loadConfig({ apiKey: "cli-key" });
    assertEquals(config.apiKey, "cli-key");
  });
});

Deno.test("loadConfig - falls back to PANPAN_API_KEY", () => {
  withEnv(
    { PANPAN_API_KEY: "panpan-key", OPENAI_API_KEY: "openai-key" },
    () => {
      const config = loadConfig({});
      assertEquals(config.apiKey, "panpan-key");
    },
  );
});

Deno.test("loadConfig - falls back to OPENAI_API_KEY", () => {
  // Clear PANPAN_API_KEY if set
  const originalPanpan = Deno.env.get("PANPAN_API_KEY");
  Deno.env.delete("PANPAN_API_KEY");

  try {
    withEnv({ OPENAI_API_KEY: "openai-key" }, () => {
      const config = loadConfig({});
      assertEquals(config.apiKey, "openai-key");
    });
  } finally {
    if (originalPanpan) {
      Deno.env.set("PANPAN_API_KEY", originalPanpan);
    }
  }
});

// =============================================================================
// loadConfig baseUrl tests
// =============================================================================

Deno.test("loadConfig - CLI baseUrl takes priority", () => {
  withEnv(
    { PANPAN_API_KEY: "key", PANPAN_BASE_URL: "https://env.com/v1" },
    () => {
      const config = loadConfig({ baseUrl: "https://cli.com/v1" });
      assertEquals(config.baseUrl, "https://cli.com/v1");
    },
  );
});

Deno.test("loadConfig - falls back to PANPAN_BASE_URL", () => {
  withEnv(
    { PANPAN_API_KEY: "key", PANPAN_BASE_URL: "https://panpan.com/v1" },
    () => {
      const config = loadConfig({});
      assertEquals(config.baseUrl, "https://panpan.com/v1");
    },
  );
});

Deno.test("loadConfig - falls back to OPENAI_BASE_URL", () => {
  // Clear PANPAN_BASE_URL
  const originalPanpan = Deno.env.get("PANPAN_BASE_URL");
  Deno.env.delete("PANPAN_BASE_URL");

  try {
    withEnv(
      { PANPAN_API_KEY: "key", OPENAI_BASE_URL: "https://openai.com/v1" },
      () => {
        const config = loadConfig({});
        assertEquals(config.baseUrl, "https://openai.com/v1");
      },
    );
  } finally {
    if (originalPanpan) {
      Deno.env.set("PANPAN_BASE_URL", originalPanpan);
    }
  }
});

Deno.test("loadConfig - uses default baseUrl", () => {
  // Clear both URL env vars
  const originalPanpan = Deno.env.get("PANPAN_BASE_URL");
  const originalOpenai = Deno.env.get("OPENAI_BASE_URL");
  Deno.env.delete("PANPAN_BASE_URL");
  Deno.env.delete("OPENAI_BASE_URL");

  try {
    withEnv({ PANPAN_API_KEY: "key" }, () => {
      const config = loadConfig({});
      assertEquals(config.baseUrl, "https://aihubmix.com/v1/");
    });
  } finally {
    if (originalPanpan) Deno.env.set("PANPAN_BASE_URL", originalPanpan);
    if (originalOpenai) Deno.env.set("OPENAI_BASE_URL", originalOpenai);
  }
});

// =============================================================================
// loadConfig model tests
// =============================================================================

Deno.test("loadConfig - CLI model takes priority", () => {
  withEnv({ PANPAN_API_KEY: "key", PANPAN_MODEL: "env-model" }, () => {
    const config = loadConfig({ model: "cli-model" });
    assertEquals(config.model, "cli-model");
  });
});

Deno.test("loadConfig - falls back to PANPAN_MODEL", () => {
  withEnv({ PANPAN_API_KEY: "key", PANPAN_MODEL: "panpan-model" }, () => {
    const config = loadConfig({});
    assertEquals(config.model, "panpan-model");
  });
});

Deno.test("loadConfig - uses default model", () => {
  const originalModel = Deno.env.get("PANPAN_MODEL");
  Deno.env.delete("PANPAN_MODEL");

  try {
    withEnv({ PANPAN_API_KEY: "key" }, () => {
      const config = loadConfig({});
      assertEquals(config.model, "claude-haiku-4-5-20251001");
    });
  } finally {
    if (originalModel) Deno.env.set("PANPAN_MODEL", originalModel);
  }
});

// =============================================================================
// loadConfig verbose tests
// =============================================================================

Deno.test("loadConfig - sets verbose from CLI", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({ verbose: true });
    assertEquals(config.verbose, true);
  });
});

Deno.test("loadConfig - defaults verbose to false", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({});
    assertEquals(config.verbose, false);
  });
});

// =============================================================================
// loadConfig thinking tests
// =============================================================================

Deno.test("loadConfig - configures thinking from CLI", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({ thinking: true });
    assertEquals(config.thinking?.enabled, true);
    assertEquals(config.thinking?.budgetTokens, 10000); // default
  });
});

Deno.test("loadConfig - sets thinking budget", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({ thinking: true, thinkingBudget: 20000 });
    assertEquals(config.thinking?.budgetTokens, 20000);
  });
});

Deno.test("loadConfig - thinking is undefined when not enabled", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({});
    assertEquals(config.thinking, undefined);
  });
});

// =============================================================================
// loadConfig provider tests
// =============================================================================

Deno.test("loadConfig - parses provider option as openai", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({ provider: "openai" });
    assertEquals(config.providerType, "openai");
  });
});

Deno.test("loadConfig - parses provider option as anthropic", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({ provider: "anthropic" });
    assertEquals(config.providerType, "anthropic");
  });
});

Deno.test("loadConfig - ignores invalid provider", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({ provider: "invalid" });
    assertEquals(config.providerType, undefined);
  });
});

Deno.test("loadConfig - falls back to PANPAN_PROVIDER env", () => {
  withEnv({ PANPAN_API_KEY: "key", PANPAN_PROVIDER: "anthropic" }, () => {
    const config = loadConfig({});
    assertEquals(config.providerType, "anthropic");
  });
});

// =============================================================================
// loadConfig fixed values tests
// =============================================================================

Deno.test("loadConfig - sets fixed maxTokens", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({});
    assertEquals(config.maxTokens, 8192);
  });
});

Deno.test("loadConfig - sets fixed temperature", () => {
  withEnv({ PANPAN_API_KEY: "key" }, () => {
    const config = loadConfig({});
    assertEquals(config.temperature, 0.7);
  });
});

// =============================================================================
// validateConfig tests
// =============================================================================

Deno.test("validateConfig - throws on missing apiKey", () => {
  const config: Config = {
    apiKey: "",
    baseUrl: "https://api.example.com",
    model: "gpt-4",
    verbose: false,
  };

  assertThrows(
    () => validateConfig(config),
    Error,
    "API key is required",
  );
});

Deno.test("validateConfig - throws on missing baseUrl", () => {
  const config: Config = {
    apiKey: "test-key",
    baseUrl: "",
    model: "gpt-4",
    verbose: false,
  };

  assertThrows(
    () => validateConfig(config),
    Error,
    "Base URL is required",
  );
});

Deno.test("validateConfig - throws on missing model", () => {
  const config: Config = {
    apiKey: "test-key",
    baseUrl: "https://api.example.com",
    model: "",
    verbose: false,
  };

  assertThrows(
    () => validateConfig(config),
    Error,
    "Model is required",
  );
});

Deno.test("validateConfig - passes for valid config", () => {
  const config: Config = {
    apiKey: "test-key",
    baseUrl: "https://api.example.com",
    model: "gpt-4",
    verbose: false,
  };

  // Should not throw
  validateConfig(config);
});
