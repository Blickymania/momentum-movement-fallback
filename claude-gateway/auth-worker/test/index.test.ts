import { describe, expect, it, vi } from "vitest";
import { checkGuildAccessForToken, hasMatchingDiscordOAuthStateCookie } from "../src/index";

const userId = "222222222222222222";
const guildId = "1565048205970767992";
const token = "discord-user-access-token";

function discordFetcher(user: unknown, guilds: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const body = String(input).endsWith("/users/@me") ? user : guilds;
    return Response.json(body, { status });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe("Discord OAuth browser-bound state", () => {
  const state = "f3a4c6d8-1234-4abc-8def-1234567890ab";
  const cookieName = `__Host-discord-oauth-${state}`;

  it("accepts the state cookie issued to the same browser", () => {
    const request = new Request("https://auth.example/discord/callback?state=" + state, {
      headers: { cookie: `${cookieName}=${state}; other=value` }
    });
    expect(hasMatchingDiscordOAuthStateCookie(request, state)).toBe(true);
  });

  it("rejects a callback without the browser-bound state cookie", () => {
    const request = new Request("https://auth.example/discord/callback?state=" + state);
    expect(hasMatchingDiscordOAuthStateCookie(request, state)).toBe(false);
  });

  it("rejects a cookie belonging to a different OAuth state", () => {
    const request = new Request("https://auth.example/discord/callback?state=" + state, {
      headers: { cookie: `${cookieName}=different-state` }
    });
    expect(hasMatchingDiscordOAuthStateCookie(request, state)).toBe(false);
  });
});

describe("live Discord guild authorization", () => {
  it("confirms a current Administrator membership", async () => {
    const { fetcher, calls } = discordFetcher(
      { id: userId },
      [{ id: guildId, owner: false, permissions: "8" }]
    );
    await expect(checkGuildAccessForToken(userId, guildId, token, fetcher)).resolves.toEqual({
      isMember: true,
      isOwner: false,
      permissions: "8"
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) =>
      (call.init?.headers as Record<string, string>).authorization === `Bearer ${token}`
    )).toBe(true);
  });

  it("confirms an owner even without the Administrator bit", async () => {
    const { fetcher } = discordFetcher(
      { id: userId },
      [{ id: guildId, owner: true, permissions: "0" }]
    );
    await expect(checkGuildAccessForToken(userId, guildId, token, fetcher)).resolves.toEqual({
      isMember: true,
      isOwner: true,
      permissions: "0"
    });
  });

  it("rejects a different Discord identity", async () => {
    const { fetcher } = discordFetcher(
      { id: "333333333333333333" },
      [{ id: guildId, owner: true, permissions: "8" }]
    );
    await expect(checkGuildAccessForToken(userId, guildId, token, fetcher)).resolves.toEqual({
      isMember: false,
      isOwner: false,
      permissions: "0"
    });
  });

  it("rejects users who are not members of the target guild", async () => {
    const { fetcher } = discordFetcher({ id: userId }, []);
    await expect(checkGuildAccessForToken(userId, guildId, token, fetcher)).resolves.toMatchObject({
      isMember: false,
      isOwner: false
    });
  });

  it("fails closed when Discord returns an authorization error", async () => {
    const fetcher = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    await expect(checkGuildAccessForToken(userId, guildId, token, fetcher)).resolves.toEqual({
      isMember: false,
      isOwner: false,
      permissions: "0"
    });
  });

  it("rejects invalid identifiers without making a Discord request", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(checkGuildAccessForToken("bad-user", guildId, token, fetcher)).resolves.toMatchObject({
      isMember: false
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
