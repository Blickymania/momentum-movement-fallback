import { describe, expect, it, vi } from "vitest";
import { createProposalAndApproval, validateProposalChannel } from "../src/proposal-service";
import type { WriteProposalRecord } from "../src/write-proposals";
import type { ProposedAction } from "../src/policy";

const guildId = "1565048205970767992";
const requesterUserId = "222222222222222222";
const channelId = "1565048207178862762";
const channels = [
  { id: channelId, type: 0, name: "general" },
  { id: "1565048207178862763", type: 5, name: "announcements" },
  { id: "1565048207178862764", type: 15, name: "creator-gallery" },
  { id: "1565048207178862765", type: 2, name: "voice" }
];

function proposal(action: ProposedAction): WriteProposalRecord {
  return {
    id: "a5c5d94c-6eac-4b6e-9b2f-3c7b4a95c8c1",
    serverKey: "dawn-dotta",
    guildId,
    requesterUserId,
    action,
    actionHash: `sha256:${"a".repeat(64)}`,
    idempotencyKey: "proposal-key-123",
    status: "pending",
    approverUserId: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    approvedAt: null,
    consumedAt: null
  };
}

describe("proposal action channel validation", () => {
  it("allows message proposals only in text and announcement channels", () => {
    expect(validateProposalChannel({ type: "message.send", channelId, content: "Hello" }, channels)).toMatchObject({ type: "message.send" });
    expect(validateProposalChannel({ type: "message.send", channelId: "1565048207178862763", content: "Notice" }, channels)).toMatchObject({ type: "message.send" });
    expect(() => validateProposalChannel({ type: "message.send", channelId: "1565048207178862765", content: "No voice" }, channels)).toThrow(/text or announcement/);
  });

  it("allows forum layout changes only for forum channels", () => {
    const action = { type: "channel.update", channelId: "1565048207178862764", patch: { default_forum_layout: 1 } } as const;
    expect(validateProposalChannel(action, channels)).toEqual(action);
    expect(() => validateProposalChannel({ ...action, channelId }, channels)).toThrow(/forum channels/);
  });

  it("rejects unknown channels, unsupported channel types, and permission overwrites", () => {
    expect(() => validateProposalChannel({ type: "message.send", channelId: "1565048207178862766", content: "Hello" }, channels)).toThrow(/not present/);
    expect(() => validateProposalChannel({ type: "channel.permission.set", channelId, targetType: "role", targetId: guildId, allow: "0", deny: "0" }, channels)).toThrow(/not available/);
  });
});

describe("proposal and owner-link orchestration", () => {
  it("stores the validated proposal and returns a one-time owner approval link", async () => {
    const action = { type: "message.send", channelId, content: "Approved update" } as const;
    const saved = proposal(action);
    const createProposal = vi.fn(async () => saved);
    const createOwnerApprovalSession = vi.fn(async () => ({ approvalUrl: "https://auth.test/owner-approval?handle=one-time", expiresAt: Date.now() + 600_000 }));
    const result = await createProposalAndApproval({
      serverKey: "dawn-dotta", guildId, requesterUserId, action, channelInventory: channels, idempotencyKey: "proposal-key-123"
    }, { createProposal, createOwnerApprovalSession });
    expect(createProposal).toHaveBeenCalledOnce();
    expect(createOwnerApprovalSession).toHaveBeenCalledWith(saved);
    expect(result).toMatchObject({ proposalId: saved.id, status: "pending", ownerApprovalUrl: "https://auth.test/owner-approval?handle=one-time" });
    expect(result.message).toContain("No Discord write has been executed");
  });

  it("does not hide an approval-link failure or lose the pending proposal", async () => {
    const saved = proposal({ type: "message.send", channelId, content: "Approved update" });
    const result = await createProposalAndApproval({
      serverKey: "dawn-dotta", guildId, requesterUserId,
      action: saved.action, channelInventory: channels, idempotencyKey: "proposal-key-123"
    }, {
      createProposal: async () => saved,
      createOwnerApprovalSession: async () => { throw new Error("auth binding unavailable"); }
    });
    expect(result.status).toBe("pending");
    expect(result.approvalLinkError).toMatch(/Retry with the same idempotency key/);
  });
});
