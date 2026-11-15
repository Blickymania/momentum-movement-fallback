import {
  OAuthResourceServer,
  type AuthorizationServerBinding
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { assertCurrentGuildReadAccess, type DiscordAuthorizationService } from "./manager-access";
import { listConfiguredManagers, readManagerResource, type GatewayEnv } from "./manager-client";
import { SERVER_CATALOG, type ServerKey } from "./policy";

interface AuthProps {
  userId: string;
}

interface ResourceEnv extends GatewayEnv {
  AUTH_SERVER: AuthorizationServerBinding<AuthProps> & DiscordAuthorizationService;
  MCP_RESOURCE_URL: string;
  OAUTH_ISSUER_URL: string;
}

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

function createReadOnlyMcpHandler(
  env: ResourceEnv,
  userId: string,
  scopes: string[]
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
          await assertCurrentGuildReadAccess(env, env.AUTH_SERVER, key, userId, scopes);
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

    return server;
  });
}

export default {
  async fetch(request: Request, env: ResourceEnv, ctx: ExecutionContext): Promise<Response> {
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
          if (!userId) {
            return Response.json({ error: "Authenticated Discord user is missing." }, { status: 403 });
          }
          const scopes = scopesFrom(authContext.auth.scope);
          const mcp = createReadOnlyMcpHandler(bindings, userId, scopes);
          return mcp.fetch(mcpRequest);
        }
      }
    });

    return resourceServer.fetch(request, env, ctx);
  }
};
