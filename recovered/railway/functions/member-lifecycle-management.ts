const CFG={"guild":"1565048205970767992","audit":"1565644261087780874","alerts":"1565644246411780159","profiles":"1565643954811052057","staff":"1568170088241168464","community":"Momentum Movement"};

import {mkdir,rename} from "node:fs/promises";
const TOKEN=Bun.env.DISCORD_BOT_TOKEN||"";
const AUTHORIZED=Bun.env.AUTHORIZED_GUILD_ID||"";
const FILE="/data/lifecycle-state.json";
const DISCORD="https://discord.com/api/v10";
if(!TOKEN||AUTHORIZED!==CFG.guild){
 console.log("LIFECYCLE_CONFIG_ERROR: missing or mismatched guild-scoped credentials; no writes");
 process.exit(1);
}
function trunc(s,n=100){return String(s||"").replace(/@everyone|@here/gi,"[mention]").slice(0,n)}
function epoch(id){try{return Number((BigInt(id)>>22n)+1420070400000n)}catch{return 0}}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,path,data){
 for(let attempt=0;attempt<4;attempt++){
  const res=await fetch(DISCORD+path,{method,headers:{"Authorization":"Bot "+TOKEN,"Content-Type":"application/json"},...(data===undefined?{}:{body:JSON.stringify(data)})});
  if(res.status===429){let delay=1500;try{delay=Math.max(500,Math.min(15000,Number((await res.json()).retry_after||1.5)*1000))}catch{}await pause(delay);continue}
  if([502,503,504].includes(res.status)&&attempt<3&&!(method==="POST"&&path.includes("/messages"))){await pause(600*(attempt+1));continue}
  if(!res.ok)throw Error("Discord HTTP "+res.status+" on "+method+" "+path);
  return res.status===204?null:await res.json();
 }
 throw Error("Discord API retries exhausted on "+method+" "+path);
}
async function roster(){
 const out=new Map();let after="0";
 for(let page=0;page<100;page++){
  const rows=await api("GET","/guilds/"+CFG.guild+"/members?limit=1000&after="+after);
  if(!Array.isArray(rows))throw Error("Unexpected roster response");
  for(const row of rows){if(row.user?.id)out.set(row.user.id,{name:trunc(row.nick||row.user.global_name||row.user.username,72),joinedAt:row.joined_at||null,bot:!!row.user.bot})}
  if(rows.length<1000)break;
  const last=rows.at(-1)?.user?.id;if(!last||last===after)throw Error("Non-advancing roster cursor");after=last;
 }
 return out;
}
async function auditAction(action){
 try{const x=await api("GET","/guilds/"+CFG.guild+"/audit-logs?limit=100&action_type="+action);return Array.isArray(x.audit_log_entries)?x.audit_log_entries:[]}
 catch(e){console.error("AUDIT_UNAVAILABLE "+action+" "+trunc(e.message,160));return null}
}
async function profiles(){
 const out=new Map();let before="";
 const componentTexts=(items,acc=[])=>{
  for(const item of items||[]){
   if(item?.type===10&&typeof item.content==="string")acc.push(item.content);
   if(Array.isArray(item?.components))componentTexts(item.components,acc);
  }
  return acc;
 };
 for(let p=0;p<12;p++){
  const path="/channels/"+CFG.profiles+"/messages?limit=100"+(before?"&before="+before:"");
  const rows=await api("GET",path);
  if(!Array.isArray(rows))throw Error("Unexpected profile-message response");
  for(const msg of rows){
   const texts=[...(msg.embeds||[]).map(em=>(em.title||"")+"\n"+(em.description||"")),...componentTexts(msg.components||[])];
   for(const body of texts){
    const number=body.match(/\b(?:Yammie|Momentum|Blicky|Bestie|Kocaine|Member)\s*#\s*(\d{4,6})\b/i);
    const user=body.match(/<@!?(\d{17,20})>/);
    if(number&&user&&!out.has(user[1])){const head=String(body.split("\n")[0]||"").trim();const display=head.includes(" · ")?head.split(" · ").slice(1).join(" · ").trim():head.replace(/^#{0,3}\s*[📇🪪]\s*/u,"").trim();out.set(user[1],{number:number[1],name:trunc(display,72),profileTitle:trunc(head,90),profileMessage:msg.id});}
   }
  }
  if(rows.length<100)break;before=rows.at(-1)?.id||"";
  if(!before)throw Error("Profile cursor missing: safety hold");
 }
 return out;
}
function validState(x){
 return x&&x.version===1&&x.guild===CFG.guild&&x.members&&typeof x.members==="object"&&!Array.isArray(x.members)&&Array.isArray(x.events);
}
async function storedState(path){
 const file=Bun.file(path);
 if(!(await file.exists()))return null;
 const value=await file.json();
 if(!validState(value))throw Error("Invalid guild-scoped history at "+path);
 return value;
}
async function read(){
 let hasAny=false;
 for(const path of [FILE,FILE+".bak"]){
  if(!(await Bun.file(path).exists()))continue;
  hasAny=true;
  try{
   const state=await storedState(path);
   if(path!==FILE)console.error("LIFECYCLE_HISTORY_BACKUP_RECOVERY: backup validated, retaining all records");
   return state;
  }catch(err){console.error("LIFECYCLE_HISTORY_READ_ERROR "+path+" "+trunc(err?.message||err,160))}
 }
 if(hasAny)throw Error("All stored history copies invalid: refusing destructive rebaseline");
 return null;
}
async function save(x){
 if(!validState(x))throw Error("Refusing invalid history write");
 try{
  const previous=await storedState(FILE);
  if(previous){
   await Bun.write(FILE+".bak.next",JSON.stringify(previous));
   await rename(FILE+".bak.next",FILE+".bak");
  }
 }catch(err){console.error("LIFECYCLE_HISTORY_BACKUP_SKIP "+trunc(err?.message||err,150))}
 await Bun.write(FILE+".next",JSON.stringify(x));
 await rename(FILE+".next",FILE);
}
function addHistory(m,kind,when,evidence,actionId=null){
 if(!m.history)m.history=[];
 if(actionId&&m.history.some(h=>h.actionId===actionId))return;
 m.history.push({kind,when,evidence,actionId});
 // Preserve the full per-member membership history. No automatic history truncation.
}
function entry(id,src){
 return {id,name:src?.name||"Unknown member",bot:!!src?.bot,number:src?.number||null,profileMessage:src?.profileMessage||null,active:false,joinedAt:src?.joinedAt||null,lastSeenAt:null,detectedAt:null,status:"unknown",reason:"unverified",history:[],lastEventKey:null}
}
function matchAction(id,logs,around,rangeMs=20*60*1000,joinedAt=null){
 const joined=Date.parse(joinedAt||"");
 const lower=Number.isFinite(joined)?joined-60000:0;
 const arr=logs.filter(a=>(a.action_type===20||a.action_type===22)&&String(a.target_id)===id&&epoch(a.id)>=lower&&Math.abs(epoch(a.id)-around)<=rangeMs);
 arr.sort((a,b)=>epoch(b.id)-epoch(a.id));return arr[0]||null;
}
function reasonFor(a){
 return a?.action_type===22?{status:"banned",reason:"verified ban",kind:"ban"}:a?.action_type===20?{status:"removed",reason:"verified staff kick",kind:"kick"}:{status:"former",reason:"departure reason unknown",kind:"departure"};
}
function enqueue(state,m,kind,source,when,actionId=null){
 const key=m.id+":"+kind+":"+when;
 if(state.events.some(e=>e.key===key))return;
 state.events.push({key,userId:m.id,kind,source,when,actionId,statusSnapshot:m.status,reasonSnapshot:m.reason,nameSnapshot:m.name,joinedAtSnapshot:m.joinedAt,done:false,alertMessage:null,auditMessage:null});
 m.lastEventKey=key;
}
function label(status){
 return ({active:"Active",rejoined:"Rejoined",former:"Former Member",removed:"Removed by Staff",banned:"Banned",unbanned:"Unbanned — Not Rejoined",unknown:"Historical Status Unverified"})[status]||"Status Unknown";
}
function eventEmbed(m,e){
 const titles={departure:"🚪 Member Departure Alert",kick:"🛡️ Member Removed",ban:"⛔ Member Banned",joined:"👋 Member Joined",rejoined:"🔄 Member Rejoined",unban:"🔓 Ban Removed"};
 const at=Math.floor(new Date(e.when).getTime()/1000)||Math.floor(Date.now()/1000);
 return {title:titles[e.kind]||"👥 Membership Activity",color:e.kind==="ban"?0xb53333:e.kind==="kick"?0xdb8e37:e.kind==="rejoined"?0x2e976f:0x65788e,description:"**"+trunc(e.nameSnapshot||m.name,72)+"** · <@"+m.id+">"+(m.number?" · Member #"+m.number:""),fields:[{name:"Membership",value:label(e.statusSnapshot||m.status),inline:true},{name:"Reason",value:trunc(e.reasonSnapshot||m.reason,180),inline:true},{name:"Account status",value:"Not independently verified",inline:false},{name:"Detection",value:"<t:"+at+":f> (approximate when based on roster reconciliation)",inline:false},{name:"Evidence",value:trunc(e.source||"Discord membership reconciliation",220),inline:false}],footer:{text:CFG.community+" • Staff only • Membership history • Event "+e.key},timestamp:new Date(e.when).toISOString()};
}
async function send(channel,embed,components){
 const eventKey=embed.footer?.text?.includes(" • Event ") ? embed.footer.text : null;
 if(eventKey||channel===CFG.staff&&embed.title==="👥 Member Administration · Membership Lifecycle"){
  const recent=await api("GET","/channels/"+channel+"/messages?limit=100");
  if(!Array.isArray(recent))throw Error("Cannot verify existing staff message");
  const prior=recent.find(m=>eventKey?m.embeds?.some(e=>e.footer?.text===eventKey):m.embeds?.some(e=>e.title===embed.title));
  if(prior?.id){if(!eventKey)await patch(channel,prior.id,embed,components);return prior.id}
 }
 const x=await api("POST","/channels/"+channel+"/messages",{embeds:[embed],...(components?{components}:{}),flags:4096,allowed_mentions:{parse:[]}});
 if(!x?.id)throw Error("Discord did not confirm message creation");
 return x.id;
}
async function patch(channel,id,embed,components){
 if(!id)return false;
 let safeComponents=components;
 if(channel===CFG.staff&&embed?.title==="👥 Member Administration · Membership Lifecycle"){
  const existing=await api("GET","/channels/"+channel+"/messages/"+id).catch(()=>null);
  const isV2=!!((existing?.flags||0)&32768)||(existing?.components||[]).some(c=>c.type===17);
  if(isV2){
   // Keep the existing component-v2 container and controls; update its text without legacy embeds.
   const current=JSON.parse(JSON.stringify(existing.components||[]));
   const container=current.find(c=>c.type===17);
   if(!container)throw Error("MEMBER_DASHBOARD_V2_CONTAINER_MISSING");
   const rows=(container.components||[]).filter(c=>c.type===1);
   const desired=(components||[]).flatMap(row=>row.components||[]).filter(c=>c.type===3&&String(c.custom_id||"").startsWith("ums:former:"));
   const ownsSelector=rows.some(row=>(row.components||[]).some(c=>c.custom_id==="ums:member"));
   if(ownsSelector){
    for(const row of rows)for(const opt of row.components||[]){
     if(opt.type!==3||!String(opt.custom_id||"").startsWith("ums:former:"))continue;
     const next=desired.find(c=>c.custom_id===opt.custom_id);
     if(next&&JSON.stringify(next.options||[])!==JSON.stringify(opt.options||[]))opt.options=next.options||[];
    }
   }
   const texts=[];
   const collect=(nodes)=>{for(const node of nodes||[]){if(node.type===10&&typeof node.content==="string")texts.push(node.content);if(Array.isArray(node.components))collect(node.components);}};
   collect(container.components);
   const selectedText=texts.find(s=>s.includes("**Selected identity**"));
   if(selectedText&&!embed.fields.some(f=>f.name==="Selected identity")){
    const value=selectedText.split("**Selected identity**").slice(1).join("**Selected identity**").trim().split("-# Selection snapshot; membership may have changed.")[0].trimEnd().slice(0,880);
    if(value)embed.fields.push({name:"Selected identity",value:value+"\n-# Selection snapshot; membership may have changed.",inline:false});
   }
   const children=[{type:10,content:"## "+embed.title+"\n"+(embed.description||"")},{type:14,spacing:1,divider:true}];
   for(let i=0;i<embed.fields.length;i+=3){
    const group=embed.fields.slice(i,i+3).map(f=>"**"+f.name+"**\n"+f.value).join("\n\n");
    children.push({type:10,content:group});
    if(i+3<embed.fields.length)children.push({type:14,spacing:1,divider:true});
   }
   if(embed.footer?.text){children.push({type:14,spacing:1,divider:true});children.push({type:10,content:"-# "+embed.footer.text});}
   children.push(...rows);
   const updated={...container,accent_color:container.accent_color??embed.color,components:children};
   try{await api("PATCH","/channels/"+channel+"/messages/"+id,{content:"",embeds:[],flags:32768,components:[updated],allowed_mentions:{parse:[]}});return true}
   catch(e){if(String(e?.message||"").includes("Discord HTTP 404"))return false;throw e}
  }
  // Legacy-message fallback.
  safeComponents=undefined;
  if(components&&Array.isArray(existing?.components)){
   const current=JSON.parse(JSON.stringify(existing.components));
   const ownsSelector=current.some(row=>(row.components||[]).some(c=>c.custom_id==="ums:member"));
   if(ownsSelector){
    const desired=components.flatMap(row=>row.components||[]).filter(c=>c.type===3&&String(c.custom_id||"").startsWith("ums:former:"));
    let changed=false;
    for(const row of current)for(const opt of row.components||[]){
     if(opt.type!==3||!String(opt.custom_id||"").startsWith("ums:former:"))continue;
     const next=desired.find(c=>c.custom_id===opt.custom_id);
     if(next?.options?.length&&JSON.stringify(next.options)!==JSON.stringify(opt.options)){opt.options=next.options;changed=true;}
    }
    if(changed)safeComponents=current;
   }
  }
  const selected=existing?.embeds?.[0]?.fields?.find(f=>f.name==="Selected identity");
  if(selected&&typeof selected.value==="string"){
   const value=selected.value.replace("Status: Active member","Status when selected: Active member").split("-# Selection snapshot; membership may have changed.")[0].trimEnd().slice(0,880);
   embed.fields.push({name:"Selected identity",value:value+"\n-# Selection snapshot; membership may have changed.",inline:false});
  }
 }
 try{await api("PATCH","/channels/"+channel+"/messages/"+id,{embeds:[embed],...(safeComponents?{components:safeComponents}:{}),allowed_mentions:{parse:[]}});return true}
 catch(e){if(String(e?.message||"").includes("Discord HTTP 404"))return false;throw e}
}
function universalSelectorRows(state){
 const history=Object.values(state.members).filter(m=>!m.active&&!m.bot&&/^\d{17,20}$/.test(m.id)).sort((a,b)=>String(b.lastSeenAt||b.detectedAt||"").localeCompare(String(a.lastSeenAt||a.detectedAt||"")));
 const rows=[{type:1,components:[{type:5,custom_id:"ums:member",placeholder:"Select Discord Member",min_values:1,max_values:1}]}];
 for(let page=0;page<Math.min(3,Math.ceil(history.length/25));page++){
  const options=history.slice(page*25,page*25+25).map(m=>({label:trunc(m.name||"Former member",90),value:m.id,description:(m.status==="banned"?"Audit-confirmed ban":m.status==="removed"?"Audit-confirmed kick":"Departure reason unverified").slice(0,100)}));
  if(options.length)rows.push({type:1,components:[{type:3,custom_id:"ums:former:"+page,placeholder:"Find Previous Member"+(history.length>25?" "+(page*25+1)+"–"+Math.min(history.length,(page+1)*25):""),min_values:1,max_values:1,options}]});
 }
 rows.push({type:1,components:[{type:2,style:2,custom_id:"ums:manual",label:"Enter TikTok Handle"}]});
 return rows;
}
async function dashboard(state){
 const selectorComponents=universalSelectorRows(state);
 const ms=Object.values(state.members),active=ms.filter(m=>m.active&&!m.bot).length,bots=ms.filter(m=>m.active&&m.bot).length,former=ms.filter(m=>!m.active).length;
 const banned=ms.filter(m=>!m.active&&m.status==="banned").length,removed=ms.filter(m=>!m.active&&m.status==="removed").length;
 const review=ms.filter(m=>!m.active&&["unknown","former"].includes(m.status)).length;
 const historicalProfiles=ms.filter(m=>!m.active&&!!m.profileMessage);
 const profileReview=historicalProfiles.slice(0,8).map(m=>"• "+trunc(m.name,55)+(m.number?" · #"+m.number:"")+" · Reason unverified").join("\n")||"No historical profile candidates currently identified.";
 const pastActions=ms.reduce((n,m)=>n+(m.history||[]).filter(h=>["historical_kick","historical_ban","historical_unban"].includes(h.kind)).length,0);
 const ts=Math.floor(new Date(state.lastScan).getTime()/1000);
 const recent=state.events.slice(-5).reverse().map(e=>{const m=state.members[e.userId];return "• "+trunc(m?.name||"Member",45)+" — "+({departure:"Departure (unverified)",kick:"Staff kick",ban:"Ban",joined:"Joined",rejoined:"Rejoined",unban:"Unbanned"})[e.kind]+" (<t:"+Math.floor(new Date(e.when).getTime()/1000)+":R>)"}).join("\n")||"No tracked changes since monitoring began.";
 const em={title:"👥 Member Administration · Membership Lifecycle",description:"Staff-only current and former member monitoring. This updates existing member records; public profiles are unchanged.",color:0x4f759c,fields:[{name:"Current human members",value:String(active),inline:true},{name:"Bots",value:String(bots),inline:true},{name:"Former / historical records",value:String(former),inline:true},{name:"Needs review",value:String(review),inline:true},{name:"Historical profiles absent from roster",value:String(historicalProfiles.length),inline:true},{name:"Historical profile review",value:profileReview,inline:false},{name:"Verified bans",value:String(banned),inline:true},{name:"Latest confirmed kick status",value:String(removed),inline:true},{name:"Recorded historical moderation actions",value:String(pastActions),inline:true},{name:"Reconciliation",value:"Every 5 minutes",inline:true},{name:"Recent membership events",value:recent,inline:false},{name:"Last verified roster scan",value:"<t:"+ts+":F>",inline:false},{name:"Important limitation",value:"Absence alone does not prove someone intentionally left. Disabled or deactivated Discord accounts cannot be verified through this workflow.",inline:false}],footer:{text:CFG.community+" • Staff only • Original member numbers preserved"}};
 if(state.dashboardId&&await patch(CFG.staff,state.dashboardId,em,selectorComponents))return;
 state.dashboardId=await send(CFG.staff,em,selectorComponents);await save(state);
}
async function run(){
 await mkdir("/data",{recursive:true});
 const now=new Date().toISOString(),existing=await read(),current=await roster();
 if(current.size===0)throw Error("ROSTER_SAFETY_HOLD: empty roster; refusing all membership changes and alerts");
 if(existing){const known=Object.values(existing.members).filter(m=>m.active).length;const missing=Object.values(existing.members).filter(m=>m.active&&!current.has(m.id)).length;if(known>=10&&missing>Math.max(4,Math.ceil(known*0.35)))throw Error("ROSTER_SAFETY_HOLD: abnormal member drop "+missing+"/"+known+"; review before alerting");}
 if(!existing){
  const p=await profiles();
  const state={version:1,guild:CFG.guild,createdAt:now,lastScan:now,members:{},events:[],dashboardId:null};
  for(const [id,v] of current){
   const m=entry(id,{...v,...(p.get(id)||{})});m.active=true;m.status="active";m.reason="present on baseline roster";m.lastSeenAt=now;
   addHistory(m,"baseline_present",now,"Verified member roster");state.members[id]=m;
  }
  for(const [id,v] of p)if(!state.members[id]){
   const m=entry(id,v);m.status="unknown";m.reason="historical profile exists, current roster absent";
   addHistory(m,"historical_profile_not_in_roster",now,"Historical profile and current roster comparison");state.members[id]=m;
  }
  const checks=await Promise.all([auditAction(20),auditAction(22),auditAction(23)]);
  for(const rows of checks)for(const a of rows||[]){
   const id=String(a.target_id||"");if(!/^\d{17,20}$/.test(id))continue;
   const m=state.members[id]||(state.members[id]=entry(id,{}));
   addHistory(m,a.action_type===20?"historical_kick":a.action_type===22?"historical_ban":"historical_unban",new Date(epoch(a.id)).toISOString(),"Discord audit log; historical moderation action",a.id);
   if(!m.active&&m.status==="unknown")m.reason="Historical moderation record; latest departure reason unverified";
  }
  await save(state);await dashboard(state);
  console.log(JSON.stringify({event:"LIFECYCLE_BASELINE_VERIFIED",members:current.size,historicalProfiles:p.size,formerRecords:Object.values(state.members).filter(m=>!m.active).length,alertsSent:0}));
  return;
 }
 const state=existing;
 const savedProfiles=await profiles();
 for(const [id,profile] of savedProfiles){
  let m=state.members[id];
  if(!m){
   m=entry(id,profile);state.members[id]=m;
   m.status="unknown";m.reason="Historical profile exists; latest membership reason unverified";
   addHistory(m,"historical_profile_discovered",now,"Canonical public profile reconciliation");
  }else{
   if(m.name==="Unknown member"&&profile.name)m.name=profile.name;
   if(!m.number)m.number=profile.number;
   else if(m.number!==profile.number)console.error("PROFILE_NUMBER_CONFLICT "+id);
   if(!m.profileMessage)m.profileMessage=profile.profileMessage;
  }
 }
 const [ks,bs,us,ps]=await Promise.all([auditAction(20),auditAction(22),auditAction(23),auditAction(21)]);
 const auditAvailable=ks!==null&&bs!==null,moderation=[...(ks||[]),...(bs||[])];
 const oldScan=Date.parse(state.lastScan)||Date.now()-300000;
 for(const [id,v] of current){
  let m=state.members[id];
  const newMember=!m;
  const returning=!!m&&!m.active;
  if(newMember){m=entry(id,v);state.members[id]=m}
  m.name=v.name;m.bot=!!v.bot;
  if(!m.firstJoinedAt&&v.joinedAt)m.firstJoinedAt=v.joinedAt;
  m.joinedAt=v.joinedAt;m.lastSeenAt=now;
  if(newMember){
   m.active=true;m.status="active";m.reason="joined server";
   addHistory(m,"joined",now,"Verified current member roster");
   if(!m.bot)enqueue(state,m,"joined","Human member detected in roster",now);
  }else if(returning){
   m.active=true;m.status="rejoined";m.reason="verified return to server";
   addHistory(m,"rejoined",now,"Verified current member roster");
   if(!m.bot)enqueue(state,m,"rejoined","Human member returned to roster",now);
  }else{m.status="active";m.reason="currently in server"}
 }
 for(const [id,m] of Object.entries(state.members)){
  if(current.has(id)||!m.active)continue;
  m.active=false;m.detectedAt=now;
  const a=auditAvailable?matchAction(id,moderation,Date.now(),Math.min(45*60*1000,Math.max(20*60*1000,Date.now()-oldScan+600000)),m.joinedAt):null;
  const r=reasonFor(a);m.status=r.status;m.reason=a?r.reason:"departure reason unverified";
  addHistory(m,r.kind,now,a?"Matched Discord audit action "+a.action_type:"Absent from current roster; no verified cause",a?.id||null);
  if(!m.bot)enqueue(state,m,r.kind,a?"Discord audit log confirmed":"Roster reconciliation; no verified voluntary-leave signal",now,a?.id||null);
 }
 for(const e of state.events){
  if(e.kind!=="departure"||!auditAvailable||!Number.isFinite(Date.parse(e.when))||Date.now()-Date.parse(e.when)>45*60*1000)continue;
  const m=state.members[e.userId];if(!m)continue;
  const a=matchAction(e.userId,moderation,Date.parse(e.when),20*60*1000,e.joinedAtSnapshot||null);
  if(!a||e.actionId===a.id)continue;
  const r=reasonFor(a);
  addHistory(m,r.kind,new Date(epoch(a.id)).toISOString(),"Delayed audit-log correlation for recorded departure",a.id);
  if(!m.active&&m.lastEventKey===e.key){m.status=r.status;m.reason=r.reason}
  e.kind=r.kind;e.source="Discord audit log verified after departure";e.actionId=a.id;
  e.statusSnapshot=r.status;e.reasonSnapshot=r.reason;e.needsUpdate=true;
 }
 for(const a of us||[]){
  const id=String(a.target_id||"");const m=state.members[id];
  if(!m||m.active||m.status!=="banned"||epoch(a.id)<Date.parse(m.detectedAt||state.createdAt))continue;
  m.status="unbanned";m.reason="verified ban reversal; member has not rejoined";
  addHistory(m,"unban",new Date(epoch(a.id)).toISOString(),"Discord moderation audit log",a.id);
  if(!state.events.some(e=>e.actionId===a.id))enqueue(state,m,"unban","Verified Discord unban action",new Date(epoch(a.id)).toISOString(),a.id);
 }
 if(ps?.length){
  const newest=ps[0];if(epoch(newest.id)>=oldScan)console.log("LIFECYCLE_PRUNE_ACTION_OBSERVED: individual causes not inferred");
 }
 state.lastScan=now;
 await save(state);
 for(const e of state.events.filter(e=>!e.done).concat(state.events.filter(e=>e.done&&e.needsUpdate)).slice(0,12)){
  const m=state.members[e.userId];if(!m)continue;
  if(e.needsUpdate&&e.done){
   const em=eventEmbed(m,e);
   const [one,two]=await Promise.all([patch(CFG.alerts,e.alertMessage,em),patch(CFG.audit,e.auditMessage,em)]);
   if(one&&two)e.needsUpdate=false;
   await save(state);
  }
  if(e.done)continue;
  const em=eventEmbed(m,e);
  if(!e.alertMessage){e.alertMessage=await send(CFG.alerts,em);await save(state)}
  if(!e.auditMessage){e.auditMessage=await send(CFG.audit,em);await save(state)}
  e.done=true;await save(state);
 }
 await dashboard(state);
 console.log(JSON.stringify({event:"LIFECYCLE_RECONCILED",active:current.size,former:Object.values(state.members).filter(m=>!m.active).length,newPendingAlerts:state.events.filter(e=>!e.done).length,auditAvailable}));
}
await run().catch(e=>{console.error("MEMBER_LIFECYCLE_FAILED "+trunc(e?.message||e,250));process.exitCode=1});
