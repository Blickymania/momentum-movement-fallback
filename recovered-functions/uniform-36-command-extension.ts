/** Standard Commands: Momentum Movement canonical 36 definitions, registration only.
 * Dedicated Blickymania Bot 005 is sole interaction executor.
 * No Discord Gateway connections, responses or public posts in this service.
 */
const C={"name":"Momentum Movement","app":"1565304619838742598","guild":"1565048205970767992","nativeForum":false};
const API="https://discord.com/api/v10";
const CORE_COMMANDS=[{"name":"addtocase","description":"Add a member to this support thread.","type":1,"options":[{"type":6,"name":"user","description":"Member to add","required":true}],"default_member_permissions":"8192"},{"name":"announce","description":"Post a formatted announcement.","type":1,"options":[{"type":7,"name":"channel","description":"Destination channel","required":true},{"type":3,"name":"title","description":"Announcement title","required":true},{"type":3,"name":"message","description":"Announcement body","required":true}],"default_member_permissions":"32"},{"name":"audit","description":"View recent Discord audit log entries.","type":1,"options":[],"default_member_permissions":"128"},{"name":"automod","description":"Manage community bot native Discord anti-spam rules.","type":1,"options":[{"type":3,"name":"action","description":"View, enable or disable safeguards","required":true,"choices":[{"name":"Status","value":"status"},{"name":"Enable","value":"enable"},{"name":"Disable","value":"disable"}]}],"default_member_permissions":"32"},{"name":"ban","description":"Ban a member from the server.","type":1,"options":[{"type":6,"name":"user","description":"Member to ban","required":true},{"type":3,"name":"reason","description":"Reason","required":true}],"default_member_permissions":"4"},{"name":"bot-status","description":"Check bot status.","type":1,"options":[]},{"name":"botconfig","description":"See which community bot integration options are configured.","type":1,"options":[],"default_member_permissions":"32"},{"name":"botstatus","description":"Show the operational status and configuration readiness.","type":1,"options":[]},{"name":"channelorder","description":"Reorder a category using its complete channel ID list.","type":1,"options":[{"type":7,"name":"category","description":"Category to reorder","required":true},{"type":3,"name":"channels","description":"All channel IDs in order, separated by commas","required":true}],"default_member_permissions":"16"},{"name":"channelposition","description":"Move a channel within its category; first position is zero.","type":1,"options":[{"type":7,"name":"channel","description":"Channel to move","required":true},{"type":4,"name":"position","description":"Zero-based sibling position","required":true}],"default_member_permissions":"16"},{"name":"chatfirst","description":"Put channels containing chat first within every category.","type":1,"options":[],"default_member_permissions":"16"},{"name":"closecase","description":"Archive this support thread.","type":1,"options":[{"type":3,"name":"reason","description":"Closure note"}]},{"name":"eventcreate","description":"Schedule an external server event (ISO 8601 ET or UTC).","type":1,"options":[{"type":3,"name":"title","description":"Event title","required":true},{"type":3,"name":"starts","description":"ISO date/time with offset (e.g. 2026-11-01T20:00:00-05:00)","required":true},{"type":4,"name":"minutes","description":"Event length in minutes","required":true},{"type":3,"name":"location","description":"External event URL or meeting location","required":true}],"default_member_permissions":"8589934592"},{"name":"events","description":"See upcoming scheduled events.","type":1,"options":[]},{"name":"help","description":"See what community bot can do.","type":1,"options":[]},{"name":"kick","description":"Remove a member from the server.","type":1,"options":[{"type":6,"name":"user","description":"Member to kick","required":true},{"type":3,"name":"reason","description":"Reason","required":true}],"default_member_permissions":"2"},{"name":"lock","description":"Lock or unlock text sending for everyone.","type":1,"options":[{"type":5,"name":"enabled","description":"True locks, false unlocks","required":true}],"default_member_permissions":"16"},{"name":"member","description":"View a member profile.","type":1,"options":[{"type":6,"name":"user","description":"Member to inspect","required":true}]},{"name":"ping","description":"Check bot status.","type":1,"options":[]},{"name":"poll","description":"Publish a reaction-based poll.","type":1,"options":[{"type":3,"name":"question","description":"Question","required":true},{"type":3,"name":"first","description":"First option","required":true},{"type":3,"name":"second","description":"Second option","required":true},{"type":3,"name":"third","description":"Third option"},{"type":3,"name":"fourth","description":"Fourth option"}]},{"name":"purge","description":"Delete recent messages (up to 100).","type":1,"options":[{"type":4,"name":"count","description":"Number of messages","required":true}],"default_member_permissions":"8192"},{"name":"report","description":"Confidentially report a member to staff.","type":1,"options":[{"type":6,"name":"user","description":"Member to report","required":true},{"type":3,"name":"reason","description":"Reason for the report","required":true}]},{"name":"role","description":"Add or remove an eligible role from a member.","type":1,"options":[{"type":6,"name":"user","description":"Target member","required":true},{"type":8,"name":"role","description":"Role to change","required":true},{"type":3,"name":"action","description":"Add or remove","required":true,"choices":[{"name":"Add","value":"add"},{"name":"Remove","value":"remove"}]}],"default_member_permissions":"268435456"},{"name":"rules","description":"Find the community rules channel.","type":1,"options":[]},{"name":"server","description":"Get the community server details.","type":1,"options":[]},{"name":"slowmode","description":"Change slowmode for this channel.","type":1,"options":[{"type":4,"name":"seconds","description":"Seconds between messages (0-21600)","required":true}],"default_member_permissions":"16"},{"name":"statsset","description":"Owner or creator: confirm TikTok stats totals.","type":1,"options":[{"type":4,"name":"super_fans","description":"Current TikTok LIVE Super Fans","required":true},{"type":4,"name":"level_50s","description":"Current TikTok Level 50s","required":true}],"default_member_permissions":"32"},{"name":"statsstatus","description":"View creator-confirmed the community TikTok statistics.","type":1,"options":[]},{"name":"support","description":"Open a private support case.","type":1,"options":[{"type":3,"name":"subject","description":"Short ticket subject","required":true},{"type":3,"name":"details","description":"Describe the problem"}]},{"name":"tiktok","description":"Open the community TikTok profile and LIVE link.","type":1,"options":[]},{"name":"timeout","description":"Temporarily restrict a member.","type":1,"options":[{"type":6,"name":"user","description":"Member to timeout","required":true},{"type":4,"name":"minutes","description":"Duration (1-40320)","required":true},{"type":3,"name":"reason","description":"Reason","required":true}],"default_member_permissions":"1099511627776"},{"name":"unban","description":"Lift a ban.","type":1,"options":[{"type":3,"name":"user_id","description":"Discord user ID","required":true},{"type":3,"name":"reason","description":"Reason","required":true}],"default_member_permissions":"4"},{"name":"warn","description":"Warn a user and record the action.","type":1,"options":[{"type":6,"name":"user","description":"Member to warn","required":true},{"type":3,"name":"reason","description":"Warning reason","required":true}],"default_member_permissions":"1099511627776"}];
const definition=[
 {name:"dashboard",description:"Interactive community dashboard for this Discord server",type:1},
 {name:"bot-test",description:"Check command response, Discord connection and bot readiness",type:1}
];
if(!C.nativeForum)definition.push({name:"forum-admin",description:"Owner-only forum and discussion management",type:1,default_member_permissions:"0",options:[
 {type:1,name:"diagnose",description:"Check this server's forums and permissions"},
 {type:1,name:"inspect",description:"Inspect a forum's configured tags",options:[{type:7,name:"forum",description:"Forum channel to inspect",channel_types:[15],required:true}]},
 {type:1,name:"thread",description:"Inspect an existing forum discussion",options:[{type:3,name:"thread_id",description:"Forum discussion ID",required:true}]},
 {type:1,name:"rename",description:"Rename a forum discussion",options:[{type:3,name:"thread_id",description:"Forum discussion ID",required:true},{type:3,name:"title",description:"New discussion title",required:true,max_length:100}]},
 {type:1,name:"tag",description:"Add or remove an existing forum tag",options:[{type:3,name:"thread_id",description:"Forum discussion ID",required:true},{type:3,name:"action",description:"Add or remove",required:true,choices:[{name:"Add",value:"add"},{name:"Remove",value:"remove"}]},{type:3,name:"tag_name",description:"Existing forum tag",required:true}]},
 {type:1,name:"pin",description:"Pin an existing forum discussion",options:[{type:3,name:"thread_id",description:"Forum discussion ID",required:true}]},
 {type:1,name:"unpin",description:"Unpin a forum discussion",options:[{type:3,name:"thread_id",description:"Forum discussion ID",required:true}]}
]});

