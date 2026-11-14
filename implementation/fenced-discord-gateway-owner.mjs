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
  let applicationReady = false;
  let startPromise = null;
  const loginAbortController = new AbortController();
  const readinessWaiters = new Set();

  function settleReadiness() {
    if (supervisor?.ready && applicationReady && !closed) {
      for (const waiter of readinessWaiters) {
        clearTimeout(waiter.timer);
        readinessWaiters.delete(waiter);
        waiter.resolve(true);
      }
    }
  }

  function rejectReadiness(reason) {
    for (const waiter of readinessWaiters) {
      clearTimeout(waiter.timer);
      readinessWaiters.delete(waiter);
      waiter.reject(new Error(reason));
    }
  }

  return Object.freeze({
    guards,
    ownerId: processOwner,
    scope: GATEWAY_LEASE_SCOPE,

    async start() {
      if (starting || supervisor || closed) {
        throw new Error("gateway_owner_start_state_invalid");
      }
      starting = true;
      const run = (async () => {
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
            const signal = loginAbortController.signal;
            if (signal.aborted) throw new Error("gateway_start_aborted");
            await new Promise((resolve, reject) => {
              const cleanup = () => signal.removeEventListener("abort", onAbort);
              const onAbort = () => {
                cleanup();
                reject(new Error("gateway_start_aborted"));
              };
              signal.addEventListener("abort", onAbort, { once: true });
              Promise.resolve()
                .then(() => client.login(botToken))
                .then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
              if (signal.aborted) onAbort();
            });
          },
          destroyGateway: async () => {
            applicationReady = false;
            rejectReadiness("gateway_lease_lost");
            guards.revoke();
            await client.destroy();
          },
          onLeaseLost: async reason => {
            applicationReady = false;
            rejectReadiness("gateway_lease_lost");
            if (typeof onLeaseLost === "function") await onLeaseLost(reason);
          }
        });
        if (!supervisor.ok) {
          guards.revoke();
          closed = true;
          rejectReadiness("gateway_lease_not_acquired");
        } else {
          settleReadiness();
        }
          return supervisor;
        } catch (error) {
          guards.revoke();
          closed = true;
          rejectReadiness("gateway_start_failed");
          throw error;
        }
      })();
      startPromise = run;
      try {
        return await run;
      } finally {
        if (startPromise === run) startPromise = null;
        starting = false;
      }
    },

    markApplicationReady() {
      if (closed) throw new Error("gateway_owner_closed");
      applicationReady = true;
      settleReadiness();
    },

    markApplicationNotReady() {
      applicationReady = false;
      rejectReadiness("gateway_application_not_ready");
    },

    waitUntilReady(timeoutMs = 30000) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
        throw new RangeError("application_ready_timeout_invalid");
      }
      if (Boolean(supervisor?.ready) && applicationReady && !closed) return Promise.resolve(true);
      if (closed) return Promise.reject(new Error("gateway_owner_closed"));
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          readinessWaiters.delete(waiter);
          reject(new Error("gateway_application_ready_timeout"));
        }, timeoutMs);
        readinessWaiters.add(waiter);
        settleReadiness();
      });
    },

    async shutdown(reason = "graceful_shutdown") {
      if (closed && !supervisor && !startPromise) return { released: false, alreadyStopped: true };
      closed = true;
      applicationReady = false;
      rejectReadiness("gateway_owner_shutdown");
      if (starting && startPromise && !supervisor) {
        guards.revoke();
        loginAbortController.abort(reason);
        await client.destroy().catch(() => {});
        await startPromise.catch(() => {});
        const current = await leaseStore.read().catch(() => null);
        return { released: !current || !(current.lease_active === true || current.lease_active === 1), alreadyStopped: false };
      }
      if (!supervisor?.ok) {
        guards.revoke();
        return { released: false, alreadyStopped: false };
      }
      const result = await supervisor.shutdown(reason);
      guards.revoke();
      return result;
    },

    get ready() {
      return Boolean(supervisor?.ready) && applicationReady && !closed;
    },
    get gatewayLoginComplete() {
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
