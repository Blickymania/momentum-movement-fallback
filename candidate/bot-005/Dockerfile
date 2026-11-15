FROM oven/bun:1.4.4
WORKDIR /app
COPY candidate/bot-005/package.json ./candidate/bot-005/package.json
COPY candidate/bot-005/bun.lock ./candidate/bot-005/bun.lock
RUN cd candidate/bot-005 && bun install --production --frozen-lockfile
COPY candidate/bot-005/index.ts ./candidate/bot-005/index.ts
COPY candidate/bot-005/standby.ts ./candidate/bot-005/standby.ts
COPY implementation/coaching-workflow-client.mjs ./implementation/coaching-workflow-client.mjs
COPY implementation/coaching-workflow-auth.mjs ./implementation/coaching-workflow-auth.mjs
COPY implementation/rules-acceptance.mjs ./implementation/rules-acceptance.mjs
COPY implementation/fenced-discord-gateway-owner.mjs ./implementation/fenced-discord-gateway-owner.mjs
COPY implementation/gateway-owner-supervisor.mjs ./implementation/gateway-owner-supervisor.mjs
COPY implementation/cloudflare-gateway-lease-client.mjs ./implementation/cloudflare-gateway-lease-client.mjs
COPY implementation/cloudflare-fence-request-client.mjs ./implementation/cloudflare-fence-request-client.mjs
COPY implementation/discord-gateway-ownership-guards.mjs ./implementation/discord-gateway-ownership-guards.mjs
COPY implementation/shared-gateway-lease.mjs ./implementation/shared-gateway-lease.mjs
COPY cloudflare/gateway-lease-coordinator.mjs ./cloudflare/gateway-lease-coordinator.mjs
WORKDIR /app/candidate/bot-005
ENV NODE_ENV=production
CMD ["bun", "run", "start"]
