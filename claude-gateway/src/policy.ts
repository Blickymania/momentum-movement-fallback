export const SERVER_CATALOG = [
  { key: "empress", name: "Empress Reigns", community: "Yammie Gang" },
  { key: "blickymania", name: "Blickymania", community: "Blicky Brigade" },
  { key: "bestyouevahad", name: "BestYouEvaHad", community: "Besties" },
  { key: "red-kocaine", name: "Red Kocaine", community: "Kocaine Kartel" },
  { key: "dawn-dotta", name: "Dawn Dotta", community: "Momentum Movement" }
] as const;

export type ServerKey = (typeof SERVER_CATALOG)[number]["key"];
export type AccessMode = "read" | "write";

export interface GuildAccessInput {
  serverKey: string;
  configuredGuildId: string;
  requestedGuildId: string;
  allowedGuildIds: readonly string[];
  userIsOwner: boolean;
  discordPermissions: string;
  scopes: readonly string[];
  mode: AccessMode;
  stagingWritesEnabled: boolean;
}

export interface ChannelUpdateAction {
  type: "channel.update";
  channelId: string;
  patch: Record<string, unknown>;
}

export interface ChannelPermissionAction {
  type: "channel.permission.set";
  channelId: string;
  targetType: "role" | "member";
  targetId: string;
  allow: string;
  deny: string;
}

export interface MessageSendAction {
  type: "message.send";
  channelId: string;
  content: string;
}

export type ProposedAction =
  | ChannelUpdateAction
  | ChannelPermissionAction
  | MessageSendAction;

export interface ActionPolicyContext {
  guildId: string;
  knownRoleIds: readonly string[];
  managedRoleIds: readonly string[];
  protectedRoleIds: readonly string[];
  botUserIds: readonly string[];
}

