// Momentum Movement Superseded Post Cleaner.
// Guild-scoped and strictly limited to duplicate bot-managed dashboard messages.
// NEVER touches member posts, media, files, forums, galleries, or channel/role names.
const G="1565048205970767992", APP="1565304619838742598";
const TOKEN=Bun.env.DISCORD_BOT_TOKEN||"";
const CHANNELS=[
 {name:"owner-social-links",id:"1566534807788191890",marker:"Official social directory • Auto-synced"},
 {name:"private-social-dashboard",id:"1565848585617023088",marker:"SOCIAL_ADMIN_DASHBOARD_V3:"+G}
];
const DIAG=Bun.env.CLEANUP_DIAGNOSTIC==="true";
const WRITES=Bun.env.CLEANUP_DELETE_ENABLED==="true"&&!DIAG;
const ageLimit=30*60*1000;
if(Bun.env.AUTHORIZED_GUILD_ID!==G||Bun.env.APPLICATION_ID!==APP||!TOKEN)
 throw Error("Wrong Momentum Movement guild/application credentials");
async function api(method,path){
 for(let n=0;n<3;n++){
  const r=await fetch("https://discord.com/api/v10"+path,{method,headers:{Authorization:"Bot "+TOKEN},signal:AbortSignal.timeout(15000)});
  const data=await r.json().catch(()=>({}));
  if(r.status===429){
   if(n===2)throw Error("Discord rate limited; defer cleanup");
   await Bun.sleep(Math.min(30000,Math.max(1300,Math.ceil(Number(data.retry_after||2)*1000)+300)));
   continue;
  }
  if(!r.ok)throw Error("Discord "+method+" "+r.status);
  return data;
 }
 throw Error("Discord retries exhausted");
}
const safe=m=>m.author?.id===APP&&
 !m.pinned&&!(m.attachments||[]).length&&!(m.sticker_items||[]).length&&
 !(m.embeds||[]).some(x=>x.image||x.thumbnail||x.video||x.provider);
function markerMatches(m,channel){
 if(channel.marker.startsWith("SOCIAL_ADMIN_DASHBOARD"))
  return m.embeds?.[0]?.footer?.text===channel.marker||
   (m.components||[]).flatMap(x=>x.components||[]).some(b=>String(b.custom_id||"").startsWith("social3:refresh"));
 return m.embeds?.[0]?.footer?.text===channel.marker;
}
function signature(m){
 const embeds=(m.embeds||[]).map(x=>({
  title:x.title||"",description:x.description||"",color:x.color||0,
  fields:(x.fields||[]).map(f=>({name:f.name,value:f.value,inline:!!f.inline})),
  footer:x.footer?.text||""
 }));
 const components=(m.components||[]).map(row=>({type:row.type,children:(row.components||[]).map(b=>({type:b.type,style:b.style,custom_id:b.custom_id||"",label:b.label||"",url:b.url||""}))}));
 return JSON.stringify({content:m.content||"",embeds,components});
}
try{
 const [me,guild,channels]=await Promise.all([
  api("GET","/users/@me"),api("GET","/guilds/"+G),api("GET","/guilds/"+G+"/channels")
 ]);
 if(me.id!==APP||guild.id!==G||!Array.isArray(channels))throw Error("Discord identity mismatch");
 let inspected=0,candidates=[],messages=0;
 for(const ch of CHANNELS){
  const c=channels.find(x=>x.id===ch.id);
  if(!c||c.type!==0||c.guild_id!==G)throw Error("Expected protected dashboard channel missing: "+ch.name);
  const rows=await api("GET","/channels/"+ch.id+"/messages?limit=100");
  if(!Array.isArray(rows))throw Error("Dashboard history malformed");
  inspected++;messages+=rows.length;
  const latest=new Map();
  for(const row of rows){
   if(!safe(row)||!markerMatches(row,ch))continue;
   const sig=signature(row);
   if(!latest.has(sig)){latest.set(sig,row);continue;}
   if(Date.now()-Date.parse(row.timestamp)<ageLimit)continue;
   candidates.push({channel:ch.name,channelId:ch.id,messageId:row.id,keptMessageId:latest.get(sig).id});
  }
 }
 let removed=0;
 if(WRITES)for(const row of candidates.slice(0,3)){
  await api("DELETE","/channels/"+row.channelId+"/messages/"+row.messageId);
  removed++;
 }
 const summary={event:"momentum_superseded_dashboard_cleanup",guild:G,readOnly:!WRITES,
  scannedChannels:inspected,inspectedMessages:messages,
  exactDuplicatesOver30Minutes:candidates.length,
  deletedMessages:removed,protectedMedia:true,protectedMemberPosts:true,protectedForumThreads:true};
 if(DIAG)throw Error("MM_CLEANER_AUDIT:"+JSON.stringify(summary));
 console.log(JSON.stringify(summary));
}catch(error){
 if(DIAG)throw error;
 console.error(JSON.stringify({event:"momentum_cleanup_deferred",readOnly:!WRITES,reason:error instanceof Error?error.message.slice(0,130):"unknown"}));
}