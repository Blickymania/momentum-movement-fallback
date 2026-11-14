export function createBot005RuntimeShutdown({ gatewayOwner, getServers }) {
  if (!gatewayOwner || typeof gatewayOwner.shutdown !== "function") {
    throw new TypeError("bot005_gateway_owner_shutdown_required");
  }
  if (typeof getServers !== "function") {
    throw new TypeError("bot005_server_provider_required");
  }

  let shutdownPromise = null;

  return function shutdownRuntime(reason = "graceful_shutdown") {
    if (shutdownPromise) return shutdownPromise;
    if (typeof reason !== "string" || reason.trim() === "" || reason.length > 120) {
      throw new TypeError("bot005_shutdown_reason_invalid");
    }

    shutdownPromise = (async () => {
      let ownerResult;
      let ownerError = null;
      try {
        ownerResult = await gatewayOwner.shutdown(reason);
      } catch (error) {
        ownerError = error;
      }

      let servers;
      try {
        servers = getServers();
        if (!Array.isArray(servers) || servers.length === 0 ||
            servers.some(server => !server || typeof server.stop !== "function")) {
          throw new Error("bot005_http_servers_unavailable");
        }
      } catch (error) {
        if (ownerError) throw new AggregateError([ownerError, error], "bot005_shutdown_incomplete");
        throw error;
      }

      const stopResults = await Promise.allSettled(
        servers.map(server => Promise.resolve().then(() => server.stop(true)))
      );
      const stopErrors = stopResults
        .filter(result => result.status === "rejected")
        .map(result => result.reason);

      if (ownerError || stopErrors.length) {
        const errors = [...(ownerError ? [ownerError] : []), ...stopErrors];
        throw new AggregateError(errors, "bot005_shutdown_incomplete");
      }

      return ownerResult;
    })();

    return shutdownPromise;
  };
}
