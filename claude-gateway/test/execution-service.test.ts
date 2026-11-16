import { describe, expect, it, vi } from "vitest";
import { executeApprovedProposal, type ExecuteApprovedProposalDependencies } from "../src/execution-service";
import type { WriteProposalRecord } from "../src/write-proposals";
import type { ProposedAction } from "../src/policy";

const proposalId = "a5c5d94c-6eac-4b6e-9b2f-3c7b4a95c8c1";
const guildId = "1565048205970767992";
const requesterUserId = "222222222222222222";
const action: ProposedAction = { type: "message.send", channelId: "1565048207178862762", content: "Approved message" };
const actionHash = `sha256:${"a".repeat(64)}`;
function proposal(status: WriteProposalRecord["status"]): WriteProposalRecord {
  return {
    id: proposalId, serverKey: "dawn-dotta", guildId, requesterUserId, action, actionHash,
    idempotencyKey: "execution-test-key", status, approverUserId: "333333333333333333",
    createdAt: Date.now(), expiresAt: Date.now() + 600_000, approvedAt: Date.now(),
    consumedAt: status === "consumed" ? Date.now() : null
  };
}
function dependencies(overrides: Partial<ExecuteApprovedProposalDependencies> = {}) {
  const saved = proposal("approved");
  const claim = { proposal: saved, attempt: 1, leaseToken: "lease-token-1", leaseUntil: Date.now() + 30_000 };
  return {
    getProposal: vi.fn(async () => saved),
    consumeApprovedProposal: vi.fn(async () => ({ ...saved, status: "consumed" as const, consumedAt: Date.now() })),
    claimExecution: vi.fn(async () => claim),
    executeManagerWrite: vi.fn(async () => ({ ok: true, httpStatus: 200, messageId: "1565048207178862764" })),
    recordExecutionResult: vi.fn(async () => undefined),
    ...overrides
  };
}
const input = { proposalId, serverKey: "dawn-dotta" as const, guildId, requesterUserId };

describe("approved proposal execution orchestration", () => {
  it("consumes approval, claims a lease, calls the typed manager, and records success", async () => {
    const deps = dependencies();
    const result = await executeApprovedProposal(input, deps);
    expect(deps.consumeApprovedProposal).toHaveBeenCalledOnce();
    expect(deps.claimExecution).toHaveBeenCalledOnce();
    expect(deps.executeManagerWrite).toHaveBeenCalledWith({ proposalId, actionHash, action });
    expect(deps.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({
      proposalId, requesterUserId, attempt: 1, leaseToken: "lease-token-1", succeeded: true, retryable: false
    }));
    expect(result).toMatchObject({ status: "succeeded", attempt: 1, messageId: "1565048207178862764" });
  });

  it("retries an already-consumed proposal without consuming approval again", async () => {
    const saved = proposal("consumed");
    const deps = dependencies({
      getProposal: vi.fn(async () => saved),
      claimExecution: vi.fn(async () => ({ proposal: saved, attempt: 2, leaseToken: "lease-token-2", leaseUntil: Date.now() + 30_000 })),
      executeManagerWrite: vi.fn(async () => ({ ok: true, httpStatus: 200, channelId: "1565048207178862762", updatedFields: ["topic"] }))
    });
    const result = await executeApprovedProposal(input, deps);
    expect(deps.consumeApprovedProposal).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "succeeded", attempt: 2, updatedFields: ["topic"] });
  });

  it("records a retryable Discord rate limit", async () => {
    const deps = dependencies({ executeManagerWrite: vi.fn(async () => ({ ok: false, httpStatus: 503, discordStatus: 429, error: "Rate limited" })) });
    const result = await executeApprovedProposal(input, deps);
    expect(result).toMatchObject({ status: "failed", retryable: true, httpStatus: 503 });
    expect(deps.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({ succeeded: false, retryable: true }));
  });

  it("records a terminal permission failure", async () => {
    const deps = dependencies({ executeManagerWrite: vi.fn(async () => ({ ok: false, httpStatus: 403, discordStatus: 403, error: "Forbidden" })) });
    const result = await executeApprovedProposal(input, deps);
    expect(result).toMatchObject({ status: "failed", retryable: false, httpStatus: 403 });
    expect(deps.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({ succeeded: false, retryable: false }));
  });

  it("treats an ambiguous private manager timeout for a message as terminal", async () => {
    const deps = dependencies({ executeManagerWrite: vi.fn(async () => { throw new Error("service binding timeout"); }) });
    const result = await executeApprovedProposal(input, deps);
    expect(result).toMatchObject({ status: "failed", retryable: false, httpStatus: 502 });
    expect(result.error).toMatch(/unconfirmed|reconcile/);
    expect(deps.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({
      retryable: false, details: { httpStatus: 502, discordCode: "MANAGER_NETWORK_ERROR" }
    }));
  });

  it("allows idempotent channel updates to retry after a private manager timeout", async () => {
    const update = { type: "channel.update" as const, channelId: action.channelId, patch: { topic: "New topic" } };
    const deps = dependencies({
      getProposal: vi.fn(async () => ({ ...proposal("approved"), action: update })),
      executeManagerWrite: vi.fn(async () => { throw new Error("service binding timeout"); })
    });
    const result = await executeApprovedProposal(input, deps);
    expect(result).toMatchObject({ status: "failed", retryable: true, httpStatus: 502 });
    expect(deps.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));
  });

  it("does not retry an ambiguously rejected message without a confirmed Discord 429", async () => {
    const deps = dependencies({
      executeManagerWrite: vi.fn(async () => ({ ok: false, httpStatus: 503, error: "Unknown upstream result" }))
    });
    const result = await executeApprovedProposal(input, deps);
    expect(result).toMatchObject({ status: "failed", retryable: false, httpStatus: 503 });
    expect(deps.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({ retryable: false }));
  });

  it("rejects mismatched requester/server and unapproved proposals before any write", async () => {
    const wrong = dependencies({ getProposal: vi.fn(async () => ({ ...proposal("approved"), requesterUserId: "444444444444444444" })) });
    await expect(executeApprovedProposal(input, wrong)).rejects.toThrow(/not bound/);
    expect(wrong.executeManagerWrite).not.toHaveBeenCalled();
    const pending = dependencies({ getProposal: vi.fn(async () => proposal("pending")) });
    await expect(executeApprovedProposal(input, pending)).rejects.toThrow(/Only owner-approved/);
    expect(pending.executeManagerWrite).not.toHaveBeenCalled();
  });

  it("recovers a race where another execution consumed the approval first", async () => {
    const consumed = proposal("consumed");
    const deps = dependencies({
      consumeApprovedProposal: vi.fn(async () => { throw new Error("already consumed"); }),
      getProposal: vi.fn().mockResolvedValueOnce(proposal("approved")).mockResolvedValueOnce(consumed)
    });
    const result = await executeApprovedProposal(input, deps);
    expect(deps.getProposal).toHaveBeenCalledTimes(2);
    expect(deps.claimExecution).toHaveBeenCalledOnce();
    expect(result.status).toBe("succeeded");
  });
});
