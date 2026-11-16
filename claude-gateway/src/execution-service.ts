import type { ServerKey } from "./policy";
import type { ExecutionClaim, WriteProposalRecord } from "./write-proposals";
import type { ManagerWriteAction, ManagerWriteResult } from "./manager-client";

export interface ExecuteApprovedProposalInput {
  proposalId: string;
  serverKey: ServerKey;
  guildId: string;
  requesterUserId: string;
}
export interface ExecuteApprovedProposalDependencies {
  getProposal(proposalId: string): Promise<WriteProposalRecord | null>;
  consumeApprovedProposal(input: { proposalId: string; guildId: string; requesterUserId: string; expectedActionHash: string }): Promise<WriteProposalRecord>;
  claimExecution(input: { proposalId: string; guildId: string; requesterUserId: string; expectedActionHash: string }): Promise<ExecutionClaim>;
  executeManagerWrite(input: { proposalId: string; actionHash: string; action: ManagerWriteAction }): Promise<ManagerWriteResult>;
  recordExecutionResult(input: {
    proposalId: string; requesterUserId: string; attempt: number; leaseToken: string;
    succeeded: boolean; retryable: boolean;
    details?: { httpStatus?: number; discordCode?: string; messageId?: string };
  }): Promise<void>;
}
export interface ExecuteApprovedProposalResult {
  proposalId: string;
  status: "succeeded" | "failed";
  attempt: number;
  retryable: boolean;
  httpStatus: number;
  messageId?: string;
  channelId?: string;
  updatedFields?: string[];
  error?: string;
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function retryableHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status >= 500;
}
function discordCode(status?: number): string | undefined {
  return status === undefined ? undefined : `HTTP_${status}`;
}

/** Internal orchestration for the owner-approved MCP execution tool. */
export async function executeApprovedProposal(
  input: ExecuteApprovedProposalInput,
  dependencies: ExecuteApprovedProposalDependencies
): Promise<ExecuteApprovedProposalResult> {
  assert(/^[0-9a-f-]{36}$/i.test(input.proposalId), "Invalid proposal ID.");
  assert(/^\d{15,22}$/.test(input.guildId) && /^\d{15,22}$/.test(input.requesterUserId), "Invalid execution identity.");
  let proposal = await dependencies.getProposal(input.proposalId);
  assert(proposal, "Write proposal was not found.");
  assert(proposal.serverKey === input.serverKey && proposal.guildId === input.guildId &&
    proposal.requesterUserId === input.requesterUserId, "Proposal is not bound to this requester and independent manager.");
  assert(proposal.status === "approved" || proposal.status === "consumed", "Only owner-approved proposals can be executed.");
  assert(proposal.action.type === "message.send" || proposal.action.type === "channel.update",
    "This proposal action is not supported by the typed manager executor.");

  if (proposal.status === "approved") {
    try {
      proposal = await dependencies.consumeApprovedProposal({
        proposalId: proposal.id, guildId: input.guildId, requesterUserId: input.requesterUserId,
        expectedActionHash: proposal.actionHash
      });
    } catch (error) {
      const refreshed = await dependencies.getProposal(input.proposalId);
      if (!refreshed || refreshed.status !== "consumed") throw error;
      proposal = refreshed;
    }
  }
  assert(proposal.status === "consumed", "Proposal approval could not be consumed.");
  assert(proposal.action.type === "message.send" || proposal.action.type === "channel.update",
    "This proposal action is not supported by the typed manager executor.");
  const claim = await dependencies.claimExecution({
    proposalId: proposal.id, guildId: input.guildId, requesterUserId: input.requesterUserId,
    expectedActionHash: proposal.actionHash
  });

  let result: ManagerWriteResult;
  try {
    result = await dependencies.executeManagerWrite({
      proposalId: proposal.id, actionHash: proposal.actionHash, action: proposal.action
    });
  } catch {
    // A network timeout after dispatch can hide a successful Discord message.
    // Channel patches are idempotent; message sends must require reconciliation.
    const retryable = proposal.action.type === "channel.update";
    await dependencies.recordExecutionResult({
      proposalId: proposal.id, requesterUserId: input.requesterUserId, attempt: claim.attempt,
      leaseToken: claim.leaseToken, succeeded: false, retryable,
      details: { httpStatus: 502, discordCode: "MANAGER_NETWORK_ERROR" }
    });
    return {
      proposalId: proposal.id, status: "failed", attempt: claim.attempt, retryable,
      httpStatus: 502, error: retryable
        ? "The private manager connection failed. Retry after the lease is released or expires."
        : "The message outcome is unconfirmed. Do not retry this proposal; reconcile the Discord channel first."
    };
  }

  if (result.ok) {
    await dependencies.recordExecutionResult({
      proposalId: proposal.id, requesterUserId: input.requesterUserId, attempt: claim.attempt,
      leaseToken: claim.leaseToken, succeeded: true, retryable: false,
      details: { httpStatus: result.httpStatus, ...(result.messageId ? { messageId: result.messageId } : {}) }
    });
    return {
      proposalId: proposal.id, status: "succeeded", attempt: claim.attempt, retryable: false,
      httpStatus: result.httpStatus,
      ...(result.messageId ? { messageId: result.messageId } : {}),
      ...(result.channelId ? { channelId: result.channelId } : {}),
      ...(result.updatedFields ? { updatedFields: result.updatedFields } : {})
    };
  }

  // Only a confirmed Discord 429 proves a message was rejected before sending.
  // Other upstream or transport failures may conceal a successful send.
  const retryable = proposal.action.type === "channel.update"
    ? retryableHttpStatus(result.httpStatus)
    : result.discordStatus === 429;
  await dependencies.recordExecutionResult({
    proposalId: proposal.id, requesterUserId: input.requesterUserId, attempt: claim.attempt,
    leaseToken: claim.leaseToken, succeeded: false, retryable,
    details: {
      httpStatus: result.httpStatus,
      ...(discordCode(result.discordStatus) ? { discordCode: discordCode(result.discordStatus) } : {})
    }
  });
  return {
    proposalId: proposal.id, status: "failed", attempt: claim.attempt, retryable,
    httpStatus: result.httpStatus, error: result.error ?? "The manager rejected the approved action."
  };
}
