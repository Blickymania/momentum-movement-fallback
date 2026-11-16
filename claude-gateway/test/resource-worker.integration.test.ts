import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import Gateway from "../src/index";
import type { WriteProposalRecord } from "../src/write-proposals";

const resourceUrl = "https://mcp.test/mcp";
const issuerUrl = "https://auth.test";
const guildId = "1565048205970767992";
const requesterUserId = "222222222222222222";
const ownerUserId = "333333333333333333";
const proposalId = "a5c5d94c-6eac-4b6e-9b2f-3c7b4a95c8c1";
const channelId = "1565048207178862762";
const messageId = "1565048207178862764";
const actionHash = `sha256:${"a".repeat(64)}`;
const action = { type: "message.send" as const, channelId, content: "OAuth-protected MCP test" };

function approvedProposal(): WriteProposalRecord {
  return {
    id: proposalId,
    serverKey: "dawn-dotta",
    guildId,
    requesterUserId,
    action,
    actionHash,
    idempotencyKey: "resource-worker-mcp-test",
    status: "approved",
    approverUserId: ownerUserId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    approvedAt: Date.now(),
    consumedAt: null
  };
}

function createHarness(options: { token?: string; audience?: string; scope?: string[]; discordTokenExpiresAt?: number | null } = {}) {
  const token = options.token ?? "valid-test-token";
  const record = approvedProposal();
  const consumed = { ...record, status: "consumed" as const, consumedAt: Date.now() };
  const store = {
    getProposal: vi.fn(async () => record),
    consumeApprovedProposal: vi.fn(async () => consumed),
    claimExecution: vi.fn(async () => ({
      proposal: consumed,
      attempt: 1,
      leaseToken: "resource-worker-test-lease",
      leaseUntil: Date.now() + 30_000
    })),
    recordExecutionResult: vi.fn(async () => undefined)
  };
  const managerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/channels")) {
      return Response.json({ channels: [{ id: channelId, name: "general", type: 0 }] });
    }
    if (path.endsWith("/write")) {
      const body = await request.json() as { proposalId: string; actionHash: string };
      return Response.json({ ok: true, proposalId: body.proposalId, actionHash: body.actionHash, messageId });
    }
    return Response.json({ status: "ok" });
  });
  const validateToken = vi.fn(async (resource: string, suppliedToken: string) => {
    if (suppliedToken !== token) return null;
    return {
      props: {
        userId: requesterUserId,
        discordAccessToken: "discord-test-access-token",
        discordTokenExpiresAt: Object.prototype.hasOwnProperty.call(options, "discordTokenExpiresAt")
          ? options.discordTokenExpiresAt
          : Date.now() + 3_600_000,
        authorizedGuildIds: [guildId]
      },
      audience: options.audience ?? resource,
      expiresAt: Math.floor(Date.now() / 1000) + 3_600,
      scope: options.scope ?? ["mcp:read"],
      userId: requesterUserId,
      clientId: "mcp-test-client"
    };
  });
  const checkGuildAccess = vi.fn(async () => ({
    isMember: true,
    isOwner: false,
    permissions: "8"
  }));
  const env = {
    MCP_RESOURCE_URL: resourceUrl,
    OAUTH_ISSUER_URL: issuerUrl,
    AUTH_SERVER: {
      validateToken,
      checkGuildAccess,
      createOwnerApprovalSession: vi.fn()
    },
    GUILD_ID_DAWN_DOTTA: guildId,
    MANAGER_DAWN_DOTTA: { fetch: managerFetch },
    MANAGER_WRITE_SECRET_DAWN_DOTTA: "resource-test-write-secret",
    WRITE_PROPOSAL_STORE: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => store)
    }
  };
  const executionContext = createExecutionContext();
  return { env, executionContext, validateToken, checkGuildAccess, managerFetch, store };
}

function bearerRequest(token: string, body: unknown) {
  return new Request(resourceUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify(body)
  });
}

async function connectClient(harness: ReturnType<typeof createHarness>, token = "valid-test-token") {
  const transport = new StreamableHTTPClientTransport(new URL(resourceUrl), {
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      return Gateway.fetch(new Request(url, { ...init, headers }), harness.env as never, harness.executionContext);
    }
  });
  const client = new Client(
    { name: "oauth-resource-worker-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  await client.connect(transport);
  return client;
}

describe("OAuth-protected MCP resource Worker", () => {
  it("rejects unauthenticated requests with a protected-resource challenge", async () => {
    const harness = createHarness();
    const response = await Gateway.fetch(
      new Request(resourceUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      }),
      harness.env as never,
      harness.executionContext
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(harness.validateToken).not.toHaveBeenCalled();
  });

  it("validates the resource-bound token before listing tools and reading a manager", async () => {
    const harness = createHarness();
    const client = await connectClient(harness);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("discord_execute_approved_change");
      const result = await client.callTool({
        name: "discord_list_channels",
        arguments: { serverKey: "dawn-dotta" }
      });
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content[0] as { text: string }).text);
      expect(payload.channels[0]).toMatchObject({ id: channelId, name: "general" });
      expect(harness.validateToken).toHaveBeenCalledWith(resourceUrl, "valid-test-token");
      expect(harness.checkGuildAccess).toHaveBeenCalledWith(
        requesterUserId,
        guildId,
        "discord-test-access-token"
      );
      expect(harness.managerFetch).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  });

  it("executes an approved proposal only after OAuth identity and current admin checks", async () => {
    const harness = createHarness();
    const client = await connectClient(harness);
    try {
      const result = await client.callTool({
        name: "discord_execute_approved_change",
        arguments: { serverKey: "dawn-dotta", proposalId }
      });
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content[0] as { text: string }).text);
      expect(payload).toMatchObject({ proposalId, status: "succeeded", messageId });
      expect(harness.validateToken).toHaveBeenCalled();
      expect(harness.checkGuildAccess).toHaveBeenCalled();
      expect(harness.store.consumeApprovedProposal).toHaveBeenCalledOnce();
      expect(harness.managerFetch).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  });

  it("rejects a valid token whose audience belongs to a different resource", async () => {
    const harness = createHarness({ audience: "https://other.test/mcp" });
    const response = await Gateway.fetch(
      bearerRequest("valid-test-token", {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } }
      }),
      harness.env as never,
      harness.executionContext
    );
    expect(response.status).toBe(401);
    expect(harness.validateToken).toHaveBeenCalledOnce();
    expect(harness.managerFetch).not.toHaveBeenCalled();
  }); 
  it("returns a 401 invalid-token reconnect challenge for expired or missing Discord identity credentials", async () => {
    for (const discordTokenExpiresAt of [Date.now() - 1_000, null]) {
      const harness = createHarness({ discordTokenExpiresAt });
      const response = await Gateway.fetch(
        bearerRequest("valid-test-token", {
          jsonrpc: "2.0",
          id: 9,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "expiry-test", version: "1.0.0" }
          }
        }),
        harness.env as never,
        harness.executionContext
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
      expect(response.headers.get("www-authenticate")).toContain("reconnect");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(harness.validateToken).toHaveBeenCalledOnce();
      expect(harness.checkGuildAccess).not.toHaveBeenCalled();
      expect(harness.managerFetch).not.toHaveBeenCalled();
    }
  });

});
