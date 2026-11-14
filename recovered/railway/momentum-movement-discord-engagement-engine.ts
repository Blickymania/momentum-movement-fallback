# Read-only recovery snapshot: Momentum Movement Discord Engagement Engine

- Railway project: Dawn Dotta / Momentum Movement
- Railway service ID: 15d5ceb0-0a23-4481-a186-ad00d3fb7075
- Environment: production
- Runtime image: ghcr.io/railwayapp/function-bun:1.4.4
- Latest deployment: not returned
- Latest deployment status: not returned
- Latest deployment created: not returned
- Source length: 14792 characters
- Extracted from configured start command using local base64 decoding on 2026-11-14 UTC.
- Environment variable names detected in source: APPLICATION_ID, AUTHORIZED_GUILD_ID, DISCORD_BOT_TOKEN, XP_VOLUME_READY
- Environment variable values are not present in this snapshot.
- Secret-literal scan found no common bot token, GitHub token, OpenAI key, private-key, bearer-token or long-base64 pattern.
- This is a read-only recovery artifact, not connected to a deployment target.
- Do not deploy directly; dependencies, gateway ownership, network boundaries, data sources and rollback must be reviewed first.

---

import {Client,Events,GatewayIntentBits,PermissionFlagsBits,MessageFlags} from "discord.js@14.27.0";
import {createHash} from "node:crypto";
import {mkdir,rename,readFile,stat} from "node:fs/promises";
const G="1565048205970767992",APP="1565304619838742598";
const PUBLIC="1565643996624199760",PUBLIC_MSG="1566161979645628522";
const STAFF="1566160801897783397",STAFF_MSG="1566162026214990027";
const VOLUME="/data/discord-engagement-v1.json",DAY=86400000;
const token=Bun.env.DISCORD_BOT_TOKEN||"";
const labels={day:"Daily",week:"Weekly",month:"Monthly",year:"Yearly",life:"All Time"};
const safeMentions={parse:[],users:[],roles:[],repliedUser:false};
const log=(event,details={})=>console.log(JSON.stringify({event:"momentum_engagement_"+event,guild:G,...details}));
if(Bun.env.AUTHORIZED_GUILD_ID!==G||Bun.env.APPLICATION_ID!==APP||!token)throw Error("Engagement engine guild/bot identity not authorized");
if(Bun.env.XP_VOLUME_READY!=="true")throw Error("XP persistent volume has not been confirmed");
const timezone="America/New_York";
function dayKey(now=Date.now()){return new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now)).replace(/\//g,"-")}
function isoDay(now=Date.now()){const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));return p.year+"-"+p.month+"-"+p.day;}
function weekMonday(date){const noon=Date.parse(date+"T12:00:00Z"),dow=new Date(noon).getUTCDay();return new Date(noon-((dow+6)%7)*DAY).toISOString().slice(0,10)}
function meaningful(str){const t=String(str||"").normalize("NFKC").replace(/https?:\/\/\S+/gi," ").replace(/<[@#][!&]?\d+>/g," ").trim();return t.length>=12&&(t.match(/\p{L}/gu)||[]).length>=9&&(t.match(/[\p{L}\p{N}]+/gu)||[]).length>=3&&!/(.)\1{9,}/u.test(t)}
function fresh(){return {v:1,guild:G,startedAt:Date.now(),captureStartedAt:null,users:{},seen:{},hashes:{},lastCredit:{},dayChannels:{}}}
let data=null,writeQueue=Promise.resolve(),syncing=false,publicPeriod="month",adminPeriod="month",adminPage="overview",client;
async function load(){
 await mkdir("/data",{recursive:true});
 const info=await stat("/data");if(!info.isDirectory())throw Error("XP volume directory invalid");
 let source;try{source=await readFile(VOLUME,"utf8")}catch(e){if(e.code!=="ENOENT")throw e}
 data=source?JSON.parse(source):fresh();
 if(data.v!==1||data.guild!==G||!data.users||!data.seen||!data.lastCredit||!data.hashes)throw Error("XP ledger integrity failed");
 if(!source)await persist(data);
 log("ledger_verified",{users:Object.keys(data.users).length,startedAt:data.startedAt,historyImported:false});
}
async function persist(next){const t=VOLUME+".tmp";await Bun.write(t,JSON.stringify(next));await rename(t,VOLUME);data=next}
function eligible(m){
 if(!data||m.guildId!==G||m.author?.bot||m.webhookId||![0,19].includes(m.type)||!meaningful(m.content))return false;
 const ch=m.channel,base=ch?.isThread?.()?ch.parent:ch;
 if(!base||base.guildId!==G||!ch.permissionsFor?.(m.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))return false;
 if(ch.nsfw||base.nsfw)return false;
 const names=(String(base.name||"")+" "+String(base.parent?.name||"")+" "+String(ch.name||"")).normalize("NFKC").toLowerCase();
 return !/safe.space|moderator|staff|admin|conference|meeting.room|recruit|incident|owner|security|private|prayer|faith|birthday|medical|crisis|system.health|server.tools|case.review|help.desk|coaching.request|support.case|mod.only/i.test(names);
}
async function award(m){
 if(!eligible(m))return false;
 const now=m.createdTimestamp||Date.now(),user=m.author.id,id=m.id;
 const key=user+":"+createHash("sha256").update(String(m.content).normalize("NFKC").toLowerCase().replace(/\s+/g," ").trim()).digest("hex");
 const day=isoDay(now),month=day.slice(0,7),base=m.channel?.isThread?.()?m.channel.parentId:m.channelId;
 writeQueue=writeQueue.then(async()=>{
  if(data.seen[id]||now-Number(data.lastCredit[user]||0)<60000||now-Number(data.hashes[key]||0)<600000)return false;
  const next=structuredClone(data);
  const old=next.users[user]||{xp:0,messages:0,replies:0,monthly:{},daily:{},channels:{},activeDays:[]};
  const current=next.dayChannels[user]?.day===day?next.dayChannels[user].ids:[];
  const reply=Boolean(m.reference?.messageId);
  const score=5+(current.includes(base)?0:3)+(reply?2:0);
  old.xp+=score;old.messages++;if(reply)old.replies++;
  old.monthly[month]=Number(old.monthly[month]||0)+score;
  old.daily[day]=Number(old.daily[day]||0)+score;
  old.channels[base]=Number(old.channels[base]||0)+1;
  old.activeDays=[...new Set([...old.activeDays,day])].sort().slice(-90);
  const oldest=isoDay(now-400*DAY);
  for(const d of Object.keys(old.daily))if(d<oldest)delete old.daily[d];
  next.users[user]=old;
  next.captureStartedAt??=now;next.seen[id]=now;next.hashes[key]=now;next.lastCredit[user]=now;
  next.dayChannels[user]={day,ids:[...new Set([...current,base])].slice(0,50)};
  for(const [mid,t] of Object.entries(next.seen))if(now-Number(t)>35*DAY)delete next.seen[mid];
  for(const [hash,t] of Object.entries(next.hashes))if(now-Number(t)>12*3600000)delete next.hashes[hash];
  await persist(next);
  log("credited",{points:score,period:month,hasContentStored:false});
  return true;
 }).catch(e=>{log("write_failed",{error:String(e.message).slice(0,90)});return false});
 return writeQueue;
}
function snapshot(period){
 const today=isoDay(),monday=weekMonday(today),month=today.slice(0,7),year=today.slice(0,4);
 const rows=Object.entries(data?.users||{}).map(([id,u])=>{
  const entries=Object.entries(u.monthly||{});
  const score=period==="day"?Number(u.daily?.[today]||0):period==="week"?Object.entries(u.daily||{}).reduce((n,[d,v])=>n+(d>=monday&&d<=today?Number(v):0),0):period==="month"?Number(u.monthly?.[month]||0):period==="year"?entries.reduce((n,[d,v])=>n+(d.startsWith(year+"-")?Number(v):0),0):Number(u.xp||0);
  return {id,score,lifetime:Number(u.xp||0)};
 }).sort((a,b)=>b.score-a.score||b.lifetime-a.lifetime||a.id.localeCompare(b.id));
 const start=data?.captureStartedAt;
 const note=start?"XP capture began "+isoDay(start)+". Prior unrecorded history is unavailable; all periods may be partial.":"No qualifying contribution has yet been recorded. Earlier history is unavailable.";
 return {period,rows,total:rows.reduce((n,x)=>n+x.score,0),scope:period==="day"?today:period==="week"?"Week of "+monday:period==="month"?month:period==="year"?year:"Recorded lifetime",note};
}
function ranks(x,limit=10){return x.rows.filter(z=>z.score>0).slice(0,limit).map((z,i)=>(i+1)+". <@"+z.id+"> — **"+z.score+" XP**").join("\n")||"No qualifying XP recorded within the verified coverage window.";}
const btn=(label,id,selected=false)=>({type:2,style:selected?1:2,label,custom_id:id});
function periodRow(prefix,chosen){return {type:1,components:Object.entries(labels).map(([p,label])=>btn(label,prefix+p,p===chosen))};}
function publicPayload(){
 const r=snapshot(publicPeriod);
 return {flags:MessageFlags.IsComponentsV2,allowedMentions:safeMentions,components:[{type:17,accent_color:0x0755c9,components:[
  {type:10,content:"## 🏆 Discord Engagement Tracker\n### Momentum Movement · "+labels[publicPeriod]+" · "+r.scope+"\n**Recorded XP:** "+r.total+" · **Members in verified ledger:** "+r.rows.length},
  periodRow("ddxp:period:",publicPeriod),
  {type:10,content:"**"+labels[publicPeriod]+" Rankings**\n"+ranks(r)},
  {type:1,components:[btn("My XP & Achievements","ddxp:my",false)]},
  {type:10,content:"-# "+r.note+"\n-# Public qualifying human messages only. Personal progress is delivered by private DM; automated news and TikTok gifts never earn Discord XP."}
 ]}]};
}
function insights(){
 const users=Object.values(data?.users||{});
 const byChannel=new Map();
 let replies=0,messages=0,multiday=0;
 for(const u of users){
  replies+=Number(u.replies||0);messages+=Number(u.messages||0);if(new Set(u.activeDays||[]).size>1)multiday++;
  for(const [id,count]of Object.entries(u.channels||{})){const v=byChannel.get(id)||{messages:0,members:0};v.messages+=Number(count||0);v.members++;byChannel.set(id,v)}
 }
 return "**Qualifying messages:** "+messages+"\n**Qualifying replies:** "+replies+"\n**Credited members:** "+users.length+"\n**Members active on 2+ recorded days:** "+multiday+"\n**Top participating channels:**\n"+([ ...byChannel].sort((a,b)=>b[1].messages-a[1].messages).slice(0,5).map(([id,v])=>"• <#"+id+"> — "+v.messages+" credited messages · "+v.members+" members").join("\n")||"No qualifying activity yet.");
}
function adminPayload(){
 const x=snapshot(adminPeriod);
 const pages=["overview","activity","rankings","insights","quality"];
 const menu={type:1,components:pages.map(p=>btn(p==="quality"?"Data Quality":p[0].toUpperCase()+p.slice(1),"ddxp:admin:page:"+p,p===adminPage))};
 let details="";
 if(adminPage==="rankings")details="**"+labels[adminPeriod]+" Rankings · "+x.scope+"**\n"+ranks(x);
 else if(adminPage==="insights")details=insights();
 else if(adminPage==="activity")details="**Current recorded XP:** "+x.total+"\n**Verified members:** "+x.rows.length+"\n**Period:** "+x.scope+"\n"+x.note;
 else if(adminPage==="quality")details="**Source:** persistent, guild-scoped XP volume\n**Guild verified:** "+G+"\n**Historical backfill:** none\n**Raw message content stored:** no\n**Spam protections:** 60s cooldown, 10min repeat hash filter\n**Privacy:** public guild channels only, sensitive rooms excluded\n"+x.note;
 else details="**Current recorded members:** "+x.rows.length+"\n**Current monthly XP:** "+snapshot("month").total+"\n**Recorded lifetime XP:** "+snapshot("life").total+"\n**Public tracker:** <#"+PUBLIC+">\n**Scoring:** 5 per eligible human message +3 for first channel of day +2 for reply.\nNo XP mutation or channel layout controls.";
 return {flags:MessageFlags.IsComponentsV2,allowedMentions:safeMentions,components:[{type:17,accent_color:0x0755c9,components:[
 {type:10,content:"## 🎯 Discord Engagement Management\n-# Momentum Movement · Staff Only · Independent server ledger"},
 menu,
 ...(adminPage==="rankings"?[periodRow("ddxp:admin:period:",adminPeriod)]:[]),
 {type:14,divider:true,spacing:1},
 {type:10,content:details},
 {type:1,components:[btn("Refresh Live Data","ddxp:admin:refresh")]},
 {type:10,content:"-# Verified data only · Original XP history not fabricated · No layout automation"}
 ]}]};
}
function own(m,id){return m?.id===id&&m.author?.id===APP;}
async function sync(){
 if(syncing||!client.isReady()||!data)return;
 syncing=true;
 try{
  for(const [cid,id,payload] of [[PUBLIC,PUBLIC_MSG,publicPayload()],[STAFF,STAFF_MSG,adminPayload()]]){
   const ch=await client.channels.fetch(cid);
   if(ch?.guildId!==G||!ch.messages?.fetch)throw Error("Unexpected dashboard channel");
   const m=await ch.messages.fetch(id,{cache:false});
   if(!own(m,id))throw Error("Existing bot-owned dashboard identity mismatch");
   await m.edit(payload);
   const updated=await ch.messages.fetch(id,{cache:false});
   if(!own(updated,id)||!JSON.stringify(updated.components||[]).includes("ddxp:"))throw Error("Dashboard readback failed");
  }
  log("dashboards_verified",{public:PUBLIC_MSG,staff:STAFF_MSG,periods:5});
 }catch(e){log("dashboard_held",{reason:String(e.message||e).slice(0,120)})}
 finally{syncing=false}
}
const clientInstance=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],allowedMentions:safeMentions});
client=clientInstance;
client.on(Events.MessageCreate,m=>{void award(m).then(ok=>{if(ok)void sync()}).catch(e=>log("event_failed",{error:String(e.message).slice(0,80)}))});
client.on(Events.InteractionCreate,async i=>{
 if(!i.isButton?.()||i.guildId!==G||!i.customId?.startsWith("ddxp:"))return;
 if(!((i.channelId===PUBLIC&&i.message?.id===PUBLIC_MSG)||(i.channelId===STAFF&&i.message?.id===STAFF_MSG))||i.message?.author?.id!==APP)return;
 const action=i.customId.slice(5);
 if(action.startsWith("admin:")){
  if(i.channelId!==STAFF)return;
  const allowed=i.user?.id===i.guild?.ownerId||i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)||i.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
  await i.deferUpdate().catch(()=>{});
  if(!allowed)return;
  if(action.startsWith("admin:page:")&&["overview","activity","rankings","insights","quality"].includes(action.slice(11)))adminPage=action.slice(11);
  else if(action.startsWith("admin:period:")&&labels[action.slice(13)]){adminPeriod=action.slice(13);adminPage="rankings";}
  else if(action!=="admin:refresh")return;
  await sync();return;
 }
 if(i.channelId!==PUBLIC)return;
 await i.deferUpdate().catch(()=>{});
 if(action.startsWith("period:")&&labels[action.slice(7)]){publicPeriod=action.slice(7);await sync();return;}
 if(action==="my"){
  const u=data?.users?.[i.user.id],today=isoDay(),current=today.slice(0,7),xp=u?.xp||0;
  const achievements=[
   [Number(u?.messages||0)>=1,"🌱 First Step"],
   [Number(u?.messages||0)>=50,"💬 Conversation Builder"],
   [Object.keys(u?.channels||{}).length>=5,"🧭 Explorer"],
   [Number(u?.replies||0)>=20,"🤝 Connector"],
   [(u?.activeDays||[]).length>=7,"📅 Seven Active Days"],
   [Number(u?.monthly?.[current]||0)>=250,"🔥 Season Spark"]
  ].filter(([earned])=>earned).map(([,label])=>label);
  const todaysMessages=Number(u?.daily?.[today]||0);
  const body="**Momentum Movement · Your Discord XP & Achievements**\nLifetime: "+xp+" XP\nThis month: "+Number(u?.monthly?.[current]||0)+" XP\nToday: "+todaysMessages+" XP\nQualifying messages: "+Number(u?.messages||0)+"\nQualifying replies: "+Number(u?.replies||0)+"\n**Participation milestones:** "+(achievements.join(", ")||"Not yet unlocked")+"\n**Next steps:** Keep contributing meaningful public messages and replies; milestones are badges, not role or TikTok Fan Club levels.\n"+snapshot("life").note;
  await i.user.send({content:body,allowedMentions:safeMentions}).catch(e=>log("dm_held",{code:String(e.code||e.message).slice(0,70)}));
 }
});
client.once(Events.ClientReady,async()=>{
 try{const g=await client.guilds.fetch(G);if(g?.id!==G||client.user?.id!==APP)throw Error("Scope mismatch");
 await load();await sync();
 setInterval(()=>{void sync()},15*60*1000).unref?.();
 log("gateway_ready",{verifiedGuild:true,persistentLedger:true,messageContentRequested:true});
 }catch(e){log("startup_held",{reason:String(e.message).slice(0,140)})}
});
const sanity=meaningful("This is a meaningful contribution to our community discussions.")&&!meaningful("hi");
if(!sanity||Object.keys(labels).length!==5||weekMonday("2026-11-06")!=="2026-11-02")throw Error("XP self-test failed");
log("selftest_passed",{periods:5,scoringRules:"5+3+2",historyImported:false});
await client.login(token);