const STANDARD_COMMANDS=[...CORE_COMMANDS,...definition];
if(STANDARD_COMMANDS.length!==36||new Set(STANDARD_COMMANDS.map(c=>c.name)).size!==36)throw Error("Invalid 36-command registry");
const state={phase:"starting",count:0,registered:0,differences:[],error:null,verifiedAt:null,mutations:0};
const token=()=>Bun.env.DISCORD_BOT_TOKEN||"";
const scoped=()=>!!token()&&Bun.env.APPLICATION_ID===C.app&&Bun.env.AUTHORIZED_GUILD_ID===C.guild&&Bun.env.ADDON_ENABLED==="true";
const writes=()=>Bun.env.COMMAND_REGISTRY_WRITES_ENABLED==="true";
function log(event,info={}){console.log(JSON.stringify({event,server:"Momentum Movement",service:"Standard Commands Registry",...info}))}
async function api(method,path,body){
 let err;
 for(let n=0;n<5;n++){
  try{
   const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);
   let r;try{r=await fetch(API+path,{method,headers:{authorization:"Bot "+token(),"user-agent":"StandardCommandsRegistry/2.0",...(body===undefined?{}:{"content-type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body),signal:c.signal})}finally{clearTimeout(t)}
   const j=await r.json().catch(()=>null);
   if(r.status===429){await Bun.sleep(Math.max(300,Math.min(12000,Math.ceil(Number(j?.retry_after||1)*1000)+250)));continue}
   if(!r.ok)throw Error("Discord HTTP "+r.status+" in registry "+method);
   return j;
  }catch(e){err=e;if(n<4)await Bun.sleep(700*(n+1))}
 }
 throw err||Error("Registry HTTP retries exhausted");
}
const canonicalOptions=items=>(items||[]).map(o=>({
 type:o.type,name:o.name,description:o.description,
 ...(o.required===true?{required:true}:{}),
 ...(o.options?.length?{options:canonicalOptions(o.options)}:{}),
 ...(o.choices?.length?{choices:o.choices.map(x=>({name:x.name,value:x.value}))}:{}),
 ...(o.channel_types?.length?{channel_types:o.channel_types}:{})
}));
const shape=o=>JSON.stringify({name:o.name,description:o.description,type:o.type||1,permissions:o.default_member_permissions??null,options:canonicalOptions(o.options)});
async function reconcile(){
 if(!scoped()){state.phase="disabled";log("STANDARD_REGISTRY_DISABLED",{tokenPresent:!!token(),applicationScopeCorrect:Bun.env.APPLICATION_ID===C.app,guildScopeCorrect:Bun.env.AUTHORIZED_GUILD_ID===C.guild,enabled:Bun.env.ADDON_ENABLED==="true"});return;}
 try{
  state.phase="checking";
  const [user,guild,list]=await Promise.all([api("GET","/users/@me"),api("GET","/guilds/"+C.guild),api("GET","/applications/"+C.app+"/guilds/"+C.guild+"/commands")]);
  if(user?.id!==C.app||guild?.id!==C.guild||!Array.isArray(list))throw Error("Registry identity/scope mismatch");
  const expected=new Set(STANDARD_COMMANDS.map(x=>x.name)),unknown=list.filter(x=>x.type===1&&!expected.has(x.name));
  if(unknown.length)throw Error("Unexpected command names: "+unknown.map(x=>x.name).join(","));
  let differences=STANDARD_COMMANDS.filter(d=>{const found=list.find(x=>x.name===d.name&&x.type===1);return !found||shape(found)!==shape(d)});
  state.differences=differences.map(x=>x.name);
  if(differences.length&&writes()){
   for(const d of differences){
    const prior=list.find(x=>x.name===d.name&&x.type===1);
    if(prior)await api("PATCH","/applications/"+C.app+"/guilds/"+C.guild+"/commands/"+prior.id,d);
    else await api("POST","/applications/"+C.app+"/guilds/"+C.guild+"/commands",d);
    state.mutations++;
    await Bun.sleep(300);
   }
  }
  const live=await api("GET","/applications/"+C.app+"/guilds/"+C.guild+"/commands");
  const names=live.filter(x=>x.type===1).map(x=>x.name);
  state.count=names.length;
  state.registered=STANDARD_COMMANDS.filter(x=>names.includes(x.name)).length;
  state.differences=STANDARD_COMMANDS.filter(d=>{const found=live.find(x=>x.name===d.name&&x.type===1);return !found||shape(found)!==shape(d)}).map(x=>x.name);
  state.verifiedAt=new Date().toISOString();
  if(state.count!==36||state.differences.length)throw Error("Registry verification mismatch: "+state.count+"/36, differing="+state.differences.join(","));
  state.phase="ready";state.error=null;
  log("STANDARD_REGISTRY_VERIFIED",{count:36,definitionParity:true,writeMode:writes(),changes:state.mutations,executor:"Blickymania Bot 005"});
 }catch(e){state.phase="error";state.error=String(e?.message||e).slice(0,300);log("STANDARD_REGISTRY_ERROR",{reason:state.error,differences:state.differences});}
}
Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||3000),fetch(request){
 const path=new URL(request.url).pathname;
 if(path==="/healthz")return Response.json({service:"Momentum Movement Standard Commands",status:"running",registryOnly:true,gatewayConnected:false});
 if(path==="/readyz")return Response.json({ready:state.phase==="ready",phase:state.phase,standardCommands:state.count,definitionParity:state.differences.length===0,registrationOnly:true,executor:"Blickymania Bot 005",lastError:state.error},{status:state.phase==="ready"?200:503});
 if(path==="/metrics")return Response.json({phase:state.phase,count:state.count,defined:36,registered:state.registered,differenceCount:state.differences.length,mutations:state.mutations,verifiedAt:state.verifiedAt,gatewayConnected:false});
 return new Response("Not found",{status:404});
}});
void reconcile();
