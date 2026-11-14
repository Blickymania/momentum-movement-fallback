import { createServer } from 'node:http';

const SERVICE = 'Momentum Movement Core Shadow';
const COMMUNITY = 'Momentum Movement';
const MODE = 'independent-preflight';
const CACHE_MS = 15000;

function isRailwayHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'railway.internal' || host.endsWith('.railway.internal') ||
    host.includes('railway') || host.endsWith('.rlwy.net');
}

function isLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host === '::1' || host.startsWith('127.') || host.startsWith('10.') ||
    host.startsWith('192.168.') || host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '0.0.0.0';
}

export function validateCoordinationDatabaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('coordination_database_url_missing');
  }
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('coordination_database_url_invalid'); }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('coordination_database_url_scheme_invalid');
  }
  if (!parsed.hostname || isRailwayHost(parsed.hostname) || isLocalHost(parsed.hostname)) {
    throw new Error('coordination_database_must_be_external_and_non_railway');
  }
  return parsed;
}

export function validatePrimaryHealthUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('primary_health_url_invalid'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname ||
      parsed.hostname.endsWith('.railway.internal') || isLocalHost(parsed.hostname)) {
    throw new Error('primary_health_url_must_be_public_https');
  }
  return parsed;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

export function createPreflightServer({
  env = process.env,
  databaseFactory,
  fetchFn = globalThis.fetch
} = {}) {
  let cachedReadiness = null;
  let cachedAt = 0;
  let inFlight = null;
  let closing = false;

  async function checkDatabase() {
    const parsed = validateCoordinationDatabaseUrl(env.COORDINATION_DATABASE_URL);
    if (typeof databaseFactory !== 'function') throw new Error('database_driver_unavailable');
    const db = await databaseFactory(parsed.toString(), {
      max: 1,
      connect_timeout: 8,
      idle_timeout: 2,
      ssl: 'require'
    });
    try {
      const rows = await db.unsafe('SELECT 1 AS ok');
      if (Number(rows?.[0]?.ok) !== 1) throw new Error('coordination_database_ping_failed');
      return { ok: true, reachable: true };
    } finally {
      await db.end({ timeout: 5 });
    }
  }

  async function checkPrimary() {
    const raw = env.PRIMARY_HEALTH_URL;
    if (!raw) return { configured: false, reachable: false, gatewayReady: false };
    let url;
    try { url = validatePrimaryHealthUrl(raw); }
    catch { return { configured: true, reachable: false, gatewayReady: false, reason: 'primary_health_url_rejected' }; }
    try {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(2500) });
      const body = await response.json().catch(() => ({}));
      return {
        configured: true,
        reachable: response.ok,
        gatewayReady: response.ok && body.gatewayReady === true && body.guildVerified === true
      };
    } catch {
      return { configured: true, reachable: false, gatewayReady: false, reason: 'primary_probe_unavailable' };
    }
  }

  async function readiness() {
    if (cachedReadiness && Date.now() - cachedAt < CACHE_MS) return cachedReadiness;
    if (!inFlight) {
      inFlight = Promise.allSettled([checkDatabase(), checkPrimary()])
        .then(([databaseResult, primaryResult]) => {
          const database = databaseResult.status === 'fulfilled'
            ? databaseResult.value
            : { ok: false, reachable: false, reason: safeReason(databaseResult.reason) };
          const primary = primaryResult.status === 'fulfilled'
            ? primaryResult.value
            : { configured: Boolean(env.PRIMARY_HEALTH_URL), reachable: false, gatewayReady: false, reason: 'primary_probe_failed' };
          const value = {
            checkedAt: new Date().toISOString(),
            ok: database.ok,
            state: database.ok ? 'independent_coordination_ready' : 'coordination_database_not_ready',
            service: SERVICE,
            community: COMMUNITY,
            mode: MODE,
            database,
            primary,
            gatewayEnabled: false,
            takeoverEnabled: false,
            discordWritesEnabled: false,
            note: 'Preflight only. This service never opens a Discord Gateway session or performs Discord writes.'
          };
          cachedReadiness = value;
          cachedAt = Date.now();
          return value;
        })
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  const server = createServer(async (request, response) => {
    if (closing) return sendJson(response, 503, { status: 'shutting_down' });
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'read_only_preflight' });
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (path === '/healthz') {
      return sendJson(response, 200, {
        status: 'ok', service: SERVICE, community: COMMUNITY, mode: MODE,
        gatewayEnabled: false, takeoverEnabled: false, discordWritesEnabled: false
      });
    }
    if (path === '/readyz' || path === '/preflight') {
      const result = await readiness();
      return sendJson(response, result.ok ? 200 : 503, result);
    }
    return sendJson(response, 404, { error: 'not_found' });
  });

  function shutdown() {
    closing = true;
    return new Promise(resolve => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      server.closeIdleConnections?.();
    });
  }

  return { server, shutdown };
}

async function main() {
  const { server, shutdown } = createPreflightServer({
    databaseFactory: async (connectionString, options) => {
      const { default: postgres } = await import('postgres');
      return postgres(connectionString, options);
    }
  });
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port_invalid');
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(JSON.stringify({ event: 'preflight_started', mode: MODE, port, gatewayEnabled: false, takeoverEnabled: false, discordWritesEnabled: false }) + '\n');
  });
  let stopping = false;
  const stop = async signal => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(JSON.stringify({ event: 'preflight_shutdown', signal }) + '\n');
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    await shutdown();
    clearTimeout(timeout);
    process.exit(0);
  };
  process.on('SIGTERM', () => { void stop('SIGTERM'); });
  process.on('SIGINT', () => { void stop('SIGINT'); });
}

function safeReason(error) {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,80}$/.test(value) ? value : 'coordination_preflight_failed';
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ event: 'preflight_start_failed', reason: safeReason(error) }) + '\n');
    process.exitCode = 1;
  });
}
