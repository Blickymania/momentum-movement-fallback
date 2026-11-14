import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCoordinationDatabaseUrl,
  validatePrimaryHealthUrl,
  createPreflightServer
} from './momentum-movement-independent-preflight.mjs';

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

test('accepts external PostgreSQL URLs', () => {
  const url = validateCoordinationDatabaseUrl('postgresql://user:secret@db.example.com:5432/app');
  assert.equal(url.hostname, 'db.example.com');
});

test('rejects Railway and local PostgreSQL URLs', () => {
  assert.throws(() => validateCoordinationDatabaseUrl('postgres://u:p@db.railway.internal:5432/app'), /non_railway/);
  assert.throws(() => validateCoordinationDatabaseUrl('postgres://u:p@monorail.proxy.rlwy.net:5432/app'), /non_railway/);
  assert.throws(() => validateCoordinationDatabaseUrl('postgres://u:p@127.0.0.1:5432/app'), /non_railway/);
});

test('requires a PostgreSQL URL scheme', () => {
  assert.throws(() => validateCoordinationDatabaseUrl('https://db.example.com'), /scheme_invalid/);
});

test('only accepts public HTTPS primary health URLs', () => {
  assert.equal(validatePrimaryHealthUrl('https://status.example.com/healthz').hostname, 'status.example.com');
  assert.throws(() => validatePrimaryHealthUrl('http://status.example.com'), /public_https/);
  assert.throws(() => validatePrimaryHealthUrl('https://bot.railway.internal/healthz'), /public_https/);
  assert.equal(validatePrimaryHealthUrl(undefined), null);
});

test('liveness stays green without a database and never enables Gateway actions', async () => {
  const app = createPreflightServer({ env: {}, databaseFactory: async () => { throw new Error('should_not_connect'); } });
  const port = await listen(app.server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.gatewayEnabled, false);
    assert.equal(body.takeoverEnabled, false);
    assert.equal(body.discordWritesEnabled, false);
  } finally { await close(app.server); }
});

test('readiness fails closed when independent coordination DB is missing', async () => {
  const app = createPreflightServer({ env: {}, databaseFactory: async () => { throw new Error('should_not_connect'); } });
  const port = await listen(app.server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.database.reason, 'coordination_database_url_missing');
    assert.equal(body.takeoverEnabled, false);
  } finally { await close(app.server); }
});

test('readiness checks the external DB without connecting to Discord', async () => {
  let dbClosed = false;
  const app = createPreflightServer({
    env: { COORDINATION_DATABASE_URL: 'postgres://user:secret@db.example.com:5432/app' },
    databaseFactory: async (_url, options) => ({
      options,
      async unsafe(sql) { assert.equal(sql, 'SELECT 1 AS ok'); return [{ ok: 1 }]; },
      async end() { dbClosed = true; }
    })
  });
  const port = await listen(app.server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.database.reachable, true);
    assert.equal(body.gatewayEnabled, false);
    assert.equal(body.takeoverEnabled, false);
    assert.equal(body.discordWritesEnabled, false);
    assert.equal(dbClosed, true);
  } finally { await close(app.server); }
});

test('rejects non-GET requests', async () => {
  const app = createPreflightServer({ env: {} });
  const port = await listen(app.server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/anything`, { method: 'POST' });
    assert.equal(response.status, 405);
  } finally { await close(app.server); }
});
