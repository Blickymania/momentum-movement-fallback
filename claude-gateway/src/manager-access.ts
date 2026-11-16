import { assertGuildAccess, type ServerKey } from "./policy";
import type { GatewayEnv } from "./manager-client";

export interface CurrentGuildAuthorization {
  isMember: boolean;
  isOwner: boolean;
  permissions: string;
}

import { assertDiscordCredentialCurrent } from "./discord-token-expiry";
export { assertDiscordCredentialCurrent } from "./discord-token-expiry";

export interface DiscordAuthorizationService {
  checkGuildAccess(userId: string, guildId: string, discordAccessToken: string): Promise<CurrentGuildAuthorization>;
}

export function getConfiguredGuildId(env: GatewayEnv, key: ServerKey): string {
  const ids: Record<ServerKey, string | undefined> = {
    empress: env.GUILD_ID_EMPRESS,
    blickymania: env.GUILD_ID_BLICKYMANIA,
    bestyouevahad: env.GUILD_ID_BESTYOUEVAHAD,
    "red-kocaine": env.GUILD_ID_RED_KOCAINE,
    "dawn-dotta": env.GUILD_ID_DAWN_DOTTA
  };
  const guildId = ids[key];
  if (!guildId || !/^\d{15,22}$/.test(guildId)) throw new Error(`A valid fixed guild ID for ${key} is not configured.`);
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
  authorizedGuildIds: readonly string[],
  scopes: readonly string[],
  discordAccessToken: string
): Promise<void> {
  if (!/^\d{15,22}$/.test(userId)) throw new Error("Authenticated Discord user ID is invalid.");
  const guildId = getConfiguredGuildId(env, serverKey);
  if (!authorizedGuildIds.includes(guildId)) {
    throw new Error("This Discord server was not included in the user's approved OAuth grant.");
  }
  const current = await authService.checkGuildAccess(userId, guildId, discordAccessToken);

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
