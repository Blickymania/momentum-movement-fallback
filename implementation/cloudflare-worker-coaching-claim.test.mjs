import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker.mjs";

const token = "coaching-idempotency-test-secret-at-least-32";
const route = "https://control.example.com/claim";

function makeNamespace() {
  const claims = new Set();
  const calls = [];
  return {
    claims,
    calls,
    idFromName(name) { return "id:" + name; },
    get(id) {
      assert.equal(id, "id:momentum-movement:coaching-interaction-idempotency");
      return {
        async fetch(request) {
          const url = new URL(request.url);
          calls.push(url.pathname);
          if (url.pathname !== "/claim") {
            return Response.json({ error: "not_found" }, { status: 404 });
          }
          const body = await request.json();
          const claimed = !claims.has(body.interactionId);
          claims.add(body.interactionId);
          return Response.json({ ok: true, claimed });
        }
      };
    }
  };
}

function request(body, authorization = "Bearer " + token) {
  return new Request(route, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("durable coaching claim route requires its own bearer credential", async () => {
  const namespace = makeNamespace();
  const env = { COACHING_IDEMPOTENCY_STORE: namespace, COACHING_IDEMPOTENCY_TOKEN: token };
  const denied = await worker.fetch(request({
    interactionId: "12345678901234567", source: "bot005"
  }, "Bearer wrong-secret"), env);
  assert.equal(denied.status, 401);
  assert.equal(namespace.calls.length, 0);
});

test("durable coaching claim route validates exact source and Discord snowflake fields", async () => {
  const namespace = makeNamespace();
  const env = { COACHING_IDEMPOTENCY_STORE: namespace, COACHING_IDEMPOTENCY_TOKEN: token };
  const invalidId = await worker.fetch(request({ interactionId: "not-a-snowflake", source: "bot005" }), env);
  assert.equal(invalidId.status, 400);
  const invalidSource = await worker.fetch(request({ interactionId: "12345678901234567", source: "other" }), env);
  assert.equal(invalidSource.status, 400);
  const extraField = await worker.fetch(request({
    interactionId: "12345678901234567", source: "bot005", extra: true
  }), env);
  assert.equal(extraField.status, 400);
  assert.equal(namespace.calls.length, 0);
});

test("durable coaching claim route delegates atomically and returns duplicate status", async () => {
  const namespace = makeNamespace();
  const env = { COACHING_IDEMPOTENCY_STORE: namespace, COACHING_IDEMPOTENCY_TOKEN: token };
  const body = { interactionId: "22345678901234567", source: "coaching-relay" };
  const first = await worker.fetch(request(body), env);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, claimed: true, duplicate: false });
  const second = await worker.fetch(request(body), env);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: true, claimed: false, duplicate: true });
  assert.deepEqual(namespace.calls, [
    "/claim",
    "/claim"
  ]);
});

test("durable claim route fails closed when its token or DO binding is missing", async () => {
  const missingToken = await worker.fetch(request({
    interactionId: "32345678901234567", source: "bot005"
  }), { COACHING_IDEMPOTENCY_STORE: makeNamespace() });
  assert.equal(missingToken.status, 503);
  const missingBinding = await worker.fetch(request({
    interactionId: "42345678901234567", source: "bot005"
  }), { COACHING_IDEMPOTENCY_TOKEN: token });
  assert.equal(missingBinding.status, 503);
});
