import { describe, expect, it } from "vitest";
import {
  assertGuildAccess,
  isAdministrator,
  validateProposedAction,
  type ActionPolicyContext
} from "../src/policy";

const guildId = "1565048205970767992";
const channelId = "1565048207178862762";
const context: ActionPolicyContext = {
  guildId,
  knownRoleIds: [guildId, "1565407676580499616", "1565304619838742598"],
  managedRoleIds: ["1565304619838742598"],
  protectedRoleIds: ["1565407676580499616"],
  botUserIds: ["1565304619838742598"]
};

describe("guild authorization", () => {
  it("allows a verified administrator to read the configured guild", () => {
    expect(() => assertGuildAccess({
      serverKey: "dawn-dotta",
      configuredGuildId: guildId,
      requestedGuildId: guildId,
      allowedGuildIds: [guildId],
      userIsOwner: false,
      discordPermissions: "8",
      scopes: ["mcp:read"],
      mode: "read",
      stagingWritesEnabled: false
    })).not.toThrow();
  });

  it("rejects a cross-guild request", () => {
    expect(() => assertGuildAccess({
      serverKey: "dawn-dotta",
      configuredGuildId: guildId,
      requestedGuildId: "1440913253118115882",
      allowedGuildIds: [guildId, "1440913253118115882"],
      userIsOwner: true,
      discordPermissions: "0",
      scopes: ["mcp:read"],
      mode: "read",
      stagingWritesEnabled: false
    })).toThrow(/fixed guild/);
  });

  it("rejects a user without owner or Administrator status", () => {
    expect(() => assertGuildAccess({
      serverKey: "dawn-dotta",
      configuredGuildId: guildId,
      requestedGuildId: guildId,
      allowedGuildIds: [guildId],
      userIsOwner: false,
      discordPermissions: "1024",
      scopes: ["mcp:read"],
      mode: "read",
      stagingWritesEnabled: false
    })).toThrow(/Administrator/);
  });

  it("requires both write scope and the staging write gate", () => {
    const base = {
      serverKey: "dawn-dotta",
      configuredGuildId: guildId,
      requestedGuildId: guildId,
      allowedGuildIds: [guildId],
      userIsOwner: true,
      discordPermissions: "0",
      scopes: ["mcp:read", "mcp:write"],
      mode: "write" as const,
      stagingWritesEnabled: false
    };
    expect(() => assertGuildAccess(base)).toThrow(/disabled/);
    expect(() => assertGuildAccess({ ...base, stagingWritesEnabled: true, scopes: ["mcp:read"] })).toThrow(/mcp:write/);
  });

  it("parses Discord Administrator permission as a bitfield", () => {
    expect(isAdministrator("8")).toBe(true);
    expect(isAdministrator("0")).toBe(false);
    expect(isAdministrator("not-a-bitfield")).toBe(false);
  });
});

describe("typed write policy", () => {
  it("allows a safe channel topic update", () => {
    expect(validateProposedAction({
      type: "channel.update",
      channelId,
      patch: { topic: "Updated topic" }
    }, context)).toEqual({
      type: "channel.update",
      channelId,
      patch: { topic: "Updated topic" }
    });
  });

  it("blocks role mutations and destructive operations", () => {
    for (const type of ["role.update", "role.create", "role.delete", "channel.delete", "category.delete"]) {
      expect(() => validateProposedAction({ type, roleId: "1565407676580499616" }, context)).toThrow(/not supported/);
    }
  });

  it("blocks permission changes targeting protected or managed bot roles", () => {
    for (const targetId of ["1565407676580499616", "1565304619838742598"]) {
      expect(() => validateProposedAction({
        type: "channel.permission.set",
        channelId,
        targetType: "role",
        targetId,
        allow: "1024",
        deny: "0"
      }, context)).toThrow(/protected/);
    }
  });

  it("blocks permission changes targeting bot members", () => {
    expect(() => validateProposedAction({
      type: "channel.permission.set",
      channelId,
      targetType: "member",
      targetId: "1565304619838742598",
      allow: "1024",
      deny: "0"
    }, context)).toThrow(/Bot member/);
  });

  it("blocks @everyone and @here mass mentions", () => {
    for (const content of ["Hello @everyone", "Emergency @here"]) {
      expect(() => validateProposedAction({
        type: "message.send",
        channelId,
        content
      }, context)).toThrow(/Mass mentions/);
    }
  });

  it("rejects unknown channel patch fields such as parent and position", () => {
    expect(() => validateProposedAction({
      type: "channel.update",
      channelId,
      patch: { position: 1 }
    }, context)).toThrow(/protected or unsupported/);
  });
});
