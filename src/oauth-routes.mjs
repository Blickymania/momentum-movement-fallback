/**
 * HTTP OAuth 2.1 / PKCE routes for the Momentum Movement MCP manager.
 *
 * This module is transport-only: D1 storage is injected through OAuthD1Store,
 * Discord token and API calls use fetch, and all secrets are supplied through
 * the Worker environment. No credentials are persisted or logged.
 */
import { OAuthStoreError } from "./oauth-d1-store.mjs";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  pragma: "no-cache",
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function oauthError(error, status = 400) {
  return jsonResponse({ error }, status);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function safeRedirect(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function scopes(value) {
  const requested = String(value || "mcp:read mcp:write").trim().split(/\s+/).filter(Boolean);
  const expanded = requested.includes("mcp")
    ? ["mcp:read", "mcp:write", ...requested.filter((scope) => scope !== "mcp")]
    : requested;
  const unique = [...new Set(expanded)];
  if (!unique.includes("mcp:read") ||
      unique.some((scope) => !["mcp:read", "mcp:write"].includes(scope))) {
    throw new Error("invalid_scope");
  }
  return unique.sort().join(" ");
}

function buildIssuer(env) {
  const value = env.OAUTH_ISSUER_URL || env.DISCORD_OAUTH_REDIRECT_URI || "https://invalid.invalid";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("invalid_issuer");
  }
  return url.origin;
}

function buildResource(env) {
  const issuer = buildIssuer(env);
  const url = new URL(env.OAUTH_RESOURCE_URL || (issuer + "/mcp"));
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) {
    throw new Error("invalid_resource");
  }
  return url.origin + (url.pathname === "/" ? "/mcp" : url.pathname.replace(/\/+$/, ""));
}

function buildDiscordRedirect(env) {
  const issuer = buildIssuer(env);
  const url = new URL(env.DISCORD_OAUTH_REDIRECT_URI || (issuer + "/oauth/callback"));
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("invalid_discord_redirect");
  }
  return url.toString();
}

function expiresIn(expiry, now) {
  return Math.max(0, Math.floor((expiry - now) / 1000));
}

