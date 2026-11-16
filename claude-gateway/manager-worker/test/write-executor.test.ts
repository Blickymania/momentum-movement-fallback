import { describe, expect, it, vi } from "vitest";
import { handleManagerWrite } from "../src/write-executor";

const guildId = "1565048205970767992";
const channelId = "1565048207178862762";
const messageId = "1565048207178862764";
const proposalId = "a5c5d94c-6eac-4b6e-9b2f-3c7b4a95c8c1";
const config = { guildId, token: "test-token", writeSecret: "test-write-secret" };

async function hashAction(action: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(action)));
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
async function requestFor(action: unknown, secret = config.writeSecret, bodyOverrides: Record<string, unknown> = {}) {
  return new Request("https://manager.internal/internal/v1/write", {
    method: "POST",
    headers: { "content-type": "application/json", "x-manager-write-secret": secret ?? "" },
    body: JSON.stringify({ proposalId, guildId, actionHash: await hashAction(action), action, ...bodyOverrides })
  });
}

describe("typed Discord manager write executor", () => {
  it("fails closed when the write secret is missing or incorrect", async () => {
    const req = await requestFor({ type: "message.send", channelId, content: "Hello" });
    const noSecret = await handleManagerWrite(req, { ...config, writeSecret: undefined }, vi.fn() as never);
    const wrongSecret = await handleManagerWrite(await requestFor({ type: "message.send", channelId, content: "Hello" }, "wrong"), config, vi.fn() as never);
    expect(noSecret.status).toBe(503);
    expect(wrongSecret.status).toBe(403);
  });

  it("validates the approved action hash and rejects permission or role actions", async () => {
    const fetcher = vi.fn();
    const permissionAction = { type: "channel.permission.set", channelId, targetType: "role", targetId: guildId, allow: "0", deny: "0" };
    const unsupported = await handleManagerWrite(await requestFor(permissionAction), config, fetcher as never);
    const validAction = { type: "message.send", channelId, content: "Hello" };
    const tampered = await handleManagerWrite(await requestFor(validAction, config.writeSecret, { actionHash: `sha256:${"0".repeat(64)}` }), config, fetcher as never);
    expect(unsupported.status).toBe(400);
    expect(tampered.status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends a message with a deterministic Discord nonce and mentions disabled", async () => {
    const action = { type: "message.send", channelId, content: "Approved announcement" };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) return Response.json({ id: channelId, guild_id: guildId, type: 0 });
      return Response.json({ id: messageId });
    });
    const response = await handleManagerWrite(await requestFor(action), config, fetcher as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, proposalId, messageId });
    expect(calls.map((call) => call.init?.method)).toEqual(["GET", "POST"]);
    const sent = JSON.parse(String(calls[1].init?.body));
    expect(sent).toMatchObject({
      content: action.content,
      nonce: `p${proposalId.replace(/-/g, "").slice(0, 24)}`,
      enforce_nonce: true,
      allowed_mentions: { parse: [] }
    });
  });

  it("rejects message targets outside the text/announcement allowlist", async () => {
    const action = { type: "message.send", channelId, content: "No voice messages" };
    const fetcher = vi.fn(async () => Response.json({ id: channelId, guild_id: guildId, type: 2 }));
    const response = await handleManagerWrite(await requestFor(action), config, fetcher as never);
    expect(response.status).toBe(400);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("patches forum channels and limits fields to the typed allowlist", async () => {
    const action = { type: "channel.update", channelId, patch: { default_forum_layout: 1, default_sort_order: 0 } };
    const calls: Array<{ init?: RequestInit }> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init });
      return Response.json({ id: channelId, guild_id: guildId, type: 15 });
    });
    const response = await handleManagerWrite(await requestFor(action), config, fetcher as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, channelId, updatedFields: ["default_forum_layout", "default_sort_order"] });
    expect(calls.map((call) => call.init?.method)).toEqual(["GET", "PATCH"]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual(action.patch);
  });

  it("rejects forum fields on text channels and permission overwrite fields", async () => {
    const forumAction = { type: "channel.update", channelId, patch: { default_forum_layout: 1 } };
    const textFetcher = vi.fn(async () => Response.json({ id: channelId, guild_id: guildId, type: 0 }));
    const textResponse = await handleManagerWrite(await requestFor(forumAction), config, textFetcher as never);
    const permissionAction = { type: "channel.update", channelId, patch: { permission_overwrites: [] } };
    const unused = vi.fn();
    const permissionResponse = await handleManagerWrite(await requestFor(permissionAction), config, unused as never);
    expect(textResponse.status).toBe(400);
    expect(permissionResponse.status).toBe(400);
    expect(unused).not.toHaveBeenCalled();
  });

  it("rejects coercible string and boolean forum values before any Discord request", async () => {
    const fetcher = vi.fn();
    for (const patch of [
      { default_auto_archive_duration: "1440" },
      { default_forum_layout: "1" },
      { default_forum_layout: true },
      { default_sort_order: "0" },
      { default_sort_order: false }
    ]) {
      const response = await handleManagerWrite(
        await requestFor({ type: "channel.update", channelId, patch }),
        config,
        fetcher as never
      );
      expect(response.status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps Discord rate limits to retryable 503 and missing channels to 404", async () => {
    const action = { type: "message.send", channelId, content: "Retryable" };
    let count = 0;
    const rateLimited = vi.fn(async () => {
      count += 1;
      return count === 1 ? Response.json({ id: channelId, guild_id: guildId, type: 0 }) : new Response("limited", { status: 429 });
    });
    const limited = await handleManagerWrite(await requestFor(action), config, rateLimited as never);
    expect(limited.status).toBe(503);
    const missing = await handleManagerWrite(await requestFor(action), config, vi.fn(async () => new Response("missing", { status: 404 })) as never);
    expect(missing.status).toBe(404);
  });
});
