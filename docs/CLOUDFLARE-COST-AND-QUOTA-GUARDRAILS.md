# Cloudflare failover cost and quota guardrails

Review date: 2026-11-14

## Current proposed usage

The Bot 005 Gateway owner uses a 30-second lease with a 10-second default heartbeat. One continuously active primary therefore generates approximately:

- 8,640 lease-renew operations per 24 hours (86,400 seconds / 10 seconds).
- 8,640 Worker requests to renew and 8,640 Durable Object coordinator requests, before status checks, acquire/release calls, failover traffic or other Worker routes.
- Each coaching interaction adds one authenticated idempotency claim request to the Worker and one request to the separate idempotency Durable Object.

This is an estimate from the current source defaults, not a measured usage report. It assumes only one active Bot 005 primary and does not include the project's other five Gateway-connected services.

## Cloudflare Durable Objects plan limits

As documented by Cloudflare on 2026-11-14:

| Meter | Workers Free | Workers Paid included allocation |
|---|---:|---:|
| Durable Object requests | 100,000/day | 1,000,000/month, then $0.15/million |
| Duration | 13,000 GB-s/day | 400,000 GB-s/month, then $12.50/million GB-s |
| SQLite row reads | 5 million/day | 25 billion/month, then $0.001/million rows |
| SQLite row writes | 100,000/day | 50 million/month, then $1.00/million rows |
| SQLite stored data | 5 GB total | 5 GB-month included, then $0.20/GB-month |

The Free plan supports SQLite-backed Durable Objects only. If a Free-tier daily quota is exceeded, further operations of that type fail until the daily reset at 00:00 UTC; this is not a free unlimited overflow path. The 10-second Bot 005 heartbeat alone is approximately 8.64% of the Free Durable Object request allowance per day, before other calls. This does not establish actual account eligibility or usage.

The Free limits and price table are documented at:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/

## Paid-plan spend control caveat

Cloudflare documents a Durable Objects spending limit that applies across the account, not just to this Worker or namespace. It can reject new DO stub requests and SQL reads/writes after included usage charges reach the configured limit.

Important exclusions and caveats:
- Stored-data charges and the shared Workers Paid subscription fee are excluded from that limit.
- Stored data can continue accruing charges during a pause.
- Already-running requests can continue accruing duration charges.
- Enforcement and usage reporting take time, so the cap is not guaranteed to be a maximum final invoice.

See https://developers.cloudflare.com/durable-objects/platform/spend-management/

## Safe deployment requirement

Before deploying any Worker or Durable Object:

1. Verify the actual Cloudflare account, active plan, current usage and whether this project is covered by Free or Paid limits.
2. If Paid, review and configure account-level Durable Objects and Workers spending controls before deployment; do not assume a DO spending cap is a hard total-bill cap.
3. If Free, set monitoring/alerts around request, duration, SQL read/write and storage consumption. Exceeding a daily Free limit can stop lease operations and cause Bot 005 to fail closed; availability may be lost even though split-brain protection remains intact.
4. Do not add the other five Gateway workloads to the Bot 005 lease. Model each independent workload's request budget and control scope separately.
5. Do not provision paid resources or change the Cloudflare plan without explicit user authorization.

## Current verified state

Cloudflare account and plan state have not been inspected in this task. No Worker, Durable Object namespace, migration, route, DNS record, secret, spending limit or other billable resource has been deployed or configured. No cost has been incurred by the source changes in this repository.
