import { describe, expect, it, vi } from "vitest";
import { assertCurrentGuildReadAccess, getConfiguredGuildId } from "../src/manager-access";
import type { GatewayEnv } from "../src/manager-client";

const env: GatewayEnv = {
  GUILD_ID_DAWN_DOTTA: "1565048205970767992"
};

describe("current Discord authorization checks", () => {
  it("returns the fixed guild ID for the selected independent manager", () => {
    expect(getConfiguredGuildId(env, "dawn-dotta")).toBe("1565048205970767992");
  });

  it("rejects malformed fixed guild IDs", () => {
    expect(() => getConfiguredGuildId({ GUILD_ID_DAWN_DOTTA: "not-a-snowflake" }, "dawn-dotta")).toThrow(/valid fixed guild ID/);
  });

  it("allows a current guild Administrator with read scope", async () => {
    const auth = {
      checkGuildAccess: vi.fn(async () => ({
        isMember: true,
        isOwner: false,
        permissions: "8"
      }))
    };
    await expect(assertCurrentGuildReadAccess(
      env, auth, "dawn-dotta", "222222222222222221", ["1565048205970767992"], ["mcp:read"], "test-access-token"
    )).resolves.toBeUndefined();
    expect(auth.checkGuildAccess).toHaveBeenCalledWith(
      "222222222222222221", "1565048205970767992", "test-access-token"
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
      env, auth, "dawn-dotta", "222222222222222222", ["1565048205970767992"], ["mcp:read"], "test-access-token"
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
      env, auth, "dawn-dotta", "222222222222222223", ["1565048205970767992"], ["mcp:read"], "test-access-token"
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
      env, auth, "dawn-dotta", "222222222222222224", ["1565048205970767992"], [], "test-access-token"
    )).rejects.toThrow(/mcp:read/);
  });

  it("rejects a guild that was not included in the OAuth consent grant", async () => {
    const auth = {
      checkGuildAccess: vi.fn(async () => ({
        isMember: true,
        isOwner: true,
        permissions: "8"
      }))
    };
    await expect(assertCurrentGuildReadAccess(
      env, auth, "dawn-dotta", "222222222222222226", [], ["mcp:read"], "test-access-token"
    )).rejects.toThrow(/not included in the user's approved OAuth grant/);
    expect(auth.checkGuildAccess).not.toHaveBeenCalled();
  });

  it("rejects malformed Discord user IDs before calling the authorization service", async () => {
    const auth = {
      checkGuildAccess: vi.fn(async () => ({
        isMember: true,
        isOwner: true,
        permissions: "8"
      }))
    };
    await expect(assertCurrentGuildReadAccess(
      env, auth, "dawn-dotta", "bad-user", ["1565048205970767992"], ["mcp:read"], "test-access-token"
    )).rejects.toThrow(/user ID is invalid/);
    expect(auth.checkGuildAccess).not.toHaveBeenCalled();
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
      {}, auth, "dawn-dotta", "222222222222222225", ["1565048205970767992"], ["mcp:read"], "test-access-token"
    )).rejects.toThrow(/not configured/);
    expect(auth.checkGuildAccess).not.toHaveBeenCalled();
  });
});
