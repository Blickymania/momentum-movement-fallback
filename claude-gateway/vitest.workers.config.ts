import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./auth-worker/wrangler.jsonc" } })],
  test: { include: ["auth-worker/test/one-time-store.integration.test.ts"] }
});
