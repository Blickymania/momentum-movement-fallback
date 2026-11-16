/// <reference types="@cloudflare/vitest-plugin/types" />
import { createExecutionContext } from "cloudflare:test";
import { env as cloudflareEnv } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import AuthServer, { type AuthWorkerEnv } from "../src/index";
import { network } from "./network";

const GUILD_ID = "1565048205970767992";
const REQUESTER_ID = "222222222222222222";
const OWNER_ID = "333333333333333333";
const PROPOSAL_ID = "a5c5d94c-6eac-4b6e-9b2f-3c7b4a95c8c1";
const ACTION_HASH = `sha256:${"a".repeat(64)}`;
const INTERNAL_SECRET = "test-owner-approval-secret";

function createAuth(userId = OWNER_ID) {
  const gatewayCalls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const gatewayBinding = {
    fetch: vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/internal/owner-approval/proposal") {
        return Response.json({
          proposalId: PROPOSAL_ID,
          guildId: GUILD_ID,
          requesterUserId: REQUESTER_ID,
          serverKey: "dawn-dotta",
          actionHash: ACTION_HASH,
          action: { type: "message.send", channelId: "1565048207178862762", content: "Send approved update" },
          status: "pending",
          expiresAt: Date.now() + 300_000
        });
      }
      if (request.method === "POST" && url.pathname === "/internal/owner-approval/decision") {
        gatewayCalls.push({ method: request.method, path: url.pathname, body: await request.json() as Record<string, unknown> });
        return Response.json({ proposalId: PROPOSAL_ID, status: "approved", approverUserId: userId });
      }
      return new Response("Not found", { status: 404 });
    })
  };
  const env = {
    ...cloudflareEnv,
    GATEWAY_SERVER: gatewayBinding,
    OWNER_APPROVAL_INTERNAL_SECRET: INTERNAL_SECRET
  } as unknown as AuthWorkerEnv;
  return { auth: new AuthServer(createExecutionContext(), env), gatewayCalls, gatewayBinding };
}

function configureDiscord(userId: string, owner: boolean, permissions = "0") {
  network.use(
    http.post("https://discord.com/api/v10/oauth2/token", () => HttpResponse.json({
      access_token: "owner-approval-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "owner-approval-refresh-token",
      scope: "identify guilds"
    })),
    http.get("https://discord.com/api/v10/users/@me", () => HttpResponse.json({
      id: userId,
      username: "approval-owner",
      global_name: "Approval Owner"
    })),
    http.get("https://discord.com/api/v10/users/@me/guilds", () => HttpResponse.json([
      { id: GUILD_ID, name: "Dawn Dotta", owner, permissions }
    ]))
  );
}

async function startApproval(auth: AuthServer) {
  const session = await auth.createOwnerApprovalSession({
    proposalId: PROPOSAL_ID,
    guildId: GUILD_ID,
    requesterUserId: REQUESTER_ID,
    serverKey: "dawn-dotta",
    actionHash: ACTION_HASH
  });
  const start = await auth.fetch(new Request(session.approvalUrl));
  return { session, start };
}

function callbackRequest(start: Response) {
  const discordUrl = new URL(start.headers.get("location") ?? "");
  const state = discordUrl.searchParams.get("state")!;
  const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0];
  const callbackUrl = new URL("https://auth.test/discord/callback");
  callbackUrl.searchParams.set("code", "mock-owner-approval-code");
  callbackUrl.searchParams.set("state", state);
  return { state, cookie, request: new Request(callbackUrl, { headers: { cookie } }) };
}

describe("separate Discord guild-owner approval flow", () => {
  it("shows the exact proposal, rechecks ownership, approves once, and rejects replay", async () => {
    configureDiscord(OWNER_ID, true);
    const { auth, gatewayCalls, gatewayBinding } = createAuth();
    const { session, start } = await startApproval(auth);
    expect(session.approvalUrl).toContain("/owner-approval?handle=");
    expect(start.status).toBe(302);
    const replayStart = await auth.fetch(new Request(session.approvalUrl));
    expect(replayStart.status).toBe(400);
    const callback = callbackRequest(start);
    expect(callback.state.startsWith("owner-")).toBe(true);

    const page = await auth.fetch(callback.request);
    expect(page.status).toBe(200);
    const replayCallback = await auth.fetch(callback.request);
    expect(replayCallback.status).toBe(400);
    const html = await page.text();
    expect(html).toContain("Send approved update");
    expect(html).toContain(REQUESTER_ID);
    expect(html).toContain("Approve change");
    expect(html).toContain("Reject change");
    const handle = html.match(/name="handle" value="([0-9a-f-]{36})"/)?.[1];
    expect(handle).toBeTruthy();

    const decision = await auth.fetch(new Request("https://auth.test/owner-approval/decision", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle: handle!, decision: "approve" })
    }));
    expect(decision.status).toBe(200);
    expect(await decision.text()).toContain("Proposal approved");
    expect(gatewayBinding.fetch).toHaveBeenCalledTimes(2);
    expect(gatewayCalls).toHaveLength(1);
    expect(gatewayCalls[0].body).toMatchObject({
      proposalId: PROPOSAL_ID,
      guildId: GUILD_ID,
      requesterUserId: REQUESTER_ID,
      approverUserId: OWNER_ID,
      actionHash: ACTION_HASH,
      decision: "approve"
    });

    const replay = await auth.fetch(new Request("https://auth.test/owner-approval/decision", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle: handle!, decision: "approve" })
    }));
    expect(replay.status).toBe(400);
    expect(gatewayCalls).toHaveLength(1);
  });

  it("does not treat an Administrator as the guild owner", async () => {
    configureDiscord(OWNER_ID, false, "8");
    const { auth, gatewayBinding } = createAuth();
    const { start } = await startApproval(auth);
    const response = await auth.fetch(callbackRequest(start).request);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Only the current owner");
    expect(gatewayBinding.fetch).not.toHaveBeenCalled();
  });

  it("allows the requester to approve in a separate step when they are the current guild owner", async () => {
    configureDiscord(REQUESTER_ID, true);
    const { auth, gatewayCalls, gatewayBinding } = createAuth(REQUESTER_ID);
    const { start } = await startApproval(auth);
    const page = await auth.fetch(callbackRequest(start).request);
    expect(page.status).toBe(200);
    const html = await page.text();
    const handle = html.match(/name="handle" value="([0-9a-f-]{36})"/)?.[1];
    expect(handle).toBeTruthy();
    const decision = await auth.fetch(new Request("https://auth.test/owner-approval/decision", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle: handle!, decision: "approve" })
    }));
    expect(decision.status).toBe(200);
    expect(gatewayBinding.fetch).toHaveBeenCalledTimes(2);
    expect(gatewayCalls[0].body?.approverUserId).toBe(REQUESTER_ID);
  });
});
