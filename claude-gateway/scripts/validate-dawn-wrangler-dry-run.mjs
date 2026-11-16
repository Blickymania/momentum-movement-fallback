import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = fileURLToPath(new URL("../", import.meta.url));
const dummyKvNamespaceId = "00000000000000000000000000000000";

// The dummy KV ID is written only into a temporary config copy for local
// Wrangler schema/bundle validation. The real staging config stays unchanged.
const targets = [
  {
    label: "Dawn manager",
    config: "manager-worker/wrangler.dawn-dotta.jsonc",
    expectedWorkersDev: false,
    requiresKvPlaceholder: false
  },
  {
    label: "Dawn Auth bootstrap",
    config: "auth-worker/wrangler.dawn-dotta-bootstrap.jsonc",
    expectedWorkersDev: false,
    requiresKvPlaceholder: true
  },
  {
    label: "Dawn Auth private",
    config: "auth-worker/wrangler.dawn-dotta.jsonc",
    expectedWorkersDev: false,
    requiresKvPlaceholder: true
  },
  {
    label: "Dawn Gateway private",
    config: "wrangler.dawn-dotta.jsonc",
    expectedWorkersDev: false,
    requiresKvPlaceholder: false
  },
  {
    label: "Dawn Auth workers.dev",
    config: "auth-worker/wrangler.dawn-dotta-workers-dev.jsonc",
    expectedWorkersDev: true,
    requiresKvPlaceholder: true
  },
  {
    label: "Dawn Gateway workers.dev",
    config: "wrangler.dawn-dotta-workers-dev.jsonc",
    expectedWorkersDev: true,
    requiresKvPlaceholder: false
  }
];

function runDryRun(target) {
  const sourcePath = path.join(gatewayRoot, target.config);
  const config = JSON.parse(readFileSync(sourcePath, "utf8"));

  if (config.workers_dev !== target.expectedWorkersDev || config.preview_urls !== false || config.keep_vars !== true) {
    throw new Error(
      `${target.label}: expected workers_dev=${target.expectedWorkersDev}, preview_urls=false, and keep_vars=true`
    );
  }

  if (target.requiresKvPlaceholder) {
    const namespace = config.kv_namespaces?.find((entry) => entry.binding === "OAUTH_KV");
    if (!namespace || namespace.id !== "") {
      throw new Error("Dawn Auth: expected the real staging OAUTH_KV ID to remain a blank placeholder");
    }
    namespace.id = dummyKvNamespaceId;
  }

  const configDir = path.dirname(sourcePath);
  const tempConfigPath = path.join(
    configDir,
    `.wrangler-dry-run-${process.pid}-${target.label.toLowerCase().replaceAll(" ", "-")}.jsonc`
  );
  const outputDir = mkdtempSync(path.join(os.tmpdir(), "dawn-wrangler-dry-run-"));

  try {
    writeFileSync(tempConfigPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
    const relativeConfig = path.relative(gatewayRoot, tempConfigPath);

    process.stdout.write(`\n[wrangler dry-run] ${target.label} — ${target.config}\n`);
    const result = spawnSync(
      "npx",
      [
        "--no-install",
        "wrangler",
        "deploy",
        "--dry-run",
        "--config",
        relativeConfig,
        "--outdir",
        outputDir
      ],
      {
        cwd: gatewayRoot,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: "inherit"
      }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${target.label}: Wrangler dry-run exited with status ${result.status}`);
    }
    process.stdout.write(`[wrangler dry-run] ${target.label}: passed; no upload performed\n`);
  } finally {
    rmSync(tempConfigPath, { force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
}

for (const target of targets) runDryRun(target);
