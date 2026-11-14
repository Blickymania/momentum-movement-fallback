FROM oven/bun:1.4.4
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY index.tsx ./index.tsx
COPY candidate ./candidate
COPY implementation ./implementation
COPY cloudflare ./cloudflare
ENV NODE_ENV=production
EXPOSE 8080
CMD ["bun", "run", "start:listener"]
