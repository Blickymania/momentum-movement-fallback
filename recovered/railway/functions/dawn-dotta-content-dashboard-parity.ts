// GALLERY_LOW_RESOLUTION_FIDELITY_V4_20261107 — audit-only: never call low-resolution copies lossless originals, and catch missing native media.

/* MASTER_WORKFLOW_DASHBOARD_PARITY_AUDIT_V1
 * Silent Build Mode: read-only; zero Discord POST/PATCH/DELETE calls.
 * Do not change server structure, messages, roles, dashboard components, or notification settings.
 * Machine-readable detection only; publisher changes require separate, verified deployment.
 */
await (async function masterWorkflowDashboardParityAuditV1(){
  const guildId="1565048205970767992";
  const contractVersion="2026-11-06.v1";
  try{
    const token=Bun.env.DISCORD_BOT_TOKEN||Bun.env.DISCORD_TOKEN||"";
    if(!token)throw Error("auditor_bot_token_unavailable");
    async function read(path){
      for(let retry=0;retry<3;retry++){
        const res=await fetch("https://discord.com/api/v10"+path,{method:"GET",headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(12000)});
        if(res.status===429){
          const data=await res.json().catch(()=>({}));
          if(retry===2)throw Error("discord_rate_limited");
          await Bun.sleep(Math.min(12000,Math.max(1200,Math.ceil(Number(data.retry_after||2)*1000)+250)));
          continue;
        }
        if(!res.ok)throw Error("discord_read_"+res.status);
        return await res.json();
      }
      throw Error("read_retry_exhausted");
    }
    const [identity,guild,channels]=await Promise.all([
      read("/users/@me"),read("/guilds/"+guildId),read("/guilds/"+guildId+"/channels")
    ]);
    if(guild?.id!==guildId||!identity?.id||!Array.isArray(channels))throw Error("guild_identity_validation_failed");
    const normalize=(v)=>String(v||"").normalize("NFKC").toLowerCase().replace(/^[^a-z0-9]+/,"");
    const kinds=[
      {key:"creator-profile",test:(n)=>(n.endsWith("-profile")&&!n.includes("member-"))||/^about-[a-z0-9-]+$/.test(n),minimum:{buttons:4,selects:2,media:1}},
      {key:"level-up-management",test:(n)=>n==="level-up-management",minimum:{buttons:2,selects:1}},
      {key:"member-profiles",test:(n)=>n==="member-profiles",minimum:{}},
      {key:"discord-engagement-management",test:(n)=>n==="discord-engagement-management",minimum:{}},
      {key:"discord-engagement-tracker",test:(n)=>n==="discord-engagement-tracker",minimum:{}},
      {key:"live-now",test:(n)=>n==="live-now",minimum:{}}
    ];
    function metrics(message){
      const result={containers:0,text:0,buttons:0,selects:0,media:0,separators:0,embedCount:(message.embeds||[]).length,attachments:(message.attachments||[]).length};
      function scan(items){
        for(const x of items||[]){
          if(x.type===17)result.containers++;
          if(x.type===10)result.text++;
          if(x.type===2)result.buttons++;
          if([3,5,6,7,8].includes(x.type))result.selects++;
          if([11,12,13].includes(x.type))result.media++;
          if(x.type===14)result.separators++;
          scan(x.components);
          if(x.accessory)scan([x.accessory]);
          if(Array.isArray(x.items))scan(x.items);
        }
      }
      scan(message.components||[]);
      return result;
    }
    const report=[];
    for(const kind of kinds){
      const matches=channels.filter(c=>c.type===0&&kind.test(normalize(c.name)));
      if(matches.length!==1){report.push({kind:kind.key,state:matches.length===0?"MISSING":"AMBIGUOUS",matchingChannels:matches.length});continue;}
      const messages=await read("/channels/"+matches[0].id+"/messages?limit=10");
      if(!Array.isArray(messages))throw Error("messages_not_array");
      const analyzed=messages.map(m=>{
        const ids=[],todo=[...(m.components||[])];
        while(todo.length){
          const c=todo.pop();if(!c)continue;
          if(c.custom_id)ids.push(String(c.custom_id));
          if(Array.isArray(c.components))todo.push(...c.components);
          if(c.accessory)todo.push(c.accessory);
        }
        return {id:m.id,isBot:!!m.author?.bot,stats:metrics(m),customIds:ids};
      });
      const ranked=analyzed.filter(x=>x.isBot).sort((a,b)=>
        (b.stats.containers*30+b.stats.buttons*5+b.stats.selects*5+b.stats.media*3+b.stats.text)
        -(a.stats.containers*30+a.stats.buttons*5+a.stats.selects*5+a.stats.media*3+a.stats.text));
      // Level-Up has a persistent member-selector dashboard. Prefer that exact control,
      // not an unrelated follow-up/control message that happens to have more buttons.
      const preferred=kind.key==="level-up-management"
        ? ranked.filter(x=>x.customIds.includes("fclub:member"))
        : ranked;
      const selected=preferred[0]||ranked[0]||null;
      const missing=selected?Object.entries(kind.minimum).filter(([k,n])=>selected.stats[k]<n).map(([k])=>k):["dashboard_message"];
      report.push({kind:kind.key,state:missing.length?"DRIFT":"OBSERVED",matchingChannels:1,recentBotMessages:analyzed.filter(x=>x.isBot).length,qualifyingDashboardCount:preferred.length,selectedMessageId:selected?.id||null,selectedCustomIds:selected?.customIds.slice(0,8)||[],components:selected?.stats||null,missingFeatures:missing});
    }
    const drift=report.filter(x=>x.state!=="OBSERVED").map(x=>x.kind);
    console.log("MASTER_WORKFLOW_PARITY_AUDIT "+JSON.stringify({
      version:contractVersion,guildId,readOnly:true,silentBuild:true,discordWrites:0,
      noLayoutEnforcement:true,distinctServerIdentity:true,drift,report
    }));
  }catch(error){
    console.warn("MASTER_WORKFLOW_PARITY_AUDIT_DEFERRED "+JSON.stringify({
      version:contractVersion,guildId,readOnly:true,silentBuild:true,
      reason:String(error?.message||error).slice(0,140)
    }));
  }
})();

