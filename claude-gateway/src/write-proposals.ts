import { DurableObject } from "cloudflare:workers";
import { SERVER_CATALOG, validateProposedAction, type ActionPolicyContext, type ProposedAction, type ServerKey } from "./policy";

const SNOWFLAKE = /^\d{15,22}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const DEFAULT_TTL_SECONDS = 600;
const MAX_TTL_SECONDS = 600;

export type ProposalStatus = "pending" | "approved" | "consumed" | "expired" | "rejected";
export type ProposalAuditEvent = "created" | "approved" | "rejected" | "consumed" | "expired" | "execution_succeeded" | "execution_failed";
export type ProposalActorRole = "requester" | "owner" | "system";

export interface CreateWriteProposalInput {
  serverKey: string;
  guildId: string;
  requesterUserId: string;
  action: unknown;
  policyContext: ActionPolicyContext;
  idempotencyKey: string;
  ttlSeconds?: number;
}

export interface ApproveWriteProposalInput {
  proposalId: string;
  guildId: string;
  approverUserId: string;
  /** Internal gateway assertion, set only after the auth Worker verifies current guild ownership. */
  verifiedGuildOwner: boolean;
}

export interface ConsumeWriteProposalInput {
  proposalId: string;
  guildId: string;
  requesterUserId: string;
  expectedActionHash: string;
}

export interface WriteProposalRecord {
  id: string;
  serverKey: ServerKey;
  guildId: string;
  requesterUserId: string;
  action: ProposedAction;
  actionHash: string;
  idempotencyKey: string;
  status: ProposalStatus;
  approverUserId: string | null;
  createdAt: number;
  expiresAt: number;
  approvedAt: number | null;
  consumedAt: number | null;
}

export interface WriteProposalAuditRecord {
  id: number;
  proposalId: string;
  serverKey: ServerKey;
  guildId: string;
  actorUserId: string;
  actorRole: ProposalActorRole;
  eventType: ProposalAuditEvent;
  actionHash: string;
  createdAt: number;
  details: Record<string, unknown>;
}

interface ProposalRow extends Record<string, string | number | null> {
  id: string;
  server_key: string;
  guild_id: string;
  requester_user_id: string;
  action_json: string;
  action_hash: string;
  idempotency_key: string;
  status: ProposalStatus;
  approver_user_id: string | null;
  created_at: number;
  expires_at: number;
  approved_at: number | null;
  consumed_at: number | null;
}

