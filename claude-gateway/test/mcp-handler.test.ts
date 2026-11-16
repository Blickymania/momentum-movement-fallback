import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { createDiscordManagerMcpHandler } from "../src/index";
import type { WriteProposalRecord } from "../src/write-proposals";

const guildId = "1565048205970767992";
const otherGuildId = "1565048205970767993";
const requesterUserId = "222222222222222222";
const ownerUserId = "333333333333333333";
const proposalId = "a5c5d94c-6eac-4b6e-9b2f-3c7b4a95c8c1";
const channelId = "1565048207178862762";
const messageId = "1565048207178862764";
const actionHash = `sha256:${"a".repeat(64)}`;
const action = { type: "message.send" as const, channelId, content: "Approved MCP test message" };

function proposal(status: "pending" | "approved" = "approved"): WriteProposalRecord {
  return {
    id: proposalId,
    serverKey: "dawn-dotta",
    guildId,
    requesterUserId,
    action,
    actionHash,
    idempotencyKey: "mcp-handler-test-key",
    status,
    approverUserId: status === "approved" ? ownerUserId : null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    approvedAt: status === "approved" ? Date.now() : null,
    consumedAt: null
  };
}

async function createHarness(record: WriteProposalRecord) {
  const managerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await request.json() as { proposalId: string; actionHash: string };
    return Response.json({ ok: true, proposalId: body.proposalId, actionHash: body.actionHash, messageId });
  });
  const consumed = { ...record, status: "consumed" as const, consumedAt: Date.now() };
  const store = {
    getProposal: vi.fn(async () => record),
    consumeApprovedProposal: vi.fn(async () => consumed),
    claimExecution: vi.fn(async () => ({
      proposal: consumed,
      attempt: 1,
      leaseToken: "mcp-test-lease",
      leaseUntil: Date.now() + 30_000
    })),
    recordExecutionResult: vi.fn(async () => undefined)
  };
  const authCheck = vi.fn(async (_userId: string, _requestedGuildId: string) => ({
    isMember: true,
    isOwner: true,
    permissions: "0"
  }));
  const storeNamespace = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => store)
  };
  const env = {
    AUTH_SERVER: { checkGuildAccess: authCheck },
    GUILD_ID_DAWN_DOTTA: guildId,
    GUILD_ID_BLICKYMANIA: otherGuildId,
    MANAGER_DAWN_DOTTA: { fetch: managerFetch },
    MANAGER_WRITE_SECRET_DAWN_DOTTA: "test-only-write-secret",
    WRITE_PROPOSAL_STORE: storeNamespace
  };
  const handler = createDiscordManagerMcpHandler(
    env as never,
    requesterUserId,
    [guildId, otherGuildId],
    ["mcp:read"],
    "test-only-discord-access-token"
  );
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.test/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init))
  });
  const client = new Client(
    { name: "claude-gateway-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  await client.connect(transport);
  return { client, handler, store, managerFetch, authCheck, storeNamespace };
}

async function closeHarness(harness: Awaited<ReturnType<typeof createHarness>>) {
  await harness.client.close();
  await harness.handler.close();
}

describe("MCP manager handler", () => {
  it("registers the read, proposal, and approved-execution tools", async () => {
    const harness = await createHarness(proposal());
    try {
      const result = await harness.client.listTools();
      const names = result.tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining([
        "discord_list_servers",
        "discord_manager_status",
        "discord_list_channels",
        "discord_list_roles",
        "discord_get_command_inventory",
        "discord_propose_change",
        "discord_execute_approved_change"
      ]));
    } finally {
      await closeHarness(harness);
    }
  });

  it("executes the exact owner-approved proposal for its original requester", async () => {
    const harness = await createHarness(proposal("approved"));
    try {
      const result = await harness.client.callTool({
        name: "discord_execute_approved_change",
        arguments: { serverKey: "dawn-dotta", proposalId }
      });
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content[0] as { text: string }).text);
      expect(payload).toMatchObject({ proposalId, status: "succeeded", attempt: 1, messageId });
      expect(harness.store.consumeApprovedProposal).toHaveBeenCalledOnce();
      expect(harness.store.claimExecution).toHaveBeenCalledOnce();
      expect(harness.store.recordExecutionResult).toHaveBeenCalledOnce();
      expect(harness.managerFetch).toHaveBeenCalledOnce();
    } finally {
      await closeHarness(harness);
    }
  });

  it("refuses to execute a proposal that has not been approved by the owner", async () => {
    const harness = await createHarness(proposal("pending"));
    try {
      const result = await harness.client.callTool({
        name: "discord_execute_approved_change",
        arguments: { serverKey: "dawn-dotta", proposalId }
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("Only owner-approved proposals");
      expect(harness.store.consumeApprovedProposal).not.toHaveBeenCalled();
      expect(harness.managerFetch).not.toHaveBeenCalled();
    } finally {
      await closeHarness(harness);
    }
  });

  it("keeps proposal execution isolated to the selected server and original requester", async () => {
    const serverMismatch = await createHarness(proposal("approved"));
    try {
      const result = await serverMismatch.client.callTool({
        name: "discord_execute_approved_change",
        arguments: { serverKey: "blickymania", proposalId }
      });
      expect(result.isError).toBe(true);
      expect(serverMismatch.storeNamespace.idFromName).toHaveBeenCalledWith(otherGuildId);
      expect(serverMismatch.managerFetch).not.toHaveBeenCalled();
    } finally {
      await closeHarness(serverMismatch);
    }

    const requesterMismatch = await createHarness({
      ...proposal("approved"),
      requesterUserId: "444444444444444444"
    });
    try {
      const result = await requesterMismatch.client.callTool({
        name: "discord_execute_approved_change",
        arguments: { serverKey: "dawn-dotta", proposalId }
      });
      expect(result.isError).toBe(true);
      expect(requesterMismatch.managerFetch).not.toHaveBeenCalled();
    } finally {
      await closeHarness(requesterMismatch);
    }
  });
});
