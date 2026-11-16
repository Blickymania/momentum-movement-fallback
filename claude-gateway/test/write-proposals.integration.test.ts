/// <reference types="@cloudflare/vitest-plugin/types" />
import { env as cloudflareEnv } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { WriteProposalStore, CreateWriteProposalInput, ApproveWriteProposalInput, ConsumeWriteProposalInput, WriteProposalRecord, WriteProposalAuditRecord, ExecutionClaim, ExecutionState } from "../src/write-proposals";
import type { ActionPolicyContext, ServerKey } from "../src/policy";

type TestEnv = { WRITE_PROPOSAL_STORE: DurableObjectNamespace<WriteProposalStore> };
type WriteProposalStoreStub = {
  createProposal(input: CreateWriteProposalInput): Promise<WriteProposalRecord>;
  approveProposal(input: ApproveWriteProposalInput): Promise<WriteProposalRecord>;
  rejectProposal(input: ApproveWriteProposalInput): Promise<WriteProposalRecord>;
  consumeApprovedProposal(input: ConsumeWriteProposalInput): Promise<WriteProposalRecord>;
  claimExecution(input: { proposalId: string; guildId: string; requesterUserId: string; expectedActionHash: string; leaseMs?: number }): Promise<ExecutionClaim>;
  renewExecutionLease(input: { proposalId: string; requesterUserId: string; attempt: number; leaseToken: string; leaseMs?: number }): Promise<number>;
  recordExecutionResult(input: { proposalId: string; requesterUserId: string; attempt: number; leaseToken: string; succeeded: boolean; retryable: boolean; details?: { httpStatus?: number; discordCode?: string; messageId?: string } }): Promise<void>;
  getExecutionState(proposalId: string): Promise<ExecutionState | null>;
  getProposal(proposalId: string): Promise<WriteProposalRecord | null>;
  getAudit(proposalId: string): Promise<WriteProposalAuditRecord[]>;
};
const env = cloudflareEnv as unknown as TestEnv;
const guildId = "1565048205970767992";
const requesterUserId = "222222222222222222";
const ownerUserId = "333333333333333333";
const channelId = "1565048207178862762";
const policyContext: ActionPolicyContext = {
  guildId,
  knownRoleIds: [guildId, "1565407676580499616"],
  managedRoleIds: [],
  protectedRoleIds: ["1565407676580499616"],
  botUserIds: []
};

function newStore(): WriteProposalStoreStub {
  return env.WRITE_PROPOSAL_STORE.getByName(`write-proposal-test-${crypto.randomUUID()}`) as unknown as WriteProposalStoreStub;
}

async function create(store: WriteProposalStoreStub, idempotencyKey = crypto.randomUUID(), ttlSeconds = 600, content = "Approved test message") {
  return store.createProposal({
    serverKey: "dawn-dotta" satisfies ServerKey,
    guildId,
    requesterUserId,
    action: { type: "message.send", channelId, content },
    policyContext,
    idempotencyKey,
    ttlSeconds
  });
}

async function approve(store: WriteProposalStoreStub, proposalId: string) {
  return store.approveProposal({ proposalId, guildId, approverUserId: ownerUserId, verifiedGuildOwner: true });
}

