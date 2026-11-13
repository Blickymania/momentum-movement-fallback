export class LeaseClient {
  constructor({ endpoint, token, instanceId = globalThis.crypto.randomUUID(), ttlSeconds = 60,
    heartbeatMs = 20_000, safetyMs = 5_000, fetchImpl = globalThis.fetch,
    now = () => globalThis.performance.now(), onLost = () => {}, onError = () => {} }) {
    if (!endpoint || !token) throw new Error("LISTENER_LEASE_URL and LISTENER_LEASE_TOKEN are required");
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("Lease endpoint must use HTTPS");
    }
    if (!/^[0-9a-f-]{36}$/i.test(instanceId)) throw new Error("instanceId must be a UUID");
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 15 || ttlSeconds > 90) throw new Error("ttlSeconds must be 15–90");
    if (!Number.isInteger(heartbeatMs) || heartbeatMs < 2_000 || heartbeatMs >= ttlSeconds * 1_000) throw new Error("heartbeatMs must be at least 2000 and shorter than the lease TTL");
    if (!Number.isInteger(safetyMs) || safetyMs < 1_000 || safetyMs >= ttlSeconds * 1_000) throw new Error("safetyMs must be at least 1000 and shorter than the lease TTL");
    if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
    this.endpoint = parsed.origin.replace(/\/$/, "");
    this.token = token;
    this.instanceId = instanceId;
    this.ttlSeconds = ttlSeconds;
    this.ttlMs = ttlSeconds * 1_000;
    this.heartbeatMs = heartbeatMs;
    this.safetyMs = safetyMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.onLost = onLost;
    this.onError = onError;
    this.fencingToken = null;
    this.localDeadline = 0;
    this.held = false;
    this.timer = null;
    this.renewing = false;
    this.lostNotified = false;
  }

  get isHeld() { return this.held && this.now() < this.localDeadline; }

  async tryAcquire() {
    if (this.isHeld) return true;
    if (this.held) this.#lose("local lease safety deadline expired before reacquisition");
    const { response, data, roundTripMs } = await this.#post("acquire", {
      instanceId: this.instanceId, ttlSeconds: this.ttlSeconds,
    });
    if (response.status === 409 && data?.acquired === false) return false;
    if (!response.ok || data?.acquired !== true || !/^\d+$/.test(String(data.fencingToken))) {
      throw new Error(`Lease acquire failed (HTTP ${response.status})`);
    }
    const safeRemaining = this.ttlMs - roundTripMs - this.safetyMs;
    if (safeRemaining <= 0) throw new Error("Lease acquire response arrived too late; refusing to start");
    this.fencingToken = String(data.fencingToken);
    this.localDeadline = this.now() + safeRemaining;
    this.held = true;
    this.lostNotified = false;
    return true;
  }

  assertValid() {
    if (!this.isHeld) {
      this.#lose("local lease safety deadline expired");
      throw new Error("Listener lease is not valid; refusing Discord API operation");
    }
    return true;
  }

  async renew() {
    this.assertValid();
    if (this.renewing) return this.isHeld;
    this.renewing = true;
    try {
      const { response, data, roundTripMs } = await this.#post("renew", {
        instanceId: this.instanceId, fencingToken: this.fencingToken, ttlSeconds: this.ttlSeconds,
      });
      if (response.status === 409 || data?.valid === false) {
        this.#lose("lease ownership was rejected by coordinator");
        return false;
      }
      if (!response.ok || data?.valid !== true) throw new Error(`Lease renewal failed (HTTP ${response.status})`);
      const safeRemaining = this.ttlMs - roundTripMs - this.safetyMs;
      if (safeRemaining <= 0) {
        this.#lose("lease renewal response arrived too late");
        return false;
      }
      this.localDeadline = this.now() + safeRemaining;
      return true;
    } finally {
      this.renewing = false;
    }
  }

  startHeartbeat() {
    if (!this.isHeld) throw new Error("Cannot heartbeat without a valid lease");
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.renew().catch(error => this.onError(error));
    }, this.heartbeatMs);
    this.timer.unref?.();
  }

  async release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasHeld = this.isHeld;
    const fencingToken = this.fencingToken;
    this.held = false;
    this.localDeadline = 0;
    if (!wasHeld || !fencingToken) return false;
    const { response, data } = await this.#post("release", { instanceId: this.instanceId, fencingToken });
    return response.ok && data?.released === true;
  }

  #lose(reason) {
    const notify = this.held && !this.lostNotified;
    this.held = false;
    this.localDeadline = 0;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (notify) {
      this.lostNotified = true;
      try { Promise.resolve(this.onLost(reason)).catch(this.onError); }
      catch (error) { this.onError(error); }
    }
  }

  async #post(action, payload) {
    const started = this.now();
    const response = await this.fetchImpl(`${this.endpoint}/v1/lease/${action}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
    const roundTripMs = Math.max(0, this.now() - started);
    let data = {};
    try { data = await response.json(); } catch {}
    return { response, data, roundTripMs };
  }
}
