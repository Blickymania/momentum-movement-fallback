# LIVE NOW V2 — isolated migration candidate

This package is a source-only candidate derived from the preserved production snapshot. It is deliberately fail-closed.

## Runtime

- Bun image: `oven/bun:1.4.4`
- `discord.js`: exact `14.27.0`
- `tiktok-live-connector`: exact `2.5.0`
- `sharp`: exact `0.34.5`

Imports use bare package names and are resolved from this package's own `package.json`. Generate and commit `bun.lock` with Bun 1.4.4 using:

```sh
bun install --lockfile-only
bun install --frozen-lockfile
```

The lockfile is intentionally not fabricated. This environment does not have Bun installed, and its npm registry request timed out. A reproducible build is not complete until the lockfile is generated and the frozen install succeeds in a real Bun 1.4.4 environment.

## TikTok dependency review

`tiktok-live-connector@2.5.0` is not an official TikTok API client. The npm package documents Euler Stream as its WebSocket URL signing provider, describes itself as a reverse-engineering project whose behavior can break when TikTok changes the Webcast protocol, and lists modified AGPL-3.0-only licensing. Before a public release, review the exact package license terms and confirm the permitted signing-provider/service usage. Do not embed an Euler API key or other provider credential in source or in this repository.

The current source uses the library's `fetchIsLive`, `fetchRoomId`, and `fetchRoomInfo` flows. Their reliability, signing-service limits, and production availability must be tested without assuming an SLA.

## Activation and deployment restrictions

- `LIVE_V2_ACTIVE=true` throws before the HTTP server or Gateway client is started.
- There is no production Discord token in this package or this repository.
- This package does not start a Discord Gateway session in its current state.
- Do not remove the guard until a separate LIVE NOW V2 ownership lease/fencing scope and independently verifiable physical stop procedure exist.
- Do not deploy this Dockerfile through the existing Hostless app configuration. The current Hostless app is still the distinct LIVE & Events listener.
- The candidate has not been built or executed; Bun 1.4.4 compatibility, native Sharp install, TikTok signing, and end-to-end Discord behavior remain unverified.

## Docker build context

Build from the repository root, selecting `candidate/live-now-v2/Dockerfile`. This file is separate from the existing root `Dockerfile`; `hostless.yaml` remains unchanged.
