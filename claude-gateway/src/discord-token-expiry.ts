export const DISCORD_TOKEN_EXPIRY_SKEW_MS = 30_000;

export function isDiscordCredentialCurrent(
  expiresAt: unknown,
  now = Date.now()
): expiresAt is number {
  return typeof expiresAt === "number" &&
    Number.isFinite(expiresAt) &&
    expiresAt > now + DISCORD_TOKEN_EXPIRY_SKEW_MS;
}

export function assertDiscordCredentialCurrent(
  expiresAt: unknown,
  now = Date.now()
): asserts expiresAt is number {
  if (!isDiscordCredentialCurrent(expiresAt, now)) {
    throw new Error("Discord authorization has expired or is expiring. Reconnect this MCP server to Discord.");
  }
}
