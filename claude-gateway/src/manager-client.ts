import { SERVER_CATALOG, type ServerKey } from "./policy";

export interface ManagerBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface GatewayEnv {
  MANAGER_EMPRESS?: ManagerBinding;
  MANAGER_BLICKYMANIA?: ManagerBinding;
  MANAGER_BESTYOUEVAHAD?: ManagerBinding;
  MANAGER_RED_KOCAINE?: ManagerBinding;
  MANAGER_DAWN_DOTTA?: ManagerBinding;
  GUILD_ID_EMPRESS?: string;
  GUILD_ID_BLICKYMANIA?: string;
  GUILD_ID_BESTYOUEVAHAD?: string;
  GUILD_ID_RED_KOCAINE?: string;
  GUILD_ID_DAWN_DOTTA?: string;
  MANAGER_WRITE_SECRET_EMPRESS?: string;
  MANAGER_WRITE_SECRET_BLICKYMANIA?: string;
  MANAGER_WRITE_SECRET_BESTYOUEVAHAD?: string;
  MANAGER_WRITE_SECRET_RED_KOCAINE?: string;
  MANAGER_WRITE_SECRET_DAWN_DOTTA?: string;
}

export type ManagerReadResource = "status" | "channels" | "roles" | "commands";

export type ManagerWriteAction =
  | { type: "message.send"; channelId: string; content: string }
  | { type: "channel.update"; channelId: string; patch: Record<string, unknown> };

export interface ManagerWriteInput {
  proposalId: string;
  actionHash: string;
  action: ManagerWriteAction;
}

export interface ManagerWriteResult {
  ok: boolean;
  httpStatus: number;
  discordStatus?: number;
  messageId?: string;
  channelId?: string;
  updatedFields?: string[];
  error?: string;
}

interface ManagerTarget {
  binding: ManagerBinding;
  guildId: string;
}

const MANAGERS: Record<ServerKey, {
  binding: keyof GatewayEnv;
  guildId: keyof GatewayEnv;
  writeSecret: keyof GatewayEnv;
}> = {
  empress: { binding: "MANAGER_EMPRESS", guildId: "GUILD_ID_EMPRESS", writeSecret: "MANAGER_WRITE_SECRET_EMPRESS" },
  blickymania: { binding: "MANAGER_BLICKYMANIA", guildId: "GUILD_ID_BLICKYMANIA", writeSecret: "MANAGER_WRITE_SECRET_BLICKYMANIA" },
  bestyouevahad: { binding: "MANAGER_BESTYOUEVAHAD", guildId: "GUILD_ID_BESTYOUEVAHAD", writeSecret: "MANAGER_WRITE_SECRET_BESTYOUEVAHAD" },
  "red-kocaine": { binding: "MANAGER_RED_KOCAINE", guildId: "GUILD_ID_RED_KOCAINE", writeSecret: "MANAGER_WRITE_SECRET_RED_KOCAINE" },
  "dawn-dotta": { binding: "MANAGER_DAWN_DOTTA", guildId: "GUILD_ID_DAWN_DOTTA", writeSecret: "MANAGER_WRITE_SECRET_DAWN_DOTTA" }
};

const SNOWFLAKE = /^\d{15,22}$/;
const SENSITIVE_KEY = /(authorization|token|secret|password|api[_-]?key|client[_-]?secret)/i;
const MAX_RESPONSE_BYTES = 1_000_000;

function requireServerKey(value: string): ServerKey {
  const match = SERVER_CATALOG.find((server) => server.key === value);
  if (!match) throw new Error("Unknown Discord manager.");
  return match.key;
}

function duplicateConfiguredGuildIds(env: GatewayEnv): Set<string> {
  const ids = Object.values(MANAGERS)
    .map((config) => env[config.guildId] as string | undefined)
    .filter((id): id is string => typeof id === "string" && SNOWFLAKE.test(id));
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return duplicates;
}