const SNOWFLAKE = /^\d{15,22}$/;
const CHANNEL_PATCH_FIELDS = new Set([
  "name",
  "topic",
  "nsfw",
  "rate_limit_per_user",
  "default_auto_archive_duration",
  "default_forum_layout",
  "default_sort_order"
]);
const AUTO_ARCHIVE_VALUES = new Set([60, 1440, 4320, 10080]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function assertGuildAccess(input: GuildAccessInput): void {
  assert(
    SERVER_CATALOG.some((server) => server.key === input.serverKey),
    "Unknown Discord manager."
  );
  assert(SNOWFLAKE.test(input.configuredGuildId), "Manager guild is not configured.");
  assert(
    input.requestedGuildId === input.configuredGuildId,
    "Requested guild does not match this manager's fixed guild."
  );
  assert(
    input.allowedGuildIds.includes(input.configuredGuildId),
    "This Discord user has not been granted access to the requested guild."
  );
  assert(input.userIsOwner || isAdministrator(input.discordPermissions),
    "Discord guild owner or Administrator permission is required.");
  assert(input.scopes.includes("mcp:read"), "OAuth token lacks mcp:read.");
  if (input.mode === "write") {
    assert(input.scopes.includes("mcp:write"), "OAuth token lacks mcp:write.");
    assert(input.stagingWritesEnabled, "Staging writes are disabled.");
  }
}

export function isAdministrator(permissions: string): boolean {
  try {
    return (BigInt(permissions) & 8n) === 8n;
  } catch {
    return false;
  }
}

export function validateProposedAction(
  value: unknown,
  context: ActionPolicyContext
): ProposedAction {
  assert(SNOWFLAKE.test(context.guildId), "Invalid authorized guild ID.");
  assert(isPlainObject(value), "A structured action is required.");
  const type = value.type;

  if (type === "channel.update") {
    assert(SNOWFLAKE.test(String(value.channelId || "")), "Invalid channel ID.");
    assert(isPlainObject(value.patch), "Channel patch must be an object.");
    const keys = Object.keys(value.patch);
    assert(keys.length > 0, "Channel patch cannot be empty.");
    assert(keys.every((key) => CHANNEL_PATCH_FIELDS.has(key)),
      "Channel patch contains a protected or unsupported field.");
    const patch = value.patch;
    if ("name" in patch) assert(typeof patch.name === "string" && patch.name.length > 0 && patch.name.length <= 100, "Invalid channel name.");
    if ("topic" in patch) assert(typeof patch.topic === "string" && patch.topic.length <= 1024, "Invalid channel topic.");
    if ("nsfw" in patch) assert(typeof patch.nsfw === "boolean", "Invalid NSFW setting.");
    if ("rate_limit_per_user" in patch) assert(Number.isInteger(patch.rate_limit_per_user) && Number(patch.rate_limit_per_user) >= 0 && Number(patch.rate_limit_per_user) <= 21600, "Invalid slowmode value.");
    if ("default_auto_archive_duration" in patch) assert(typeof patch.default_auto_archive_duration === "number" && AUTO_ARCHIVE_VALUES.has(patch.default_auto_archive_duration), "Invalid forum auto-archive duration.");
    if ("default_forum_layout" in patch) assert(patch.default_forum_layout === 1 || patch.default_forum_layout === 2, "Invalid forum layout.");
    if ("default_sort_order" in patch) assert(patch.default_sort_order === 0 || patch.default_sort_order === 1, "Invalid forum sort order.");
    return { type, channelId: String(value.channelId), patch: { ...patch } };
  }

  if (type === "channel.permission.set") {
    assert(SNOWFLAKE.test(String(value.channelId || "")), "Invalid channel ID.");
    assert(value.targetType === "role" || value.targetType === "member", "Invalid permission target type.");
    assert(SNOWFLAKE.test(String(value.targetId || "")), "Invalid permission target ID.");
    assert(typeof value.allow === "string" && /^\d+$/.test(value.allow), "Invalid allow permission bitfield.");
    assert(typeof value.deny === "string" && /^\d+$/.test(value.deny), "Invalid deny permission bitfield.");
    const allow = BigInt(value.allow);
    const deny = BigInt(value.deny);
    assert((allow & deny) === 0n, "The same permission cannot be both allowed and denied.");
    if (value.targetType === "role") {
      assert(context.knownRoleIds.includes(String(value.targetId)), "Permission target role is not in this guild.");
      assert(String(value.targetId) === context.guildId ||
        (!context.managedRoleIds.includes(String(value.targetId)) &&
         !context.protectedRoleIds.includes(String(value.targetId))),
      "Managed or protected bot roles cannot be modified.");
    } else {
      assert(!context.botUserIds.includes(String(value.targetId)), "Bot member permissions are protected.");
    }
    return {
      type,
      channelId: String(value.channelId),
      targetType: value.targetType,
      targetId: String(value.targetId),
      allow: value.allow,
      deny: value.deny
    };
  }

  if (type === "message.send") {
    assert(SNOWFLAKE.test(String(value.channelId || "")), "Invalid channel ID.");
    assert(typeof value.content === "string" && value.content.trim().length > 0 && value.content.length <= 2000, "Invalid message content.");
    assert(!/@everyone|@here/i.test(value.content), "Mass mentions are blocked; use a separately authorized SOS workflow.");
    return { type, channelId: String(value.channelId), content: value.content };
  }

  throw new Error("This action is not supported. Role mutations and destructive operations are blocked.");
}


export interface ApprovalCheckInput {
  status: "pending" | "approved" | "consumed" | "expired";
  proposalUserId: string;
  approverUserId: string | null;
  approverIsOwner: boolean;
  callerUserId: string;
  proposalGuildId: string;
  requestedGuildId: string;
  actionHash: string;
  expectedActionHash: string;
  expiresAtEpochSeconds: number;
  nowEpochSeconds: number;
  consumed: boolean;
}

export function assertApprovalReady(input: ApprovalCheckInput): void {
  assert(!input.consumed && input.status !== "consumed", "Approval has already been consumed.");
  assert(input.status === "approved", "Change proposal is not approved.");
  assert(input.proposalUserId === input.callerUserId,
    "Only the original requester may execute the approved proposal.");
  assert(typeof input.approverUserId === "string" && input.approverUserId.length > 0 &&
    input.approverUserId !== input.proposalUserId,
  "A separate owner approval is required; the requester cannot approve their own proposal.");
  assert(input.approverIsOwner,
    "Only a verified Discord guild owner may approve this change.");
  assert(input.proposalGuildId === input.requestedGuildId,
    "Approval is bound to a different Discord server.");
  assert(input.actionHash === input.expectedActionHash,
    "Approved action payload does not match the proposed change.");
  assert(Number.isFinite(input.expiresAtEpochSeconds) &&
    input.expiresAtEpochSeconds > input.nowEpochSeconds,
  "Approval has expired.");
}
