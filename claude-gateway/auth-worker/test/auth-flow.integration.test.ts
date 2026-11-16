/// <reference types="@cloudflare/vitest-plugin/types" />
import { createExecutionContext } from "cloudflare:test";
import { env as cloudflareEnv } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import AuthServer, { type AuthWorkerEnv } from "../src/index";
import { network } from "./network";

const USER_ID = "100000000000000001";
const EMPRESS_GUILD = "100000000000000011";
const BLICKY_GUILD = "100000000000000012";
const DAWN_GUILD = "100000000000000013";
const NOT_CONFIGURED_GUILD = "100000000000000014";
const REDIRECT_URI = "https://client.test/callback";
const RESOURCE = "https://mcp.test/mcp";

function createAuth(env = cloudflareEnv as unknown as AuthWorkerEnv) {
  return new AuthServer(createExecutionContext(), env);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function pkce() {
  const verifier = "test-verifier-with-more-than-forty-three-characters-0123456789";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

async function registerClient(auth: AuthServer): Promise<string> {
  const response = await auth.fetch(new Request("https://auth.test/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Gateway Integration Test",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  }));
  expect(response.status, await response.clone().text()).toBe(201);
  const client = await response.json() as { client_id: string };
  expect(client.client_id).toBeTruthy();
  return client.client_id;
}

async function authorizeDiscordAndExchange(auth: AuthServer, clientId: string, clientState: string): Promise<{ accessToken: string; refreshToken: string; scope: string }> {
  const { verifier, challenge } = await pkce();
  const authorizeUrl = new URL("https://auth.test/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "mcp:read offline_access");
  authorizeUrl.searchParams.set("resource", RESOURCE);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", clientState);

  const start = await auth.fetch(new Request(authorizeUrl));
  expect(start.status).toBe(302);
  const discordUrl = new URL(start.headers.get("location") ?? "");
  const discordState = discordUrl.searchParams.get("state");
  expect(discordState).toBeTruthy();
  const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0];

  const callbackUrl = new URL("https://auth.test/discord/callback");
  callbackUrl.searchParams.set("code", `discord-code-${clientState}`);
  callbackUrl.searchParams.set("state", discordState!);
  const callback = await auth.fetch(new Request(callbackUrl, { headers: { cookie } }));
  expect(callback.status).toBe(200);
  const html = await callback.text();
  const handle = html.match(/name="handle" value="([0-9a-f-]{36})"/)?.[1];
  expect(handle).toBeTruthy();

  const consent = await auth.fetch(new Request("https://auth.test/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle: handle!, decision: "approve" })
  }));
  expect(consent.status).toBe(302);
  const redirect = new URL(consent.headers.get("location") ?? "");
  expect(redirect.searchParams.get("state")).toBe(clientState);
  const code = redirect.searchParams.get("code");
  expect(code).toBeTruthy();

  const tokenResponse = await auth.fetch(new Request("https://auth.test/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier
    })
  }));
  expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
  const issued = await tokenResponse.json() as { access_token: string; refresh_token?: string; scope: string };
  expect(issued.access_token).toBeTruthy();
  expect(issued.refresh_token).toBeTruthy();
  expect(issued.scope).toContain("mcp:read");
  expect(issued.scope).toContain("offline_access");
  expect(issued.scope).not.toContain("mcp:write");
  return { accessToken: issued.access_token, refreshToken: issued.refresh_token!, scope: issued.scope };
}