try {
// Momentum Movement: read-only dashboard and LIVE source audit.
// Never creates, renames, posts, deletes, or edits any Discord resource.
const G="1565048205970767992";
const APP="1565304619838742598";
const CAT="1566030078964539432";
const TARGETS={
  greeting:"1566030413842096241",
  clock:"1566030421635104768",
  members:"1566030474034282537",
  superfan:"1569452169374204005",
  boosts:"1569452187933737073",
  live:"1566030504635924600"
};
const token=Bun.env.DISCORD_BOT_TOKEN||"";
if(Bun.env.AUTHORIZED_GUILD_ID!==G||Bun.env.APPLICATION_ID!==APP||!token)throw Error("Expected Momentum Movement bot identity/configuration missing");
async function get(path){
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch("https://discord.com/api/v10"+path,{headers:{"Authorization":"Bot "+token},signal:AbortSignal.timeout(12000)});
  const data=await r.json().catch(()=>({}));
  if(r.status===429){
   if(attempt===2)throw Error("Discord read deferred after 429 for "+path.split("?")[0]);
   await Bun.sleep(Math.min(30000,Math.max(1200,Math.ceil(Number(data?.retry_after||2)*1000)+300)));
   continue;
  }
  if(!r.ok)throw Error("Discord read "+r.status+" on "+path.split("?")[0]);
  return data;
 }
 throw Error("Discord retry budget reached");
}
const [me,guild,channels,members]=await Promise.all([
 get("/users/@me"),get("/guilds/"+G+"?with_counts=true"),get("/guilds/"+G+"/channels"),get("/guilds/"+G+"/members?limit=1000")
]);
if(me.id!==APP||guild.id!==G||!Array.isArray(channels)||!Array.isArray(members))throw Error("Discord identity or response validation failed");
const category=channels.find(c=>c.id===CAT&&c.type===4);
// Community Stats category is presentation-only; counter identities remain valid after owner moves.
// Inspect only existing access-control metadata; never retrieve private coaching content.
const privateCategory=channels.find(x=>x.id==="1565643251783049237");
const caseForum=channels.find(x=>x.id==="1566227861747138641");
function restrictedToModerators(ch){
 if(!ch||!Array.isArray(ch.permission_overwrites))return false;
 const all=ch.permission_overwrites.find(o=>o.id===G&&o.type===0);
 const mod=ch.permission_overwrites.find(o=>o.id==="1565407676580499616"&&o.type===0);
 const others=ch.permission_overwrites.some(o=>o.id!==G&&o.id!=="1565407676580499616"&&(BigInt(o.allow||"0")&1024n)===1024n);
 return !!all&&(BigInt(all.deny||"0")&1024n)===1024n&&!!mod&&(BigInt(mod.allow||"0")&1024n)===1024n&&!others;
}
const coachingPrivacyAudit={
 checked:true,
 parentCategoryFound:!!privateCategory&&privateCategory.type===4,
 caseForumFound:!!caseForum&&caseForum.type===15&&caseForum.parent_id===privateCategory?.id,
 categoryRestricted:restrictedToModerators(privateCategory),
 caseForumRestricted:restrictedToModerators(caseForum),
 violations:0
};
coachingPrivacyAudit.violations=[
 !coachingPrivacyAudit.parentCategoryFound,
 !coachingPrivacyAudit.caseForumFound,
 !coachingPrivacyAudit.categoryRestricted,
 !coachingPrivacyAudit.caseForumRestricted
].filter(Boolean).length;
const rows=Object.entries(TARGETS).map(([key,id])=>{
 const c=channels.find(x=>x.id===id);
 return {key,id,valid:!!c&&c.guild_id===G&&c.type===2,name:c?.name||null,parentId:c?.parent_id??null,displayedInCommunityStats:c?.parent_id===CAT};
});
const slug=x=>String(x||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const liveCh=channels.filter(c=>c.type===0&&slug(c.name)==="live-now");
if(liveCh.length!==1)throw Error("Expected exactly one LIVE NOW text channel");
const messages=await get("/channels/"+liveCh[0].id+"/messages?limit=100");
if(!Array.isArray(messages))throw Error("LIVE NOW history response invalid");
const now=Date.now();
const ownerHandle=String(Bun.env.SOCIAL_TIKTOK_HANDLE||"").replace(/^@/,"").trim().toLowerCase();
const matches=[];
for(const m of messages){
 if(m.author?.id!==APP||!Array.isArray(m.embeds))continue;
 const embed=m.embeds[0];
 if(!embed||!/^(🔴 LIVE NOW|🔴 BOX BATTLE)/.test(embed.title||"")||!embed.url)continue;
 const buttons=(m.components||[]).flatMap(row=>row.components||[]);
 const manage=buttons.find(b=>/^cw:live:manage:\d+:\d+$/.test(b.custom_id||""));
 const expires=manage?Number(manage.custom_id.split(":")[4])*1000:0;
 const titleHandle=String(embed.title||"").match(/ · @([a-z0-9._]+)/i)?.[1]?.toLowerCase()||"";
 matches.push({
  id:m.id,handle:titleHandle,unexpired:expires>now,ended:/^⚫ ENDED LIVE/.test(embed.title||"")||(embed.fields||[]).some(x=>x.name==="Status"&&x.value==="⚫ Ended"),
  ageMinutes:Math.max(0,Math.floor((now-Date.parse(m.timestamp))/60000)),
  minutesUntilSubmissionExpiry:expires?Math.floor((expires-now)/60000):null,
  isConfiguredOwner:!!ownerHandle&&titleHandle===ownerHandle
 });
}
const expectedCommands=["addtocase","announce","audit","automod","ban","bot-status","botconfig","botstatus","channelorder","channelposition","chatfirst","closecase","eventcreate","events","help","kick","lock","member","ping","poll","purge","report","role","rules","server","slowmode","statsset","statsstatus","support","tiktok","timeout","unban","warn","dashboard","bot-test","forum-admin"];
let commandRegistry={checked:false,count:null,matching:null,missing:[],unexpected:[],reason:null};
try {
 const cmds=await get("/applications/"+APP+"/guilds/"+G+"/commands");
 if(!Array.isArray(cmds))throw Error("guild_commands_not_array");
 const names=cmds.filter(c=>c.type===1).map(c=>c.name);
 commandRegistry={checked:true,count:names.length,matching:expectedCommands.filter(n=>names.includes(n)).length,missing:expectedCommands.filter(n=>!names.includes(n)),unexpected:names.filter(n=>!expectedCommands.includes(n)),reason:null};
}catch(err){commandRegistry.reason=err instanceof Error?err.message.slice(0,105):"unknown"}
const active=matches.filter(x=>x.unexpired&&!x.ended);
const report={
 event:"momentum_dashboard_parity_audit",guild:G,readOnly:true,
 commandRegistry,coachingPrivacyAudit,
 verifiedIdentity:true,memberCount:members.length,statsCategoryPresent:!!category,
 statsChannels:rows,allStatsChannelsValid:rows.every(x=>x.valid),
 liveChannelId:liveCh[0].id,inspectedRecentMessages:messages.length,
 advertisedActiveLivePosts:active.length,
 configuredOwnerHandlePresent:!!ownerHandle,
 advertisedOwnerLivePosts:active.filter(x=>x.isConfiguredOwner).length,
 activePosts:active.slice(0,8),
 presenceBreakdownAvailableFromREST:false,
 liveTikTokStateIndependentlyVerified:false,
 liveDurationIndependentlyVerified:false,
 warning:"Discord LIVE submissions are not proof of actual TikTok LIVE status"
};
if(Bun.env.PARITY_DIAGNOSTIC==="true")throw Error("MM_PARITY_AUDIT:"+JSON.stringify(report));
console.log(JSON.stringify({...report,activePosts:undefined}));

} catch(error) { if(Bun.env.PARITY_DIAGNOSTIC==='true'&&error instanceof Error&&error.message.startsWith('MM_PARITY_AUDIT:'))throw error; console.error(JSON.stringify({event:'momentum_dashboard_parity_deferred',readOnly:true,reason:error instanceof Error?error.message.slice(0,130):'unknown'})); }

