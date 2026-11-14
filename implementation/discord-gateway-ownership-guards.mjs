// Installs a fail-closed ownership gate around Discord event listeners,
// Discord REST requests, and direct outbound fetch calls.
//
// Install immediately after creating the Discord Client and BEFORE registering
// application listeners. Create the Cloudflare lease client BEFORE installing
// this guard so its captured fetch implementation remains available for lease
// acquisition/renewal. Only the lease coordinator origin is exempted from the
// global fetch gate. All other outbound HTTP must have current Gateway ownership.
export function installGatewayOwnershipGuards({
  client,
  leaseCoordinatorUrl,
  fetchTarget = globalThis
}) {
  if (!client || typeof client.on !== "function" || typeof client.once !== "function") {
    throw new TypeError("discord_client_event_api_required");
  }
  if (!client.rest || typeof client.rest.request !== "function") {
    throw new TypeError("discord_rest_request_hook_required");
  }
  if (!fetchTarget || typeof fetchTarget.fetch !== "function") {
    throw new TypeError("global_fetch_hook_required");
  }

  let coordinator;
  try { coordinator = new URL(leaseCoordinatorUrl); }
  catch { throw new TypeError("lease_coordinator_url_invalid"); }
  const host = coordinator.hostname.toLowerCase().replace(/\.$/, "");
  if (coordinator.protocol !== "https:" || !host || host.includes("railway") ||
      host.endsWith(".rlwy.net") || host === "localhost" ||
      host.endsWith(".localhost") || host.endsWith(".local") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || coordinator.username ||
      coordinator.password || coordinator.search || coordinator.hash) {
    throw new TypeError("lease_coordinator_url_must_be_public_https");
  }
  const coordinatorOrigin = coordinator.origin;

  const originalOn = client.on;
  const originalOnce = client.once;
  const originalRestRequest = client.rest.request;
  const originalFetch = fetchTarget.fetch;

  let assertOwned = () => { throw new Error("gateway_lease_not_active"); };
  let revoked = false;
  let restored = false;
  let guardedListenerCount = 0;

  function checkOwnership() {
    if (revoked) throw new Error("gateway_ownership_revoked");
    assertOwned();
    return true;
  }

  function wrapListener(listener) {
    if (typeof listener !== "function") return listener;
    guardedListenerCount++;
    const guarded = function guardedGatewayListener(...args) {
      try { checkOwnership(); }
      catch { return undefined; }
      return listener.apply(this, args);
    };
    guarded.listener = listener;
    return guarded;
  }

  client.on = function guardedOn(event, listener) {
    return originalOn.call(this, event, wrapListener(listener));
  };

  client.once = function guardedOnce(event, listener) {
    if (typeof listener !== "function") return originalOnce.call(this, event, listener);
    guardedListenerCount++;
    function onceWrapper(...args) {
      try { checkOwnership(); }
      catch { return undefined; }
      this.removeListener(event, onceWrapper);
      return listener.apply(this, args);
    }
    onceWrapper.listener = listener;
    return originalOn.call(this, event, onceWrapper);
  };

  client.rest.request = function guardedRestRequest(...args) {
    checkOwnership();
    return originalRestRequest.apply(this, args);
  };

  fetchTarget.fetch = function guardedFetch(input, init) {
    let url;
    try {
      if (typeof input === "string") url = new URL(input);
      else if (input instanceof URL) url = input;
      else if (input && typeof input.url === "string") url = new URL(input.url);
      else throw new TypeError("outbound_request_url_invalid");
    } catch {
      throw new TypeError("outbound_request_url_invalid");
    }

    // The lease client captures the original fetch before this guard is installed.
    // Only direct use of global fetch to the lease endpoint is exempt here.
    if (url.origin !== coordinatorOrigin) checkOwnership();
    return originalFetch.call(this, input, init);
  };

  return Object.freeze({
    setAssertOwned(callback) {
      if (typeof callback !== "function") throw new TypeError("ownership_callback_required");
      if (revoked || restored) throw new Error("gateway_ownership_guard_closed");
      assertOwned = callback;
    },
    revoke() {
      revoked = true;
    },
    restore() {
      if (restored) return;
      revoked = true;
      client.on = originalOn;
      client.once = originalOnce;
      client.rest.request = originalRestRequest;
      fetchTarget.fetch = originalFetch;
      restored = true;
    },
    get revoked() { return revoked; },
    get guardedListenerCount() { return guardedListenerCount; },
    get coordinatorOrigin() { return coordinatorOrigin; }
  });
}
