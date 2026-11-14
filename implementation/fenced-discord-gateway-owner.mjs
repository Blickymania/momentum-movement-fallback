import { startGatewayOwner } from "./gateway-owner-supervisor.mjs";
import { createCloudflareGatewayLeaseStore } from "./cloudflare-gateway-lease-client.mjs";
import { installGatewayOwnershipGuards } from "./discord-gateway-ownership-guards.mjs";
import { GATEWAY_LEASE_SCOPE } from "../cloudflare/gateway-lease-coordinator.mjs";

function requiredText(value, name) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200) {
    throw new TypeError(name + "_invalid");
  }
  return value.trim();
}

// Call immediately after constructing the Discord Client and BEFORE registering
// any application listeners. Register listeners after preparation; the returned
// ownership guard wraps each listener and all REST/fetch egress.
export function prepareFencedDiscordGatewayOwner({
  client,
  botToken,
  deploymentId,
  ownerId,
  leaseCoordinatorUrl,
  leaseServiceToken,
  ttlSeconds = 30,
  heartbeatIntervalMs = 10000,
  renewTimeoutMs = 7000,
  fetchFn = globalThis.fetch,
  fetchTarget = globalThis,
  onLeaseLost
}) {
  if (!client || typeof client.login !== "function" || typeof client.destroy !== "function") {
    throw new TypeError("discord_client_login_and_destroy_required");
  }
  if (typeof botToken !== "string" || botToken.length < 20) {
    throw new TypeError("discord_bot_token_missing");
  }

  const deployment = requiredText(deploymentId, "deployment_id");
  const processOwner = requiredText(
    ownerId || deployment + ":" + globalThis.crypto.randomUUID(),
    "owner_id"
  );

  // Create the remote store before wrapping global fetch so the client captures
  // its dedicated lease transport. The guard exempts only this public HTTPS origin.
  const leaseStore = createCloudflareGatewayLeaseStore({
    baseUrl: leaseCoordinatorUrl,
    serviceToken: leaseServiceToken,
    fetchFn
  });
  const guards = installGatewayOwnershipGuards({
    client,
    leaseCoordinatorUrl,
    fetchTarget
  });

  let supervisor = null;
  let starting = false;
  let closed = false;

  return Object.freeze({
    guards,
    ownerId: processOwner,
    scope: GATEWAY_LEASE_SCOPE,

    async start() {
      if (starting || supervisor || closed) {
        throw new Error("gateway_owner_start_state_invalid");
      }
      starting = true;
      try {
        supervisor = await startGatewayOwner({
          leaseStore,
          scope: GATEWAY_LEASE_SCOPE,
          ownerId: processOwner,
          deploymentId: deployment,
          ttlSeconds,
          heartbeatIntervalMs,
          renewTimeoutMs,
          loginGateway: async ({ assertOwned }) => {
            guards.setAssertOwned(assertOwned);
            await client.login(botToken);
          },
          destroyGateway: async () => {
            guards.revoke();
            await client.destroy();
          },
          onLeaseLost
        });
        if (!supervisor.ok) {
          guards.revoke();
          closed = true;
        }
        return supervisor;
      } catch (error) {
        guards.revoke();
        closed = true;
        throw error;
      } finally {
        starting = false;
      }
    },

    async shutdown(reason = "graceful_shutdown") {
      if (closed && !supervisor) return { released: false, alreadyStopped: true };
      closed = true;
      if (!supervisor?.ok) {
        guards.revoke();
        return { released: false, alreadyStopped: false };
      }
      const result = await supervisor.shutdown(reason);
      guards.revoke();
      return result;
    },

    get ready() {
      return Boolean(supervisor?.ready) && !closed;
    },
    get leaseLost() {
      return Boolean(supervisor?.leaseLost);
    },
    get lostReason() {
      return supervisor?.lostReason || null;
    }
  });
}
