/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type WranglerConfig = {
  name: string;
  workers_dev?: boolean;
  vars?: Record<string, string>;
  services?: Array<{ binding: string; service: string }>;
  kv_namespaces?: Array<{ binding: string; id: string }>;
  durable_objects?: { bindings?: Array<{ name: string; class_name: string }> };
  routes?: unknown[];
};

function readConfig(path: string): WranglerConfig {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as WranglerConfig;
}

const managers = [
  { key: "empress", binding: "MANAGER_EMPRESS" },
  { key: "blickymania", binding: "MANAGER_BLICKYMANIA" },
  { key: "bestyouevahad", binding: "MANAGER_BESTYOUEVAHAD" },
  { key: "red-kocaine", binding: "MANAGER_RED_KOCAINE" },
  { key: "dawn-dotta", binding: "MANAGER_DAWN_DOTTA" }
] as const;

const guildVars = [
  "GUILD_ID_EMPRESS",
  "GUILD_ID_BLICKYMANIA",
  "GUILD_ID_BESTYOUEVAHAD",
  "GUILD_ID_RED_KOCAINE",
  "GUILD_ID_DAWN_DOTTA"
] as const;

describe("staging Wrangler configuration", () => {
  it("declares five distinct private manager Workers with no public routes or embedded secrets", () => {
    for (const manager of managers) {
      const config = readConfig(`../manager-worker/wrangler.${manager.key}.jsonc`);
      expect(config.name).toBe(`manager-${manager.key}-staging`);
      expect(config.workers_dev).toBe(false);
      expect(config.vars).toMatchObject({
        DISCORD_GUILD_ID: "",
        DISCORD_APPLICATION_ID: ""
      });
      expect(config.services ?? []).toHaveLength(0);
      expect(config.routes ?? []).toHaveLength(0);
      expect(JSON.stringify(config)).not.toMatch(/DISCORD_BOT_TOKEN|MANAGER_WRITE_SECRET/);
    }
  });

  it("binds the resource Worker to the auth Worker and all five isolated manager Workers", () => {
    const resource = readConfig("../wrangler.jsonc");
    const services = resource.services ?? [];
    expect(resource.workers_dev).toBe(false);
    expect(services).toHaveLength(6);
    expect(services).toContainEqual({
      binding: "AUTH_SERVER",
      service: "discord-claude-auth-staging"
    });
    for (const manager of managers) {
      expect(services).toContainEqual({
        binding: manager.binding,
        service: `manager-${manager.key}-staging`
      });
    }
    expect(new Set(services.map((service) => service.service)).size).toBe(6);
    expect(resource.vars?.MCP_RESOURCE_URL).toBe("");
    expect(resource.vars?.OAUTH_ISSUER_URL).toBe("");
    for (const variable of guildVars) expect(resource.vars?.[variable]).toBe("");
    expect(resource.durable_objects?.bindings).toContainEqual({
      name: "WRITE_PROPOSAL_STORE",
      class_name: "WriteProposalStore"
    });
  });

  it("declares the auth Worker gateway binding, dedicated blank KV placeholder, and all five guild IDs", () => {
    const auth = readConfig("../auth-worker/wrangler.jsonc");
    expect(auth.workers_dev).toBe(false);
    expect(auth.services).toContainEqual({
      binding: "GATEWAY_SERVER",
      service: "discord-claude-gateway-staging"
    });
    expect(auth.kv_namespaces).toContainEqual({ binding: "OAUTH_KV", id: "" });
    expect(auth.vars?.OAUTH_ISSUER_URL).toBe("");
    expect(auth.vars?.MCP_RESOURCE_URL).toBe("");
    for (const variable of guildVars) expect(auth.vars?.[variable]).toBe("");
    expect(auth.durable_objects?.bindings).toContainEqual({
      name: "OAUTH_ONE_TIME_STORE",
      class_name: "OAuthOneTimeStore"
    });
    expect(JSON.stringify(auth)).not.toMatch(/DISCORD_CLIENT_SECRET|AUTH_SESSION_ENCRYPTION_KEY|OWNER_APPROVAL_INTERNAL_SECRET/);
  });
});
