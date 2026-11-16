import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./auth-worker/wrangler.test.jsonc" } })],
  test: {
    include: [
      "auth-worker/test/one-time-store.integration.test.ts",
      "auth-worker/test/auth-flow.integration.test.ts",
      "auth-worker/test/owner-approval.integration.test.ts"
    ],
    setupFiles: ["./auth-worker/test/network.setup.ts"]
  }
});
