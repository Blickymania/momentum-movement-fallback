import { assertGuildAccess, type ServerKey } from "./policy";
import type { GatewayEnv } from "./manager-client";

export interface CurrentGuildAuthorization {
  isMember: boolean;
  isOwner: boolean;
  permissions: string;
}

export interface DiscordAuthorizationService {
  checkGuildAccess(userId: string, guildId: string): Promise<CurrentGuildAuthorization>;
}

function configuredGuildId(env: GatewayEnv, key: ServerKey): string {
  const ids: Record<ServerKey, string | undefined> = {
    empress: env.GUILD_ID_EMPRESS,
    blickymania: env.GUILD_ID_BLICKYMANIA,
    bestyouevahad: env.GUILD_ID_BESTYOUEVAHAD,
    "red-kocaine": env.GUILD_ID_RED_KOCAINE,
    "dawn-dotta": env.GUILD_ID_DAWN_DOTTA
  };
  const guildId = ids[key];
  if (!guildId) throw new Error(`Fixed guild ID for ${key} is not configured.`);
  return guildId;
}

/**
 * Re-checks Discord membership and owner/Administrator permission through
 * the private authorization Worker for every manager read.
 */
export async function assertCurrentGuildReadAccess(
  env: GatewayEnv,
  authService: DiscordAuthorizationService,
  serverKey: ServerKey,
  userId: string,
  scopes: readonly string[]
): Promise<void> {
  if (!userId) throw new Error("Authenticated Discord user is missing.");
  const guildId = configuredGuildId(env, serverKey);
  const current = await authService.checkGuildAccess(userId, guildId);

  assertGuildAccess({
    serverKey,
    configuredGuildId: guildId,
    requestedGuildId: guildId,
    allowedGuildIds: current.isMember ? [guildId] : [],
    userIsOwner: current.isOwner,
    discordPermissions: current.permissions,
    scopes,
    mode: "read",
    stagingWritesEnabled: false
  });
}
