import {
  OAuthResourceServer,
  type AuthorizationServerBinding
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { assertCurrentGuildReadAccess, getConfiguredGuildId, type DiscordAuthorizationService } from "./manager-access";
import { executeManagerWrite, listConfiguredManagers, readManagerResource, type GatewayEnv } from "./manager-client";
import { SERVER_CATALOG, type ServerKey } from "./policy";
import type { WriteProposalStore, WriteProposalRecord, ApproveWriteProposalInput, CreateWriteProposalInput, ExecutionClaim } from "./write-proposals";
import type { OwnerApprovalDecisionRequest, OwnerApprovalProposalSnapshot, OwnerApprovalSessionRequest, OwnerApprovalSessionResponse } from "./owner-approval-types";
import { createProposalAndApproval } from "./proposal-service";
import { executeApprovedProposal } from "./execution-service";
import type { ProposedAction } from "./policy";
export { WriteProposalStore } from "./write-proposals";

interface AuthProps {
  userId: string;
  discordAccessToken: string;
  discordTokenExpiresAt: number;
  authorizedGuildIds: string[];
}

type AuthServerBinding = AuthorizationServerBinding<AuthProps> & DiscordAuthorizationService & {
  createOwnerApprovalSession(input: OwnerApprovalSessionRequest): Promise<OwnerApprovalSessionResponse>;
};

interface ResourceEnv extends GatewayEnv {
  AUTH_SERVER: AuthServerBinding;
  MCP_RESOURCE_URL: string;
  OAUTH_ISSUER_URL: string;
  WRITE_PROPOSAL_STORE: DurableObjectNamespace<WriteProposalStore>;
  OWNER_APPROVAL_INTERNAL_SECRET?: string;
}

type WriteProposalStoreRpc = {
  createProposal(input: CreateWriteProposalInput): Promise<WriteProposalRecord>;
  getProposal(proposalId: string): Promise<WriteProposalRecord | null>;
  approveProposal(input: ApproveWriteProposalInput): Promise<WriteProposalRecord>;
  rejectProposal(input: ApproveWriteProposalInput): Promise<WriteProposalRecord>;
  consumeApprovedProposal(input: { proposalId: string; guildId: string; requesterUserId: string; expectedActionHash: string }): Promise<WriteProposalRecord>;
  claimExecution(input: { proposalId: string; guildId: string; requesterUserId: string; expectedActionHash: string }): Promise<ExecutionClaim>;
  recordExecutionResult(input: {
    proposalId: string; requesterUserId: string; attempt: number; leaseToken: string;
    succeeded: boolean; retryable: boolean;
    details?: { httpStatus?: number; discordCode?: string; messageId?: string };
  }): Promise<void>;
};

const SERVER_KEYS = SERVER_CATALOG.map((server) => server.key) as [
  "empress",
  "blickymania",
  "bestyouevahad",
  "red-kocaine",
  "dawn-dotta"
];

function scopesFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

const SNOWFLAKE = /^\d{15,22}$/;
const ACTION_HASH = /^sha256:[a-f0-9]{64}$/;

function constantTimeEqual(expected: string, actual: string): boolean {
  if (!expected || expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

function internalApprovalAuthorized(request: Request, env: ResourceEnv): boolean {
  const expected = env.OWNER_APPROVAL_INTERNAL_SECRET ?? "";
  const supplied = request.headers.get("x-owner-approval-secret") ?? "";
  return constantTimeEqual(expected, supplied);
}

async function handleInternalOwnerApproval(request: Request, env: ResourceEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!internalApprovalAuthorized(request, env)) {
    return Response.json({ error: "Forbidden." }, { status: 403, headers: { "cache-control": "no-store" } });
  }

  if (path === "/internal/owner-approval/proposal") {
    if (request.method !== "GET") return new Response("Method not allowed.", { status: 405 });
    const url = new URL(request.url);
    const proposalId = url.searchParams.get("proposalId") ?? "";
    const guildId = url.searchParams.get("guildId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(proposalId) || !SNOWFLAKE.test(guildId)) {
      return Response.json({ error: "Invalid proposal reference." }, { status: 400 });
    }
    const store = env.WRITE_PROPOSAL_STORE.get(env.WRITE_PROPOSAL_STORE.idFromName(guildId)) as unknown as WriteProposalStoreRpc;
    const proposal = await store.getProposal(proposalId);
    if (!proposal) return Response.json({ error: "Proposal not found." }, { status: 404 });
    if (proposal.guildId !== guildId || proposal.status !== "pending" || proposal.expiresAt <= Date.now()) {
      return Response.json({ error: "Proposal is no longer awaiting owner approval." }, { status: 409 });
    }
    const snapshot: OwnerApprovalProposalSnapshot = {
      proposalId: proposal.id,
      guildId: proposal.guildId,
      requesterUserId: proposal.requesterUserId,
      serverKey: proposal.serverKey,
      actionHash: proposal.actionHash,
      action: proposal.action,
      status: "pending",
      expiresAt: proposal.expiresAt
    };
    return Response.json(snapshot, { headers: { "cache-control": "no-store" } });
  }

  if (path === "/internal/owner-approval/decision") {
    if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
    let body: OwnerApprovalDecisionRequest;
    try { body = await request.json() as OwnerApprovalDecisionRequest; }
    catch { return Response.json({ error: "Invalid decision request." }, { status: 400 }); }
    if (!/^[0-9a-f-]{36}$/i.test(body.proposalId) || !SNOWFLAKE.test(body.guildId) ||
      !SNOWFLAKE.test(body.requesterUserId) || !SNOWFLAKE.test(body.approverUserId) ||
      !ACTION_HASH.test(body.actionHash) || !["approve", "reject"].includes(body.decision)) {
      return Response.json({ error: "Invalid decision request." }, { status: 400 });
    }
    const store = env.WRITE_PROPOSAL_STORE.get(env.WRITE_PROPOSAL_STORE.idFromName(body.guildId)) as unknown as WriteProposalStoreRpc;
    const proposal = await store.getProposal(body.proposalId);
    if (!proposal || proposal.status !== "pending" || proposal.guildId !== body.guildId ||
      proposal.requesterUserId !== body.requesterUserId || proposal.actionHash !== body.actionHash ||
      proposal.expiresAt <= Date.now()) {
      return Response.json({ error: "Proposal no longer matches the owner approval request." }, { status: 409 });
    }
    try {
      const result = body.decision === "approve"
        ? await store.approveProposal({ proposalId: body.proposalId, guildId: body.guildId, approverUserId: body.approverUserId, verifiedGuildOwner: true })
        : await store.rejectProposal({ proposalId: body.proposalId, guildId: body.guildId, approverUserId: body.approverUserId, verifiedGuildOwner: true });
      return Response.json({ proposalId: result.id, status: result.status, approverUserId: result.approverUserId }, {
        headers: { "cache-control": "no-store" }
      });
    } catch {
      return Response.json({ error: "Proposal decision could not be applied." }, { status: 409 });
    }
  }

  return new Response("Not found.", { status: 404 });
}

function createReadAndProposeMcpHandler(
  env: ResourceEnv,
  userId: string,
  authorizedGuildIds: string[],
  scopes: string[],
  discordAccessToken: string
) {
  return createMcpHandler(() => {
    const server = new McpServer(
      { name: "blickymania-five-server-discord-manager", version: "0.1.0" },
      { capabilities: { tools: {} } }
    );

    server.registerTool(
      "discord_list_servers",
      {
        description: "List the five independent Discord communities and whether their private manager bindings are configured. Does not expose guild IDs or credentials.",
        inputSchema: z.object({})
      },
      async () => textResult(listConfiguredManagers(env))
    );

    const registerReadTool = (name: string, resource: "status" | "channels" | "roles" | "commands", description: string) => {
      server.registerTool(
        name,
        {
          description,
          inputSchema: z.object({ serverKey: z.enum(SERVER_KEYS) })
        },
        async ({ serverKey }) => {
          const key = serverKey as ServerKey;
          await assertCurrentGuildReadAccess(
            env, env.AUTH_SERVER, key, userId, authorizedGuildIds, scopes, discordAccessToken
          );
          const result = await readManagerResource(env, key, resource);
          return textResult(result);
        }
      );
    };

    registerReadTool(
      "discord_manager_status",
      "status",
      "Read the current status of exactly one authorized Discord manager."
    );
    registerReadTool(
      "discord_list_channels",
      "channels",
      "List channels for exactly one currently authorized Discord server."
    );
    registerReadTool(
      "discord_list_roles",
      "roles",
      "List roles for exactly one currently authorized Discord server. This tool is read-only; it cannot change roles."
    );
    registerReadTool(
      "discord_get_command_inventory",
      "commands",
      "Read the registered command inventory for exactly one currently authorized Discord server."
    );

    const proposalActionSchema = z.discriminatedUnion("type", [
      z.object({
        type: z.literal("message.send"),
        channelId: z.string().regex(SNOWFLAKE),
        content: z.string().min(1).max(2000)
      }).strict(),
      z.object({
        type: z.literal("channel.update"),
        channelId: z.string().regex(SNOWFLAKE),
        patch: z.object({
          name: z.string().min(1).max(100).optional(),
          topic: z.string().max(1024).optional(),
          nsfw: z.boolean().optional(),
          rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
          default_auto_archive_duration: z.number().int().refine((value) => [60, 1440, 4320, 10080].includes(value)).optional(),
          default_forum_layout: z.union([z.literal(1), z.literal(2)]).optional(),
          default_sort_order: z.union([z.literal(0), z.literal(1)]).optional()
        }).strict()
      }).strict()
    ]);

    server.registerTool(
      "discord_propose_change",
      {
        description: "Create a pending, idempotent change proposal for one authorized Discord server and return a one-time owner approval link. This tool does not execute a Discord write. Only message.send and channel.update are supported; permission overwrites, role or bot-role changes, deletes, and bulk actions are not available.",
        inputSchema: z.object({
          serverKey: z.enum(SERVER_KEYS),
          action: proposalActionSchema,
          idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
        })
      },
      async ({ serverKey, action, idempotencyKey }) => {
        const key = serverKey as ServerKey;
        await assertCurrentGuildReadAccess(
          env, env.AUTH_SERVER, key, userId, authorizedGuildIds, scopes, discordAccessToken
        );
        const guildId = getConfiguredGuildId(env, key);
        const channelInventory = await readManagerResource(env, key, "channels");
        const store = env.WRITE_PROPOSAL_STORE.get(env.WRITE_PROPOSAL_STORE.idFromName(guildId)) as unknown as WriteProposalStoreRpc;
        const result = await createProposalAndApproval({
          serverKey: key,
          guildId,
          requesterUserId: userId,
          action: action as ProposedAction,
          channelInventory,
          idempotencyKey
        }, {
          createProposal: (normalizedAction, policyContext) => store.createProposal({
            serverKey: key,
            guildId,
            requesterUserId: userId,
            action: normalizedAction,
            policyContext,
            idempotencyKey
          }),
          createOwnerApprovalSession: (proposal) => env.AUTH_SERVER.createOwnerApprovalSession({
            proposalId: proposal.id,
            guildId: proposal.guildId,
            requesterUserId: proposal.requesterUserId,
            serverKey: proposal.serverKey,
            actionHash: proposal.actionHash
          })
        });
        return textResult(result);
      }
    );

    server.registerTool(
      "discord_execute_approved_change",
      {
        description: "Execute one previously owner-approved Discord change for the original requester. The current requester must still be an owner or Administrator in the selected community. The exact action is consumed once, protected by a short execution lease, and audited. Only message.send and channel.update are supported; role changes, bot-role changes, permission overwrites, deletes, and bulk actions are unavailable.",
        inputSchema: z.object({
          serverKey: z.enum(SERVER_KEYS),
          proposalId: z.string().uuid()
        })
      },
      async ({ serverKey, proposalId }) => {
        const key = serverKey as ServerKey;
        await assertCurrentGuildReadAccess(
          env, env.AUTH_SERVER, key, userId, authorizedGuildIds, scopes, discordAccessToken
        );
        const guildId = getConfiguredGuildId(env, key);
        const store = env.WRITE_PROPOSAL_STORE.get(env.WRITE_PROPOSAL_STORE.idFromName(guildId)) as unknown as WriteProposalStoreRpc;
        const result = await executeApprovedProposal({
          proposalId,
          serverKey: key,
          guildId,
          requesterUserId: userId
        }, {
          getProposal: (id) => store.getProposal(id),
          consumeApprovedProposal: (input) => store.consumeApprovedProposal(input),
          claimExecution: (input) => store.claimExecution(input),
          executeManagerWrite: (input) => executeManagerWrite(env, key, input),
          recordExecutionResult: async (input) => { await store.recordExecutionResult(input); }
        });
        return textResult(result);
      }
    );

    return server;
  });
}

export default {
  async fetch(request: Request, env: ResourceEnv, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/internal/owner-approval/")) {
      return handleInternalOwnerApproval(request, env);
    }
    if (!env.MCP_RESOURCE_URL || !env.OAUTH_ISSUER_URL) {
      return Response.json(
        { error: "Gateway resource URL and OAuth issuer URL must be configured before serving requests." },
        { status: 503 }
      );
    }

    const resourceServer = new OAuthResourceServer<ResourceEnv, AuthProps>({
      resourceMetadata: {
        resource: env.MCP_RESOURCE_URL,
        authorization_servers: [env.OAUTH_ISSUER_URL]
      },
      requiredScopes: ["mcp:read"],
      validateToken: (bindings) => bindings.AUTH_SERVER.validateToken,
      handler: {
        async fetch(mcpRequest, bindings, authContext) {
          const userId = authContext.props?.userId ?? authContext.auth.userId;
          const discordAccessToken = authContext.props?.discordAccessToken;
          if (!userId || !discordAccessToken) {
            return Response.json({ error: "Authenticated Discord identity is incomplete." }, { status: 403 });
          }
          const authorizedGuildIds = authContext.props?.authorizedGuildIds;
          if (!Array.isArray(authorizedGuildIds) || !authorizedGuildIds.every((id) => typeof id === "string")) {
            return Response.json({ error: "OAuth grant is missing its approved Discord server list." }, { status: 403 });
          }
          const scopes = scopesFrom(authContext.auth.scope);
          const mcp = createReadAndProposeMcpHandler(bindings, userId, authorizedGuildIds, scopes, discordAccessToken);
          return mcp.fetch(mcpRequest);
        }
      }
    });

    return resourceServer.fetch(request, env, ctx);
  }
};
