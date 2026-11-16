FROM oven/bun:1.4.4
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY index.tsx ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["bun", "run", "start:listener"]
