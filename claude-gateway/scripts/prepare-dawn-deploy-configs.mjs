import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = fileURLToPath(new URL("../", import.meta.url));
const namespaceId = process.env.DAWN_OAUTH_KV_NAMESPACE_ID;

if (!namespaceId || !/^[a-f0-9]{32}$/i.test(namespaceId)) {
  throw new Error(
    "Set DAWN_OAUTH_KV_NAMESPACE_ID to the 32-character ID of the dedicated Dawn staging KV namespace."
  );
}

const configs = [
  {
    source: "auth-worker/wrangler.dawn-dotta-bootstrap.jsonc",
    output: "auth-worker/wrangler.dawn-dotta-bootstrap.local.jsonc"
  },
  {
    source: "auth-worker/wrangler.dawn-dotta.jsonc",
    output: "auth-worker/wrangler.dawn-dotta.local.jsonc"
  },
  {
    source: "auth-worker/wrangler.dawn-dotta-workers-dev.jsonc",
    output: "auth-worker/wrangler.dawn-dotta-workers-dev.local.jsonc"
  }
];

// Validate every template and every destination before writing any files.
const prepared = configs.map(({ source, output }) => {
  const outputPath = path.join(gatewayRoot, output);
  if (existsSync(outputPath)) {
    throw new Error(`Refusing to overwrite existing local config: ${output}`);
  }

  const config = JSON.parse(readFileSync(path.join(gatewayRoot, source), "utf8"));
  const namespaces = (config.kv_namespaces ?? []).filter((entry) => entry.binding === "OAUTH_KV");
  if (namespaces.length !== 1 || namespaces[0].id !== "") {
    throw new Error(`${source}: expected exactly one blank OAUTH_KV namespace placeholder`);
  }

  namespaces[0].id = namespaceId;
  return { outputPath, output, content: `${JSON.stringify(config, null, 2)}\\n` };
});

const created = [];
try {
  for (const item of prepared) {
    writeFileSync(item.outputPath, item.content, { flag: "wx", mode: 0o600 });
    created.push(item.outputPath);
  }
  process.stdout.write("Prepared three local Dawn Auth deployment configs. Namespace ID was not printed.\n");
  for (const item of prepared) process.stdout.write(`- ${item.output}\n`);
  process.stdout.write("These files are git-ignored; verify the matching namespace in Cloudflare before deploying.\n");
} catch (error) {
  for (const outputPath of created) unlinkSync(outputPath);
  throw error;
}
