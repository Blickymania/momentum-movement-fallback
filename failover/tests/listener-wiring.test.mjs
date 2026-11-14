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
  const lostHandler = source.match(/onLost:async reason=>\{([\s\S]*?)\n \},\n onError:/);
  assert.ok(lostHandler, "lease-loss handler must be present");
  assert.ok(
    lostHandler[1].indexOf("await old.destroy()") < lostHandler[1].indexOf("if(client===old)client=null"),
    "do not permit a replacement Gateway client before the previous client is destroyed"
  );
});
