# Independent Bun runtime for the Dawn Dotta Manager cold fallback.
# Build context must be the repository root.
FROM oven/bun:1.4.4
WORKDIR /app
COPY render/manager.ts ./manager.ts
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000
CMD ["bun", "run", "manager.ts"]
