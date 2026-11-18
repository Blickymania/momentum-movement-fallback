const MANAGE_THREADS = 1n << 34n;
const ADMINISTRATOR = 1n << 3n;

function validSnowflake(value) {
  return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function validThread(channel, threadId, guildId, forumId) {
  return channel && String(channel.id ?? "") === threadId &&
    String(channel.guild_id ?? "") === guildId && Number(channel.type) === 11 &&
    String(channel.parent_id ?? "") === forumId &&
    typeof channel.name === "string" && channel.name.length >= 1 && channel.name.length <= 100;
}

function validForum(channel, forumId, guildId) {
  return channel && String(channel.id ?? "") === forumId &&
    String(channel.guild_id ?? "") === guildId && Number(channel.type) === 15;
}

function hasManageThreads(permissionValue) {
  if (typeof permissionValue !== "string" || !/^\d{1,32}$/.test(permissionValue)) return false;
  try {
    const permissions = BigInt(permissionValue);
    return (permissions & (MANAGE_THREADS | ADMINISTRATOR)) !== 0n;
  } catch {
    return false;
  }
}

function outcome(state, code) {
  return Object.freeze({ state, code });
}

export function createBot005ForumRenameExecutor({
  guildId, applicationId, getChannel, getMemberPermissions, patchChannel,
} = {}) {
  if (!validSnowflake(guildId) || !validSnowflake(applicationId) ||
      typeof getChannel !== "function" || typeof getMemberPermissions !== "function" ||
      typeof patchChannel !== "function") {
    throw new TypeError("Bot 005 forum rename executor dependencies are invalid");
  }

  return async function executeBot005ForumRename(plan) {
    const payload = plan?.payload;
    const threadId = payload?.threadId;
    const forumId = payload?.forumId;
    const before = payload?.before;
    const title = payload?.title;
    if (plan?.kind !== "forum-rename" || plan.guildId !== guildId ||
        !validSnowflake(plan.actorId) || !validSnowflake(plan.channelId) ||
        !validSnowflake(threadId) || !validSnowflake(forumId) ||
        typeof before !== "string" || before.length < 1 || before.length > 100 ||
        typeof title !== "string" || title.length < 3 || title.length > 100 || title === before) {
      return outcome("failed", "plan_invalid");
    }

    let thread;
    let forum;
    try {
      thread = await getChannel(threadId);
      if (!validThread(thread, threadId, guildId, forumId)) return outcome("failed", "thread_identity_changed");
      if (thread.name === title) return outcome("completed", "already_applied");
      if (thread.name !== before) return outcome("failed", "thread_title_changed");
      if (thread.thread_metadata?.archived === true) return outcome("failed", "thread_archived");
      forum = await getChannel(forumId);
      if (!validForum(forum, forumId, guildId)) return outcome("failed", "forum_identity_changed");
    } catch {
      return outcome("failed", "preflight_read_failed");
    }

    let permissions;
    try {
      const result = await getMemberPermissions(forumId, applicationId);
      permissions = result?.permissions;
    } catch {
      return outcome("failed", "permission_read_failed");
    }
    if (!hasManageThreads(permissions)) return outcome("failed", "manage_threads_required");

    // Re-read immediately before writing to avoid overwriting a title changed after staging.
    try {
      thread = await getChannel(threadId);
      if (!validThread(thread, threadId, guildId, forumId)) return outcome("failed", "thread_identity_changed");
      if (thread.name === title) return outcome("completed", "already_applied");
      if (thread.name !== before) return outcome("failed", "thread_title_changed");
      if (thread.thread_metadata?.archived === true) return outcome("failed", "thread_archived");
    } catch {
      return outcome("failed", "prewrite_read_failed");
    }

    let patch;
    try {
      patch = await patchChannel(threadId, { name: title });
    } catch {
      return verifyUncertainWrite({ getChannel, threadId, guildId, forumId, title, before });
    }
    if (!patch || patch.ok !== true) {
      return verifyUncertainWrite({ getChannel, threadId, guildId, forumId, title, before });
    }

    try {
      const verified = await getChannel(threadId);
      if (!validThread(verified, threadId, guildId, forumId)) return outcome("unknown", "postwrite_identity_unverified");
      return verified.name === title
        ? outcome("completed", "rename_verified")
        : outcome("unknown", "rename_postcondition_mismatch");
    } catch {
      return outcome("unknown", "rename_postcondition_unavailable");
    }
  };
}

async function verifyUncertainWrite({ getChannel, threadId, guildId, forumId, title, before }) {
  try {
    const current = await getChannel(threadId);
    if (!validThread(current, threadId, guildId, forumId)) return outcome("unknown", "uncertain_thread_identity");
    if (current.name === title) return outcome("completed", "rename_verified_after_uncertain_write");
    if (current.name === before) return outcome("failed", "rename_not_observed");
    return outcome("unknown", "rename_outcome_uncertain");
  } catch {
    return outcome("unknown", "rename_outcome_unverified");
  }
}
