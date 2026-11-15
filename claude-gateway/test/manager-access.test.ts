import { describe, expect, it, vi } from "vitest";
import { assertCurrentGuildReadAccess } from "../src/manager-access";
import type { GatewayEnv } from "../src/manager-client";

const env: GatewayEnv = {
  GUILD_ID_DAWN_DOTTA: "1565048205970767992"
};

describe("current Discord authorization checks", () => {
  it("allows a current guild Administrator with read scope", async () => {
    const auth = {
      checkGuildAccess: vi.fn(async () => ({
        isMember: true,
        isOwner: false,
        permissions: "8"
      }))
    };
    await expect(assertCurrentGuildReadAccess(
      env, auth, "dawn-dotta", "discord-user-1", ["mcp:read"]
    )).resolves.toBeUndefined();
    expect(auth.checkGuildAccess).toHaveBeenCalledWith(
      "discord-user-1", "1565048205970767992"
    );
  });

  it("rejects a user who is no longer a member", async () => {
    const auth = {
      checkGuildAccess: vi.fn(async () => ({
        isMember: false,
        isOwner: false,
        permissions: "0"
      }))
    };
    await expect(assertCurrentGuildReadAccess(
      env, auth, "dawn-dotta", "discord-user-2", ["mcp:read"]
    )).rejects.toThrow(/not been granted access/);
  });

  it("rejects a member who is not the owner or an Administrator", async () => {
    const auth = {
      checkGuildAccess: vi.fn(async () => ({
        isMember: true,
        isOwner: false,
        permissions: "1024"
      }))
    };
    await expect(assertCurrentGuildReadAccess(
      env, auth, "dawn-dotta", "discord-user-3", ["mcp:read"]
    )).rejects.toThrow(/Administrator/);
  });

  it("rejects a request without the read scope", async () => {
    const auth = {
      checkGuildAccess: vi.fn(async () => ({
        isMember: true,
        isOwner: true,
        permissions: "0"
      }))
    };
    await expect(assertCurrentGuildReadAccess(
      env, auth, "dawn-dotta", "discord-user-4", []
    )).rejects.toThrow(/mcp:read/);
  });

  it("fails closed when the guild ID is not configured", async () => {
    const auth = {
      checkGuildAccess: vi.fn(async () => ({
        isMember: true,
        isOwner: true,
        permissions: "0"
      }))
    };
    await expect(assertCurrentGuildReadAccess(
      {}, auth, "dawn-dotta", "discord-user-5", ["mcp:read"]
    )).rejects.toThrow(/not configured/);
    expect(auth.checkGuildAccess).not.toHaveBeenCalled();
  });
});