async function captureInObject(store: WriteProposalStoreStub, operation: (instance: WriteProposalStore) => Promise<unknown> | unknown): Promise<string | null> {
  return runInDurableObject(store as never, async (instance) => {
    try {
      await operation(instance as WriteProposalStore);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}

describe("persistent owner-approved write proposals", () => {
  it("creates an idempotent pending proposal and immutable creation audit", async () => {
    const store = newStore();
    const key = crypto.randomUUID();
    const first = await create(store, key);
    const duplicate = await create(store, key);
    expect(first.id).toBe(duplicate.id);
    expect(first.status).toBe("pending");
    expect(first.actionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await store.getAudit(first.id)).toHaveLength(1);
    const sameActionRetry = await create(store, key, 30);
    expect(sameActionRetry.id).toBe(first.id);
    const conflict = await captureInObject(store, (instance) => instance.createProposal({
      serverKey: "dawn-dotta", guildId, requesterUserId,
      action: { type: "message.send", channelId, content: "different payload" },
      policyContext, idempotencyKey: key
    }));
    expect(conflict).toMatch(/different proposal/);
  });

  it("requires verified guild ownership and a separate approval step", async () => {
    const store = newStore();
    const ownerRequesterProposal = await create(store);
    const ownerRequesterApproved = await store.approveProposal({
      proposalId: ownerRequesterProposal.id, guildId, approverUserId: requesterUserId, verifiedGuildOwner: true
    });
    expect(ownerRequesterApproved.status).toBe("approved");
    expect(ownerRequesterApproved.approverUserId).toBe(requesterUserId);

    const adminRequestedProposal = await create(store);
    const unverifiedOwner = await captureInObject(store, (instance) => instance.approveProposal({
      proposalId: adminRequestedProposal.id, guildId, approverUserId: ownerUserId, verifiedGuildOwner: false
    }));
    expect(unverifiedOwner).toMatch(/verified Discord guild owner/);
    const approved = await approve(store, adminRequestedProposal.id);
    expect(approved.status).toBe("approved");
    expect(approved.approverUserId).toBe(ownerUserId);
  });

  it("records an explicit owner rejection", async () => {
    const store = newStore();
    const proposal = await create(store);
    const rejected = await store.rejectProposal({
      proposalId: proposal.id, guildId, approverUserId: ownerUserId, verifiedGuildOwner: true
    });
    expect(rejected.status).toBe("rejected");
    expect((await store.getAudit(proposal.id)).map((entry) => entry.eventType)).toEqual(["created", "rejected"]);
  });

  it("rejects cross-guild, wrong-requester, and changed-action consumption", async () => {
    const store = newStore();
    const proposal = await create(store);
    await approve(store, proposal.id);
    const wrongGuild = await captureInObject(store, (instance) => instance.consumeApprovedProposal({
      proposalId: proposal.id, guildId: "1440913253118115882", requesterUserId, expectedActionHash: proposal.actionHash
    }));
    expect(wrongGuild).toMatch(/another Discord server/);
    const wrongRequester = await captureInObject(store, (instance) => instance.consumeApprovedProposal({
      proposalId: proposal.id, guildId, requesterUserId: ownerUserId, expectedActionHash: proposal.actionHash
    }));
    expect(wrongRequester).toMatch(/original requester/);
    const changedHash = await captureInObject(store, (instance) => instance.consumeApprovedProposal({
      proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: "sha256:tampered"
    }));
    expect(changedHash).toMatch(/does not match/);
    expect((await store.getProposal(proposal.id))?.status).toBe("approved");
  });

  it("allows only one concurrent consume and records the result", async () => {
    const store = newStore();
    const proposal = await create(store);
    await approve(store, proposal.id);
    const input = { proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash };
    const results = await runInDurableObject(store as never, async (instance) => {
      const target = instance as WriteProposalStore;
      return Promise.allSettled([target.consumeApprovedProposal(input), target.consumeApprovedProposal(input)]);
    });
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const claim = await store.claimExecution({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash });
    await store.recordExecutionResult({
      proposalId: proposal.id, requesterUserId, attempt: claim.attempt, leaseToken: claim.leaseToken,
      succeeded: true, retryable: false, details: { httpStatus: 200 }
    });
    expect((await store.getProposal(proposal.id))?.status).toBe("consumed");
    expect(await store.getExecutionState(proposal.id)).toMatchObject({ status: "succeeded", attempts: 1, retryable: false });
    expect((await store.getAudit(proposal.id)).map((entry) => entry.eventType)).toEqual([
      "created", "approved", "consumed", "execution_started", "execution_succeeded"
    ]);
  });

  it("expires pending proposals and cleans them through the scheduled alarm", async () => {
    const store = newStore();
    const proposal = await create(store, crypto.randomUUID(), 1);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await runDurableObjectAlarm(store as never);
    expect((await store.getProposal(proposal.id))?.status).toBe("expired");
    expect((await store.getAudit(proposal.id)).map((entry) => entry.eventType)).toEqual(["created", "expired"]);
  });

  it("atomically grants only one active execution lease under concurrent claims", async () => {
    const store = newStore();
    const proposal = await create(store);
    await approve(store, proposal.id);
    await store.consumeApprovedProposal({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash });
    const results = await runInDurableObject(store as never, async (instance) => {
      const target = instance as WriteProposalStore;
      const input = { proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash };
      return Promise.allSettled([target.claimExecution(input), target.claimExecution(input)]);
    });
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await store.getExecutionState(proposal.id)).toMatchObject({ status: "running", attempts: 1 });
  });

  it("renews an active execution lease and prevents a concurrent claim", async () => {
    const store = newStore();
    const proposal = await create(store);
    await approve(store, proposal.id);
    await store.consumeApprovedProposal({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash });
    const claim = await store.claimExecution({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash, leaseMs: 5_000 });
    const renewedUntil = await store.renewExecutionLease({
      proposalId: proposal.id, requesterUserId, attempt: claim.attempt, leaseToken: claim.leaseToken, leaseMs: 10_000
    });
    expect(renewedUntil).toBeGreaterThan(claim.leaseUntil);
    const duplicate = await captureInObject(store, (instance) => instance.claimExecution({
      proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash
    }));
    expect(duplicate).toMatch(/lease is still active/);
    await store.recordExecutionResult({
      proposalId: proposal.id, requesterUserId, attempt: claim.attempt, leaseToken: claim.leaseToken,
      succeeded: true, retryable: false
    });
  });

  it("reclaims an expired idempotent channel-update lease with a new fencing token and rejects stale results", async () => {
    const store = newStore();
    const proposal = await store.createProposal({
      serverKey: "dawn-dotta",
      guildId,
      requesterUserId,
      action: { type: "channel.update", channelId, patch: { topic: "Safe retry after expired lease" } },
      policyContext,
      idempotencyKey: crypto.randomUUID()
    });
    await approve(store, proposal.id);
    await store.consumeApprovedProposal({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash });
    const first = await store.claimExecution({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash, leaseMs: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const second = await store.claimExecution({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash, leaseMs: 5_000 });
    expect(second.attempt).toBe(2);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    const staleRenew = await captureInObject(store, (instance) => instance.renewExecutionLease({
      proposalId: proposal.id, requesterUserId, attempt: first.attempt, leaseToken: first.leaseToken
    }));
    expect(staleRenew).toMatch(/expired or has been superseded/);
    const stale = await captureInObject(store, (instance) => instance.recordExecutionResult({
      proposalId: proposal.id, requesterUserId, attempt: first.attempt, leaseToken: first.leaseToken,
      succeeded: true, retryable: false
    }));
    expect(stale).toMatch(/stale or expired fencing token/);
    await store.recordExecutionResult({
      proposalId: proposal.id, requesterUserId, attempt: second.attempt, leaseToken: second.leaseToken,
      succeeded: true, retryable: false
    });
    expect((await store.getExecutionState(proposal.id))?.attempts).toBe(2);
    expect((await store.getAudit(proposal.id)).map((entry) => entry.eventType)).toContain("execution_reclaimed");
  });

  it("blocks expired message-send leases from replaying an unconfirmed Discord message", async () => {
    const store = newStore();
    const proposal = await create(store);
    await approve(store, proposal.id);
    await store.consumeApprovedProposal({
      proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash
    });
    const first = await store.claimExecution({
      proposalId: proposal.id, guildId, requesterUserId,
      expectedActionHash: proposal.actionHash, leaseMs: 1_000
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const rejected = await captureInObject(store, (instance) => instance.claimExecution({
      proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash
    }));
    expect(rejected).toMatch(/unconfirmed message send.*reconciled manually/);
    expect(await store.getExecutionState(proposal.id)).toMatchObject({
      status: "running", attempts: first.attempt
    });
    expect((await store.getAudit(proposal.id)).map((record) => record.eventType)).not.toContain("execution_reclaimed");
  });

  it("enforces a three-attempt retry limit", async () => {
    const store = newStore();
    const proposal = await create(store);
    await approve(store, proposal.id);
    await store.consumeApprovedProposal({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = await store.claimExecution({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash });
      expect(claim.attempt).toBe(attempt);
      await store.recordExecutionResult({
        proposalId: proposal.id, requesterUserId, attempt: claim.attempt, leaseToken: claim.leaseToken,
        succeeded: false, retryable: true, details: { discordCode: "TEMPORARY" }
      });
    }
    const exhausted = await captureInObject(store, (instance) => instance.claimExecution({
      proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash
    }));
    expect(exhausted).toMatch(/Maximum execution retry count/);
    expect(await store.getExecutionState(proposal.id)).toMatchObject({ status: "failed", attempts: 3, retryable: true });
    expect((await store.getAudit(proposal.id)).map((entry) => entry.eventType).filter((event) => event === "execution_retry_started")).toHaveLength(2);
  });

  it("does not retry a terminal execution failure", async () => {
    const store = newStore();
    const proposal = await create(store);
    await approve(store, proposal.id);
    await store.consumeApprovedProposal({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash });
    const claim = await store.claimExecution({ proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash });
    await store.recordExecutionResult({
      proposalId: proposal.id, requesterUserId, attempt: claim.attempt, leaseToken: claim.leaseToken,
      succeeded: false, retryable: false
    });
    const terminal = await captureInObject(store, (instance) => instance.claimExecution({
      proposalId: proposal.id, guildId, requesterUserId, expectedActionHash: proposal.actionHash
    }));
    expect(terminal).toMatch(/terminal and not retryable/);
  });

  it("prevents mutation or deletion of audit rows", async () => {
    const store = newStore();
    const proposal = await create(store);
    await expect(runInDurableObject(store as never, (_instance, state) => {
      state.storage.sql.exec("DELETE FROM write_proposal_audit WHERE proposal_id = ?", proposal.id);
    })).rejects.toThrow(/immutable/);
    await expect(runInDurableObject(store as never, (_instance, state) => {
      state.storage.sql.exec("UPDATE write_proposal_audit SET event_type = 'tampered' WHERE proposal_id = ?", proposal.id);
    })).rejects.toThrow(/immutable/);
    expect(await store.getAudit(proposal.id)).toHaveLength(1);
  });
});
