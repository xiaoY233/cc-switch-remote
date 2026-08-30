import { describe, expect, it } from "vitest";
import { providerPresets as claudeProviderPresets } from "@/config/claudeProviderPresets";
import { claudeDesktopProviderPresets } from "@/config/claudeDesktopProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { grokBuildProviderPresets } from "@/config/grokBuildProviderPresets";
import { hermesProviderPresets } from "@/config/hermesProviderPresets";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import { piProviderPresets } from "@/config/piProviderPresets";

type Preset = {
  name: string;
  websiteUrl: string;
  endpointCandidates?: string[];
  config: string;
};

const teamoRouter = <T extends { name: string }>(presets: T[]) => {
  const preset = presets.find(({ name }) => name === "TeamoRouter");
  expect(preset, "TeamoRouter preset").toBeDefined();
  return preset!;
};

describe("TeamoRouter preset endpoints", () => {
  it("uses .cn only for new presets without a provider migration", () => {
    const presets: Preset[] = [
      {
        ...teamoRouter(claudeProviderPresets),
        config: JSON.stringify(
          teamoRouter(claudeProviderPresets).settingsConfig,
        ),
      },
      {
        ...teamoRouter(claudeDesktopProviderPresets),
        config: JSON.stringify(
          teamoRouter(claudeDesktopProviderPresets).baseUrl,
        ),
      },
      {
        ...teamoRouter(codexProviderPresets),
        config: teamoRouter(codexProviderPresets).config,
      },
      {
        ...teamoRouter(grokBuildProviderPresets),
        config: teamoRouter(grokBuildProviderPresets).config,
      },
      {
        ...teamoRouter(hermesProviderPresets),
        config: JSON.stringify(
          teamoRouter(hermesProviderPresets).settingsConfig,
        ),
      },
      {
        ...teamoRouter(opencodeProviderPresets),
        config: JSON.stringify(
          teamoRouter(opencodeProviderPresets).settingsConfig,
        ),
      },
      {
        ...teamoRouter(openclawProviderPresets),
        config: JSON.stringify(
          teamoRouter(openclawProviderPresets).settingsConfig,
        ),
      },
      {
        ...teamoRouter(piProviderPresets),
        config: JSON.stringify(teamoRouter(piProviderPresets).settingsConfig),
      },
    ];

    for (const preset of presets) {
      expect(preset.websiteUrl).toBe("https://teamorouter.cn");
      expect(preset.config).toContain("https://api.teamorouter.cn");
      expect(preset.config).not.toContain("https://api.teamorouter.com");
    }

    for (const preset of presets.filter(
      (preset) => preset.endpointCandidates !== undefined,
    )) {
      expect(preset.endpointCandidates).toContain(
        "https://api.teamorouter.cn" +
          (preset.config.includes("/v1") ? "/v1" : ""),
      );
      expect(preset.endpointCandidates).toContain(
        "https://api.teamorouter.com" +
          (preset.config.includes("/v1") ? "/v1" : ""),
      );
    }
  });
});
