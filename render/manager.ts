const NAME = "Dawn Dotta Discord Manager";
const API = "https://discord.com/api/v10";
function quietManagedMessage(method,route,body,notificationMode){
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

const tools = [
  {name:"discord_manager_status",description:"Check this manager's authorized Discord connection without changing Discord.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
  {name:"discord_guild_request",description:"Read or manage resources in this manager's single authorized Discord guild. Guild routes must use that guild ID; channel routes are ownership checked. Writes require WRITES_ENABLED=true and remain subject to authenticated owner authorization, guild/channel scope, bot identity, and Discord permissions. Destructive actions require explicit authorization for that specific action; no confirmation phrase is required.",inputSchema:{type:"object",properties:{method:{type:"string",enum:["GET","POST","PUT","PATCH","DELETE"]},route:{type:"string",minLength:1,maxLength:500},query:{type:"object",additionalProperties:{type:["string","number","boolean"]}},body:{type:"object"},notification_mode:{type:"string",enum:["silent","normal"],description:"Silent by default for manager-created messages and forum starters. Use normal only when the server owner explicitly authorizes a public notification, such as LIVE or SOS."}},required:["method","route"],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}},
  {name:"discord_manager_audit",description:"Read-only guild health, forum, role, command and independence audit for this manager\u0027s authorized Discord server. Does not modify Discord.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const text=(value,isError=false)=>({content:[{type:"text",text:typeof value==="string"?value:JSON.stringify(value)}],isError});
const fail=(message)=>text({error:message},true);
const config=()=>({token:Bun.env.DISCORD_BOT_TOKEN,guild:Bun.env.AUTHORIZED_GUILD_ID,writes:Bun.env.WRITES_ENABLED==="true",app:Bun.env.APPLICATION_ID});
const validRoute=(route)=>{if(typeof route!=="string"||!route.startsWith("/")||route.startsWith("//")||/[\\?#]/.test(route)||/%(?:2e|2f|5c)/i.test(route))return false;let decoded;try{decoded=decodeURIComponent(route)}catch{return false}if(decoded.includes("%")||/[\\?#]/.test(decoded)||decoded.includes("//")||decoded.split("/").some(p=>p==="."||p===".."))return false;return new URL(API+route).pathname===new URL(API).pathname+route;};
async function channelGuild(id,token){const r=await fetch(API+"/channels/"+encodeURIComponent(id),{headers:{authorization:"Bot "+token,"user-agent":"DiscordManager/1.0"}});if(!r.ok)return {status:r.status};const c=await r.json();return {guildId:c.guild_id};}
async function managerStandardAudit(c){
 if(!c.token||!/^\d{15,22}$/.test(c.guild||"")||!/^\d{15,22}$/.test(c.app||""))return fail("Discord manager identity is not configured.");
 const headers={authorization:"Bot "+c.token,"user-agent":"IndependentDiscordManagerAudit"};
 const get=async(path)=>{const r=await fetch(API+path,{method:"GET",headers,signal:AbortSignal.timeout(13000)});if(!r.ok)throw Error("read "+r.status+" "+path);return r.json();};
 try{
  const root="/guilds/"+c.guild;
  const [bot,guild,channels,roles,commands]=await Promise.all([get("/users/@me"),get(root),get(root+"/channels"),get(root+"/roles"),get("/applications/"+c.app+root+"/commands")]);
  if(!bot?.bot||String(bot.id)!==String(c.app)||String(guild?.id)!==String(c.guild)||!Array.isArray(channels)||!Array.isArray(roles)||!Array.isArray(commands))return fail("Authorized guild or bot identity mismatch; audit stopped.");
  const forums=channels.filter(x=>x.type===15);
  const badForums=forums.filter(x=>x.default_forum_layout!==2||x.default_auto_archive_duration!==1440).map(x=>({id:x.id,name:x.name,galleryLayout:x.default_forum_layout,autoArchiveMinutes:x.default_auto_archive_duration}));
  // The current Discord category names use Mathematical Sans-Serif Bold Unicode; normalize when auditing.
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
  const caseReview={found:!!caseForum,correctParent:caseForum?.parent_id===staffId,typeVerified:caseForum?.type===15,
   everyoneDenied:!!caseEveryone&&(BigInt(caseEveryone.deny||"0")&1024n)!==0n,
   moderatorsAllowed:!!caseMod&&(BigInt(caseMod.allow||"0")&1024n)!==0n,
   unexpectedViewGrants:unexpected};
  caseReview.passed=caseReview.found&&caseReview.correctParent&&caseReview.typeVerified&&caseReview.everyoneDenied&&caseReview.moderatorsAllowed&&unexpected.length===0;
  const retiredLevel50Channels=channels.filter(x=>/level[\s_-]*50.*lounge|lounge.*level[\s_-]*50/i.test(String(x.name||"").normalize("NFKC")));
  const warnings=[];
  if(retiredLevel50Channels.length)warnings.push("Retired Level 50 Lounge channels detected; no channels changed.");
  if(commands.length!==36)warnings.push("Guild command count differs from 36; no commands changed.");
  if(badForums.length)warnings.push("Some forums differ from gallery layout or 24-hour auto-archive; no forums changed.");
  if(missingPrivateCategories.length)warnings.push("Known private categories are missing; no categories changed.");
  if(permissionExceptions.length)warnings.push("Private category permissions need review; no permissions changed.");
  if(!caseReview.passed)warnings.push("Case Review forum location or privacy needs review; no permissions changed.");
  return text({manager:NAME,authorizedGuild:c.guild,botId:bot.id,identityVerified:true,readOnly:true,writesEnabled:c.writes,checkedAt:new Date().toISOString(),counts:{channels:channels.length,roles:roles.length,forums:forums.length,commands:commands.length,categories:channels.filter(x=>x.type===4).length},forums:{expectedGalleryLayout:2,expectedArchiveMinutes:1440,exceptions:badForums},privateCategoryReview:{examined:privateCats.length,expectedPrivateCount:expectedPrivateCategories.length,missing:missingPrivateCategories,exceptions:permissionExceptions},caseReview,retiredLevel50Channels:retiredLevel50Channels.map(x=>({id:x.id,name:x.name})),warnings,passed:warnings.length===0});
 }catch(e){return fail("Read-only audit unavailable: "+String(e?.message||"request failed").replace(/Bot [^ ]+/g,"[redacted]").slice(0,180));}
}
async function invoke(name,args){
 const c=config();
 if(c.guild!=="1565048205970767992"||c.app!=="1565304619838742598")return fail("Momentum Movement identity configuration mismatch.");
 if(name==="discord_guild_request"&&(!args||!["GET","POST","PUT","PATCH","DELETE"].includes(args.method)))return fail("Invalid HTTP method.");
 if(name==="discord_manager_status"){
   if(!c.token||!c.guild)return text({manager:NAME,state:"needs_discord_credentials",authorizedGuild:!!c.guild,botCredentialPresent:!!c.token,writesEnabled:c.writes});
   try{
    const options={headers:{authorization:"Bot "+c.token,"user-agent":"DiscordManager/1.0"},signal:AbortSignal.timeout(12000)};
    const [identity,guild]=await Promise.all([fetch(API+"/users/@me",options),fetch(API+"/guilds/"+encodeURIComponent(c.guild),options)]);
    const isCloudflareBlocked=async r=>{
     if(r.status===429)return true;
     if(r.status!==403)return false;
     if(r.headers.get("cf-ray")||r.headers.get("cf-mitigated")||/cloudflare/i.test(r.headers.get("server")||""))return true;
     try{const body=(await r.clone().text()).slice(0,1200);return /cloudflare|error code:\s*1015|1015/i.test(body);}catch{return false;}
    };
    const limited=(await isCloudflareBlocked(identity))||(await isCloudflareBlocked(guild));
    const retryValues=[];
    for(const r of [identity,guild]){
     const h=Number(r.headers.get("retry-after"));
     if(Number.isFinite(h)&&h>0)retryValues.push(h);
     if(!r.ok){try{const j=await r.clone().json();const n=Number(j?.retry_after);if(Number.isFinite(n)&&n>0)retryValues.push(n);}catch{}}
    }
    const me=identity.ok?await identity.json():null;
    const g=guild.ok?await guild.json():null;
    const botIdentityMatches=me?Boolean(me.bot&&c.app&&String(me.id)===String(c.app)):null;
    const guildMatches=g?String(g.id)===String(c.guild):null;
    const guildReachable=guild.ok?true:(guild.status===403||guild.status===404)&&!limited?false:null;
    if(limited)return text({manager:NAME,state:"discord_rate_limited",authorizedGuild:c.guild,botCredentialPresent:true,botIdentityVerified:identity.ok,botIdentityMatches,guildReachable,guildIdentityMatches:guildMatches,discordHttp:{identity:identity.status,guild:guild.status},retryAfterSeconds:retryValues.length?Math.max(...retryValues):null,retryAutomatically:false,writesEnabled:c.writes});
    if(identity.status===401||identity.status===403)return text({manager:NAME,state:"invalid_bot_credentials",authorizedGuild:c.guild,botCredentialPresent:true,botIdentityVerified:false,botIdentityMatches:null,guildReachable,guildIdentityMatches:guildMatches,discordHttp:{identity:identity.status,guild:guild.status},writesEnabled:c.writes});
    if(!identity.ok||!guild.ok){
     const state=[500,502,503,504].includes(identity.status)||[500,502,503,504].includes(guild.status)?"discord_api_unavailable":guild.status===403||guild.status===404?"guild_access_denied":"discord_connection_unverified";
     return text({manager:NAME,state,authorizedGuild:c.guild,botCredentialPresent:true,botIdentityVerified:identity.ok,botIdentityMatches,guildReachable,guildIdentityMatches:guildMatches,discordHttp:{identity:identity.status,guild:guild.status},retryAfterSeconds:retryValues.length?Math.max(...retryValues):null,writesEnabled:c.writes});
    }
    const state=!botIdentityMatches?"bot_identity_mismatch":!guildMatches?"guild_identity_mismatch":"connected";
    return text({manager:NAME,state,authorizedGuild:c.guild,botCredentialPresent:true,botIdentityVerified:true,botIdentityMatches,guildReachable:true,guildIdentityMatches:guildMatches,discordHttp:{identity:identity.status,guild:guild.status},retryAfterSeconds:null,writesEnabled:c.writes});
   }catch(error){
    return text({manager:NAME,state:"connection_check_error",authorizedGuild:c.guild,botCredentialPresent:!!c.token,diagnostic:String(error?.name||"request_failed"),guildReachable:null,botIdentityMatches:null,writesEnabled:c.writes});
   }
  }
  if(name==="discord_manager_audit")return managerStandardAudit(c);
 if(name!=="discord_guild_request")return fail("Unknown tool.");
 if(!c.token||!c.guild)return fail("Discord credentials are not configured for this manager.");
 const method=args&&args.method,route=args&&args.route;
 if(!validRoute(route))return fail("Invalid Discord API route.");
 const root="/guilds/"+c.guild;
 if(route===root+"/manager/command-inventory"){
  if(method!=="GET")return fail("Command inventory is read-only.");
  if(!/^\d{15,22}$/.test(c.app||""))return fail("Configured application ID is missing.");
  try {
   const headers={authorization:"Bot "+c.token,"user-agent":"DiscordManagerReadOnlyInventory/1.0"};
   const get=async path=>{
    const response=await fetch(API+path,{headers,signal:AbortSignal.timeout(12000)});
    if(!response.ok)return {ok:false,status:response.status};
    const data=await response.json();
    return {ok:true,data};
   };
   const [identity,globals,guildCommands]=await Promise.all([
    get("/users/@me"),get("/applications/"+c.app+"/commands"),
    get("/applications/"+c.app+"/guilds/"+c.guild+"/commands")
   ]);
   if(!identity.ok||identity.data?.bot!==true||String(identity.data?.id)!==String(c.app))
     return fail("Bot application identity could not be verified.");
   if(!globals.ok||!guildCommands.ok)
     return fail("Read-only command inventory unavailable (global HTTP "+(globals.status||200)+", guild HTTP "+(guildCommands.status||200)+").");
   const canonical=list=>list.map(x=>({
    name:x.name,type:x.type||1,description:x.description||"",
    options:x.options||[],default_member_permissions:x.default_member_permissions??null,
    contexts:(x.contexts||[]).slice().sort(),integration_types:(x.integration_types||[]).slice().sort(),
    nsfw:x.nsfw===true,name_localizations:x.name_localizations||null,
    description_localizations:x.description_localizations||null
   })).sort((a,b)=>a.name.localeCompare(b.name)||a.type-b.type);
   const digest=async items=>{
    const bytes=new TextEncoder().encode(JSON.stringify(items));
    const hash=await crypto.subtle.digest("SHA-256",bytes);
    return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
   };
   const g=canonical(globals.data),l=canonical(guildCommands.data);
   return text({manager:NAME,mode:"read-only",authorizedGuild:c.guild,applicationId:c.app,
    botUserId:identity.data.id,identityVerified:true,global:{count:g.length,sha256:await digest(g),commands:g},
    guild:{count:l.length,sha256:await digest(l),commands:l},discordContentModified:false});
  }catch(error){return fail("Command inventory diagnostic failed: "+String(error?.name||"unknown"));}
 }
 if(route===root+"/manager/capabilities"){
  if(method!=="GET")return fail("Read-only capability diagnostic requires GET");
  const h={authorization:"Bot "+c.token,"user-agent":"DiscordManagerCapabilityAudit/1.0"};
  const get=async path=>{const response=await fetch(API+path,{headers:h,signal:AbortSignal.timeout(10000)});let data=null;try{data=await response.json()}catch{}return {ok:response.ok,status:response.status,data:response.ok?data:null};};
  try{
   const [identity,guild,rolesResult,channelResult]=await Promise.all([get("/users/@me"),get(root),get(root+"/roles"),get(root+"/channels")]);
   if(!identity.ok||!guild.ok||!rolesResult.ok||!channelResult.ok||guild.data?.id!==c.guild)return fail("Permission diagnostic readback failed; no changes made");
   const botId=identity.data?.id,member=await get(root+"/members/"+botId);
   if(!member.ok)return fail("Bot membership readback failed (HTTP "+member.status+"); no changes made");
   const roles=rolesResult.data,memberRoleIds=new Set(member.data.roles||[]);
   const botRoles=roles.filter(r=>memberRoleIds.has(r.id));
   const bits=roles.filter(r=>r.id===c.guild||memberRoleIds.has(r.id)).reduce((p,r)=>p|BigInt(r.permissions||"0"),0n);
   const admin=(bits&8n)!==0n;
   const has=bit=>admin||(bits&(1n<<BigInt(bit)))!==0n;
   const highestRolePosition=Math.max(0,...botRoles.map(r=>Number(r.position)||0));
   const hierarchyAbove=roles.filter(r=>r.id!==c.guild&&!memberRoleIds.has(r.id)&&Number(r.position)>=highestRolePosition).map(r=>({name:r.name,position:r.position,managed:r.managed===true}));
   const channels=channelResult.data;
   return text({manager:NAME,mode:"read-only",authorizedGuild:c.guild,botId,botUsername:identity.data?.username,writesEnabled:c.writes,guildReachable:true,guildPermissions:{administrator:admin,manageGuild:has(5),manageChannels:has(4),manageRoles:has(28),manageMessages:has(13),viewAuditLog:has(7),manageWebhooks:has(29),manageEvents:has(33),moderateMembers:has(40)},roleHierarchy:{highestBotPosition:highestRolePosition,rolesAtOrAbove:hierarchyAbove,limitation:hierarchyAbove.length?"Cannot manage these higher or equal-position roles, even as Administrator":"No non-bot roles at or above the bot's highest role"},resources:{channels:channels.length,forums:channels.filter(ch=>ch.type===15).length,roles:roles.length},exposedManagerTools:tools.map(t=>t.name),scopeVerified:true,discordContentModified:false});
  }catch(e){return fail("Capability diagnostic unavailable: "+String(e?.message||e).slice(0,150));}
 }
 const segments=route.split("/");
 const deletingChannel=method==="DELETE"&&(
  (segments[1]==="channels"&&segments.length===3&&/^\d{15,22}$/.test(segments[2]||""))||
  (segments[1]==="guilds"&&segments[2]===c.guild&&segments[3]==="channels"&&segments.length===5&&/^\d{15,22}$/.test(segments[4]||""))
 );
 const deletingRole=method==="DELETE"&&segments[1]==="guilds"&&segments[2]===c.guild&&segments[3]==="roles"&&segments.length===5&&/^\d{15,22}$/.test(segments[4]||"");
 if(deletingChannel||deletingRole){
  console.warn(JSON.stringify({event:"discord_destructive_delete_blocked",manager:NAME,resource:deletingChannel?"channel_or_category":"role",route,guild:c.guild,reason:"owner_preservation_policy_requires_separate_specific_authorization"}));
  return fail("Channel, category, and role deletions are blocked by the owner-preservation policy. Use a separate, explicitly authorized recovery or deletion workflow; no Discord resource was changed.");
 }
 const channelId=segments[1]==="channels"&&/^[0-9]{15,22}$/.test(segments[2]||"")?segments[2]:null;
 if(!(route===root||route.startsWith(root+"/")||channelId))return fail("Route is outside this manager's authorized guild.");
 if(channelId){const owner=await channelGuild(channelId,c.token);if(owner.status)return fail("Channel ownership could not be verified (Discord returned "+owner.status+").");if(owner.guildId!==c.guild)return fail("Channel is outside this manager's authorized guild.");}
 if(method!=="GET"){if(!c.writes)return fail("Writes are disabled until WRITES_ENABLED=true is set for this manager service.");if(!/^\d{15,22}$/.test(c.app||""))return fail("Configured bot application identity is missing.");try{const who=await fetch(API+"/users/@me",{headers:{authorization:"Bot "+c.token},signal:AbortSignal.timeout(12000)});if(!who.ok||String((await who.json()).id)!==c.app)return fail("Discord bot application identity mismatch; no write performed.");}catch{return fail("Discord bot identity could not be verified; no write performed.");}}
 const url=new URL(API+route);
 for(const [k,v] of Object.entries(args.query||{})){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(k))return fail("Invalid query parameter.");url.searchParams.set(k,String(v));}
 const headers={authorization:"Bot "+c.token,"user-agent":"DiscordManager/1.0"};
 const init={method,headers};if(args.body!==undefined){headers["content-type"]="application/json";let sendBody;try{sendBody=quietManagedMessage(method,route,args.body,args.notification_mode)}catch(e){return fail(String(e.message||e))}init.body=JSON.stringify(sendBody);}
 const r=await fetch(url,init);const raw=await r.text();let value;try{value=raw?JSON.parse(raw):null;}catch{value={message:raw.slice(0,2000)};}
 console.log(JSON.stringify({event:"discord_api_call",manager:NAME,method,route,status:r.status,changed:method!=="GET"}));
 return r.ok?text(value):text({status:r.status,discord:value,retryAfter:r.headers.get("retry-after")},true);
}
const { SQL: McpOAuthSQL } = await import("bun");
const mcpOAuthDb = Bun.env.OAUTH_DATABASE_URL ? new McpOAuthSQL(Bun.env.OAUTH_DATABASE_URL) : null;
let mcpOAuthSchemaPromise = null;
const mcpOAuthEnabled = () => Bun.env.MCP_OAUTH_ENABLED === "true";
const mcpOAuthJson = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const mcpOAuthB64 = bytes => { let s=""; for(const b of bytes)s+=String.fromCharCode(b); return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_"); };
const mcpOAuthRandom = (n=32) => { const b=new Uint8Array(n); crypto.getRandomValues(b); return mcpOAuthB64(b); };
const mcpOAuthHash = async value => { const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value)))); return Array.from(b,x=>x.toString(16).padStart(2,"0")).join(""); };
const mcpOAuthPkce = async verifier => mcpOAuthB64(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))));
const mcpOAuthQuery = (db,sql,...values) => db.unsafe(sql,values);
const mcpOAuthIssuer = () => { const u=new URL(Bun.env.OAUTH_ISSUER_URL||Bun.env.DISCORD_OAUTH_REDIRECT_URI||"https://invalid.invalid"); if(u.protocol!=="https:")throw new Error("invalid_issuer"); return u.origin; };
const mcpOAuthResource = () => { const u=new URL(Bun.env.OAUTH_RESOURCE_URL||(mcpOAuthIssuer()+"/mcp")); if(u.protocol!=="https:"||u.search||u.hash||u.username||u.password)throw new Error("invalid_resource"); return u.origin+(u.pathname==="/"?"/mcp":u.pathname.replace(/\/+$/,"")); };
const mcpOAuthDiscordRedirect = () => { const u=new URL(Bun.env.DISCORD_OAUTH_REDIRECT_URI||(mcpOAuthIssuer()+"/oauth/callback")); if(u.protocol!=="https:"||u.username||u.password||u.hash)throw new Error("invalid_discord_redirect"); return u.toString(); };
const mcpOAuthScopes = value => { const req=String(value||"mcp:read mcp:write").trim().split(/\s+/).filter(Boolean); const all=req.includes("mcp")?["mcp:read","mcp:write",...req.filter(x=>x!=="mcp")]:req; const unique=[...new Set(all)]; if(!unique.includes("mcp:read")||unique.some(x=>!["mcp:read","mcp:write"].includes(x)))throw new Error("invalid_scope"); return unique.sort().join(" "); };
const mcpOAuthSafeRedirect = value => { try { const u=new URL(value); if(u.username||u.password||u.hash)return false; if(u.protocol==="https:")return true; return u.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(u.hostname); } catch { return false; } };
async function mcpOAuthEnsureSchema(){
 if(!mcpOAuthDb)throw new Error("oauth_database_unavailable");
 if(!mcpOAuthSchemaPromise){
  mcpOAuthSchemaPromise=(async()=>{
   await mcpOAuthQuery(mcpOAuthDb,"CREATE TABLE IF NOT EXISTS mcp_oauth_clients (client_id text PRIMARY KEY, client_name text NOT NULL, redirect_uris text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())");
   await mcpOAuthQuery(mcpOAuthDb,"CREATE TABLE IF NOT EXISTS mcp_oauth_login_requests (state_hash text PRIMARY KEY, client_id text NOT NULL, redirect_uri text NOT NULL, client_state text, code_challenge text NOT NULL, scope text NOT NULL, resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, consumed_at timestamptz)");
   await mcpOAuthQuery(mcpOAuthDb,"CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes (code_hash text PRIMARY KEY, client_id text NOT NULL, redirect_uri text NOT NULL, code_challenge text NOT NULL, user_id text NOT NULL, guild_id text NOT NULL, scope text NOT NULL, resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, consumed_at timestamptz)");
   await mcpOAuthQuery(mcpOAuthDb,"CREATE TABLE IF NOT EXISTS mcp_oauth_access_tokens (token_hash text PRIMARY KEY, client_id text NOT NULL, user_id text NOT NULL, guild_id text NOT NULL, scope text NOT NULL, resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz)");
   await mcpOAuthQuery(mcpOAuthDb,"CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (token_hash text PRIMARY KEY, client_id text NOT NULL, user_id text NOT NULL, guild_id text NOT NULL, scope text NOT NULL, resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz, replaced_by text)");
   await mcpOAuthQuery(mcpOAuthDb,"CREATE INDEX IF NOT EXISTS mcp_oauth_access_expiry_idx ON mcp_oauth_access_tokens (expires_at)");
   await mcpOAuthQuery(mcpOAuthDb,"CREATE INDEX IF NOT EXISTS mcp_oauth_refresh_expiry_idx ON mcp_oauth_refresh_tokens (expires_at)");
  })().catch(err=>{mcpOAuthSchemaPromise=null;throw err;});
 }
 await mcpOAuthSchemaPromise;
}
const mcpOAuthError=(error,status=400)=>mcpOAuthJson({error},status);
const mcpOAuthRedirect=(target,params)=>{const u=new URL(target);for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));return new Response(null,{status:302,headers:{location:u.toString(),"cache-control":"no-store"}});};
async function mcpOAuthHandle(request,u){
 if(!mcpOAuthEnabled())return null;
 const path=u.pathname;
 if(path==="/oauth/health"&&request.method==="GET"){
  try{
   await mcpOAuthEnsureSchema();
   const rows=await mcpOAuthQuery(mcpOAuthDb,"SELECT to_regclass('public.mcp_oauth_clients') IS NOT NULL AS clients,to_regclass('public.mcp_oauth_login_requests') IS NOT NULL AS login_requests,to_regclass('public.mcp_oauth_authorization_codes') IS NOT NULL AS authorization_codes,to_regclass('public.mcp_oauth_access_tokens') IS NOT NULL AS access_tokens,to_regclass('public.mcp_oauth_refresh_tokens') IS NOT NULL AS refresh_tokens");
   const tables=rows[0]||{};
   const ready=Object.values(tables).every(Boolean);
   return mcpOAuthJson({status:ready?"ready":"degraded",storage:"postgres",tablesReady:ready,tables,discordProviderConfigured:!!Bun.env.DISCORD_OAUTH_CLIENT_ID&&!!Bun.env.DISCORD_OAUTH_CLIENT_SECRET,discordRedirectConfigured:!!Bun.env.DISCORD_OAUTH_REDIRECT_URI,authorizedGuildConfigured:/^\d{15,22}$/.test(Bun.env.AUTHORIZED_GUILD_ID||""),resource:mcpOAuthResource()},ready?200:503);
  }catch{return mcpOAuthJson({status:"degraded",storage:"postgres",tablesReady:false,reason:"storage_unavailable"},503);}
 }
 if(path==="/.well-known/oauth-protected-resource"&&request.method==="GET"){
  try{return mcpOAuthJson({resource:mcpOAuthResource(),authorization_servers:[mcpOAuthIssuer()],bearer_methods_supported:["header"],scopes_supported:["mcp:read","mcp:write"]});}
  catch{return mcpOAuthError("oauth_configuration_error",503);}
 }
 if(path==="/.well-known/oauth-authorization-server"&&request.method==="GET"){
  try{const issuer=mcpOAuthIssuer();return mcpOAuthJson({issuer,authorization_endpoint:issuer+"/oauth/authorize",token_endpoint:issuer+"/oauth/token",registration_endpoint:issuer+"/register",revocation_endpoint:issuer+"/oauth/revoke",response_types_supported:["code"],response_modes_supported:["query"],grant_types_supported:["authorization_code","refresh_token"],token_endpoint_auth_methods_supported:["none"],code_challenge_methods_supported:["S256"],scopes_supported:["mcp:read","mcp:write"],resource_parameter_supported:true,client_id_metadata_document_supported:false});}
  catch{return mcpOAuthError("oauth_configuration_error",503);}
 }
 if(path==="/register"&&request.method==="POST"){
  try{
   await mcpOAuthEnsureSchema(); const body=await request.json(); const redirects=body?.redirect_uris;
   if(!Array.isArray(redirects)||redirects.length<1||redirects.length>10||redirects.some(x=>typeof x!=="string"||!mcpOAuthSafeRedirect(x)))return mcpOAuthError("invalid_redirect_uri");
   const clientId="mcp_"+mcpOAuthRandom(24); const name=typeof body.client_name==="string"&&body.client_name.trim()?body.client_name.trim().slice(0,100):"MCP client";
   const unique=[...new Set(redirects)];
   await mcpOAuthQuery(mcpOAuthDb,"INSERT INTO mcp_oauth_clients (client_id,client_name,redirect_uris) VALUES ($1,$2,$3)",clientId,name,JSON.stringify(unique));
   return mcpOAuthJson({client_id:clientId,client_id_issued_at:Math.floor(Date.now()/1000),client_name:name,redirect_uris:unique,grant_types:["authorization_code","refresh_token"],response_types:["code"],token_endpoint_auth_method:"none"},201);
  }catch{return mcpOAuthError("invalid_client_metadata");}
 }
 if(path==="/oauth/authorize"&&request.method==="GET"){
  try{
   await mcpOAuthEnsureSchema();
   const clientId=u.searchParams.get("client_id")||"",redirectUri=u.searchParams.get("redirect_uri")||"",challenge=u.searchParams.get("code_challenge")||"";
   const clients=await mcpOAuthQuery(mcpOAuthDb,"SELECT client_name,redirect_uris FROM mcp_oauth_clients WHERE client_id=$1 LIMIT 1",clientId);
   if(!clients.length)return mcpOAuthError("invalid_client");
   const redirects=JSON.parse(clients[0].redirect_uris);
   if(u.searchParams.get("response_type")!=="code"||!redirects.includes(redirectUri)||!mcpOAuthSafeRedirect(redirectUri))return mcpOAuthError("invalid_request");
   if(u.searchParams.get("code_challenge_method")!=="S256"||challenge.length<43||challenge.length>128||!/^[A-Za-z0-9_-]+$/.test(challenge))return mcpOAuthError("invalid_request");
   const resource=u.searchParams.get("resource")||""; if(resource!==mcpOAuthResource())return mcpOAuthError("invalid_target");
   const scope=mcpOAuthScopes(u.searchParams.get("scope")),state=mcpOAuthRandom(32);
   await mcpOAuthQuery(mcpOAuthDb,"INSERT INTO mcp_oauth_login_requests (state_hash,client_id,redirect_uri,client_state,code_challenge,scope,resource,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",await mcpOAuthHash(state),clientId,redirectUri,u.searchParams.get("state"),challenge,scope,resource,new Date(Date.now()+600000));
   const discordId=Bun.env.DISCORD_OAUTH_CLIENT_ID,discordSecret=Bun.env.DISCORD_OAUTH_CLIENT_SECRET;
   if(!discordId||!discordSecret)return mcpOAuthError("oauth_provider_not_configured",503);
   const auth=new URL("https://discord.com/oauth2/authorize");auth.searchParams.set("client_id",discordId);auth.searchParams.set("redirect_uri",mcpOAuthDiscordRedirect());auth.searchParams.set("response_type","code");auth.searchParams.set("scope","identify guilds");auth.searchParams.set("state",state);auth.searchParams.set("prompt","consent");
   return new Response(null,{status:302,headers:{location:auth.toString(),"cache-control":"no-store"}});
  }catch(e){return mcpOAuthError(String(e?.message||"invalid_request").startsWith("invalid_")?String(e.message):"invalid_request");}
 }
 if(path==="/oauth/callback"&&request.method==="GET"){
  try{
   await mcpOAuthEnsureSchema();const state=u.searchParams.get("state")||"",stateHash=await mcpOAuthHash(state);
   const rows=await mcpOAuthQuery(mcpOAuthDb,"SELECT * FROM mcp_oauth_login_requests WHERE state_hash=$1 AND expires_at>now() AND consumed_at IS NULL LIMIT 1",stateHash);
   if(!rows.length)return mcpOAuthError("invalid_state");
   const pending=rows[0];
   const fail=async message=>{await mcpOAuthQuery(mcpOAuthDb,"UPDATE mcp_oauth_login_requests SET consumed_at=now() WHERE state_hash=$1 AND consumed_at IS NULL",stateHash);return mcpOAuthRedirect(pending.redirect_uri,{error:"access_denied",error_description:message,state:pending.client_state});};
   if(u.searchParams.get("error"))return await fail("Discord authorization was not completed");
   const code=u.searchParams.get("code")||"",discordId=Bun.env.DISCORD_OAUTH_CLIENT_ID,discordSecret=Bun.env.DISCORD_OAUTH_CLIENT_SECRET;
   if(!code||!discordId||!discordSecret)return await fail("Discord OAuth provider is not configured");
   const form=new URLSearchParams({client_id:discordId,client_secret:discordSecret,grant_type:"authorization_code",code,redirect_uri:mcpOAuthDiscordRedirect()});
   const tokenRes=await fetch("https://discord.com/api/v10/oauth2/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(12000)});
   const token=await tokenRes.json().catch(()=>({}));if(!tokenRes.ok||!token.access_token)return await fail("Discord token exchange failed");
   const headers={authorization:"Bearer "+token.access_token,"user-agent":"IndependentDiscordManagerOAuth/1.0"};
   const [userRes,guildRes]=await Promise.all([fetch("https://discord.com/api/v10/users/@me",{headers,signal:AbortSignal.timeout(12000)}),fetch("https://discord.com/api/v10/users/@me/guilds",{headers,signal:AbortSignal.timeout(12000)})]);
   if(!userRes.ok||!guildRes.ok)return await fail("Discord identity verification failed");
   const user=await userRes.json(),guilds=await guildRes.json(),guildId=Bun.env.AUTHORIZED_GUILD_ID||"";
   const membership=Array.isArray(guilds)?guilds.find(g=>String(g.id)===String(guildId)):null;
   let admin=false;try{admin=!!membership&&(membership.owner===true||((BigInt(membership.permissions||"0")&8n)===8n));}catch{}
   if(!user?.id||!/^\d{15,22}$/.test(guildId)||!admin)return await fail("Discord account must be an owner or administrator of this server");
   const authCode=mcpOAuthRandom(32);
   await mcpOAuthDb.begin(async tx=>{
    const locked=await mcpOAuthQuery(tx,"SELECT state_hash FROM mcp_oauth_login_requests WHERE state_hash=$1 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE",stateHash);
    if(!locked.length)throw new Error("invalid_state");
    await mcpOAuthQuery(tx,"UPDATE mcp_oauth_login_requests SET consumed_at=now() WHERE state_hash=$1",stateHash);
    await mcpOAuthQuery(tx,"INSERT INTO mcp_oauth_authorization_codes (code_hash,client_id,redirect_uri,code_challenge,user_id,guild_id,scope,resource,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",await mcpOAuthHash(authCode),pending.client_id,pending.redirect_uri,pending.code_challenge,String(user.id),String(guildId),pending.scope,pending.resource,new Date(Date.now()+300000));
   });
   return mcpOAuthRedirect(pending.redirect_uri,{code:authCode,state:pending.client_state});
  }catch(e){return mcpOAuthError(String(e?.message||"").includes("invalid_state")?"invalid_state":"oauth_callback_failed",400);}
 }
 if(path==="/oauth/token"&&request.method==="POST"){
  try{
   await mcpOAuthEnsureSchema();const form=new URLSearchParams(await request.text()),grant=form.get("grant_type")||"",clientId=form.get("client_id")||"";
   if(grant==="authorization_code"){
    const code=form.get("code")||"",redirect=form.get("redirect_uri")||"",verifier=form.get("code_verifier")||"";
    if(!code||!clientId||!redirect||verifier.length<43||verifier.length>128)return mcpOAuthError("invalid_grant");
    const context=await mcpOAuthDb.begin(async tx=>{
     const rows=await mcpOAuthQuery(tx,"SELECT * FROM mcp_oauth_authorization_codes WHERE code_hash=$1 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE",await mcpOAuthHash(code));
     if(!rows.length)throw new Error("invalid_grant");const row=rows[0];
     if(row.client_id!==clientId||row.redirect_uri!==redirect||await mcpOAuthPkce(verifier)!==row.code_challenge)throw new Error("invalid_grant");
     const resource=form.get("resource");if(resource&&resource!==row.resource)throw new Error("invalid_target");
     await mcpOAuthQuery(tx,"UPDATE mcp_oauth_authorization_codes SET consumed_at=now() WHERE code_hash=$1",row.code_hash);return row;
    });
    const access=mcpOAuthRandom(32),refresh=mcpOAuthRandom(48);
    await mcpOAuthDb.begin(async tx=>{
     await mcpOAuthQuery(tx,"INSERT INTO mcp_oauth_access_tokens (token_hash,client_id,user_id,guild_id,scope,resource,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",await mcpOAuthHash(access),context.client_id,context.user_id,context.guild_id,context.scope,context.resource,new Date(Date.now()+3600000));
     await mcpOAuthQuery(tx,"INSERT INTO mcp_oauth_refresh_tokens (token_hash,client_id,user_id,guild_id,scope,resource,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",await mcpOAuthHash(refresh),context.client_id,context.user_id,context.guild_id,context.scope,context.resource,new Date(Date.now()+2592000000));
    });
    return mcpOAuthJson({access_token:access,token_type:"Bearer",expires_in:3600,refresh_token:refresh,scope:context.scope,resource:context.resource});
   }
   if(grant==="refresh_token"){
    const oldToken=form.get("refresh_token")||"";if(!oldToken||!clientId)return mcpOAuthError("invalid_grant");
    const refreshed=await mcpOAuthDb.begin(async tx=>{
     const rows=await mcpOAuthQuery(tx,"SELECT * FROM mcp_oauth_refresh_tokens WHERE token_hash=$1 AND expires_at>now() AND revoked_at IS NULL FOR UPDATE",await mcpOAuthHash(oldToken));
     if(!rows.length||rows[0].client_id!==clientId)throw new Error("invalid_grant");const row=rows[0];
     const resource=form.get("resource");if(resource&&resource!==row.resource)throw new Error("invalid_target");
     const access=mcpOAuthRandom(32),refresh=mcpOAuthRandom(48),refreshHash=await mcpOAuthHash(refresh);
     await mcpOAuthQuery(tx,"UPDATE mcp_oauth_refresh_tokens SET revoked_at=now(),replaced_by=$1 WHERE token_hash=$2",refreshHash,await mcpOAuthHash(oldToken));
     await mcpOAuthQuery(tx,"INSERT INTO mcp_oauth_access_tokens (token_hash,client_id,user_id,guild_id,scope,resource,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",await mcpOAuthHash(access),row.client_id,row.user_id,row.guild_id,row.scope,row.resource,new Date(Date.now()+3600000));
     await mcpOAuthQuery(tx,"INSERT INTO mcp_oauth_refresh_tokens (token_hash,client_id,user_id,guild_id,scope,resource,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",refreshHash,row.client_id,row.user_id,row.guild_id,row.scope,row.resource,new Date(Date.now()+2592000000));
     return {access,refresh,scope:row.scope,resource:row.resource};
    });
    return mcpOAuthJson({access_token:refreshed.access,token_type:"Bearer",expires_in:3600,refresh_token:refreshed.refresh,scope:refreshed.scope,resource:refreshed.resource});
   }
   return mcpOAuthError("unsupported_grant_type");
  }catch(e){const err=String(e?.message||"");return mcpOAuthError(err==="invalid_target"?"invalid_target":"invalid_grant");}
 }
 if(path==="/oauth/revoke"&&request.method==="POST"){
  try{
   await mcpOAuthEnsureSchema();const form=new URLSearchParams(await request.text()),token=form.get("token")||"",clientId=form.get("client_id")||"";
   if(token){const hash=await mcpOAuthHash(token);await mcpOAuthQuery(mcpOAuthDb,"UPDATE mcp_oauth_access_tokens SET revoked_at=now() WHERE token_hash=$1 AND ($2='' OR client_id=$2) AND revoked_at IS NULL",hash,clientId);await mcpOAuthQuery(mcpOAuthDb,"UPDATE mcp_oauth_refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND ($2='' OR client_id=$2) AND revoked_at IS NULL",hash,clientId);}
   return new Response(null,{status:200,headers:{"cache-control":"no-store"}});
  }catch{return mcpOAuthError("server_error",503);}
 }
 return null;
}
async function mcpOAuthAuthenticate(token){
 if(!mcpOAuthEnabled()||!token)return null;
 await mcpOAuthEnsureSchema();
 const rows=await mcpOAuthQuery(mcpOAuthDb,"SELECT client_id,user_id,guild_id,scope,resource FROM mcp_oauth_access_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() LIMIT 1",await mcpOAuthHash(token));
 if(!rows.length||rows[0].resource!==mcpOAuthResource()||String(rows[0].guild_id)!==String(Bun.env.AUTHORIZED_GUILD_ID||""))return null;
 return rows[0];
}
const mcpOAuthUnauthorized=()=>{
 let metadata="";try{metadata=mcpOAuthIssuer()+"/.well-known/oauth-protected-resource";}catch{}
 return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","www-authenticate":'Bearer resource_metadata="'+metadata+'", scope="mcp:read"'}});
};
async function mcpOAuthDispatch(request,u){
 if(u.pathname.startsWith("/.well-known/")||u.pathname==="/register"||u.pathname.startsWith("/oauth/")){
  if(!mcpOAuthEnabled())return mcpOAuthError("oauth_not_enabled",404);
  return await mcpOAuthHandle(request,u);
 }
 return null;
}

Bun.serve({port:Number(Bun.env.PORT||3000),async fetch(request){
 const u=new URL(request.url);const oauthResponse=await mcpOAuthDispatch(request,u);if(oauthResponse)return oauthResponse;
 if(u.pathname==="/readyz"&&request.method==="GET"){
  const bot=Bun.env.DISCORD_BOT_TOKEN,guild=Bun.env.AUTHORIZED_GUILD_ID,expectedBot=Bun.env.APPLICATION_ID;
  if(!bot||!/^\d{15,22}$/.test(guild||"")||!/^\d{15,22}$/.test(expectedBot||""))return reply({status:"not_ready",reason:"configuration"},503);
  try{
   const h={authorization:"Bot "+bot,"user-agent":"DiscordManagerReadiness/1.0"};
   const [identity,access]=await Promise.all([
    fetch(API+"/users/@me",{headers:h,signal:AbortSignal.timeout(9000)}),
    fetch(API+"/guilds/"+encodeURIComponent(guild),{headers:h,signal:AbortSignal.timeout(9000)})
   ]);
   if(!identity.ok||!access.ok)return reply({status:"not_ready",reason:"discord_unavailable"},503);
   const [who,server]=await Promise.all([identity.json(),access.json()]);
   if(String(who.id)!==String(expectedBot)||String(server.id)!==String(guild))return reply({status:"not_ready",reason:"scope_mismatch"},503);
   let databaseVerified=false;
   if(mcpOAuthEnabled()){
    if(!mcpOAuthDb)return reply({status:"not_ready",reason:"oauth_database_unavailable",discordVerified:true,databaseVerified:false},503);
    try{
     const rows=await mcpOAuthQuery(mcpOAuthDb,"SELECT to_regclass('public.mcp_oauth_clients') IS NOT NULL AS clients,to_regclass('public.mcp_oauth_login_requests') IS NOT NULL AS login_requests,to_regclass('public.mcp_oauth_authorization_codes') IS NOT NULL AS authorization_codes,to_regclass('public.mcp_oauth_access_tokens') IS NOT NULL AS access_tokens,to_regclass('public.mcp_oauth_refresh_tokens') IS NOT NULL AS refresh_tokens");
     const tables=rows[0]||{};
     databaseVerified=["clients","login_requests","authorization_codes","access_tokens","refresh_tokens"].every(key=>tables[key]===true);
     if(!databaseVerified)return reply({status:"not_ready",reason:"oauth_schema_unavailable",discordVerified:true,databaseVerified:false},503);
    }catch{return reply({status:"not_ready",reason:"oauth_database_unavailable",discordVerified:true,databaseVerified:false},503);}
   }
   return reply({status:"ready",manager:NAME,discordVerified:true,databaseVerified});
  }catch{return reply({status:"not_ready",reason:"readiness_timeout"},503);}
 }
 if(u.pathname==="/healthz"&&request.method==="GET")return reply({status:"ok",manager:NAME,service:"dawn-dotta-http-manager"});
 if(u.pathname!=="/mcp"||request.method!=="POST")return reply({error:"Not found"},404);
 const provided=request.headers.get("authorization")||"";const secret=Bun.env.MANAGER_SERVICE_KEY||Bun.env.RAILWAY_SERVICE_KEY;const staticAuth=!!secret&&provided==="Bearer "+secret;let oauthAuth=null;if(!staticAuth&&provided.startsWith("Bearer ")){try{oauthAuth=await mcpOAuthAuthenticate(provided.slice(7));}catch{return reply({error:"OAuth authentication backend unavailable"},503);}}if(!staticAuth&&!oauthAuth)return mcpOAuthUnauthorized();
 let rpc;try{rpc=await request.json();}catch{return reply({error:"Invalid JSON"},400);}
 const id=rpc.id??null;const result=(v)=>reply({jsonrpc:"2.0",id,result:v});
 if(oauthAuth&&rpc.params?.name==="discord_guild_request"&&String(rpc.params?.arguments?.method||"GET").toUpperCase()!=="GET"&&!String(oauthAuth.scope).split(/\s+/).includes("mcp:write"))return reply({jsonrpc:"2.0",id,error:{code:-32003,message:"OAuth token lacks mcp:write scope"}},403);
 if(rpc.method==="server/discover")return result({supportedVersions:["2026-07-28"],capabilities:{tools:{}},serverInfo:{name:NAME,version:"1.0.0"}});
 if(rpc.method==="initialize")return result({protocolVersion:rpc.params?.protocolVersion||"2026-07-28",capabilities:{tools:{}},serverInfo:{name:NAME,version:"1.0.0"}});
 if(rpc.method==="notifications/initialized")return new Response(null,{status:202});
 if(rpc.method==="tools/list")return result({tools});
 if(rpc.method==="tools/call"){
  try{return result(await invoke(rpc.params?.name,rpc.params?.arguments||{}));}
  catch(error){console.error(JSON.stringify({event:"manager-request-failed",manager:NAME,errorType:error?.name||"unknown"}));return result(fail("Manager request failed; no Discord modification was confirmed."));}
 }
 return reply({jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}});
}});
