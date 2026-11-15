const port = Number(Bun.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Invalid standby health port");
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return Response.json({
        service: "Blickymania Bot 005",
        community: "Momentum Movement",
        mode: "standby",
        ready: true,
        gatewayConnected: false,
        applicationId: "1565304619838742598"
      }, { headers: { "cache-control": "no-store" } });
    }
    return Response.json({ error: "not-found" }, { status: 404 });
  }
});

console.log(JSON.stringify({
  event: "momentum_bot005_standby_ready",
  port: server.port,
  gatewayConnected: false,
  mode: "standby"
}));
