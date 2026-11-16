import {
  AuthorizationError,
  authorizationErrorRedirect,
  OAuthAuthorizationServer,
  type AuthRequest
} from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { OAuthOneTimeStore } from "./one-time-store";
import { checkGuildAccessForToken, discordStateCookieName, hasMatchingDiscordOAuthStateCookie } from "./discord-auth";
export { OAuthOneTimeStore } from "./one-time-store";
export { checkGuildAccessForToken, discordStateCookieName, hasMatchingDiscordOAuthStateCookie } from "./discord-auth";

export interface AuthWorkerEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_ONE_TIME_STORE: DurableObjectNamespace<OAuthOneTimeStore>;
  OAUTH_ISSUER_URL: string;
  MCP_RESOURCE_URL: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_REDIRECT_URI: string;
  AUTH_SESSION_ENCRYPTION_KEY: string;
  GUILD_ID_EMPRESS?: string;
  GUILD_ID_BLICKYMANIA?: string;
  GUILD_ID_BESTYOUEVAHAD?: string;
  GUILD_ID_RED_KOCAINE?: string;
  GUILD_ID_DAWN_DOTTA?: string;
}

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

interface DiscordGuild {
  id: string;
  name: string;
  owner?: boolean;
  permissions?: string;
}

interface LoginState {
  authorizationUrl: string;
  createdAt: number;
}

interface ConsentPayload {
  authorizationUrl: string;
  user: DiscordUser;
  discordAccessToken: string;
  discordTokenExpiresAt: number;
  authorizedGuildIds: string[];
  authorizedGuildNames: string[];
  clientName: string;
}

const SCOPES = ["mcp:read", "offline_access"];
const DISCORD_API = "https://discord.com/api/v10";
const LOGIN_TTL_SECONDS = 600;
const CONSENT_TTL_SECONDS = 300;
const SNOWFLAKE = /^\d{15,22}$/;

function oneTimeStoreFor(env: AuthWorkerEnv, name: string) {
  const id = env.OAUTH_ONE_TIME_STORE.idFromName(name);
  return env.OAUTH_ONE_TIME_STORE.get(id);
}

function getAuthorizationServer(env: AuthWorkerEnv) {
  if (!env.OAUTH_ISSUER_URL || !env.MCP_RESOURCE_URL) {
    throw new Error("OAuth issuer and MCP resource URLs must be configured.");
  }
  return new OAuthAuthorizationServer<AuthWorkerEnv>({
    issuer: env.OAUTH_ISSUER_URL,
    resources: [env.MCP_RESOURCE_URL],
    scopesSupported: SCOPES,
    clientRegistrationEndpoint: "/oauth/register"
  });
}

function configuredGuildIds(env: AuthWorkerEnv): string[] {
  return [
    env.GUILD_ID_EMPRESS,
    env.GUILD_ID_BLICKYMANIA,
    env.GUILD_ID_BESTYOUEVAHAD,
    env.GUILD_ID_RED_KOCAINE,
    env.GUILD_ID_DAWN_DOTTA
  ].filter((value): value is string => typeof value === "string" && SNOWFLAKE.test(value));
}

