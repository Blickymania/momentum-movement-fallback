FROM oven/bun:1.4.4
WORKDIR /app
COPY candidate/live-now-v2/package.json ./candidate/live-now-v2/package.json
RUN cd candidate/live-now-v2 && bun install --production --frozen-lockfile
COPY candidate/live-now-v2/index.ts ./candidate/live-now-v2/index.ts
COPY implementation/live-now-panel-repair-adapter.mjs ./implementation/live-now-panel-repair-adapter.mjs
COPY implementation/live-now-panel-recovery.mjs ./implementation/live-now-panel-recovery.mjs
WORKDIR /app/candidate/live-now-v2
ENV NODE_ENV=production
EXPOSE 8080
CMD ["bun", "run", "start"]
