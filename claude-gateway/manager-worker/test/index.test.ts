import { describe, expect, it, vi } from "vitest";
import {
  handleManagerRequest,
  type ManagerWorkerEnv
} from "../src/index";

const guildId = "1565048205970767992";
const applicationId = "1565048205970767993";
const env: ManagerWorkerEnv = {
  DISCORD_BOT_TOKEN: "test-only-token",
  DISCORD_GUILD_ID: guildId,
  DISCORD_APPLICATION_ID: applicationId
};

function request(path: string, method = "GET", headers: Record<string, string> = {}) {
  return new Request(`https://manager.internal${path}`, {
    method,
    headers: { "x-gateway-guild-id": guildId, ...headers }
  });
}

function discordFetcher(payloads: unknown[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const payload = payloads.shift();
    return Response.json(payload ?? {});
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe("private read-only Discord manager Worker", () => {
  it("rejects all non-GET requests", async () => {
    const { fetcher } = discordFetcher([]);
    const response = await handleManagerRequest(request("/internal/v1/roles", "POST"), env, fetcher);
    expect(response.status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed when configuration is missing", async () => {
    const { fetcher } = discordFetcher([]);
    const response = await handleManagerRequest(request("/internal/v1/status"), {}, fetcher);
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a request addressed to a different guild", async () => {
    const { fetcher } = discordFetcher([]);
    const response = await handleManagerRequest(
      new Request("https://manager.internal/internal/v1/roles", {
        headers: { "x-gateway-guild-id": "1440913253118115882" }
      }),
      env,
      fetcher
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects arbitrary paths and query parameters", async () => {
    const { fetcher } = discordFetcher([]);
    const path = await handleManagerRequest(request("/guilds/123/roles"), env, fetcher);
    const query = await handleManagerRequest(request("/internal/v1/roles?guild_id=123"), env, fetcher);
    expect(path.status).toBe(404);
    expect(query.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the configured guild for role reads and returns array data", async () => {
    const { fetcher, calls } = discordFetcher([[{ id: "role-1", name: "Member" }]]);
    const response = await handleManagerRequest(request("/internal/v1/roles"), env, fetcher);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "role-1", name: "Member" }]);
    expect(calls[0].url).toBe(`https://discord.com/api/v10/guilds/${guildId}/roles`);
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Bot test-only-token");
  });

  it("verifies the bot application identity for status reads", async () => {
    const { fetcher } = discordFetcher([
      { id: applicationId },
      { id: applicationId, username: "TestBot" },
      { id: guildId, name: "Momentum Movement" }
    ]);
    const response = await handleManagerRequest(request("/internal/v1/status"), env, fetcher);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connected: true,
      applicationId,
      bot: { id: applicationId, username: "TestBot" },
      guild: { id: guildId, name: "Momentum Movement" }
    });
  });

  it("rejects a mismatched bot application identity", async () => {
    const { fetcher } = discordFetcher([
      { id: "999999999999999999" },
      { id: "bot-user" },
      { id: guildId, name: "Momentum Movement" }
    ]);
    const response = await handleManagerRequest(request("/internal/v1/status"), env, fetcher);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/identity/) });
  });

  it("rejects a current bot user that does not match the configured application", async () => {
    const { fetcher } = discordFetcher([
      { id: applicationId },
      { id: "999999999999999999", username: "WrongBot" },
      { id: guildId, name: "Momentum Movement" }
    ]);
    const response = await handleManagerRequest(request("/internal/v1/status"), env, fetcher);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Bot user identity does not match this manager." });
  });

  it("rejects a guild response that does not match the configured guild", async () => {
    const { fetcher } = discordFetcher([
      { id: applicationId },
      { id: applicationId, username: "TestBot" },
      { id: "999999999999999999", name: "Wrong Guild" }
    ]);
    const response = await handleManagerRequest(request("/internal/v1/status"), env, fetcher);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Guild identity does not match this manager." });
  });

  it("uses manual redirect handling and fails closed on Discord redirects", async () => {
    let observedRedirect: RequestRedirect | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedRedirect = init?.redirect;
      return new Response(null, { status: 302, headers: { location: "https://attacker.invalid/" } });
    }) as unknown as typeof fetch;
    const response = await handleManagerRequest(request("/internal/v1/roles"), env, fetcher);
    expect(response.status).toBe(502);
    expect(observedRedirect).toBe("manual");
  });

  it("does not expose the bot token in errors", async () => {
    const fetcher = vi.fn(async () => new Response("secret body", { status: 401 })) as unknown as typeof fetch;
    const response = await handleManagerRequest(request("/internal/v1/roles"), env, fetcher);
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).not.toContain("test-only-token");
    expect(body).not.toContain("secret body");
  });
});
