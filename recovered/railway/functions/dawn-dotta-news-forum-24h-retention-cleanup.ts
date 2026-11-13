// Dedicated News Forum retention worker. Deletes only archived public threads
// in the explicitly configured News Forum after 24 hours from archive/closure.
// Pinned threads and the Editorial & Source Rules thread are permanently exempt.
const G = Bun.env.AUTHORIZED_GUILD_ID || "";
const F = Bun.env.NEWS_FORUM_ID || "";
const TOKEN = Bun.env.DISCORD_BOT_TOKEN || "";
const AGE_MS = 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;
if (!/^\d{17,20}$/.test(G) || !/^\d{17,20}$/.test(F) || !TOKEN) {
  throw new Error("Missing or invalid guild, forum, or bot credential configuration");
}
async function api(method, path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("https://discord.com/api/v10" + path, {
      method,
      headers: { Authorization: "Bot " + TOKEN, "User-Agent": "NewsForumRetention/1.1" },
      signal: AbortSignal.timeout(20000)
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      if (attempt === 4) throw new Error("Discord rate limit persisted");
      await Bun.sleep(Math.min(60000, Math.max(1000, Math.ceil(Number(body.retry_after || 2) * 1000) + 250)));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error("Discord API " + method + " " + res.status + " " + body.slice(0, 180));
    }
    if (res.status === 204) return null;
    return await res.json();
  }
  throw new Error("Discord API retries exhausted");
}
const forum = await api("GET", "/channels/" + F);
if (forum.id !== F || forum.guild_id !== G || forum.type !== 15 || !/news/i.test(forum.name || "")) {
  throw new Error("Configured target is not the expected News Forum; refusing all deletion");
}
let before = new Date(Date.now() - AGE_MS).toISOString();
let pagesScanned = 0, scanned = 0, deleted = 0, exempted = 0, young = 0;
let hasMoreAtLimit = false;
for (let page = 0; page < MAX_PAGES; page++) {
  const qs = new URLSearchParams({ limit: String(PAGE_LIMIT), before });
  const data = await api("GET", "/channels/" + F + "/threads/archived/public?" + qs.toString());
  const threads = data.threads;
  if (!Array.isArray(threads)) throw new Error("Archived thread response malformed");
  pagesScanned++;
  scanned += threads.length;
  for (const thread of threads) {
    const title = String(thread.name || "").toLowerCase();
    const isRules = title.includes("editorial") && title.includes("source") && title.includes("rules");
    const isPinned = (Number(thread.flags || 0) & 2) !== 0;
    if (isRules || isPinned) { exempted++; continue; }
    const archivedAt = Date.parse(thread.thread_metadata?.archive_timestamp || "");
    if (!Number.isFinite(archivedAt) || archivedAt > Date.now() - AGE_MS) { young++; continue; }
    if (thread.parent_id !== F || (thread.guild_id && thread.guild_id !== G)) {
      throw new Error("Archived thread escaped configured forum scope; aborting run");
    }
    await api("DELETE", "/channels/" + thread.id);
    deleted++;
  }
  if (!data.has_more || threads.length === 0) break;
  const oldest = threads.reduce((a, t) => {
    const ta = Date.parse(t.thread_metadata?.archive_timestamp || "");
    const aa = Date.parse(a.thread_metadata?.archive_timestamp || "");
    return ta < aa ? t : a;
  }, threads[0]);
  before = oldest.thread_metadata?.archive_timestamp;
  if (!before) throw new Error("Cannot paginate archived threads safely");
  if (page === MAX_PAGES - 1) hasMoreAtLimit = true;
}
if (hasMoreAtLimit) throw new Error("Archive scan reached the 10,000-thread safety cap; additional eligible threads remain for the next run");
console.log(JSON.stringify({
  event: "news_forum_24h_retention_cleanup_v1_1",
  guildId: G, forumId: F, pagesScanned, threadsScanned: scanned,
  threadsDeleted: deleted, editorialOrPinnedExempt: exempted, under24hOrUnverified: young,
  retentionMs: AGE_MS, cutoff: new Date(Date.now() - AGE_MS).toISOString()
}));