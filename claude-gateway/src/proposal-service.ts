import { validateProposedAction, type ActionPolicyContext, type ProposedAction, type ServerKey } from "./policy";
import type { WriteProposalRecord } from "./write-proposals";
import type { OwnerApprovalSessionResponse } from "./owner-approval-types";

interface ChannelInventoryEntry {
  id: string;
  type: number;
  name?: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function channelEntries(value: unknown): ChannelInventoryEntry[] {
  const raw = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.channels)
      ? value.channels
      : null;
  assert(raw, "The manager did not return a valid channel inventory.");
  return raw.filter((entry): entry is ChannelInventoryEntry =>
    isObject(entry) && typeof entry.id === "string" && typeof entry.type === "number"
  );
}

export function validateProposalChannel(
  action: ProposedAction,
  inventory: unknown
): ProposedAction {
  assert(action.type !== "channel.permission.set", "Permission-overwrite changes are not available through the proposal tool.");
  const channel = channelEntries(inventory).find((entry) => entry.id === action.channelId);
  assert(channel, "The target channel is not present in the selected manager's current channel inventory.");

  if (action.type === "message.send") {
    assert(channel.type === 0 || channel.type === 5,
      "Messages can only be proposed for text or announcement channels.");
    return action;
  }

  assert(channel.type === 0 || channel.type === 5 || channel.type === 15,
    "Channel updates are limited to text, announcement, and forum channels.");
  const forumFields = ["default_auto_archive_duration", "default_forum_layout", "default_sort_order"];
  if (forumFields.some((field) => field in action.patch)) {
    assert(channel.type === 15, "Forum layout and archive settings can only be proposed for forum channels.");
  }
  return action;
}

export interface CreateProposalAndApprovalInput {
  serverKey: ServerKey;
  guildId: string;
  requesterUserId: string;
  action: unknown;
  channelInventory: unknown;
  idempotencyKey: string;
}

export interface CreateProposalAndApprovalDependencies {
  createProposal(action: ProposedAction, policyContext: ActionPolicyContext): Promise<WriteProposalRecord>;
  createOwnerApprovalSession(proposal: WriteProposalRecord): Promise<OwnerApprovalSessionResponse>;
}

export interface CreateProposalAndApprovalResult {
  proposalId: string;
  serverKey: ServerKey;
  guildId: string;
  status: WriteProposalRecord["status"];
  actionHash: string;
  expiresAt: string;
  ownerApprovalUrl?: string;
  approvalLinkError?: string;
  message: string;
}

export async function createProposalAndApproval(
  input: CreateProposalAndApprovalInput,
  dependencies: CreateProposalAndApprovalDependencies
): Promise<CreateProposalAndApprovalResult> {
  const policyContext: ActionPolicyContext = {
    guildId: input.guildId,
    knownRoleIds: [],
    managedRoleIds: [],
    protectedRoleIds: [],
    botUserIds: []
  };
  const action = validateProposedAction(input.action, policyContext);
  const safeAction = validateProposalChannel(action, input.channelInventory);
  const proposal = await dependencies.createProposal(safeAction, policyContext);
  assert(proposal.guildId === input.guildId && proposal.requesterUserId === input.requesterUserId &&
    proposal.serverKey === input.serverKey, "Stored proposal does not match the authorized requester or server.");
  assert(proposal.status === "pending", "This idempotency key refers to a proposal that is no longer pending; use a new key for a new proposal.");

  try {
    const approval = await dependencies.createOwnerApprovalSession(proposal);
    return {
      proposalId: proposal.id,
      serverKey: proposal.serverKey,
      guildId: proposal.guildId,
      status: proposal.status,
      actionHash: proposal.actionHash,
      expiresAt: new Date(proposal.expiresAt).toISOString(),
      ownerApprovalUrl: approval.approvalUrl,
      message: "Pending owner approval. No Discord write has been executed. The current guild owner must review the exact action and explicitly approve or reject it."
    };
  } catch {
    return {
      proposalId: proposal.id,
      serverKey: proposal.serverKey,
      guildId: proposal.guildId,
      status: proposal.status,
      actionHash: proposal.actionHash,
      expiresAt: new Date(proposal.expiresAt).toISOString(),
      approvalLinkError: "The proposal is stored, but the owner approval link could not be created. Retry with the same idempotency key to request a fresh link.",
      message: "Pending owner approval; no Discord write has been executed."
    };
  }
}
