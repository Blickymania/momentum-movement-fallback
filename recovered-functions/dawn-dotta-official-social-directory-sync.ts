// Guild-scoped Momentum Movement social directory synchronization.
// Edits only the one already-verified bot-authored message. No creates/deletes/renames.
const G="1565048205970767992",APP="1565304619838742598";
const CAT="1565592611048267935",CH="1566534807788191890",MESSAGE="1566536906282639525";
const TOKEN=Bun.env.DISCORD_BOT_TOKEN||"";
const MARKER="Official social directory • Auto-synced";
const TITLE="🔗 Official Social Links · Dawn Dotta / Momentum Movement";
if(Bun.env.AUTHORIZED_GUILD_ID!==G||Bun.env.APPLICATION_ID!==APP||!TOKEN)throw Error("Momentum Movement guild/app scope mismatch");
const DIAG=Bun.env.DIRECTORY_DIAGNOSTIC==="true";
const WRITES=Bun.env.DIRECTORY_WRITES_ENABLED==="true"&&!DIAG;
async function api(method,path,body){
 for(let i=0;i<3;i++){
  const r=await fetch("https://discord.com/api/v10"+path,{
   method,headers:{Authorization:"Bot "+TOKEN,"Content-Type":"application/json"},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)
  });
  const data=await r.json().catch(()=>({}));
  if(r.status===429){if(i===2)throw Error("Discord rate limited; defer to next run");
   await Bun.sleep(Math.min(30000,Math.max(1200,Math.ceil(Number(data.retry_after||2)*1000)+300)));continue;
  }
  if(!r.ok)throw Error("Discord "+method+" "+r.status+" on "+path.split("?")[0]);
  return data;
 }
 throw Error("Discord retry budget exhausted");
}
const SPECS=[
 {label:"TikTok",key:"SOCIAL_TIKTOK_URL",host:"tiktok.com"},
 {label:"Instagram",key:"SOCIAL_INSTAGRAM_URL",host:"instagram.com"},
 {label:"Facebook",key:"SOCIAL_FACEBOOK_URL",host:"facebook.com"},
 {label:"Threads",key:"SOCIAL_THREADS_URL",host:"threads.com"}
];
const urls=new Map();
for(const s of SPECS){
 const raw=String(Bun.env[s.key]||"").trim();
 if(!raw)continue;
 const u=new URL(raw);
 const host=u.hostname.toLowerCase();
 if(u.protocol!=="https:"||u.username||u.password||u.port||!(host===s.host||host.endsWith("."+s.host)))throw Error("Configured "+s.label+" URL rejected: invalid host");
 urls.set(s.label.toLowerCase(),u.href);
}
const description="Verified official profiles for Dawn Dotta / Momentum Movement. Use the links below to visit her social platforms.";
const sanitizeRow=r=>({
 type:1,components:(r.components||[]).map(b=>{
  const out={type:b.type,style:b.style};
  for(const key of ["label","url","custom_id","emoji","disabled","sku_id"]){if(b[key]!==undefined)out[key]=b[key];}
  return out;
 })
});
const cleanField=f=>({name:f.name,value:f.value,inline:!!f.inline});
const embedEditable=e=>{
 const o={title:TITLE,description,color:e.color??3848880,fields:(e.fields||[]).map(cleanField),
 footer:{text:MARKER}};
 if(e.url)o.url=e.url;
 if(e.thumbnail?.url)o.thumbnail={url:e.thumbnail.url};
 if(e.image?.url)o.image={url:e.image.url};
 return o;
};
try{
 const [me,channel,message]=await Promise.all([
  api("GET","/users/@me"),api("GET","/channels/"+CH),api("GET","/channels/"+CH+"/messages/"+MESSAGE)
 ]);
 if(me.id!==APP||channel.id!==CH||channel.guild_id!==G||channel.parent_id!==CAT||channel.type!==0)
  throw Error("Social directory destination identity changed");
 if(message.id!==MESSAGE||message.author?.id!==APP||message.embeds?.length!==1||message.embeds[0].footer?.text!==MARKER)
  throw Error("Original managed social directory ownership/marker mismatch");
 if((Number(message.flags||0)&32768)!==0)throw Error("Component-layout upgrade requires separate review");
 const old=message.embeds[0];
 const beforeRows=message.components||[];
 const rows=beforeRows.map(sanitizeRow);
 let changedButtons=0,changedFields=0;
 for(const row of rows)for(const b of row.components){
  const label=String(b.label||"").trim().toLowerCase();
  if(b.style!==5||!urls.has(label))continue;
  const newUrl=urls.get(label);
  if(b.url!==newUrl){b.url=newUrl;changedButtons++;}
 }
 const next=embedEditable(old);
 for(const field of next.fields){
  const clean=String(field.name||"").toLowerCase().replace(/^[^a-z]+/,"").trim();
  const key=urls.has(clean)?clean:null;
  if(!key)continue;
  const newUrl=urls.get(key);
  const original=field.value;
  if(/\]\(https?:\/\/[^)]+\)/.test(original))
   field.value=original.replace(/\]\(https?:\/\/[^)]+\)/,"]("+newUrl+")");
  if(field.value!==original)changedFields++;
 }
 const changes=old.title!==next.title||old.description!==next.description||changedButtons>0||changedFields>0;
 const buttons=rows.flatMap(r=>r.components);
 const summary={event:"momentum_social_directory_sync",guild:G,channel:CH,messageId:MESSAGE,
  readOnly:!WRITES,changes,changedButtons,changedFields,buttonCount:buttons.length,
  configuredLinks:urls.size,titleMatches:old.title===TITLE,writesPerformed:0};
 if(DIAG)throw Error("MM_SOCIAL_SYNC_PLAN:"+JSON.stringify(summary));
 if(WRITES&&changes){
  const payload={embeds:[next],components:rows,allowed_mentions:{parse:[]}};
  await api("PATCH","/channels/"+CH+"/messages/"+MESSAGE,payload);
  const verified=await api("GET","/channels/"+CH+"/messages/"+MESSAGE);
  if(verified.author?.id!==APP||verified.embeds?.[0]?.title!==TITLE
    ||verified.embeds?.[0]?.description!==description)throw Error("Social directory update verification failed");
  summary.writesPerformed=1;
 }
 console.log(JSON.stringify(summary));
}catch(error){
 if(DIAG)throw error;
 console.error(JSON.stringify({event:"momentum_social_directory_deferred",guild:G,readOnly:!WRITES,reason:error instanceof Error?error.message.slice(0,150):"unknown"}));
}