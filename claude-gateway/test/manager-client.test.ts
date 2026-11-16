import { describe, expect, it, vi } from "vitest";
import {
  listConfiguredManagers,
  readManagerResource,
  type GatewayEnv,
  type ManagerBinding
} from "../src/manager-client";

const guildId = "1565048205970767992";

function bindingReturning(payload: unknown, status = 200): ManagerBinding {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.method).toBe("GET");
      expect(new URL(request.url).origin).toBe("https://manager.internal");
      return Response.json(payload, { status });
    })
  };
}

describe("isolated private manager client", () => {
  it("reports five independent managers without exposing guild IDs", () => {
    const env: GatewayEnv = {
      MANAGER_DAWN_DOTTA: bindingReturning({ ok: true }),
      GUILD_ID_DAWN_DOTTA: guildId
    };
    const result = listConfiguredManagers(env);
    expect(result).toHaveLength(5);
    expect(result.filter((item) => item.configured).map((item) => item.key)).toEqual(["dawn-dotta"]);
    expect(JSON.stringify(result)).not.toContain(guildId);
  });

  it("calls only the selected server's binding and fixed resource path", async () => {
    const empress = bindingReturning({ server: "empress" });
    const dawn = bindingReturning({ server: "dawn" });
    const env: GatewayEnv = {
      MANAGER_EMPRESS: empress,
      GUILD_ID_EMPRESS: guildId,
      MANAGER_DAWN_DOTTA: dawn,
      GUILD_ID_DAWN_DOTTA: "1565048205970767993"
    };

    await expect(readManagerResource(env, "empress", "channels")).resolves.toEqual({ server: "empress" });
    expect(empress.fetch).toHaveBeenCalledTimes(1);
    expect(dawn.fetch).not.toHaveBeenCalled();
    const request = (empress.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as Request;
    expect(new URL(request.url).pathname).toBe("/internal/v1/channels");
    expect(request.headers.get("x-gateway-guild-id")).toBe(guildId);
  });

  it("fails closed when two independent managers share a configured guild ID", async () => {
    const sharedGuildId = "1565048205970767992";
    const env: GatewayEnv = {
      MANAGER_EMPRESS: bindingReturning({ ok: true }),
      GUILD_ID_EMPRESS: sharedGuildId,
      MANAGER_DAWN_DOTTA: bindingReturning({ ok: true }),
      GUILD_ID_DAWN_DOTTA: sharedGuildId
    };
    await expect(readManagerResource(env, "dawn-dotta", "status")).rejects.toThrow(/unique guild ID/);
    expect(listConfiguredManagers(env).filter((item) => item.configured)).toHaveLength(0);
  });

  it("fails closed when a manager binding is missing", async () => {
    await expect(readManagerResource({}, "dawn-dotta", "status")).rejects.toThrow(/binding.*not configured/i);
  });

  it("fails closed when a fixed guild ID is invalid", async () => {
    const env: GatewayEnv = {
      MANAGER_DAWN_DOTTA: bindingReturning({ ok: true }),
      GUILD_ID_DAWN_DOTTA: "not-a-snowflake"
    };
    await expect(readManagerResource(env, "dawn-dotta", "status")).rejects.toThrow(/valid fixed guild ID/i);
  });

  it("rejects unknown servers and unsupported resources", async () => {
    await expect(readManagerResource({}, "unknown", "status")).rejects.toThrow(/Unknown Discord manager/);
    await expect(readManagerResource({
      MANAGER_DAWN_DOTTA: bindingReturning({}),
      GUILD_ID_DAWN_DOTTA: guildId
    }, "dawn-dotta", "../roles")).rejects.toThrow(/Unsupported manager read resource/);
  });

  it("redacts secret-like response fields before returning manager data", async () => {
    const env: GatewayEnv = {
      MANAGER_DAWN_DOTTA: bindingReturning({
        guild: { name: "Momentum Movement" },
        access_token: "do-not-return",
        nested: { client_secret: "also-do-not-return" }
      }),
      GUILD_ID_DAWN_DOTTA: guildId
    };
    const result = await readManagerResource(env, "dawn-dotta", "status");
    expect(result).toEqual({
      guild: { name: "Momentum Movement" },
      access_token: "[redacted]",
      nested: { client_secret: "[redacted]" }
    });
  });

  it("rejects non-success responses and invalid JSON", async () => {
    const failed: ManagerBinding = {
      fetch: async () => new Response("unavailable", { status: 503 })
    };
    await expect(readManagerResource({
      MANAGER_DAWN_DOTTA: failed,
      GUILD_ID_DAWN_DOTTA: guildId
    }, "dawn-dotta", "status")).rejects.toThrow(/HTTP 503/);

    const invalid: ManagerBinding = {
      fetch: async () => new Response("not-json", { status: 200 })
    };
    await expect(readManagerResource({
      MANAGER_DAWN_DOTTA: invalid,
      GUILD_ID_DAWN_DOTTA: guildId
    }, "dawn-dotta", "status")).rejects.toThrow(/invalid JSON/);
  });
});