export function createOAuthRoutes({
  store,
  env,
  fetchImpl = fetch,
  cryptoImpl = globalThis.crypto,
  now = () => Date.now(),
  randomBytes = (length) => {
    const bytes = new Uint8Array(length);
    cryptoImpl.getRandomValues(bytes);
    return bytes;
  },
} = {}) {
  if (!store || typeof store.findLoginRequest !== "function" ||
      typeof store.consumeLoginRequestAndCreateCode !== "function" ||
      typeof store.exchangeAuthorizationCode !== "function" ||
      typeof store.rotateRefreshToken !== "function" ||
      typeof store.authenticateAccessToken !== "function" ||
      typeof store.revokeToken !== "function") {
    throw new TypeError("A compatible OAuthD1Store instance is required");
  }
  if (!env || typeof env !== "object") throw new TypeError("Worker environment is required");
  if (!cryptoImpl?.subtle || typeof fetchImpl !== "function" || typeof now !== "function") {
    throw new TypeError("Web Crypto, fetch and a clock are required");
  }

  const random = (length = 32) => base64Url(randomBytes(length));
  const hash = async (value) => {
    const digest = await cryptoImpl.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(String(value)),
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const pkce = async (verifier) => base64Url(new Uint8Array(await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  )));
  const enabled = () => env.MCP_OAUTH_ENABLED === "true";
  const issuer = () => buildIssuer(env);
  const resource = () => buildResource(env);
  const discordRedirect = () => buildDiscordRedirect(env);
  const isAdmin = (member) => {
    if (!member) return false;
    if (member.owner === true) return true;
    try {
      const permissions = BigInt(member.permissions ?? "0");
      return (permissions & 8n) === 8n;
    } catch {
      return false;
    }
  };

  async function denyLogin(pending, stateHash, reason) {
    await store.consumeLoginRequestFailure(stateHash);
    const url = new URL(pending.redirect_uri);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", reason);
    if (pending.client_state !== null && pending.client_state !== undefined) {
      url.searchParams.set("state", String(pending.client_state));
    }
    return new Response(null, {
      status: 302,
      headers: { location: url.toString(), "cache-control": "no-store" },
    });
  }

  async function register(request) {
    try {
      const body = await request.json();
      const redirects = body?.redirect_uris;
      if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 10 ||
          redirects.some((url) => typeof url !== "string" || !safeRedirect(url))) {
        return oauthError("invalid_redirect_uri");
      }
      const clientId = "mcp_" + random(24);
      const clientName = typeof body.client_name === "string" && body.client_name.trim()
        ? body.client_name.trim().slice(0, 100)
        : "MCP client";
      const unique = [...new Set(redirects)];
      await store.registerClient({ clientId, clientName, redirectUris: unique });
      return jsonResponse({
        client_id: clientId,
        client_id_issued_at: Math.floor(now() / 1000),
        client_name: clientName,
        redirect_uris: unique,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }, 201);
    } catch {
      return oauthError("invalid_client_metadata");
    }
  }

  async function authorize(url) {
    try {
      const clientId = url.searchParams.get("client_id") || "";
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      const challenge = url.searchParams.get("code_challenge") || "";
      const client = await store.getClient(clientId);
      if (!client) return oauthError("invalid_client");
      const registeredRedirects = JSON.parse(client.redirect_uris);
      if (url.searchParams.get("response_type") !== "code" ||
          !registeredRedirects.includes(redirectUri) || !safeRedirect(redirectUri)) {
        return oauthError("invalid_request");
      }
      if (url.searchParams.get("code_challenge_method") !== "S256" ||
          challenge.length < 43 || challenge.length > 128 ||
          !/^[A-Za-z0-9_-]+$/.test(challenge)) {
        return oauthError("invalid_request");
      }

      const target = url.searchParams.get("resource") || "";
      if (target !== resource()) return oauthError("invalid_target");
      const scope = scopes(url.searchParams.get("scope"));
      const discordClientId = env.DISCORD_OAUTH_CLIENT_ID;
      const discordClientSecret = env.DISCORD_OAUTH_CLIENT_SECRET;
      if (!discordClientId || !discordClientSecret) {
        return oauthError("oauth_provider_not_configured", 503);
      }

      const state = random(32);
      await store.createLoginRequest({
        stateHash: await hash(state),
        clientId,
        redirectUri,
        clientState: url.searchParams.get("state"),
        codeChallenge: challenge,
        scope,
        resource: target,
      });

      const authUrl = new URL("https://discord.com/oauth2/authorize");
      authUrl.searchParams.set("client_id", discordClientId);
      authUrl.searchParams.set("redirect_uri", discordRedirect());
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "identify guilds");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("prompt", "consent");
      return new Response(null, {
        status: 302,
        headers: { location: authUrl.toString(), "cache-control": "no-store" },
      });
    } catch (error) {
      const code = String(error?.message || "");
      return oauthError(code.startsWith("invalid_") ? code : "invalid_request");
    }
  }

  async function callback(url) {
    const state = url.searchParams.get("state") || "";
    const stateHash = await hash(state);
    const pending = await store.findLoginRequest(stateHash);
    if (!pending) return oauthError("invalid_state");

    if (url.searchParams.has("error")) {
      return denyLogin(pending, stateHash, "Discord authorization was not completed");
    }
    const code = url.searchParams.get("code") || "";
    const discordClientId = env.DISCORD_OAUTH_CLIENT_ID;
    const discordClientSecret = env.DISCORD_OAUTH_CLIENT_SECRET;
    if (!code || !discordClientId || !discordClientSecret) {
      return denyLogin(pending, stateHash, "Discord OAuth provider is not configured");
    }

    try {
      const tokenForm = new URLSearchParams({
        client_id: discordClientId,
        client_secret: discordClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: discordRedirect(),
      });
      const tokenResponse = await fetchImpl("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenForm,
      });
      const discordToken = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !discordToken.access_token) {
        return denyLogin(pending, stateHash, "Discord token exchange failed");
      }

      const headers = {
        authorization: "Bearer " + discordToken.access_token,
        "user-agent": "MomentumMovementOAuth/1.0",
      };
      const [userResponse, guildResponse] = await Promise.all([
        fetchImpl("https://discord.com/api/v10/users/@me", { headers }),
        fetchImpl("https://discord.com/api/v10/users/@me/guilds", { headers }),
      ]);
      if (!userResponse.ok || !guildResponse.ok) {
        return denyLogin(pending, stateHash, "Discord identity verification failed");
      }

      const user = await userResponse.json();
      const guilds = await guildResponse.json();
      const guildId = env.AUTHORIZED_GUILD_ID || "";
      const membership = Array.isArray(guilds)
        ? guilds.find((guild) => String(guild.id) === String(guildId))
        : null;
      if (!user?.id || !/^\d{15,22}$/.test(guildId) || !isAdmin(membership)) {
        return denyLogin(pending, stateHash, "Discord account must be an owner or administrator of this server");
      }

      const authorizationCode = random(32);
      await store.consumeLoginRequestAndCreateCode({
        stateHash,
        authorizationCodeHash: await hash(authorizationCode),
        userId: String(user.id),
        guildId: String(guildId),
      });

      const redirect = new URL(pending.redirect_uri);
      redirect.searchParams.set("code", authorizationCode);
      if (pending.client_state !== null && pending.client_state !== undefined) {
        redirect.searchParams.set("state", String(pending.client_state));
      }
      return new Response(null, {
        status: 302,
        headers: { location: redirect.toString(), "cache-control": "no-store" },
      });
    } catch (error) {
      if (error instanceof OAuthStoreError && error.code === "invalid_state") {
        return oauthError("invalid_state");
      }
      return denyLogin(pending, stateHash, "OAuth callback failed");
    }
  }

  async function token(request) {
    try {
      const form = new URLSearchParams(await request.text());
      const grantType = form.get("grant_type") || "";
      const clientId = form.get("client_id") || "";
      if (grantType === "authorization_code") {
        const code = form.get("code") || "";
        const redirectUri = form.get("redirect_uri") || "";
        const verifier = form.get("code_verifier") || "";
        if (!code || !clientId || !redirectUri ||
            verifier.length < 43 || verifier.length > 128) {
          return oauthError("invalid_grant");
        }
        const accessToken = random(32);
        const refreshToken = random(48);
        const context = await store.exchangeAuthorizationCode({
          codeHash: await hash(code),
          clientId,
          redirectUri,
          codeChallenge: await pkce(verifier),
          resource: form.get("resource") || "",
          accessTokenHash: await hash(accessToken),
          refreshTokenHash: await hash(refreshToken),
        });
        return jsonResponse({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: expiresIn(context.accessExpiresAt, now()),
          refresh_token: refreshToken,
          scope: context.scope,
          resource: context.resource,
        });
      }

      if (grantType === "refresh_token") {
        const oldRefresh = form.get("refresh_token") || "";
        if (!oldRefresh || !clientId) return oauthError("invalid_grant");
        const accessToken = random(32);
        const refreshToken = random(48);
        const context = await store.rotateRefreshToken({
          oldRefreshTokenHash: await hash(oldRefresh),
          clientId,
          resource: form.get("resource") || "",
          accessTokenHash: await hash(accessToken),
          newRefreshTokenHash: await hash(refreshToken),
        });
        return jsonResponse({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: expiresIn(context.accessExpiresAt, now()),
          refresh_token: refreshToken,
          scope: context.scope,
          resource: context.resource,
        });
      }
      return oauthError("unsupported_grant_type");
    } catch (error) {
      if (error instanceof OAuthStoreError &&
          ["invalid_grant", "invalid_target"].includes(error.code)) {
        return oauthError(error.code);
      }
      return oauthError("invalid_grant");
    }
  }

  async function revoke(request) {
    try {
      const form = new URLSearchParams(await request.text());
      const tokenValue = form.get("token") || "";
      const clientId = form.get("client_id") || "";
      if (tokenValue) await store.revokeToken(await hash(tokenValue), clientId);
      return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
    } catch {
      return oauthError("server_error", 503);
    }
  }

  async function dispatch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const known = path.startsWith("/.well-known/") || path === "/register" || path.startsWith("/oauth/");
    if (!known) return null;
    if (!enabled()) return oauthError("oauth_not_enabled", 404);

    if (path === "/oauth/health" && request.method === "GET") {
      try {
        if (typeof store.health !== "function") throw new Error("health_unavailable");
        const health = await store.health();
        const ready = health.ready === true;
        return jsonResponse({
          status: ready ? "ready" : "degraded",
          storage: "d1",
          tablesReady: ready,
          tables: health.tables,
          discordProviderConfigured: !!env.DISCORD_OAUTH_CLIENT_ID && !!env.DISCORD_OAUTH_CLIENT_SECRET,
          discordRedirectConfigured: !!env.DISCORD_OAUTH_REDIRECT_URI,
          authorizedGuildConfigured: /^\d{15,22}$/.test(env.AUTHORIZED_GUILD_ID || ""),
          resource: resource(),
        }, ready ? 200 : 503);
      } catch {
        return jsonResponse({ status: "degraded", storage: "d1", tablesReady: false, reason: "storage_unavailable" }, 503);
      }
    }

    if (path === "/.well-known/oauth-protected-resource" && request.method === "GET") {
      try {
        return jsonResponse({
          resource: resource(),
          authorization_servers: [issuer()],
          bearer_methods_supported: ["header"],
          scopes_supported: ["mcp:read", "mcp:write"],
        });
      } catch {
        return oauthError("oauth_configuration_error", 503);
      }
    }

    if (path === "/.well-known/oauth-authorization-server" && request.method === "GET") {
      try {
        const authority = issuer();
        return jsonResponse({
          issuer: authority,
          authorization_endpoint: authority + "/oauth/authorize",
          token_endpoint: authority + "/oauth/token",
          registration_endpoint: authority + "/register",
          revocation_endpoint: authority + "/oauth/revoke",
          response_types_supported: ["code"],
          response_modes_supported: ["query"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["mcp:read", "mcp:write"],
          resource_parameter_supported: true,
          client_id_metadata_document_supported: false,
        });
      } catch {
        return oauthError("oauth_configuration_error", 503);
      }
    }

    if (path === "/register" && request.method === "POST") return register(request);
    if (path === "/oauth/authorize" && request.method === "GET") return authorize(url);
    if (path === "/oauth/callback" && request.method === "GET") return callback(url);
    if (path === "/oauth/token" && request.method === "POST") return token(request);
    if (path === "/oauth/revoke" && request.method === "POST") return revoke(request);
    return oauthError("not_found", 404);
  }

  async function authenticate(tokenValue) {
    if (!enabled() || !tokenValue) return null;
    return store.authenticateAccessToken(
      await hash(tokenValue),
      resource(),
      env.AUTHORIZED_GUILD_ID || "",
    );
  }

  return { dispatch, authenticate };
}
