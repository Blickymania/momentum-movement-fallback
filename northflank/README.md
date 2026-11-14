# Northflank runtime package

This directory contains the Docker entrypoint for the Dawn Dotta Discord Manager's independent Northflank deployment.

- Dockerfile: `northflank/Dockerfile`
- Canonical Bun Manager source: `render/manager.ts`
- Port: 3000
- Readiness: `/readyz`
- Deployment and account-side setup: `northflank/DEPLOYMENT.md`

This package does not deploy itself and contains no runtime secrets. Build it with the repository root as the Docker build context. Do not enable the origin in the router until the independent OAuth database and readiness endpoint have been verified.