/* DASHBOARD_WORKFLOW_PARITY_V2_20261107 - read-only; never POST, PATCH, DELETE, ping, or modify any Discord content. */
await (async function dashboardWorkflowParityV2() {
  const guildId="1565048205970767992";
  const prefix="DASHBOARD_WORKFLOW_PARITY_V2_20261107";
  try {
    const token=Bun.env.DISCORD_BOT_TOKEN||Bun.env.DISCORD_TOKEN||"";
    if(!token){console.warn(prefix+" token_missing");return;}
    async function get(path){
      for(let attempt=0;attempt<3;attempt++){
        const res=await fetch("https://discord.com/api/v10"+path,{
          headers:{Authorization:"Bot "+token},method:"GET",signal:AbortSignal.timeout(12000)
        });
        if(res.status===429){let j=await res.json().catch(()=>({}));await Bun.sleep(Math.min(12000,Math.max(1000,Number(j.retry_after||1)*1000)));continue;}
        if(!res.ok)throw Error("discord_read_"+res.status);
        return res.json();
      }
      throw Error("rate_limit_retry_exhausted");
    }
    const channels=await get("/guilds/"+guildId+"/channels");
    if(!Array.isArray(channels))throw Error("invalid_guild_channels");
    const name=v=>String(v||"").normalize("NFKC").toLowerCase().replace(/^[^a-z0-9]+/,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
    const required=["member-profiles","discord-engagement-tracker","discord-engagement-management","live-now","level-up-management","tiktok-campaign-management"];
    const singleton=new Set(["discord-engagement-tracker","live-now"]);
    const records=[];
    for(const key of required){
      const matching=channels.filter(c=>name(c.name)===key);
      if(matching.length!==1){records.push({key,status:"REVIEW",reason:"channel_count",count:matching.length});continue;}
      const channel=matching[0];
      try{
        const messages=await get("/channels/"+channel.id+"/messages?limit=15");
        // UMM_PERSISTENT_DASHBOARD_CLASSIFIER_V3: distinguish active dashboard controls
        // from historical LIVE records and ordinary bot-produced member/engagement content.
        // This is read-only; never rewrite or delete a message on an audit finding.
        const botPosts=(Array.isArray(messages)?messages:[]).filter(m=>m.author?.bot&&((m.components||[]).length||(m.embeds||[]).length));
        const customIds=m=>{
          const found=[],todo=[...(m.components||[])];
          while(todo.length){const c=todo.pop();if(!c)continue;
            if(c.custom_id)found.push(String(c.custom_id));
            if(Array.isArray(c.components))todo.push(...c.components);
          }
          return found;
        };
        const botPanels=singleton.has(key)?botPosts.filter(m=>{
          const ids=customIds(m);
          // Do not count an ended LIVE record with a Manage LIVE button as a second dashboard.
          if(key==="live-now")return ids.some(id=>["ln2:post","cw:live:open","live-now:v1:open"].includes(id));
          return (m.components||[]).some(c=>c.type===17)||ids.length>0;
        }):botPosts;
        const native=botPanels.filter(m=>(m.components||[]).some(c=>c.type===17));
        const legacy=botPanels.filter(m=>!(m.components||[]).some(c=>c.type===17));
        const warnings=[];
        // UMM_TEXT_ONLY_STAFF_DASHBOARD_AUDIT_V4: a legitimate instruction post is not
        // an interactive native dashboard, but it is also not an empty channel.
        const textOnlyBotPosts=(Array.isArray(messages)?messages:[]).filter(m=>m.author?.bot&&
          String(m.content||"").trim()&&!(m.components||[]).length&&!(m.embeds||[]).length);
        if(!botPanels.length)warnings.push(textOnlyBotPosts.length
          ?"text_only_staff_instructions_need_native_dashboard"
          :"no_bot_dashboard_in_recent_messages");
        if(botPanels.length&&!native.length)warnings.push("no_native_container_in_recent_messages");
        if(singleton.has(key)&&botPanels.length>1)warnings.push("multiple_active_dashboards_review_before_cleanup");
        if(legacy.length&&native.length)warnings.push("mixed_legacy_and_native_dashboards");
        records.push({key,channelId:channel.id,botPanels:botPanels.length,otherBotRecords:botPosts.length-botPanels.length,
          native:native.length,legacy:legacy.length,newestBotPanelId:botPanels[0]?.id||null,
          status:warnings.length?"REVIEW":"PASS",warnings});
      }catch(err){records.push({key,status:"READ_ERROR",detail:String(err?.message||err).slice(0,80)});}
    }
    const categories=channels.filter(c=>c.type===4).map(c=>name(c.name));
    const retired=["meeting-rooms","level-50-lounge"];
    const retiredPresent=categories.filter(c=>retired.some(r=>c.includes(r)));
    const academyPresent=categories.filter(c=>/academy|creator-lab/.test(c));
    const academyUnexpected=false;
    const summary={guildId,readOnly:true,notificationFree:true,channels:channels.length,records,retiredPresent,academyUnexpected,
      status:retiredPresent.length||academyUnexpected||records.some(r=>r.status!=="PASS")?"REVIEW":"PASS"};
    console.log(prefix+" "+JSON.stringify(summary));
  }catch(err){console.warn(prefix+" ERROR "+String(err?.message||err).slice(0,200));}
})();
// PARITY_V2_STAGED_ALIGNMENT_20261107: conference rooms intentionally retained.
// PARITY_CANONICAL_SOURCE_GUARD_20261107 — preserve current production audit corrections on future patch commit.


/* GALLERY_NATIVE_PARITY_AUDIT_V3_20261107
 * Read-only; log integrity findings; never delete, repost, edit or ping.
 */
await (async function nativeGalleryIntegrityAuditV3(){
 const G="1565048205970767992",token=Bun.env.DISCORD_BOT_TOKEN||Bun.env.DISCORD_TOKEN||"";
 const tag="GALLERY_NATIVE_PARITY_AUDIT_V3";
 const report={guild:G,readOnly:true,discordWrites:0,sourceDeletes:0,forums:[],status:"PASS"};
 if(!token){console.warn(tag+" "+JSON.stringify({...report,status:"HELD",reason:"bot_token_missing"}));return;}
 async function get(path){
  for(let attempt=0;attempt<3;attempt++){
   const res=await fetch("https://discord.com/api/v10"+path,{method:"GET",headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(13000)});
   if(res.status===429){const j=await res.json().catch(()=>({}));await Bun.sleep(Math.min(13000,Math.ceil(Number(j.retry_after||1)*1000)+250));continue;}
   if(!res.ok)throw Error("GET_"+res.status);
   return res.json();
  }throw Error("read_retry_exhausted");
 }
 const slug=v=>String(v||"").normalize("NFKC").toLowerCase().replace(/^[^a-z0-9]+/,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
 const photo=a=>String(a?.content_type||"").startsWith("image/")||/\.(?:png|jpe?g|webp|gif|avif)$/i.test(String(a?.filename||""));
 function pickThreads(list,limit){
  if(!list.length)return [];
  const origin=Math.floor(Date.now()/7200000)%list.length;
  return Array.from({length:Math.min(list.length,limit)},(_,i)=>list[(origin+i)%list.length]);
 }
 try{
  const [channels,active]=await Promise.all([get("/guilds/"+G+"/channels"),get("/guilds/"+G+"/threads/active")]);
  if(!Array.isArray(channels)||!Array.isArray(active.threads))throw Error("guild_thread_inventory_invalid");
  const forums=channels.filter(c=>c.type===15&&["event-media-archive"].includes(slug(c.name))||c.type===15&&slug(c.name).endsWith("-photo-gallery"));
  for(const forum of forums){
   const archival=await get("/channels/"+forum.id+"/threads/archived/public?limit=100");
   if(!Array.isArray(archival.threads))throw Error("archive_thread_inventory_invalid");
   const all=[...(active.threads||[]).filter(t=>t.parent_id===forum.id),...archival.threads].filter((t,i,l)=>l.findIndex(x=>x.id===t.id)===i);
   const candidates=all.filter(t=>!/posting.guide|gallery.guide|^📌/i.test(t.name||""));
   const selected=pickThreads(candidates,8),issues=[];
   if(archival.has_more)issues.push({reason:"archive_inventory_needs_pagination"});
   for(const t of selected){
    try{
     const messages=await get("/channels/"+t.id+"/messages?limit=100");
     if(!Array.isArray(messages))throw Error("thread_messages_invalid");
     const starter=messages.find(m=>m.id===t.id);
     const total=messages.reduce((n,m)=>n+(m.attachments||[]).filter(photo).length,0);
     const starterNative=(starter?.attachments||[]).filter(photo).length;
     const externals=messages.reduce((n,m)=>n+(m.embeds||[]).filter(e=>e.image||e.thumbnail).length,0);
     const lowResolution=messages.reduce((n,m)=>n+(m.attachments||[]).filter(a=>photo(a)&&Number(a.width)>0&&Number(a.height)>0&&Math.max(Number(a.width),Number(a.height))<=256).length,0);
     const reasons=[];
     if(lowResolution>0)reasons.push("low_resolution_original_needs_review");
     if(total===0)reasons.push("native_photo_missing");
     if(!starter)reasons.push("starter_not_visible");
     if(messages.length===100)reasons.push("thread_history_partial");
     if(total>0&&starterNative===0)reasons.push("photo_missing_from_starter");
     if(total>1)reasons.push("multiple_photos_in_one_thread");
     if(total===0&&externals>0)reasons.push("external_only_images");
     if(reasons.length)issues.push({thread:t.id,reasons,totalNativePhotos:total,starterNativePhotos:starterNative,lowResolutionPhotos:lowResolution});
    }catch(e){issues.push({thread:t.id,reasons:["read_error"],error:String(e?.message||e).slice(0,100)});}
   }
   report.forums.push({id:forum.id,kind:slug(forum.name).endsWith("-photo-gallery")?"creator-photo-gallery":"event-media-archive",threadsDiscovered:all.length,nonGuideThreads:candidates.length,sampled:selected.length,issues});
  }
  report.status=report.forums.some(f=>f.issues.length)?"REVIEW":"PASS";
  console.log(tag+" "+JSON.stringify(report));
 }catch(e){console.warn(tag+" "+JSON.stringify({...report,status:"READ_ERROR",reason:String(e?.message||e).slice(0,140)}));}
})();