function isAdministrator(permissions: string): boolean {
  try {
    return (BigInt(permissions) & 8n) === 8n;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(env: AuthWorkerEnv, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = fromBase64(env.AUTH_SESSION_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("Session encryption key must be 32 bytes.");
  const rawBuffer = new ArrayBuffer(raw.byteLength);
  new Uint8Array(rawBuffer).set(raw);
  return crypto.subtle.importKey("raw", rawBuffer, { name: "AES-GCM" }, false, usage);
}

async function seal(env: AuthWorkerEnv, value: ConsentPayload): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env, ["encrypt"]);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const packed = new Uint8Array(iv.byteLength + encrypted.byteLength);
  packed.set(iv, 0);
  packed.set(encrypted, iv.byteLength);
  return base64(packed);
}

async function unseal(env: AuthWorkerEnv, value: string): Promise<ConsentPayload> {
  const packed = fromBase64(value);
  if (packed.byteLength < 29) throw new Error("Invalid encrypted consent record.");
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const key = await encryptionKey(env, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as ConsentPayload;
}

async function discordJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, redirect: "error" });
  if (!response.ok) throw new Error(`Discord OAuth request failed with HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

async function beginDiscordLogin(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const oauth = getAuthorizationServer(env).getOAuthApi(env);
  let authRequest: AuthRequest;
  try {
    authRequest = await oauth.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.redirectTo) return Response.redirect(error.redirectTo, 302);
      return new Response(error.description, { status: 400 });
    }
    throw error;
  }

  const state = crypto.randomUUID();
  const stateRecord: LoginState = { authorizationUrl: request.url, createdAt: Date.now() };
  await oneTimeStoreFor(env, `discord-login:${state}`).put(
    JSON.stringify(stateRecord),
    LOGIN_TTL_SECONDS
  );

  const discordUrl = new URL("https://discord.com/oauth2/authorize");
  discordUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  discordUrl.searchParams.set("redirect_uri", env.DISCORD_REDIRECT_URI);
  discordUrl.searchParams.set("response_type", "code");
  discordUrl.searchParams.set("scope", "identify guilds");
  discordUrl.searchParams.set("state", state);
  discordUrl.searchParams.set("prompt", "consent");

  // The original MCP authorization request is persisted server-side; only a random state leaves this Worker.
  void authRequest;
  const cookieName = discordStateCookieName(state);
  return new Response(null, {
    status: 302,
    headers: {
      location: discordUrl.toString(),
      "set-cookie": `${cookieName}=${state}; Path=/; Max-Age=${LOGIN_TTL_SECONDS}; Secure; HttpOnly; SameSite=Lax`,
      "cache-control": "no-store"
    }
  });
}

async function finishDiscordLogin(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code) return new Response("Missing Discord OAuth state or code.", { status: 400 });
  if (!hasMatchingDiscordOAuthStateCookie(request, state)) {
    return new Response("Discord OAuth state does not match this browser session.", { status: 400 });
  }

  const stateText = await oneTimeStoreFor(env, `discord-login:${state}`).consume();
  if (!stateText) return new Response("Discord login state expired or was already used.", { status: 400 });

  const loginState = JSON.parse(stateText) as LoginState;
  if (Date.now() - loginState.createdAt > LOGIN_TTL_SECONDS * 1000) {
    return new Response("Discord login state expired.", { status: 400 });
  }

  const token = await discordJson<DiscordTokenResponse>(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: env.DISCORD_REDIRECT_URI
    })
  });

  const [user, guilds] = await Promise.all([
    discordJson<DiscordUser>(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${token.access_token}` }
    }),
    discordJson<DiscordGuild[]>(`${DISCORD_API}/users/@me/guilds`, {
      headers: { authorization: `Bearer ${token.access_token}` }
    })
  ]);

  const configured = new Set(configuredGuildIds(env));
  const authorizedGuilds = guilds.filter(
    (guild) => configured.has(guild.id) && (guild.owner === true || isAdministrator(guild.permissions ?? "0"))
  );
  const authorizedGuildIds = authorizedGuilds.map((guild) => guild.id);
  const authorizedGuildNames = authorizedGuilds.map((guild) => guild.name);

  if (authorizedGuildIds.length === 0) {
    return new Response("Your Discord account is not the owner of, or an Administrator in, any configured server.", {
      status: 403
    });
  }

  const oauth = getAuthorizationServer(env).getOAuthApi(env);
  const authRequest = await oauth.parseAuthRequest(new Request(loginState.authorizationUrl));
  const client = await oauth.lookupClient(authRequest.clientId);
  const clientName = client?.clientName ?? "Claude MCP Client";
  const handle = crypto.randomUUID();
  const consent: ConsentPayload = {
    authorizationUrl: loginState.authorizationUrl,
    user,
    discordAccessToken: token.access_token,
    discordTokenExpiresAt: Date.now() + token.expires_in * 1000,
    authorizedGuildIds,
    authorizedGuildNames,
    clientName
  };

  await oneTimeStoreFor(env, `discord-consent:${handle}`).put(
    await seal(env, consent),
    CONSENT_TTL_SECONDS
  );

  const displayName = escapeHtml(user.global_name || user.username);
  const safeClientName = escapeHtml(clientName);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Discord Manager</title></head><body style="font-family:system-ui;max-width:38rem;margin:3rem auto;padding:0 1rem"><h1>Connect your Discord servers</h1><p>Signed in as <strong>${displayName}</strong>.</p><p><strong>${safeClientName}</strong> is requesting read-only access to the Discord communities where your account is an owner or Administrator.</p><p>Eligible communities: ${authorizedGuildNames.map(escapeHtml).join(", ")}.</p><p>This connection cannot change roles, channel permissions, or delete resources.</p><form method="post" action="/consent"><input type="hidden" name="handle" value="${handle}"><button name="decision" value="approve" type="submit">Allow read-only access</button> <button name="decision" value="deny" type="submit">Deny</button></form><p>This approval expires in five minutes.</p></body></html>`;
  return new Response(html, { headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "set-cookie": `${discordStateCookieName(state)}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`
  } });
}

async function completeConsent(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(handle)) return new Response("Invalid consent handle.", { status: 400 });

  const encrypted = await oneTimeStoreFor(env, `discord-consent:${handle}`).consume();
  if (!encrypted) return new Response("Consent expired or was already used.", { status: 400 });

  const consent = await unseal(env, encrypted);
  if (Date.now() >= consent.discordTokenExpiresAt) {
    return new Response("Discord sign-in expired. Please reconnect.", { status: 401 });
  }

  const oauth = getAuthorizationServer(env).getOAuthApi(env);
  const authRequest = await oauth.parseAuthRequest(new Request(consent.authorizationUrl));

  if (form.get("decision") !== "approve") {
    return Response.redirect(authorizationErrorRedirect(authRequest, "access_denied"), 302);
  }

  const requestedScopes = authRequest.scope.filter((scope) => SCOPES.includes(scope));
  if (!requestedScopes.includes("mcp:read")) {
    return Response.redirect(authorizationErrorRedirect(authRequest, "invalid_scope"), 302);
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: authRequest,
    userId: consent.user.id,
    metadata: { clientName: consent.clientName },
    scope: requestedScopes,
    props: {
      userId: consent.user.id,
      discordAccessToken: consent.discordAccessToken,
      discordTokenExpiresAt: consent.discordTokenExpiresAt,
      authorizedGuildIds: consent.authorizedGuildIds
    }
  });
  return Response.redirect(redirectTo, 302);
}


export default class AuthServer extends WorkerEntrypoint<AuthWorkerEnv> {
  async fetch(request: Request): Promise<Response> {
    if (
      !this.env.OAUTH_KV ||
      !this.env.OAUTH_ONE_TIME_STORE ||
      !this.env.OAUTH_ISSUER_URL ||
      !this.env.MCP_RESOURCE_URL ||
      !this.env.DISCORD_CLIENT_ID ||
      !this.env.DISCORD_CLIENT_SECRET ||
      !this.env.DISCORD_REDIRECT_URI ||
      !this.env.AUTH_SESSION_ENCRYPTION_KEY
    ) {
      return new Response("OAuth authorization service is not configured.", { status: 503 });
    }
    const path = new URL(request.url).pathname;
    if (path === "/authorize" && request.method === "GET") return beginDiscordLogin(request, this.env);
    if (path === "/discord/callback" && request.method === "GET") return finishDiscordLogin(request, this.env);
    if (path === "/consent" && request.method === "POST") return completeConsent(request, this.env);
    if (path === "/authorize" || path === "/discord/callback" || path === "/consent") {
      return new Response("Method not allowed.", { status: 405 });
    }
    try {
      return await getAuthorizationServer(this.env).fetch(request, this.env, this.ctx);
    } catch {
      return new Response("OAuth authorization service is not configured.", { status: 503 });
    }
  }

  validateToken(resource: string, token: string) {
    return getAuthorizationServer(this.env).validateToken(resource, token, this.env);
  }

  checkGuildAccess(userId: string, guildId: string, discordAccessToken: string) {
    return checkGuildAccessForToken(userId, guildId, discordAccessToken);
  }
}
