import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const gatewayRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptName = "prepare-dawn-deploy-configs.mjs";
const sourceFiles = [
  "auth-worker/wrangler.dawn-dotta-bootstrap.jsonc",
  "auth-worker/wrangler.dawn-dotta.jsonc",
  "auth-worker/wrangler.dawn-dotta-workers-dev.jsonc"
];
const outputFiles = [
  "auth-worker/wrangler.dawn-dotta-bootstrap.local.jsonc",
  "auth-worker/wrangler.dawn-dotta.local.jsonc",
  "auth-worker/wrangler.dawn-dotta-workers-dev.local.jsonc"
];

function createSandbox(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "dawn-config-prep-test-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, "auth-worker"), { recursive: true });
  copyFileSync(
    path.join(gatewayRoot, "scripts", scriptName),
    path.join(root, "scripts", scriptName)
  );
  for (const source of sourceFiles) {
    copyFileSync(path.join(gatewayRoot, source), path.join(root, source));
  }
  return root;
}

function runPreparation(root: string, namespaceId: string) {
  return spawnSync(
    process.execPath,
    [path.join(root, "scripts", scriptName)],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, DAWN_OAUTH_KV_NAMESPACE_ID: namespaceId }
    }
  );
}

describe("Dawn local deployment config preparation", () => {
  it("requires a real namespace ID and creates no files when it is missing", () => {
    const root = createSandbox();
    try {
      const result = runPreparation(root, "");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("DAWN_OAUTH_KV_NAMESPACE_ID");
      for (const output of outputFiles) {
        expect(existsSync(path.join(root, output))).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes all three validated profiles with the namespace ID and private permissions", () => {
    const root = createSandbox();
    const namespaceId = "a".repeat(32);
    try {
      const result = runPreparation(root, namespaceId);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(namespaceId);

      for (let index = 0; index < outputFiles.length; index += 1) {
        const outputPath = path.join(root, outputFiles[index]);
        const generated = JSON.parse(readFileSync(outputPath, "utf8")) as {
          workers_dev: boolean;
          kv_namespaces: Array<{ binding: string; id: string }>;
        };
        expect(
          generated.kv_namespaces.filter((entry) => entry.binding === "OAUTH_KV")
        ).toEqual([{ binding: "OAUTH_KV", id: namespaceId }]);
        expect(statSync(outputPath).mode & 0o777).toBe(0o600);

        const original = JSON.parse(readFileSync(path.join(root, sourceFiles[index]), "utf8")) as {
          kv_namespaces: Array<{ binding: string; id: string }>;
        };
        expect(
          original.kv_namespaces.filter((entry) => entry.binding === "OAUTH_KV")
        ).toEqual([{ binding: "OAUTH_KV", id: "" }]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an existing destination without overwriting it or creating siblings", () => {
    const root = createSandbox();
    const existingPath = path.join(root, outputFiles[0]);
    try {
      writeFileSync(existingPath, "preserve-this-file");
      const result = runPreparation(root, "b".repeat(32));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Refusing to overwrite");
      expect(readFileSync(existingPath, "utf8")).toBe("preserve-this-file");
      expect(existsSync(path.join(root, outputFiles[1]))).toBe(false);
      expect(existsSync(path.join(root, outputFiles[2]))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("validates every template before creating any output", () => {
    const root = createSandbox();
    try {
      const invalidPath = path.join(root, sourceFiles[2]);
      const invalid = JSON.parse(readFileSync(invalidPath, "utf8")) as {
        kv_namespaces: Array<{ binding: string; id: string }>;
      };
      invalid.kv_namespaces[0].id = "not-a-placeholder";
      writeFileSync(invalidPath, JSON.stringify(invalid));

      const result = runPreparation(root, "c".repeat(32));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("blank OAUTH_KV namespace placeholder");
      for (const output of outputFiles) {
        expect(existsSync(path.join(root, output))).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores every generated local config path", () => {
    const ignoreRules = readFileSync(path.join(gatewayRoot, ".gitignore"), "utf8");
    for (const output of outputFiles) {
      expect(ignoreRules).toContain(output);
    }
  });
});