describe("OAuth authorization Worker end-to-end", () => {
  it("binds browser state, filters guilds, consumes consent once, and issues a read-only grant", async () => {
    const auth = createAuth();
    const clientId = await registerClient(auth);
    const { verifier, challenge } = await pkce();

    network.use(
      http.post("https://discord.com/api/v10/oauth2/token", () => HttpResponse.json({
        access_token: "discord-access-test-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "discord-refresh-test-token",
        scope: "identify guilds"
      })),
      http.get("https://discord.com/api/v10/users/@me", () => HttpResponse.json({
        id: USER_ID,
        username: "integration-user",
        global_name: "Integration User"
      })),
      http.get("https://discord.com/api/v10/users/@me/guilds", () => HttpResponse.json([
        { id: EMPRESS_GUILD, name: "Empress Reigns", owner: true, permissions: "0" },
        { id: BLICKY_GUILD, name: "Blickymania", owner: false, permissions: "8" },
        { id: DAWN_GUILD, name: "Dawn Dotta", owner: false, permissions: "0" },
        { id: NOT_CONFIGURED_GUILD, name: "Unconfigured Admin", owner: true, permissions: "8" }
      ]))
    );

    const authorizeUrl = new URL("https://auth.test/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "mcp:read");
    authorizeUrl.searchParams.set("resource", RESOURCE);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", "client-state-123");

    const start = await auth.fetch(new Request(authorizeUrl));
    expect(start.status).toBe(302);
    const discordUrl = new URL(start.headers.get("location") ?? "");
    expect(discordUrl.origin).toBe("https://discord.com");
    const state = discordUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toContain(state);

    const callbackUrl = new URL("https://auth.test/discord/callback");
    callbackUrl.searchParams.set("code", "mock-discord-code");
    callbackUrl.searchParams.set("state", state!);

    const wrongBrowser = await auth.fetch(new Request(callbackUrl, {
      headers: { cookie: cookie.replace(state!, "wrong-state") }
    }));
    expect(wrongBrowser.status).toBe(400);
    expect(await wrongBrowser.text()).toContain("does not match");

    const callback = await auth.fetch(new Request(callbackUrl, { headers: { cookie } }));
    expect(callback.status).toBe(200);
    const html = await callback.text();
    expect(html).toContain("Empress Reigns");
    expect(html).toContain("Blickymania");
    expect(html).not.toContain("Dawn Dotta");
    expect(html).not.toContain("Unconfigured Admin");

    const replayLogin = await auth.fetch(new Request(callbackUrl, { headers: { cookie } }));
    expect(replayLogin.status).toBe(400);
    expect(await replayLogin.text()).toContain("already used");

    const handle = html.match(/name="handle" value="([0-9a-f-]{36})"/)?.[1];
    expect(handle).toBeTruthy();
    const consent = await auth.fetch(new Request("https://auth.test/consent", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle: handle!, decision: "approve" })
    }));
    expect(consent.status).toBe(302);
    const redirect = new URL(consent.headers.get("location") ?? "");
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get("state")).toBe("client-state-123");
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const replayConsent = await auth.fetch(new Request("https://auth.test/consent", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle: handle!, decision: "approve" })
    }));
    expect(replayConsent.status).toBe(400);
    expect(await replayConsent.text()).toContain("already used");

    const tokenResponse = await auth.fetch(new Request("https://auth.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier
      })
    }));
    expect(tokenResponse.status).toBe(200);
    const issued = await tokenResponse.json() as { access_token: string; scope: string };
    expect(issued.access_token).toBeTruthy();
    expect(issued.scope).toContain("mcp:read");
    expect(issued.scope).not.toContain("mcp:write");

    network.use(
      http.get("https://discord.com/api/v10/users/@me", () => new HttpResponse(null, { status: 401 })),
      http.get("https://discord.com/api/v10/users/@me/guilds", () => new HttpResponse(null, { status: 401 }))
    );
    const expiredDiscordToken = await auth.checkGuildAccess(USER_ID, EMPRESS_GUILD, "expired-discord-token");
    expect(expiredDiscordToken.isMember).toBe(false);
    expect(expiredDiscordToken.isOwner).toBe(false);
  });

  it("reconnects through a fresh Discord authorization after the previous Discord credential expires", async () => {
    const auth = createAuth();
    const clientId = await registerClient(auth);
    let discordExchangeCount = 0;
    let oldCredentialExpired = false;
    const guilds = [
      { id: EMPRESS_GUILD, name: "Empress Reigns", owner: true, permissions: "0" },
      { id: BLICKY_GUILD, name: "Blickymania", owner: false, permissions: "8" }
    ];

    network.use(
      http.post("https://discord.com/api/v10/oauth2/token", () => {
        discordExchangeCount += 1;
        return HttpResponse.json({
          access_token: discordExchangeCount === 1 ? "discord-access-old" : "discord-access-fresh",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: `discord-refresh-unused-${discordExchangeCount}`,
          scope: "identify guilds"
        });
      }),
      http.get("https://discord.com/api/v10/users/@me", ({ request }) => {
        if (oldCredentialExpired && request.headers.get("authorization") === "Bearer discord-access-old") {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json({ id: USER_ID, username: "reconnect-user" });
      }),
      http.get("https://discord.com/api/v10/users/@me/guilds", ({ request }) => {
        if (oldCredentialExpired && request.headers.get("authorization") === "Bearer discord-access-old") {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json(guilds);
      })
    );

    const firstMcpToken = await authorizeDiscordAndExchange(auth, clientId, "reconnect-state-one");
    const firstGrant = await auth.validateToken(RESOURCE, firstMcpToken.accessToken);
    expect(firstGrant?.props.discordAccessToken).toBe("discord-access-old");
    const initialAccess = await auth.checkGuildAccess(USER_ID, EMPRESS_GUILD, firstGrant!.props.discordAccessToken);
    expect(initialAccess.isMember).toBe(true);

    oldCredentialExpired = true;
    const expiredCheck = await auth.checkGuildAccess(USER_ID, EMPRESS_GUILD, firstGrant!.props.discordAccessToken);
    expect(expiredCheck.isMember).toBe(false);
    expect(expiredCheck.isOwner).toBe(false);

    const secondMcpToken = await authorizeDiscordAndExchange(auth, clientId, "reconnect-state-two");
    const secondGrant = await auth.validateToken(RESOURCE, secondMcpToken.accessToken);
    expect(secondGrant?.props.discordAccessToken).toBe("discord-access-fresh");
    const restoredAccess = await auth.checkGuildAccess(USER_ID, EMPRESS_GUILD, secondGrant!.props.discordAccessToken);
    expect(restoredAccess.isMember).toBe(true);
    expect(restoredAccess.isOwner).toBe(true);
    expect(discordExchangeCount).toBe(2);
  });

  it("refreshes the MCP OAuth grant while preserving the linked Discord credential and scope", async () => {
    const auth = createAuth();
    const clientId = await registerClient(auth);
    network.use(
      http.post("https://discord.com/api/v10/oauth2/token", () => HttpResponse.json({
        access_token: "discord-access-refresh-test",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "discord-refresh-not-persisted",
        scope: "identify guilds"
      })),
      http.get("https://discord.com/api/v10/users/@me", () => HttpResponse.json({
        id: USER_ID,
        username: "refresh-test-user"
      })),
      http.get("https://discord.com/api/v10/users/@me/guilds", () => HttpResponse.json([
        { id: EMPRESS_GUILD, name: "Empress Reigns", owner: true, permissions: "0" }
      ]))
    );

    const issued = await authorizeDiscordAndExchange(auth, clientId, "mcp-refresh-state");
    expect(issued.scope).toContain("offline_access");
    const originalGrant = await auth.validateToken(RESOURCE, issued.accessToken);
    expect(originalGrant?.props.discordAccessToken).toBe("discord-access-refresh-test");

    const refreshResponse = await auth.fetch(new Request("https://auth.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: issued.refreshToken,
        client_id: clientId
      })
    }));
    expect(refreshResponse.status, await refreshResponse.clone().text()).toBe(200);
    const refreshed = await refreshResponse.json() as { access_token: string; scope: string };
    expect(refreshed.access_token).toBeTruthy();
    expect(refreshed.scope).toContain("mcp:read");
    expect(refreshed.scope).toContain("offline_access");

    const refreshedGrant = await auth.validateToken(RESOURCE, refreshed.access_token);
    expect(refreshedGrant?.props.discordAccessToken).toBe("discord-access-refresh-test");
    expect(refreshedGrant?.props.discordTokenExpiresAt).toBe(originalGrant?.props.discordTokenExpiresAt);
  });

  it("supports Claude's current and future remote MCP OAuth callback URLs through DCR", async () => {
    const auth = createAuth();
    const redirectUris = [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback"
    ];
    const response = await auth.fetch(new Request("https://auth.test/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      })
    }));
    expect(response.status, await response.clone().text()).toBe(201);
    const registered = await response.json() as { client_id: string; client_name: string; redirect_uris: string[] };
    expect(registered.client_id).toBeTruthy();
    expect(registered.client_name).toBe("Claude");
    expect(registered.redirect_uris).toEqual(redirectUris);
  });

  it("fails closed when the authorization environment is incomplete", async () => {
    const auth = createAuth({} as AuthWorkerEnv);
    const response = await auth.fetch(new Request("https://auth.test/authorize"));
    expect(response.status).toBe(503);
  });
});
