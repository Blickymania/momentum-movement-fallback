# Dawn Dotta Manager: portable Bun 1.4.4 runtime.
# Configure the Northflank service with repository root as build context
# and this file as its Dockerfile path.
FROM oven/bun:1.4.4

WORKDIR /app
COPY render/manager.ts ./manager.ts

ENV NODE_ENV=production
ENV PORT=3000
ENV DEPLOYMENT_PLATFORM=northflank

EXPOSE 3000

CMD ["bun", "run", "manager.ts"]
