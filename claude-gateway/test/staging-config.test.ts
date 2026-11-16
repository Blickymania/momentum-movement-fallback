/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type WranglerConfig = {
  name: string;
  workers_dev?: boolean;
  keep_vars?: boolean;
  preview_urls?: boolean;
  vars?: Record<string, string>;
  services?: Array<{ binding: string; service: string }>;
  kv_namespaces?: Array<{ binding: string; id: string }>;
  durable_objects?: { bindings?: Array<{ name: string; class_name: string }> };
  routes?: unknown[];
};

function readConfig(path: string): WranglerConfig {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as WranglerConfig;
}

// Shared gateway bindings remain defined for the five-server architecture.
// This execution scope reads only the Dawn Dotta manager config; the other four
// manager projects remain locked and must not be deployed in this cycle.
const managerBindings = [
  { key: "empress", binding: "MANAGER_EMPRESS" },
  { key: "blickymania", binding: "MANAGER_BLICKYMANIA" },
  { key: "bestyouevahad", binding: "MANAGER_BESTYOUEVAHAD" },
  { key: "red-kocaine", binding: "MANAGER_RED_KOCAINE" },
  { key: "dawn-dotta", binding: "MANAGER_DAWN_DOTTA" }
] as const;

describe("staging Wrangler configuration", () => {
  it("keeps the authorized Dawn Dotta manager private and preserves dashboard variables", () => {
    const config = readConfig("../manager-worker/wrangler.dawn-dotta.jsonc");
    expect(config.name).toBe("manager-dawn-dotta-staging");
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.keep_vars).toBe(true);
    expect(config.vars).toBeUndefined();
    expect(config.services ?? []).toHaveLength(0);
    expect(config.routes ?? []).toHaveLength(0);
    expect(JSON.stringify(config)).not.toMatch(/DISCORD_BOT_TOKEN|MANAGER_WRITE_SECRET/);
  });

  it("binds the shared resource Worker to auth and the five isolated manager service names", () => {
    const resource = readConfig("../wrangler.jsonc");
    const services = resource.services ?? [];
    expect(resource.name).toBe("discord-claude-gateway-staging");
    expect(resource.workers_dev).toBe(false);
    expect(resource.preview_urls).toBe(false);
    expect(resource.keep_vars).toBe(true);
    expect(resource.vars).toBeUndefined();
    expect(services).toHaveLength(6);
    expect(services).toContainEqual({
      binding: "AUTH_SERVER",
      service: "discord-claude-auth-staging"
    });
    for (const manager of managerBindings) {
      expect(services).toContainEqual({
        binding: manager.binding,
        service: `manager-${manager.key}-staging`
      });
    }
    expect(new Set(services.map((service) => service.service)).size).toBe(6);
    expect(resource.durable_objects?.bindings).toContainEqual({
      name: "WRITE_PROPOSAL_STORE",
      class_name: "WriteProposalStore"
    });
  });

  it("declares the auth Worker gateway binding, dedicated KV placeholder, and no embedded secrets", () => {
    const auth = readConfig("../auth-worker/wrangler.jsonc");
    expect(auth.name).toBe("discord-claude-auth-staging");
    expect(auth.workers_dev).toBe(false);
    expect(auth.preview_urls).toBe(false);
    expect(auth.keep_vars).toBe(true);
    expect(auth.vars).toBeUndefined();
    expect(auth.services).toContainEqual({
      binding: "GATEWAY_SERVER",
      service: "discord-claude-gateway-staging"
    });
    expect(auth.kv_namespaces).toContainEqual({ binding: "OAUTH_KV", id: "" });
    expect(auth.durable_objects?.bindings).toContainEqual({
      name: "OAUTH_ONE_TIME_STORE",
      class_name: "OAuthOneTimeStore"
    });
    expect(JSON.stringify(auth)).not.toMatch(/DISCORD_CLIENT_SECRET|AUTH_SESSION_ENCRYPTION_KEY|OWNER_APPROVAL_INTERNAL_SECRET/);
  });
});
