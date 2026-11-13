import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("isolated listener requires lease ownership before Discord operations", async () => {
  const source = await readFile(new URL("../listener/index.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{LeaseClient\} from "\.\/lease-client\.mjs"/);
  assert.match(source, /lease\.assertValid\(\)/);
  assert.match(source, /lease\.startHeartbeat\(\)/);
  assert.match(source, /AbortSignal\.any\(\[AbortSignal\.timeout\(15000\),lease\.signal\]\)/);
  assert.match(source, /momentum-listener-standby-waiting-for-lease/);
  assert.match(source, /lease\?\.isHeld===true/);
});
