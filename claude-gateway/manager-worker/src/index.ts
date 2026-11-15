export interface ManagerWorkerEnv {
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_APPLICATION_ID?: string;
}

type JsonObject = Record<string, unknown>;
type DiscordFetch = typeof fetch;

const API = "https://discord.com/api/v10";
const SNOWFLAKE = /^\d{15,22}$/;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}

function requiredConfig(env: ManagerWorkerEnv) {
  const guildId = env.DISCORD_GUILD_ID ?? "";
  const applicationId = env.DISCORD_APPLICATION_ID ?? "";
  const token = env.DISCORD_BOT_TOKEN ?? "";
  if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(applicationId) || !token) {
    throw new Error("Manager Worker is missing required private configuration.");
  }
  return { guildId, applicationId, token };
}

async function discordGet(
  path: string,
  token: string,
  discordFetch: DiscordFetch
): Promise<JsonObject> {
  const response = await discordFetch(`${API}${path}`, {
    method: "GET",
    headers: {
      authorization: `Bot ${token}`,
      accept: "application/json"
    },
    redirect: "error"
  });
  if (!response.ok) {
    throw new Error(`Discord API returned HTTP ${response.status}.`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Discord API returned an unexpected response.");
  }
  return data as JsonObject;
}

/**
 * Private, read-only adapter intended to be called only over a Cloudflare
 * Service Binding. There are no public routes or arbitrary Discord paths.
 */
export async function handleManagerRequest(
  request: Request,
  env: ManagerWorkerEnv,
  discordFetch: DiscordFetch = fetch
): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);

  let config: ReturnType<typeof requiredConfig>;
  try {
    config = requiredConfig(env);
  } catch {
    return json({ error: "Manager Worker is not configured." }, 503);
  }

  if (request.headers.get("x-gateway-guild-id") !== config.guildId) {
    return json({ error: "Guild does not match this isolated manager." }, 403);
  }

  const url = new URL(request.url);
  if (url.search || url.hash) return json({ error: "Query parameters are not supported." }, 400);

  try {
    switch (url.pathname) {
      case "/internal/v1/status": {
        const [application, bot, guild] = await Promise.all([
          discordGet("/oauth2/applications/@me", config.token, discordFetch),
          discordGet("/users/@me", config.token, discordFetch),
          discordGet(`/guilds/${config.guildId}`, config.token, discordFetch)
        ]);
        if (application.id !== config.applicationId) {
          return json({ error: "Bot application identity does not match this manager." }, 502);
        }
        return json({
          connected: true,
          applicationId: config.applicationId,
          bot: { id: bot.id, username: bot.username },
          guild: { id: guild.id, name: guild.name }
        });
      }
      case "/internal/v1/channels":
        return json(await discordGet(`/guilds/${config.guildId}/channels`, config.token, discordFetch));
      case "/internal/v1/roles":
        return json(await discordGet(`/guilds/${config.guildId}/roles`, config.token, discordFetch));
      case "/internal/v1/commands":
        return json(await discordGet(
          `/applications/${config.applicationId}/guilds/${config.guildId}/commands`,
          config.token,
          discordFetch
        ));
      default:
        return json({ error: "Unknown internal read resource." }, 404);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown manager error.";
    return json({ error: message }, 502);
  }
}

export default {
  fetch(request: Request, env: ManagerWorkerEnv): Promise<Response> {
    return handleManagerRequest(request, env);
  }
};
