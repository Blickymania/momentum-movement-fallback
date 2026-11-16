const DISCORD_API = "https://discord.com/api/v10";
const SNOWFLAKE = /^\d{15,22}$/;

interface DiscordUser {
  id: string;
}

interface DiscordGuild {
  id: string;
  owner?: boolean;
  permissions?: string;
}

export function discordStateCookieName(state: string): string {
  return `__Host-discord-oauth-${state}`;
}

export function hasMatchingDiscordOAuthStateCookie(request: Request, state: string): boolean {
  const name = discordStateCookieName(state);
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader.split(";").some((part) => {
    const separator = part.indexOf("=");
    return separator >= 0 && part.slice(0, separator).trim() === name &&
      part.slice(separator + 1).trim() === state;
  });
}

export async function checkGuildAccessForToken(
  userId: string,
  guildId: string,
  discordAccessToken: string,
  discordFetch: typeof fetch = fetch
): Promise<{ isMember: boolean; isOwner: boolean; permissions: string }> {
  if (!SNOWFLAKE.test(userId) || !SNOWFLAKE.test(guildId) || !discordAccessToken) {
    return { isMember: false, isOwner: false, permissions: "0" };
  }

  const [userResponse, guildsResponse] = await Promise.all([
    discordFetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${discordAccessToken}` },
      redirect: "error"
    }),
    discordFetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { authorization: `Bearer ${discordAccessToken}` },
      redirect: "error"
    })
  ]);

  if (!userResponse.ok || !guildsResponse.ok) {
    return { isMember: false, isOwner: false, permissions: "0" };
  }

  const user = await userResponse.json() as DiscordUser;
  if (user.id !== userId) return { isMember: false, isOwner: false, permissions: "0" };

  const guilds = await guildsResponse.json() as DiscordGuild[];
  const guild = guilds.find((item) => item.id === guildId);
  if (!guild) return { isMember: false, isOwner: false, permissions: "0" };

  return {
    isMember: true,
    isOwner: guild.owner === true,
    permissions: guild.permissions ?? "0"
  };
}
