import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  loadProvidersQueryData,
  useProvidersQuery,
} from "@/lib/query/queries";
import { providersApi, type ManagementTarget } from "@/lib/api";

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile: {
    id: "server-1",
    name: "Server 1",
    host: "192.168.1.10",
    port: 22,
    username: "root",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
  secret: { password: "secret" },
};

describe("provider query loading", () => {
  it("loads remote providers and current provider through one aggregated reader", async () => {
    const calls: string[] = [];

    const result = await loadProvidersQueryData("claude", remoteTarget, {
      getAll: async () => {
        calls.push("getAll");
        throw new Error("remote getAll should not be called");
      },
      getCurrent: async () => {
        calls.push("getCurrent");
        throw new Error("remote getCurrent should not be called");
      },
      getState: async () => {
        calls.push("getState");
        return {
          providers: {
            beta: {
              id: "beta",
              name: "Beta",
              settingsConfig: { env: {} },
              createdAt: 2,
            },
          },
          currentProviderId: "beta",
        };
      },
    });

    expect(calls).toEqual(["getState"]);
    expect(result.currentProviderId).toBe("beta");
    expect(Object.keys(result.providers)).toEqual(["beta"]);
  });

  it("surfaces remote provider load errors instead of returning an empty list", async () => {
    const error = new Error("unsupported remote command");

    await expect(
      loadProvidersQueryData("claude", remoteTarget, {
        getAll: async () => {
          throw error;
        },
        getCurrent: async () => "anthropic",
      }),
    ).rejects.toThrow("unsupported remote command");
  });

  it("does not expose the previous remote target as actionable placeholder data", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    let resolveSecond!: (value: {
      providers: Record<string, never>;
      currentProviderId: string;
    }) => void;
    vi.spyOn(providersApi, "getState").mockImplementation(
      async (_appId, target) => {
        if (target?.type === "remote" && target.profile.id === "server-1") {
          return {
            providers: {
              old: {
                id: "old",
                name: "Old server",
                settingsConfig: { env: {} },
              },
            },
            currentProviderId: "old",
          };
        }
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      },
    );
    const secondTarget: ManagementTarget = {
      ...remoteTarget,
      profile: { ...remoteTarget.profile, id: "server-2", host: "server-2" },
    };
    const { result, rerender } = renderHook(
      ({ target }) => useProvidersQuery("claude", { target }),
      { initialProps: { target: remoteTarget }, wrapper },
    );
    await waitFor(() => expect(result.current.data?.currentProviderId).toBe("old"));

    rerender({ target: secondTarget });

    expect(result.current.data).toBeUndefined();
    resolveSecond({ providers: {}, currentProviderId: "new" });
    await waitFor(() => expect(result.current.data?.currentProviderId).toBe("new"));
  });
});
