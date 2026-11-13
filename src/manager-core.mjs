const NAME = "Dawn Dotta Discord Manager";
const API = "https://discord.com/api/v10";
const AUTHORIZED_GUILD = "1565048205970767992";
const APPLICATION_ID = "1565304619838742598";

const tools = [
  {
    name: "discord_manager_status",
    description: "Check this manager's authorized Discord connection without changing Discord.",
    inputSchema: { type:"object", properties:{}, additionalProperties:false },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  },
  {
    name: "discord_guild_request",
    description: "Read or manage resources in this manager's single authorized Discord guild. Guild routes must use that guild ID; channel routes are ownership checked. Writes require WRITES_ENABLED=true and remain subject to authenticated owner authorization, guild/channel scope, bot identity, and Discord permissions. Destructive deletes are blocked by the owner-preservation policy.",
    inputSchema: {
      type:"object",
      properties:{
        method:{type:"string",enum:["GET","POST","PUT","PATCH","DELETE"]},
        route:{type:"string",minLength:1,maxLength:500},
        query:{type:"object",additionalProperties:{type:["string","number","boolean"]}},
        body:{type:"object"},
        notification_mode:{type:"string",enum:["silent","normal"]},
      },
      required:["method","route"],additionalProperties:false,
    },
    annotations: { readOnlyHint:false, destructiveHint:true, idempotentHint:false, openWorldHint:false },
  },
  {
    name:"discord_manager_audit",
    description:"Read-only guild health, forum, role, command and independence audit for this manager's authorized Discord server. Does not modify Discord.",
    inputSchema:{type:"object",properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },
];

function quietManagedMessage(method,route,body,notificationMode) {
  const hasBodyHint=!!body&&typeof body==="object"&&!Array.isArray(body)&&Object.prototype.hasOwnProperty.call(body,"_notification_mode");
  const bodyHint=hasBodyHint?body._notification_mode:undefined;
  if(notificationMode!==undefined&&bodyHint!==undefined&&notificationMode!==bodyHint)throw Error("Conflicting notification modes");
  const mode=bodyHint??notificationMode;
  if(mode!==undefined&&!["silent","normal"].includes(mode))throw Error("Invalid notification mode");
  const post=method==="POST"&&/^\/channels\/\d{15,22}\/messages$/.test(route);
  const starter=method==="POST"&&/^\/channels\/\d{15,22}\/threads$/.test(route)&&body?.message&&typeof body.message==="object"&&!Array.isArray(body.message);
  if(hasBodyHint&&!post&&!starter)throw Error("Notification override is only valid for new messages");
  const requestBody=hasBodyHint?Object.fromEntries(Object.entries(body).filter(([k])=>k!=="_notification_mode")):body;
  if(mode==="normal"||(!post&&!starter))return requestBody;
  const target=starter?requestBody.message:requestBody;
  if(!target||typeof target!=="object"||Array.isArray(target))throw Error("Invalid message payload");
  const flags=target.flags??0;
  if(!Number.isSafeInteger(flags)||flags<0)throw Error("Unsupported message flags");
  const payload={...target,flags:flags|4096,allowed_mentions:{parse:[]},...(post?{tts:false}:{})};
  return starter?{...requestBody,message:payload}:payload;
}

function routeIsValid(route) {
  if(typeof route!=="string"||!route.startsWith("/")||route.startsWith("//")||/[\\?#]/.test(route)||/%(?:2e|2f|5c)/i.test(route))return false;
  let decoded;try{decoded=decodeURIComponent(route);}catch{return false;}
  if(decoded.includes("%")||/[\\?#]/.test(decoded)||decoded.includes("//")||decoded.split("/").some(p=>p==="."||p===".."))return false;
  return new URL(API+route).pathname===new URL(API).pathname+route;
}

function responseText(value,isError=false) {
  return {content:[{type:"text",text:typeof value==="string"?value:JSON.stringify(value)}],isError};
}
const fail=message=>responseText({error:message},true);

export function createManagerCore({env,fetchImpl=fetch,now=()=>new Date().toISOString(),timeoutSignal=(ms)=>AbortSignal.timeout(ms)}={}) {
  if(!env||typeof env!=="object"||typeof fetchImpl!=="function")throw new TypeError("Worker environment and fetch are required");
  const config=()=>({
    token:env.DISCORD_BOT_TOKEN,
    guild:env.AUTHORIZED_GUILD_ID,
    app:env.APPLICATION_ID,
    writes:env.WRITES_ENABLED==="true",
  });
  const apiFetch=async(path,options={})=>fetchImpl(API+path,options);
  async function channelGuild(id,token) {
    const r=await apiFetch("/channels/"+encodeURIComponent(id),{
      headers:{authorization:"Bot "+token,"user-agent":"DiscordManager/1.0"},
      signal:timeoutSignal(12000),
    });
    if(!r.ok)return {status:r.status};
    const c=await r.json();
    return {guildId:c.guild_id};
  }

  async function managerStandardAudit(c) {
    if(!c.token||!/^\d{15,22}$/.test(c.guild||"")||!/^\d{15,22}$/.test(c.app||""))return fail("Discord manager identity is not configured.");
    const headers={authorization:"Bot "+c.token,"user-agent":"IndependentDiscordManagerAudit"};
    const get=async(path)=>{
      const r=await apiFetch(path,{method:"GET",headers,signal:timeoutSignal(13000)});
      if(!r.ok)throw Error("read "+r.status+" "+path);
      return r.json();
    };
    try {
      const root="/guilds/"+c.guild;
      const [bot,guild,channels,roles,commands]=await Promise.all([
        get("/users/@me"),get(root),get(root+"/channels"),get(root+"/roles"),get("/applications/"+c.app+root+"/commands"),
      ]);
      if(!bot?.bot||String(bot.id)!==String(c.app)||String(guild?.id)!==String(c.guild)||!Array.isArray(channels)||!Array.isArray(roles)||!Array.isArray(commands))return fail("Authorized guild or bot identity mismatch; audit stopped.");
      const forums=channels.filter(x=>x.type===15);
      const badForums=forums.filter(x=>x.default_forum_layout!==2||x.default_auto_archive_duration!==1440)
        .map(x=>({id:x.id,name:x.name,galleryLayout:x.default_forum_layout,autoArchiveMinutes:x.default_auto_archive_duration}));
      const expectedPrivateCategories=["1565588426655404162","1565643251783049237"];
      const ids=new Set(expectedPrivateCategories);
      const privateCats=channels.filter(x=>x.type===4&&(ids.has(x.id)||/super[ _-]?fan lounge|level[ _-]?50 lounge|moderator|staff|admin/i.test(String(x.name||"").normalize("NFKC"))));
      const foundIds=new Set(privateCats.map(x=>x.id));
      const missingPrivateCategories=expectedPrivateCategories.filter(id=>!foundIds.has(id));
      const permissionExceptions=privateCats.filter(x=>{
        const entry=(x.permission_overwrites||[]).find(y=>String(y.id)===String(c.guild)&&Number(y.type)===0);
        return !entry||(BigInt(entry.deny||"0")&1024n)===0n;
      }).map(x=>({id:x.id,name:x.name,reason:"@everyone ViewChannel deny missing"}));
      const staffId="1565643251783049237",caseId="1566227861747138641",modRole="1565407676580499616";
      const caseForum=channels.find(x=>x.id===caseId),caseOverwrites=caseForum?.permission_overwrites||[];
      const caseEveryone=caseOverwrites.find(x=>x.id===c.guild&&Number(x.type)===0);
      const caseMod=caseOverwrites.find(x=>x.id===modRole&&Number(x.type)===0);
      const unexpected=caseOverwrites.filter(x=>x.id!==c.guild&&x.id!==modRole&&(BigInt(x.allow||"0")&1024n)!==0n).map(x=>x.id);
      const caseReview={
        found:!!caseForum,correctParent:caseForum?.parent_id===staffId,typeVerified:caseForum?.type===15,
        everyoneDenied:!!caseEveryone&&(BigInt(caseEveryone.deny||"0")&1024n)!==0n,
        moderatorsAllowed:!!caseMod&&(BigInt(caseMod.allow||"0")&1024n)!==0n,
        unexpectedViewGrants:unexpected,
      };
      caseReview.passed=caseReview.found&&caseReview.correctParent&&caseReview.typeVerified&&caseReview.everyoneDenied&&caseReview.moderatorsAllowed&&unexpected.length===0;
      const retiredLevel50Channels=channels.filter(x=>/level[\s_-]*50.*lounge|lounge.*level[\s_-]*50/i.test(String(x.name||"").normalize("NFKC")));
      const warnings=[];
      if(retiredLevel50Channels.length)warnings.push("Retired Level 50 Lounge channels detected; no channels changed.");
      if(commands.length!==36)warnings.push("Guild command count differs from 36; no commands changed.");
      if(badForums.length)warnings.push("Some forums differ from gallery layout or 24-hour auto-archive; no forums changed.");
      if(missingPrivateCategories.length)warnings.push("Known private categories are missing; no categories changed.");
      if(permissionExceptions.length)warnings.push("Private category permissions need review; no permissions changed.");
      if(!caseReview.passed)warnings.push("Case Review forum location or privacy needs review; no permissions changed.");
      return responseText({
        manager:NAME,authorizedGuild:c.guild,botId:bot.id,identityVerified:true,readOnly:true,writesEnabled:c.writes,
        checkedAt:now(),
        counts:{channels:channels.length,roles:roles.length,forums:forums.length,commands:commands.length,categories:channels.filter(x=>x.type===4).length},
        forums:{expectedGalleryLayout:2,expectedArchiveMinutes:1440,exceptions:badForums},
        privateCategoryReview:{examined:privateCats.length,expectedPrivateCount:expectedPrivateCategories.length,missing:missingPrivateCategories,exceptions:permissionExceptions},
        caseReview,retiredLevel50Channels:retiredLevel50Channels.map(x=>({id:x.id,name:x.name})),warnings,passed:warnings.length===0,
      });
    } catch(e) {
      return fail("Read-only audit unavailable: "+String(e?.message||"request failed").replace(/Bot [^ ]+/g,"[redacted]").slice(0,180));
    }
  }

  async function managerStatus(c) {
    if(!c.token||!c.guild)return responseText({manager:NAME,state:"needs_discord_credentials",authorizedGuild:!!c.guild,botCredentialPresent:!!c.token,writesEnabled:c.writes});
    try {
      const options={headers:{authorization:"Bot "+c.token,"user-agent":"DiscordManager/1.0"},signal:timeoutSignal(12000)};
      const [identity,guild]=await Promise.all([
        apiFetch("/users/@me",options),
        apiFetch("/guilds/"+encodeURIComponent(c.guild),options),
      ]);
      const isLimited=async r=>{
        if(r.status===429)return true;
        if(r.status!==403)return false;
        if(r.headers.get("cf-ray")||r.headers.get("cf-mitigated")||/cloudflare/i.test(r.headers.get("server")||""))return true;
        try{return /cloudflare|error code:\s*1015|1015/i.test((await r.clone().text()).slice(0,1200));}catch{return false;}
      };
      const limited=(await isLimited(identity))||(await isLimited(guild));
      const retryValues=[];
      for(const r of [identity,guild]){
        const h=Number(r.headers.get("retry-after"));
        if(Number.isFinite(h)&&h>0)retryValues.push(h);
        if(!r.ok){try{const j=await r.clone().json();const n=Number(j?.retry_after);if(Number.isFinite(n)&&n>0)retryValues.push(n);}catch{}}
      }
      const me=identity.ok?await identity.json():null,g= guild.ok?await guild.json():null;
      const botIdentityMatches=me?Boolean(me.bot&&c.app&&String(me.id)===String(c.app)):null;
      const guildMatches=g?String(g.id)===String(c.guild):null;
      const guildReachable=guild.ok?true:(guild.status===403||guild.status===404)&&!limited?false:null;
      if(limited)return responseText({manager:NAME,state:"discord_rate_limited",authorizedGuild:c.guild,botCredentialPresent:true,botIdentityVerified:identity.ok,botIdentityMatches,guildReachable,guildIdentityMatches:guildMatches,discordHttp:{identity:identity.status,guild:guild.status},retryAfterSeconds:retryValues.length?Math.max(...retryValues):null,retryAutomatically:false,writesEnabled:c.writes});
      if(identity.status===401||identity.status===403)return responseText({manager:NAME,state:"invalid_bot_credentials",authorizedGuild:c.guild,botCredentialPresent:true,botIdentityVerified:false,botIdentityMatches:null,guildReachable,guildIdentityMatches:guildMatches,discordHttp:{identity:identity.status,guild:guild.status},writesEnabled:c.writes});
      if(!identity.ok||!guild.ok){
        const state=[500,502,503,504].includes(identity.status)||[500,502,503,504].includes(guild.status)?"discord_api_unavailable":guild.status===403||guild.status===404?"guild_access_denied":"discord_connection_unverified";
        return responseText({manager:NAME,state,authorizedGuild:c.guild,botCredentialPresent:true,botIdentityVerified:identity.ok,botIdentityMatches,guildReachable,guildIdentityMatches:guildMatches,discordHttp:{identity:identity.status,guild:guild.status},retryAfterSeconds:retryValues.length?Math.max(...retryValues):null,writesEnabled:c.writes});
      }
      const state=!botIdentityMatches?"bot_identity_mismatch":!guildMatches?"guild_identity_mismatch":"connected";
      return responseText({manager:NAME,state,authorizedGuild:c.guild,botCredentialPresent:true,botIdentityVerified:true,botIdentityMatches,guildReachable:true,guildIdentityMatches:guildMatches,discordHttp:{identity:identity.status,guild:guild.status},retryAfterSeconds:null,writesEnabled:c.writes});
    } catch(error) {
      return responseText({manager:NAME,state:"connection_check_error",authorizedGuild:c.guild,botCredentialPresent:!!c.token,diagnostic:String(error?.name||"request_failed"),guildReachable:null,botIdentityMatches:null,writesEnabled:c.writes});
    }
  }

  async function commandInventory(c,method) {
    if(method!=="GET")return fail("Command inventory is read-only.");
    const headers={authorization:"Bot "+c.token,"user-agent":"DiscordManagerReadOnlyInventory/1.0"};
    const get=async path=>{
      const response=await apiFetch(path,{headers,signal:timeoutSignal(12000)});
      if(!response.ok)return {ok:false,status:response.status};
      return {ok:true,data:await response.json()};
    };
    try {
      const [identity,globals,guildCommands]=await Promise.all([
        get("/users/@me"),get("/applications/"+c.app+"/commands"),
        get("/applications/"+c.app+"/guilds/"+c.guild+"/commands"),
      ]);
      if(!identity.ok||identity.data?.bot!==true||String(identity.data?.id)!==String(c.app))return fail("Bot application identity could not be verified.");
      if(!globals.ok||!guildCommands.ok)return fail("Read-only command inventory unavailable (global HTTP "+(globals.status||200)+", guild HTTP "+(guildCommands.status||200)+").");
      const canonical=list=>list.map(x=>({
        name:x.name,type:x.type||1,description:x.description||"",options:x.options||[],
        default_member_permissions:x.default_member_permissions??null,
        contexts:(x.contexts||[]).slice().sort(),integration_types:(x.integration_types||[]).slice().sort(),
        nsfw:x.nsfw===true,name_localizations:x.name_localizations||null,
        description_localizations:x.description_localizations||null,
      })).sort((a,b)=>a.name.localeCompare(b.name)||a.type-b.type);
      const digest=async items=>{
        const bytes=new TextEncoder().encode(JSON.stringify(items)),hash=await crypto.subtle.digest("SHA-256",bytes);
        return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
      };
      const g=canonical(globals.data),l=canonical(guildCommands.data);
      return responseText({manager:NAME,mode:"read-only",authorizedGuild:c.guild,applicationId:c.app,botUserId:identity.data.id,identityVerified:true,global:{count:g.length,sha256:await digest(g),commands:g},guild:{count:l.length,sha256:await digest(l),commands:l},discordContentModified:false});
    } catch(error) {return fail("Command inventory diagnostic failed: "+String(error?.name||"unknown"));}
  }

  async function capabilities(c,method) {
    if(method!=="GET")return fail("Read-only capability diagnostic requires GET");
    const h={authorization:"Bot "+c.token,"user-agent":"DiscordManagerCapabilityAudit/1.0"};
    const get=async path=>{
      const response=await apiFetch(path,{headers:h,signal:timeoutSignal(10000)});
      let data=null;try{data=await response.json();}catch{}
      return {ok:response.ok,status:response.status,data:response.ok?data:null};
    };
    try {
      const root="/guilds/"+c.guild;
      const [identity,guild,rolesResult,channelResult]=await Promise.all([get("/users/@me"),get(root),get(root+"/roles"),get(root+"/channels")]);
      if(!identity.ok||!guild.ok||!rolesResult.ok||!channelResult.ok||guild.data?.id!==c.guild)return fail("Permission diagnostic readback failed; no changes made");
      const botId=identity.data?.id,member=await get(root+"/members/"+botId);
      if(!member.ok)return fail("Bot membership readback failed (HTTP "+member.status+"); no changes made");
      const roles=rolesResult.data,memberRoleIds=new Set(member.data.roles||[]),botRoles=roles.filter(r=>memberRoleIds.has(r.id));
      const bits=roles.filter(r=>r.id===c.guild||memberRoleIds.has(r.id)).reduce((p,r)=>p|BigInt(r.permissions||"0"),0n);
      const admin=(bits&8n)!==0n,has=bit=>admin||(bits&(1n<<BigInt(bit)))!==0n;
      const highestRolePosition=Math.max(0,...botRoles.map(r=>Number(r.position)||0));
      const hierarchyAbove=roles.filter(r=>r.id!==c.guild&&!memberRoleIds.has(r.id)&&Number(r.position)>=highestRolePosition).map(r=>({name:r.name,position:r.position,managed:r.managed===true}));
      const channels=channelResult.data;
      return responseText({
        manager:NAME,mode:"read-only",authorizedGuild:c.guild,botId,botUsername:identity.data?.username,writesEnabled:c.writes,guildReachable:true,
        guildPermissions:{administrator:admin,manageGuild:has(5),manageChannels:has(4),manageRoles:has(28),manageMessages:has(13),viewAuditLog:has(7),manageWebhooks:has(29),manageEvents:has(33),moderateMembers:has(40)},
        roleHierarchy:{highestBotPosition:highestRolePosition,rolesAtOrAbove:hierarchyAbove,limitation:hierarchyAbove.length?"Cannot manage these higher or equal-position roles, even as Administrator":"No non-bot roles at or above the bot's highest role"},
        resources:{channels:channels.length,forums:channels.filter(ch=>ch.type===15).length,roles:roles.length},exposedManagerTools:tools.map(t=>t.name),scopeVerified:true,discordContentModified:false,
      });
    } catch(e) {return fail("Capability diagnostic unavailable: "+String(e?.message||e).slice(0,150));}
  }

  async function guildRequest(c,args) {
    if(!c.token||!c.guild)return fail("Discord credentials are not configured for this manager.");
    const method=args?.method,route=args?.route;
    if(!routeIsValid(route))return fail("Invalid Discord API route.");
    const root="/guilds/"+c.guild;
    if(route===root+"/manager/command-inventory")return commandInventory(c,method);
    if(route===root+"/manager/capabilities")return capabilities(c,method);
    const segments=route.split("/");
    const deletingChannel=method==="DELETE"&&(
      (segments[1]==="channels"&&segments.length===3&&/^\d{15,22}$/.test(segments[2]||""))||
      (segments[1]==="guilds"&&segments[2]===c.guild&&segments[3]==="channels"&&segments.length===5&&/^\d{15,22}$/.test(segments[4]||""))
    );
    const deletingRole=method==="DELETE"&&segments[1]==="guilds"&&segments[2]===c.guild&&segments[3]==="roles"&&segments.length===5&&/^\d{15,22}$/.test(segments[4]||"");
    if(deletingChannel||deletingRole)return fail("Channel, category, and role deletions are blocked by the owner-preservation policy. Use a separate, explicitly authorized recovery or deletion workflow; no Discord resource was changed.");
    const channelId=segments[1]==="channels"&&/^[0-9]{15,22}$/.test(segments[2]||"")?segments[2]:null;
    if(!(route===root||route.startsWith(root+"/")||channelId))return fail("Route is outside this manager's authorized guild.");
    if(channelId){
      const owner=await channelGuild(channelId,c.token);
      if(owner.status)return fail("Channel ownership could not be verified (Discord returned "+owner.status+").");
      if(owner.guildId!==c.guild)return fail("Channel is outside this manager's authorized guild.");
    }
    if(method!=="GET"){
      if(!c.writes)return fail("Writes are disabled until WRITES_ENABLED=true is set for this service.");
      if(!/^\d{15,22}$/.test(c.app||""))return fail("Configured bot application identity is missing.");
      try{
        const who=await apiFetch("/users/@me",{headers:{authorization:"Bot "+c.token},signal:timeoutSignal(12000)});
        if(!who.ok||String((await who.json()).id)!==c.app)return fail("Discord bot application identity mismatch; no write performed.");
      }catch{return fail("Discord bot identity could not be verified; no write performed.");}
    }
    const url=new URL(API+route);
    for(const [k,v] of Object.entries(args.query||{})){
      if(!/^[a-zA-Z0-9_-]{1,80}$/.test(k))return fail("Invalid query parameter.");
      url.searchParams.set(k,String(v));
    }
    const headers={authorization:"Bot "+c.token,"user-agent":"DiscordManager/1.0"};
    const init={method,headers};
    if(args.body!==undefined){
      headers["content-type"]="application/json";
      let sendBody;try{sendBody=quietManagedMessage(method,route,args.body,args.notification_mode);}catch(e){return fail(String(e.message||e));}
      init.body=JSON.stringify(sendBody);
    }
    const r=await fetchImpl(url,init),raw=await r.text();
    let value;try{value=raw?JSON.parse(raw):null;}catch{value={message:raw.slice(0,2000)};}
    return r.ok?responseText(value):responseText({status:r.status,discord:value,retryAfter:r.headers.get("retry-after")},true);
  }

  async function invoke(name,args={}) {
    const c=config();
    if(c.guild!==AUTHORIZED_GUILD||c.app!==APPLICATION_ID)return fail("Momentum Movement identity configuration mismatch.");
    if(name==="discord_guild_request"&&(!args||!["GET","POST","PUT","PATCH","DELETE"].includes(args.method)))return fail("Invalid HTTP method.");
    if(name==="discord_manager_status")return managerStatus(c);
    if(name==="discord_manager_audit")return managerStandardAudit(c);
    if(name==="discord_guild_request")return guildRequest(c,args);
    return fail("Unknown tool.");
  }
  return {tools,invoke};
}
