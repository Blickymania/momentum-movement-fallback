import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
  test: {
    include: [
      "test/write-proposals.integration.test.ts",
      "test/owner-approval-routes.integration.test.ts",
      "test/mcp-handler.integration.test.ts"
    ]
  }
});
