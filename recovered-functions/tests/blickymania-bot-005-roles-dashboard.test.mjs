import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourceFile = new URL("../blickymania-bot-005.ts", import.meta.url);
const file = await readFile(sourceFile, "utf8");
const match = file.match(/const payload="([^"]+)";/);
assert.ok(match, "Bot 005 compressed source payload exists");

function decompress(payload) {
  const raw = Buffer.from(payload, "base64");
  assert.equal(raw.length % 2, 0, "payload stores 16-bit LZW codes");
  const codes = Array.from({ length: raw.length / 2 }, (_, i) => raw.readUInt16LE(i * 2));
  const dictionary = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
  let word = dictionary[codes[0]];
  let output = word;
  for (let i = 1; i < codes.length; i++) {
    const code = codes[i];
    const entry = dictionary[code] !== undefined
      ? dictionary[code]
      : code === dictionary.length ? word + word[0] : "";
    assert.notEqual(entry, "", "valid LZW dictionary reference");
    output += entry;
    if (dictionary.length < 65535) dictionary.push(word + entry[0]);
    word = entry;
  }
  return Buffer.from(Array.from(output, c => c.charCodeAt(0))).toString("utf8");
}

const decoded = decompress(match[1]);
const configStart = decoded.indexOf("const DCP_SHARED_PAGES=") + "const DCP_SHARED_PAGES=".length;
const configEnd = decoded.indexOf("\nclient.on(Events.InteractionCreate", configStart);
assert.ok(configStart >= "const DCP_SHARED_PAGES=".length && configEnd > configStart);
const pages = JSON.parse(decoded.slice(configStart, configEnd).replace(/;$/, ""));
const roles = pages.roles;
const route = /^dcp:([a-z]+):([0-4])(?::std26c)?$/;

test("roles dashboard configuration matches the existing Discord message", () => {
  assert.equal(roles.channel, "1565643484965109781");
  assert.equal(roles.message, "1566161931377709137");
  assert.deepEqual(roles.tabs, ["Access Roles", "Eligibility", "Privacy", "Original"]);
  assert.equal(roles.pages.length, 4);
});

test("all four existing roles buttons resolve to the same dashboard", () => {
  for (let index = 0; index < 4; index++) {
    const customId = `dcp:roles:${index}:std26c`;
    const parsed = customId.match(route);
    assert.ok(parsed, customId);
    assert.equal(parsed[1], "roles");
    assert.equal(Number(parsed[2]), index);
    assert.ok(roles.tabs[index]);
    assert.equal(roles.channel, "1565643484965109781");
    assert.equal(roles.message, "1566161931377709137");
  }
});

test("shared dashboard handler acknowledges before editing the message", () => {
  assert.match(decoded, /await i\.deferUpdate\(\);await i\.editReply\(/);
  assert.match(decoded, /i\.message\?\.author\?\.id!==A/);
  assert.match(decoded, /i\.channelId!==def\.channel\|\|i\.message\?\.id!==def\.message/);
});

test("roles dashboard navigation contains no role mutation", () => {
  assert.match(roles.pages[2], /do not add, remove or change roles/i);
  assert.match(roles.pages[3], /does not modify any member or bot role/i);
});
