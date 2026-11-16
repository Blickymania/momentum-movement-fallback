import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = fileURLToPath(new URL("../", import.meta.url));
const namespaceId = (process.env.DAWN_OAUTH_KV_NAMESPACE_ID ?? "").trim().toLowerCase();

if (!/^[a-f0-9]{32}$/.test(namespaceId) || /^0{32}$/.test(namespaceId)) {
  throw new Error(
    "Set DAWN_OAUTH_KV_NAMESPACE_ID to the real 32-character ID of the dedicated Dawn staging KV namespace."
  );
}

const expectedName = "discord-claude-auth-dawn-staging";
const expectedService = [
  { binding: "GATEWAY_SERVER", service: "discord-claude-gateway-dawn-staging" }
];

const targets = [
  {
    source: "auth-worker/wrangler.dawn-dotta-bootstrap.jsonc",
    output: "auth-worker/wrangler.dawn-dotta-bootstrap.local.jsonc",
    workersDev: false,
    services: []
  },
  {
    source: "auth-worker/wrangler.dawn-dotta.jsonc",
    output: "auth-worker/wrangler.dawn-dotta.local.jsonc",
    workersDev: false,
    services: expectedService
  },
  {
    source: "auth-worker/wrangler.dawn-dotta-workers-dev.jsonc",
    output: "auth-worker/wrangler.dawn-dotta-workers-dev.local.jsonc",
    workersDev: true,
    services: expectedService
  }
];

// Validate every template and destination before creating any local file.
const prepared = targets.map((target) => {
  const sourcePath = path.join(gatewayRoot, target.source);
  const outputPath = path.join(gatewayRoot, target.output);

  if (existsSync(outputPath)) {
    throw new Error("Refusing to overwrite existing local config: " + target.output);
  }

  const config = JSON.parse(readFileSync(sourcePath, "utf8"));

  if (
    config.name !== expectedName ||
    config.workers_dev !== target.workersDev ||
    config.preview_urls !== false ||
    config.keep_vars !== true ||
    config.vars !== undefined ||
    (config.routes ?? []).length !== 0
  ) {
    throw new Error(target.source + ": Dawn Auth deployment safeguards do not match the expected profile.");
  }

  if (JSON.stringify(config.services ?? []) !== JSON.stringify(target.services)) {
    throw new Error(target.source + ": Dawn Auth Service Bindings do not match the expected profile.");
  }

  const namespaces = (config.kv_namespaces ?? []).filter((entry) => entry.binding === "OAUTH_KV");
  if (namespaces.length !== 1 || namespaces[0].id !== "") {
    throw new Error(target.source + ": expected exactly one blank OAUTH_KV namespace placeholder.");
  }

  const hasOneTimeStore = (config.durable_objects?.bindings ?? []).some(
    (binding) => binding.name === "OAUTH_ONE_TIME_STORE" && binding.class_name === "OAuthOneTimeStore"
  );
  const hasMigration = (config.migrations ?? []).some(
    (migration) => (migration.new_sqlite_classes ?? []).includes("OAuthOneTimeStore")
  );
  if (!hasOneTimeStore || !hasMigration) {
    throw new Error(target.source + ": the OAuth one-time Durable Object binding or migration is missing.");
  }

  namespaces[0].id = namespaceId;
  return {
    outputPath,
    output: target.output,
    content: JSON.stringify(config, null, 2) + "\n"
  };
});

const created = [];
try {
  for (const item of prepared) {
    const descriptor = openSync(item.outputPath, "wx", 0o600);
    created.push(item.outputPath);
    try {
      writeFileSync(descriptor, item.content, { encoding: "utf8" });
    } finally {
      closeSync(descriptor);
    }
  }
} catch (error) {
  const cleanupErrors = [];
  for (const outputPath of created.reverse()) {
    try {
      unlinkSync(outputPath);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError([error, ...cleanupErrors], "Config preparation failed and cleanup was incomplete.");
  }
  throw error;
}

process.stdout.write("Prepared three local Dawn Auth deployment configs. The KV namespace ID was not printed.\n");
for (const item of prepared) process.stdout.write("- " + item.output + "\n");
process.stdout.write("The generated files are git-ignored. Verify the namespace in Cloudflare before deploying.\n");