interface AuditRow extends Record<string, string | number | null> {
  id: number;
  proposal_id: string;
  server_key: string;
  guild_id: string;
  actor_user_id: string;
  actor_role: ProposalActorRole;
  event_type: ProposalAuditEvent;
  action_hash: string;
  created_at: number;
  details_json: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function hashAction(actionJson: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actionJson));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export class WriteProposalStore extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS write_proposals (
        id TEXT PRIMARY KEY,
        server_key TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        requester_user_id TEXT NOT NULL,
        action_json TEXT NOT NULL,
        action_hash TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','consumed','expired','rejected')),
        approver_user_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        approved_at INTEGER,
        consumed_at INTEGER
      )
    `);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS write_proposal_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        server_key TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        event_type TEXT NOT NULL,
        action_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        details_json TEXT NOT NULL
      )
    `);
    ctx.storage.sql.exec(`
      CREATE TRIGGER IF NOT EXISTS write_proposal_audit_no_update
      BEFORE UPDATE ON write_proposal_audit
      BEGIN SELECT RAISE(ABORT, 'write proposal audit is immutable'); END
    `);
    ctx.storage.sql.exec(`
      CREATE TRIGGER IF NOT EXISTS write_proposal_audit_no_delete
      BEFORE DELETE ON write_proposal_audit
      BEGIN SELECT RAISE(ABORT, 'write proposal audit is immutable'); END
    `);
  }

  private proposalRow(proposalId: string): ProposalRow | undefined {
    return this.ctx.storage.sql.exec<ProposalRow>("SELECT * FROM write_proposals WHERE id = ?", proposalId).toArray()[0];
  }

  private toRecord(row: ProposalRow): WriteProposalRecord {
    return {
      id: row.id,
      serverKey: row.server_key as ServerKey,
      guildId: row.guild_id,
      requesterUserId: row.requester_user_id,
      action: JSON.parse(row.action_json) as ProposedAction,
      actionHash: row.action_hash,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      approverUserId: row.approver_user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      approvedAt: row.approved_at,
      consumedAt: row.consumed_at
    };
  }

  private appendAudit(
    row: ProposalRow,
    actorUserId: string,
    actorRole: ProposalActorRole,
    eventType: ProposalAuditEvent,
    details: Record<string, unknown> = {}
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO write_proposal_audit
       (proposal_id, server_key, guild_id, actor_user_id, actor_role, event_type, action_hash, created_at, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.server_key, row.guild_id, actorUserId, actorRole, eventType,
      row.action_hash, Date.now(), JSON.stringify(details)
    );
  }

  private async scheduleNextExpiry(): Promise<void> {
    const next = this.ctx.storage.sql.exec<{ next_expiry: number | null }>(
      "SELECT MIN(expires_at) AS next_expiry FROM write_proposals WHERE status IN ('pending','approved')"
    ).toArray()[0]?.next_expiry;
    if (typeof next === "number") await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  async createProposal(input: CreateWriteProposalInput): Promise<WriteProposalRecord> {
    assert(SERVER_CATALOG.some((server) => server.key === input.serverKey), "Unknown Discord manager.");
    assert(SNOWFLAKE.test(input.guildId), "Invalid proposal guild ID.");
    assert(SNOWFLAKE.test(input.requesterUserId), "Invalid proposal requester ID.");
    assert(input.policyContext.guildId === input.guildId, "Proposal policy context is bound to another guild.");
    assert(IDEMPOTENCY_KEY.test(input.idempotencyKey), "Invalid proposal idempotency key.");
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    assert(Number.isInteger(ttlSeconds) && ttlSeconds >= 1 && ttlSeconds <= MAX_TTL_SECONDS,
      "Proposal TTL is outside the permitted range.");

    const action = validateProposedAction(input.action, input.policyContext);
    const actionJson = JSON.stringify(action);
    const actionHash = await hashAction(actionJson);
    const createdAt = Date.now();
    const expiresAt = createdAt + ttlSeconds * 1000;

    const row = this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql.exec<ProposalRow>(
        "SELECT * FROM write_proposals WHERE idempotency_key = ?", input.idempotencyKey
      ).toArray()[0];
      if (existing) {
        assert(existing.requester_user_id === input.requesterUserId && existing.server_key === input.serverKey &&
          existing.guild_id === input.guildId && existing.action_hash === actionHash,
        "Idempotency key was already used for a different proposal.");
        return existing;
      }
      const id = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        `INSERT INTO write_proposals
         (id, server_key, guild_id, requester_user_id, action_json, action_hash, idempotency_key, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        id, input.serverKey, input.guildId, input.requesterUserId, actionJson, actionHash,
        input.idempotencyKey, createdAt, expiresAt
      );
      const created = this.proposalRow(id);
      assert(created, "Failed to persist write proposal.");
      this.appendAudit(created, input.requesterUserId, "requester", "created");
      return created;
    });
    await this.scheduleNextExpiry();
    return this.toRecord(row);
  }

  async approveProposal(input: ApproveWriteProposalInput): Promise<WriteProposalRecord> {
    assert(SNOWFLAKE.test(input.approverUserId), "Invalid proposal approver ID.");
    assert(input.verifiedGuildOwner === true, "A verified Discord guild owner is required to approve this proposal.");
    const outcome = this.ctx.storage.transactionSync(() => {
      const row = this.proposalRow(input.proposalId);
      assert(row, "Write proposal was not found.");
      assert(row.guild_id === input.guildId, "Proposal is bound to another Discord server.");
      assert(row.status === "pending", "Only pending proposals can be approved.");
      if (row.expires_at <= Date.now()) {
        this.ctx.storage.sql.exec("UPDATE write_proposals SET status = 'expired' WHERE id = ? AND status = 'pending'", row.id);
        const expired = this.proposalRow(row.id)!;
        this.appendAudit(expired, input.approverUserId, "owner", "expired");
        return { expired: true as const };
      }
      this.ctx.storage.sql.exec(
        "UPDATE write_proposals SET status = 'approved', approver_user_id = ?, approved_at = ? WHERE id = ? AND status = 'pending'",
        input.approverUserId, Date.now(), row.id
      );
      const approved = this.proposalRow(row.id);
      assert(approved?.status === "approved", "Proposal approval could not be committed.");
      this.appendAudit(approved, input.approverUserId, "owner", "approved");
      return { row: approved };
    });
    await this.scheduleNextExpiry();
    if ("expired" in outcome) throw new Error("Write proposal has expired.");
    return this.toRecord(outcome.row);
  }

  async rejectProposal(input: ApproveWriteProposalInput): Promise<WriteProposalRecord> {
    assert(SNOWFLAKE.test(input.approverUserId), "Invalid proposal approver ID.");
    assert(input.verifiedGuildOwner === true, "A verified Discord guild owner is required to reject this proposal.");
    const outcome = this.ctx.storage.transactionSync(() => {
      const row = this.proposalRow(input.proposalId);
      assert(row, "Write proposal was not found.");
      assert(row.guild_id === input.guildId, "Proposal is bound to another Discord server.");
      assert(row.status === "pending", "Only pending proposals can be rejected.");
      if (row.expires_at <= Date.now()) {
        this.ctx.storage.sql.exec("UPDATE write_proposals SET status = 'expired' WHERE id = ? AND status = 'pending'", row.id);
        const expired = this.proposalRow(row.id)!;
        this.appendAudit(expired, input.approverUserId, "owner", "expired");
        return { expired: true as const };
      }
      this.ctx.storage.sql.exec(
        "UPDATE write_proposals SET status = 'rejected', approver_user_id = ?, approved_at = ? WHERE id = ? AND status = 'pending'",
        input.approverUserId, Date.now(), row.id
      );
      const rejected = this.proposalRow(row.id);
      assert(rejected?.status === "rejected", "Proposal rejection could not be committed.");
      this.appendAudit(rejected, input.approverUserId, "owner", "rejected");
      return { row: rejected };
    });
    await this.scheduleNextExpiry();
    if ("expired" in outcome) throw new Error("Write proposal has expired.");
    return this.toRecord(outcome.row);
  }

  async consumeApprovedProposal(input: ConsumeWriteProposalInput): Promise<WriteProposalRecord> {
    assert(SNOWFLAKE.test(input.requesterUserId), "Invalid proposal requester ID.");
    const outcome = this.ctx.storage.transactionSync(() => {
      const row = this.proposalRow(input.proposalId);
      assert(row, "Write proposal was not found.");
      assert(row.status === "approved", "Write proposal is not approved or has already been consumed.");
      if (row.expires_at <= Date.now()) {
        this.ctx.storage.sql.exec("UPDATE write_proposals SET status = 'expired' WHERE id = ? AND status = 'approved'", row.id);
        const expired = this.proposalRow(row.id)!;
        this.appendAudit(expired, input.requesterUserId, "requester", "expired");
        return { expired: true as const };
      }
      assert(row.guild_id === input.guildId, "Proposal is bound to another Discord server.");
      assert(row.requester_user_id === input.requesterUserId, "Only the original requester may execute the approved proposal.");
      assert(row.action_hash === input.expectedActionHash, "Approved action hash does not match the proposal.");
      const consumed = this.ctx.storage.sql.exec<ProposalRow>(
        `UPDATE write_proposals SET status = 'consumed', consumed_at = ?
         WHERE id = ? AND status = 'approved' AND requester_user_id = ? AND guild_id = ? AND action_hash = ? AND expires_at > ?
         RETURNING *`,
        Date.now(), row.id, input.requesterUserId, input.guildId, input.expectedActionHash, Date.now()
      ).toArray()[0];
      assert(consumed, "Write proposal was consumed by another request or is no longer valid.");
      this.appendAudit(consumed, input.requesterUserId, "requester", "consumed");
      return { row: consumed };
    });
    await this.scheduleNextExpiry();
    if ("expired" in outcome) throw new Error("Write proposal has expired.");
    return this.toRecord(outcome.row);
  }

  recordExecutionResult(input: {
    proposalId: string;
    requesterUserId: string;
    succeeded: boolean;
    details?: { httpStatus?: number; discordCode?: string; messageId?: string };
  }): void {
    this.ctx.storage.transactionSync(() => {
      const row = this.proposalRow(input.proposalId);
      assert(row?.status === "consumed", "Only consumed proposals can receive an execution result.");
      assert(row.requester_user_id === input.requesterUserId, "Execution result is bound to another requester.");
      assert(typeof input.succeeded === "boolean", "Invalid execution result.");
      const details = input.details ?? {};
      const allowedKeys = new Set(["httpStatus", "discordCode", "messageId"]);
      assert(Object.keys(details).every((key) => allowedKeys.has(key)), "Unsupported audit detail field.");
      if (details.httpStatus !== undefined) assert(Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599, "Invalid audit HTTP status.");
      if (details.discordCode !== undefined) assert(typeof details.discordCode === "string" && details.discordCode.length <= 64, "Invalid audit Discord code.");
      if (details.messageId !== undefined) assert(SNOWFLAKE.test(details.messageId), "Invalid audit message ID.");
      this.appendAudit(row, "gateway", "system", input.succeeded ? "execution_succeeded" : "execution_failed", details);
    });
  }

  getProposal(proposalId: string): WriteProposalRecord | null {
    const row = this.proposalRow(proposalId);
    return row ? this.toRecord(row) : null;
  }

  getAudit(proposalId: string): WriteProposalAuditRecord[] {
    return this.ctx.storage.sql.exec<AuditRow>(
      "SELECT * FROM write_proposal_audit WHERE proposal_id = ? ORDER BY id ASC", proposalId
    ).toArray().map((row) => ({
      id: row.id,
      proposalId: row.proposal_id,
      serverKey: row.server_key as ServerKey,
      guildId: row.guild_id,
      actorUserId: row.actor_user_id,
      actorRole: row.actor_role,
      eventType: row.event_type,
      actionHash: row.action_hash,
      createdAt: row.created_at,
      details: JSON.parse(row.details_json) as Record<string, unknown>
    }));
  }

  async alarm(): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      const expired = this.ctx.storage.sql.exec<ProposalRow>(
        "SELECT * FROM write_proposals WHERE status IN ('pending','approved') AND expires_at <= ?", Date.now()
      ).toArray();
      for (const row of expired) {
        this.ctx.storage.sql.exec(
          "UPDATE write_proposals SET status = 'expired' WHERE id = ? AND status IN ('pending','approved')", row.id
        );
        const updated = this.proposalRow(row.id)!;
        this.appendAudit(updated, "gateway", "system", "expired");
      }
    });
    await this.scheduleNextExpiry();
  }
}
