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
}

export type ManagerReadResource = "status" | "channels" | "roles" | "commands";

interface ManagerTarget {
  binding: ManagerBinding;
  guildId: string;
}

const MANAGERS: Record<ServerKey, {
  binding: keyof GatewayEnv;
  guildId: keyof GatewayEnv;
}> = {
  empress: { binding: "MANAGER_EMPRESS", guildId: "GUILD_ID_EMPRESS" },
  blickymania: { binding: "MANAGER_BLICKYMANIA", guildId: "GUILD_ID_BLICKYMANIA" },
  bestyouevahad: { binding: "MANAGER_BESTYOUEVAHAD", guildId: "GUILD_ID_BESTYOUEVAHAD" },
  "red-kocaine": { binding: "MANAGER_RED_KOCAINE", guildId: "GUILD_ID_RED_KOCAINE" },
  "dawn-dotta": { binding: "MANAGER_DAWN_DOTTA", guildId: "GUILD_ID_DAWN_DOTTA" }
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
