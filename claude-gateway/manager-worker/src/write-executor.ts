export interface ManagerWriteExecutorConfig {
  guildId: string;
  token: string;
  writeSecret?: string;
}
type JsonObject = Record<string, unknown>;
type DiscordFetch = typeof fetch;
type WriteAction =
  | { type: "message.send"; channelId: string; content: string }
  | { type: "channel.update"; channelId: string; patch: Record<string, unknown> };
const API = "https://discord.com/api/v10";
const SNOWFLAKE = /^\d{15,22}$/;
const PROPOSAL_ID = /^[0-9a-f-]{36}$/i;
const ACTION_HASH = /^sha256:[a-f0-9]{64}$/;
const MAX_BODY_BYTES = 16_384;
const PATCH_FIELDS = new Set(["name", "topic", "nsfw", "rate_limit_per_user", "default_auto_archive_duration", "default_forum_layout", "default_sort_order"]);

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as JsonObject;
}
function constantTimeEqual(expected: string, actual: string): boolean {
  if (!expected || expected.length !== actual.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}
function validatePatch(value: unknown): Record<string, unknown> {
  const patch = asObject(value);
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => !PATCH_FIELDS.has(key))) throw new Error("Unsupported or empty channel update patch.");
  if (patch.name !== undefined && (typeof patch.name !== "string" || patch.name.length < 1 || patch.name.length > 100)) throw new Error("Invalid channel name.");
  if (patch.topic !== undefined && (typeof patch.topic !== "string" || patch.topic.length > 1024)) throw new Error("Invalid channel topic.");
  if (patch.nsfw !== undefined && typeof patch.nsfw !== "boolean") throw new Error("Invalid NSFW flag.");
  if (patch.rate_limit_per_user !== undefined && (!Number.isInteger(patch.rate_limit_per_user) || Number(patch.rate_limit_per_user) < 0 || Number(patch.rate_limit_per_user) > 21600)) throw new Error("Invalid slowmode.");
  if (patch.default_auto_archive_duration !== undefined &&
      (typeof patch.default_auto_archive_duration !== "number" || ![60, 1440, 4320, 10080].includes(patch.default_auto_archive_duration))) {
    throw new Error("Invalid auto-archive duration.");
  }
  if (patch.default_forum_layout !== undefined &&
      (typeof patch.default_forum_layout !== "number" || ![1, 2].includes(patch.default_forum_layout))) {
    throw new Error("Invalid forum layout.");
  }
  if (patch.default_sort_order !== undefined &&
      (typeof patch.default_sort_order !== "number" || ![0, 1].includes(patch.default_sort_order))) {
    throw new Error("Invalid forum sort order.");
  }
  return patch;
}
function validateAction(value: unknown): WriteAction {
  const action = asObject(value);
  if (!SNOWFLAKE.test(String(action.channelId ?? ""))) throw new Error("Invalid target channel ID.");
  if (action.type === "message.send") {
    if (Object.keys(action).some((key) => !["type", "channelId", "content"].includes(key))) throw new Error("Unsupported message action fields.");
    if (typeof action.content !== "string" || !action.content.trim() || action.content.length > 2000 || /@everyone|@here/i.test(action.content)) throw new Error("Invalid message content.");
    return { type: "message.send", channelId: String(action.channelId), content: action.content };
  }
  if (action.type === "channel.update") {
    if (Object.keys(action).some((key) => !["type", "channelId", "patch"].includes(key))) throw new Error("Unsupported channel update fields.");
    return { type: "channel.update", channelId: String(action.channelId), patch: validatePatch(action.patch) };
  }
  throw new Error("Unsupported Discord write action.");
}
async function digestAction(action: WriteAction): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(action)));
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
function retryStatus(status: number): number { return status === 429 || status >= 500 ? 503 : status; }

export async function handleManagerWrite(
  request: Request,
  config: ManagerWriteExecutorConfig,
  discordFetch: DiscordFetch = fetch
): Promise<Response> {
  if (!config.writeSecret) return json({ error: "Manager write executor is not configured." }, 503);
  if (!constantTimeEqual(config.writeSecret, request.headers.get("x-manager-write-secret") ?? "")) return json({ error: "Forbidden." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON content type is required." }, 415);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: "Write request is too large." }, 413);
  let body: JsonObject;
  try { body = asObject(JSON.parse(raw)); } catch { return json({ error: "Invalid JSON body." }, 400); }
  if (!PROPOSAL_ID.test(String(body.proposalId ?? "")) || body.guildId !== config.guildId || !ACTION_HASH.test(String(body.actionHash ?? ""))) {
    return json({ error: "Invalid approved proposal reference or guild binding." }, 400);
  }
  let action: WriteAction;
  try { action = validateAction(body.action); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid action." }, 400); }
  if (await digestAction(action) !== body.actionHash) return json({ error: "Action hash mismatch." }, 409);

  const channelResponse = await discordFetch(`${API}/channels/${action.channelId}`, {
    method: "GET", headers: { authorization: `Bot ${config.token}`, accept: "application/json" }, redirect: "manual"
  });
  if (channelResponse.status >= 300 && channelResponse.status < 400) return json({ error: "Unexpected Discord channel lookup redirect." }, 502);
  if (!channelResponse.ok) return json({ error: "Target channel could not be verified.", discordStatus: channelResponse.status }, retryStatus(channelResponse.status));
  const channel = asObject(await channelResponse.json());
  if (channel.guild_id !== config.guildId) return json({ error: "Target channel is outside this isolated guild." }, 403);

  let path: string;
  let method: "POST" | "PATCH";
  let payload: JsonObject;
  if (action.type === "message.send") {
    if (channel.type !== 0 && channel.type !== 5) return json({ error: "Message targets must be text or announcement channels." }, 400);
    const nonce = `p${String(body.proposalId).replace(/-/g, "").slice(0, 24)}`;
    path = `/channels/${action.channelId}/messages`;
    method = "POST";
    payload = { content: action.content, nonce, enforce_nonce: true, allowed_mentions: { parse: [] } };
  } else {
    if (![0, 5, 15].includes(Number(channel.type))) return json({ error: "Channel updates are limited to text, announcement, and forum channels." }, 400);
    const forumFields = ["default_auto_archive_duration", "default_forum_layout", "default_sort_order"];
    if (forumFields.some((field) => field in action.patch) && channel.type !== 15) return json({ error: "Forum settings require a forum channel." }, 400);
    path = `/channels/${action.channelId}`;
    method = "PATCH";
    payload = action.patch;
  }
  const response = await discordFetch(`${API}${path}`, {
    method, headers: { authorization: `Bot ${config.token}`, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(payload), redirect: "manual"
  });
  if (response.status >= 300 && response.status < 400) return json({ error: "Unexpected Discord write redirect." }, 502);
  if (!response.ok) return json({ error: "Discord rejected the approved change.", discordStatus: response.status }, retryStatus(response.status));
  const result = asObject(response.status === 204 ? {} : await response.json());
  if (action.type === "message.send") {
    if (typeof result.id !== "string" || !SNOWFLAKE.test(result.id)) return json({ error: "Discord returned an invalid message ID." }, 502);
    return json({ ok: true, proposalId: body.proposalId, actionHash: body.actionHash, messageId: result.id });
  }
  return json({ ok: true, proposalId: body.proposalId, actionHash: body.actionHash, channelId: action.channelId, updatedFields: Object.keys(action.patch) });
}
