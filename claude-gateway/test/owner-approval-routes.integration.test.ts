/// <reference types="@cloudflare/vitest-plugin/types" />
import { env as cloudflareEnv } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import gatewayWorker from "../src/index";
import type { WriteProposalStore, CreateWriteProposalInput, WriteProposalRecord } from "../src/write-proposals";
import type { ActionPolicyContext } from "../src/policy";

type GatewayTestEnv = {
  WRITE_PROPOSAL_STORE: DurableObjectNamespace<WriteProposalStore>;
  OWNER_APPROVAL_INTERNAL_SECRET: string;
};
type StoreStub = { createProposal(input: CreateWriteProposalInput): Promise<WriteProposalRecord> };
const env = cloudflareEnv as unknown as GatewayTestEnv;
const guildId = "1565048205970767992";
const requesterUserId = "222222222222222222";
const ownerUserId = "333333333333333333";
const channelId = "1565048207178862762";
const policyContext: ActionPolicyContext = {
  guildId, knownRoleIds: [guildId], managedRoleIds: [], protectedRoleIds: [], botUserIds: []
};

function newStore(): StoreStub {
  return env.WRITE_PROPOSAL_STORE.getByName(guildId) as unknown as StoreStub;
}

async function createProposal() {
  const store = newStore();
  return store.createProposal({
    serverKey: "dawn-dotta", guildId, requesterUserId,
    action: { type: "message.send", channelId, content: "Owner-approved staging test" },
    policyContext, idempotencyKey: crypto.randomUUID()
  });
}

async function gatewayFetch(path: string, init: RequestInit = {}) {
  return gatewayWorker.fetch(new Request(`https://gateway.internal${path}`, init), env as never, createExecutionContext());
}

describe("private gateway owner-approval routes", () => {
  it("requires the internal service secret and returns the exact pending proposal", async () => {
    const proposal = await createProposal();
    const path = `/internal/owner-approval/proposal?proposalId=${proposal.id}&guildId=${guildId}`;
    const denied = await gatewayFetch(path, { headers: { "x-owner-approval-secret": "wrong" } });
    expect(denied.status).toBe(403);
    const response = await gatewayFetch(path, { headers: { "x-owner-approval-secret": env.OWNER_APPROVAL_INTERNAL_SECRET } });
    expect(response.status).toBe(200);
    const snapshot = await response.json() as { proposalId: string; guildId: string; actionHash: string; action: { content: string }; status: string };
    expect(snapshot.proposalId).toBe(proposal.id);
    expect(snapshot.guildId).toBe(guildId);
    expect(snapshot.actionHash).toBe(proposal.actionHash);
    expect(snapshot.action.content).toBe("Owner-approved staging test");
    expect(snapshot.status).toBe("pending");
  });

  it("accepts only a matching owner decision and atomically updates the proposal", async () => {
    const proposal = await createProposal();
    const response = await gatewayFetch("/internal/owner-approval/decision", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-owner-approval-secret": env.OWNER_APPROVAL_INTERNAL_SECRET
      },
      body: JSON.stringify({
        proposalId: proposal.id, guildId, requesterUserId, approverUserId: ownerUserId,
        actionHash: proposal.actionHash, decision: "approve"
      })
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { proposalId: string; status: string; approverUserId: string };
    expect(result).toEqual({ proposalId: proposal.id, status: "approved", approverUserId: ownerUserId });
  });

  it("rejects a mismatched action hash", async () => {
    const proposal = await createProposal();
    const headers = { "content-type": "application/json", "x-owner-approval-secret": env.OWNER_APPROVAL_INTERNAL_SECRET };
    const mismatch = await gatewayFetch("/internal/owner-approval/decision", {
      method: "POST", headers,
      body: JSON.stringify({ proposalId: proposal.id, guildId, requesterUserId, approverUserId: ownerUserId, actionHash: `sha256:${"0".repeat(64)}`, decision: "approve" })
    });
    expect(mismatch.status).toBe(409);
  });
});
