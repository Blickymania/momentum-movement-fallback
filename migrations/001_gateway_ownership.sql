-- Momentum Movement Gateway ownership lease table.
-- Apply only to a dedicated, Railway-independent coordination database.
-- Run as the restricted application/owner role that will perform lease reads/writes.
-- This migration is source-only until the independent database provider is approved.

BEGIN;

CREATE SCHEMA IF NOT EXISTS failover AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA failover FROM PUBLIC;

CREATE TABLE IF NOT EXISTS failover.gateway_ownership (
  lease_scope text PRIMARY KEY
    CHECK (length(lease_scope) BETWEEN 1 AND 200),
  owner_id text NOT NULL
    CHECK (length(owner_id) BETWEEN 1 AND 200),
  fencing_epoch bigint NOT NULL
    CHECK (fencing_epoch >= 1),
  lease_until timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  deployment_id text NOT NULL
    CHECK (length(deployment_id) BETWEEN 1 AND 200)
);

REVOKE ALL ON TABLE failover.gateway_ownership FROM PUBLIC;

COMMIT;