function resolveTarget(env: GatewayEnv, key: ServerKey): ManagerTarget {
  const config = MANAGERS[key];
  const binding = env[config.binding] as ManagerBinding | undefined;
  const guildId = env[config.guildId] as string | undefined;
  if (!binding) throw new Error(`Manager binding for ${key} is not configured.`);
  if (!guildId || !SNOWFLAKE.test(guildId)) {
    throw new Error(`A valid fixed guild ID for ${key} is not configured.`);
  }
  if (duplicateConfiguredGuildIds(env).has(guildId)) {
    throw new Error("Each independent Discord manager must have a unique guild ID.");
  }
  return { binding, guildId };
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth-limited]";
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > 20_000) return value.slice(0, 20_000);
  return value;
}

export function listConfiguredManagers(env: GatewayEnv): Array<{
  key: ServerKey;
  name: string;
  community: string;
  configured: boolean;
}> {
  const duplicateGuildIds = duplicateConfiguredGuildIds(env);
  return SERVER_CATALOG.map((server) => {
    const config = MANAGERS[server.key];
    const binding = env[config.binding];
    const guildId = env[config.guildId];
    return {
      ...server,
      configured: !!binding && typeof guildId === "string" && SNOWFLAKE.test(guildId) && !duplicateGuildIds.has(guildId)
    };
  });
}

/**
 * Calls one fixed private manager binding using a strict read-only resource
 * allowlist. There is intentionally no caller-supplied URL, HTTP method,
 * guild ID, or arbitrary Discord route.
 */
export async function readManagerResource(
  env: GatewayEnv,
  serverKey: string,
  resource: ManagerReadResource
): Promise<unknown> {
  const key = requireServerKey(serverKey);
  if (!["status", "channels", "roles", "commands"].includes(resource)) {
    throw new Error("Unsupported manager read resource.");
  }

  const { binding, guildId } = resolveTarget(env, key);
  const response = await binding.fetch(
    new Request(`https://manager.internal/internal/v1/${resource}`, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "x-gateway-guild-id": guildId,
        "x-gateway-request-id": crypto.randomUUID()
      }
    })
  );

  if (!response.ok) {
    throw new Error(`Private manager request failed with HTTP ${response.status}.`);
  }

  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Private manager response exceeded the gateway size limit.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Private manager returned an invalid JSON response.");
  }
  return redact(parsed);
}

/** Calls only the selected manager's private typed write endpoint. */
export async function executeManagerWrite(
  env: GatewayEnv,
  serverKey: string,
  input: ManagerWriteInput
): Promise<ManagerWriteResult> {
  const key = requireServerKey(serverKey);
  if (!/^[0-9a-f-]{36}$/i.test(input.proposalId) || !/^sha256:[a-f0-9]{64}$/.test(input.actionHash)) {
    throw new Error("Invalid approved proposal reference.");
  }
  if (input.action.type !== "message.send" && input.action.type !== "channel.update") {
    throw new Error("Unsupported manager write action.");
  }
  const { binding, guildId } = resolveTarget(env, key);
  const writeSecret = env[MANAGERS[key].writeSecret] as string | undefined;
  if (!writeSecret) throw new Error("Write execution secret for " + key + " is not configured.");
  const response = await binding.fetch(new Request("https://manager.internal/internal/v1/write", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-gateway-guild-id": guildId,
      "x-manager-write-secret": writeSecret
    },
    body: JSON.stringify({ proposalId: input.proposalId, guildId, actionHash: input.actionHash, action: input.action })
  }));
  const bodyText = await response.text();
  if (new TextEncoder().encode(bodyText).byteLength > 64_000) {
    return { ok: false, httpStatus: 502, error: "Manager write response exceeded the gateway size limit." };
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid response object.");
    body = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, httpStatus: 502, error: "Manager returned an invalid write response." };
  }
  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      discordStatus: typeof body.discordStatus === "number" ? body.discordStatus : undefined,
      error: typeof body.error === "string" ? body.error.slice(0, 240) : "Manager write failed."
    };
  }
  if (body.ok !== true || body.proposalId !== input.proposalId || body.actionHash !== input.actionHash) {
    return { ok: false, httpStatus: 502, error: "Manager write response did not match the approved proposal." };
  }
  return {
    ok: true,
    httpStatus: response.status,
    messageId: typeof body.messageId === "string" ? body.messageId : undefined,
    channelId: typeof body.channelId === "string" ? body.channelId : undefined,
    updatedFields: Array.isArray(body.updatedFields) ? body.updatedFields.filter((value): value is string => typeof value === "string") : undefined
  };
}
