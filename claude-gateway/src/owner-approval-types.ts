import type { ProposedAction, ServerKey } from "./policy";

export interface OwnerApprovalSessionRequest {
  proposalId: string;
  guildId: string;
  requesterUserId: string;
  serverKey: ServerKey;
  actionHash: string;
}

export interface OwnerApprovalSessionResponse {
  approvalUrl: string;
  expiresAt: number;
}

export interface OwnerApprovalProposalSnapshot extends OwnerApprovalSessionRequest {
  action: ProposedAction;
  status: "pending";
  expiresAt: number;
}

export interface OwnerApprovalDecisionRequest {
  proposalId: string;
  guildId: string;
  requesterUserId: string;
  approverUserId: string;
  actionHash: string;
  decision: "approve" | "reject";
}

export interface OwnerApprovalDecisionResponse {
  proposalId: string;
  status: "approved" | "rejected";
  approverUserId: string;
}
