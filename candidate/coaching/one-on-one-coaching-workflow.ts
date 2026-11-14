# Candidate 1-on-1 Coaching Workflow — authenticated HTTPS ingress

- Candidate only. This is not deployed or connected to a public endpoint.
- Derived from the read-only recovered live Workflow source; the recovered production service remains untouched.
- The /interaction route rejects requests without a valid per-service HMAC-SHA256 signature and a timestamp within 60 seconds.
- The exact raw request body is signed before JSON parsing; body size is limited to 256 KiB.
- Separate secrets are required for Bot 005 and the independent Coaching Interaction Relay.
- Required environment variables: DISCORD_BOT_TOKEN, AUTHORIZED_GUILD_ID, APPLICATION_ID, COACHING_BOT005_AUTH_SECRET, COACHING_RELAY_AUTH_SECRET, COACHING_IDEMPOTENCY_URL, COACHING_IDEMPOTENCY_TOKEN, WRITES_ENABLED.
- /readyz is a read-only health endpoint. Do not expose a public endpoint until both source secrets are provisioned and the candidate is deployed behind HTTPS.
- Interaction IDs are claimed in the Cloudflare Durable Object SQLite store before dispatch, with a seven-day retention window; the local map is only a short-lived duplicate fast path. A successful durable claim is at-most-once: a crash after claim but before dispatch can require manual recovery.
- No production service, database, or deployment has been changed.

---


const G="1565048205970767992",APP="1565304619838742598",REQUEST="1569552594727215164",MANAGEMENT="1569552611995287745",VOICE="1569552605003124883",MOD="1565407676580499616",ADMIN="1565547110944735272";
const API="https://discord.com/api/v10",token=()=>Bun.env.DISCORD_BOT_TOKEN||"";
const { verifyCoachingRequest } = await import("../../implementation/coaching-workflow-auth.mjs");
let ready=false,ownerId=null,lastError=null,coachingIdempotencyEndpoint=null;
const seenInteractions=new Map(),formSessions=new Map(),pendingActions=new Set();
const activeStatuses=new Set(["Pending Review","Awaiting Member Response","Approved - Scheduling","Scheduled","Active Coaching"]);
const closedStatuses=new Set(["Completed","Declined","Withdrawn","Cancelled"]),pendingUsers=new Set();
const quiet={parse:[],users:[],roles:[],replied_user:false};
const clean=(v,n=900)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/@/g,"@\u200b").trim().slice(0,n);
const safeUrl=v=>String(v??"").replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,220);
async function api(method,path,body){
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch(API+path,{method,headers:{authorization:"Bot "+token(),"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(9000)});
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null}catch{data={message:raw.slice(0,300)}}
  if(r.status===429&&attempt<2){await Bun.sleep(Math.min(2500,Math.max(300,Number(r.headers.get("retry-after")||1)*1000)));continue}
  if(!r.ok)throw Error("Discord "+method+" "+path+" returned "+r.status+": "+String(data?.message||raw).slice(0,240));
  return data;
 }
 throw Error("Discord API retry limit reached");
}
async function callback(i,type,data){
 if(i.__acknowledged)return;
 const started=Date.now(),snowflake=String(i.id||"");
 const createdAt=/^\d{15,22}$/.test(snowflake)?Number((BigInt(snowflake)>>22n)+1420070400000n):null;
 try{
  const r=await fetch(API+"/interactions/"+i.id+"/"+i.token+"/callback",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type,data}),signal:AbortSignal.timeout(1800)});
  if(!r.ok)throw Error("Interaction callback returned "+r.status);
  i.__acknowledged=true;
  console.log(JSON.stringify({event:"coaching_interaction_ack",type,ackLatencyMs:Date.now()-started,interactionAgeMs:createdAt===null?null:Date.now()-createdAt}));
 }catch(error){
  console.log(JSON.stringify({event:"coaching_interaction_ack_failed",type,ackLatencyMs:Date.now()-started,interactionAgeMs:createdAt===null?null:Date.now()-createdAt,reason:String(error?.message||error).slice(0,120)}));
  throw error;
 }
}
async function followup(i,content){
 const r=await fetch(API+"/webhooks/"+APP+"/"+i.token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content,allowed_mentions:quiet}),signal:AbortSignal.timeout(4000)});
 if(!r.ok)console.log("COACHING_FOLLOWUP_FAILED",r.status);
}
async function editOriginal(i,content){
 const r=await fetch(API+"/webhooks/"+APP+"/"+i.token+"/messages/@original",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({content,allowed_mentions:quiet}),signal:AbortSignal.timeout(4000)});
 if(!r.ok)console.log("COACHING_ORIGINAL_EDIT_FAILED",r.status);
}
function modal(i,id,title,fields){
 const components=fields.map(f=>{
  let component;
  if(f.kind==="select"){
   component={type:3,custom_id:f.id,placeholder:"Choose "+f.label.toLowerCase(),options:f.options.map(o=>({label:o[0],value:o[1]})),min_values:f.required===false?0:1,max_values:f.multi?Math.min(f.options.length,9):1,required:f.required!==false};
  }else{
   component={type:4,custom_id:f.id,style:f.style||1,required:!!f.required,max_length:f.max||500,placeholder:f.placeholder||""};
  }
  return {type:18,label:f.label,component};
 });
 return callback(i,9,{custom_id:id,title,components});
}
function modalFields(i){
 const out={};
 const visit=c=>{
  if(!c)return;
  if(c.custom_id){
   if(Array.isArray(c.values))out[c.custom_id]=c.values.join(", ");
   else if(c.value!==undefined)out[c.custom_id]=clean(c.value,1100);
  }
  if(c.component)visit(c.component);
  for(const child of c.components||[])visit(child);
 };
 for(const row of i.data?.components||[])visit(row);
 return out;
}
function metaOf(m){
 const s=m?.embeds?.[0]?.footer?.text||"";
 if(!s.startsWith("coach:record:v1:"))return null;
 try{return JSON.parse(s.slice("coach:record:v1:".length))}catch{return null}
}
function valuesOf(m){
 const out={};for(const f of m?.embeds?.[0]?.fields||[])out[f.name]=f.value;return out;
}
function footer(meta){return "coach:record:v1:"+JSON.stringify(meta)}
function recordEmbed(meta,v){
 const fields=[
  ["Member",v.Member||("<@"+meta.memberId+">")],["Assigned Coach",meta.assignedTo?("<@"+meta.assignedTo+">"):"Unassigned"],["TikTok Username",v["TikTok Username"]||"Not provided"],
  ["TikTok Profile",v["TikTok Profile"]||"Not provided"],["Coaching Topic",v["Coaching Topic"]||"Not provided"],
  ["Current Situation",v["Current Situation"]||"Not provided"],["Coaching Areas",v["Coaching Areas"]||"Not provided"],["Goals / Priorities / Success Criteria",v["Goals / Priorities / Success Criteria"]||"Not provided"],
  ["Support Needed",v["Support Needed"]||"Not provided"],["Other Available Days/Times",v["Other Available Days/Times"]||"Not provided"],["Preferred Date/Time + Time Zone",v["Preferred Date/Time + Time Zone"]||"Not provided"],
  ["Session Length",v["Session Length"]||"Not provided"],["Coach Preference",v["Coach Preference"]||"No preference"],["Commitment / Expectations",v["Commitment / Expectations"]||"Not provided"],["Privacy Consent",v["Privacy Consent"]||"Not provided"],
  ["Supporting Materials",v["Supporting Materials"]||"Not provided"],["Alternate Availability",v["Alternate Availability"]||"Not provided"],["Additional Details",v["Additional Details"]||"Not provided"],
  ["Appointment",meta.appointment||"Not scheduled"],["Status",meta.status]
 ].map(([name,value])=>({name,value:String(value||"Not provided").slice(0,1024),inline:false}));
 return {title:"1-on-1 Coaching Request - "+meta.status,description:"Private staff record. Review the request, communicate with the member, and update its status using the controls below.",color:meta.status==="Declined"?0xed4245:meta.status==="Completed"?0x57f287:0x5865f2,fields,footer:{text:footer(meta)},timestamp:meta.createdAt};
}
function staffButtons(id,status){
 return [
  {type:1,components:[
   {type:2,style:3,label:"Approve",custom_id:"coach:staff:approve:"+id},
   {type:2,style:4,label:"Decline",custom_id:"coach:staff:decline:"+id},
   {type:2,style:2,label:"Request Info",custom_id:"coach:staff:clarify:"+id},
   {type:2,style:1,label:status==="Scheduled"?"Reschedule":"Schedule",custom_id:"coach:staff:schedule:"+id},
   {type:2,style:2,label:"Staff Note",custom_id:"coach:staff:note:"+id}
  ]},
  {type:1,components:[
   {type:2,style:2,label:"Activate",custom_id:"coach:staff:activate:"+id},
   {type:2,style:3,label:"Complete",custom_id:"coach:staff:complete:"+id},
   {type:2,style:4,label:"Cancel",custom_id:"coach:staff:cancel:"+id},
   {type:2,style:2,label:"Reopen",custom_id:"coach:staff:reopen:"+id}
  ]},
  {type:1,components:[{type:5,custom_id:"coach:staff:assign:"+id,placeholder:"Assign Coach",min_values:1,max_values:1}]}
 ]; 
}
function memberButtons(id,status){
 const b=[{type:2,style:2,label:"Check Status",custom_id:"coach:dm:status:"+id}];
 if(!closedStatuses.has(status))b.push({type:2,style:1,label:"Respond to Staff",custom_id:"coach:dm:respond:"+id},{type:2,style:2,label:"Add Details",custom_id:"coach:dm:details:"+id},{type:2,style:4,label:"Withdraw Request",custom_id:"coach:dm:withdraw:"+id});
 return [{type:1,components:b}];
}
function dmEmbed(meta,v){
 const desc=["**Request:** "+meta.id,"**Status:** "+meta.status,"**Topic:** "+clean(v["Coaching Topic"]||"Not provided",150)];
 if(meta.appointment)desc.push("**Appointment:** "+clean(meta.appointment,300));
 if(meta.assignedTo)desc.push("**Assigned coach:** <@"+meta.assignedTo+">");
 if(meta.lastStaffMessage)desc.push("**Message from staff:** "+clean(meta.lastStaffMessage,700));
 desc.push("Your request details and status are private to you and authorized staff.");
 return {title:"Your 1-on-1 Coaching Request",description:desc.join("\n"),color:0x5865f2,footer:{text:"coach:member:v1:"+meta.id}};
}
async function getRecord(id){
 const m=await api("GET","/channels/"+MANAGEMENT+"/messages/"+id),meta=metaOf(m);
 if(!meta||m.author?.id!==APP||meta.memberId==null)throw Error("Coaching record could not be verified");
 meta.id=id;return {message:m,meta,values:valuesOf(m)};
}
async function updateRecord(rec){
 await api("PATCH","/channels/"+MANAGEMENT+"/messages/"+rec.meta.id,{embeds:[recordEmbed(rec.meta,rec.values)],components:staffButtons(rec.meta.id,rec.meta.status),allowed_mentions:quiet});
}
async function openDM(uid){return api("POST","/users/@me/channels",{recipient_id:uid})}
async function sendDM(uid,body){
 const ch=await openDM(uid),m=await api("POST","/channels/"+ch.id+"/messages",body);
 return {channelId:ch.id,messageId:m.id};
}
async function updateDM(rec){
 const body={embeds:[dmEmbed(rec.meta,rec.values)],components:memberButtons(rec.meta.id,rec.meta.status),allowed_mentions:quiet};
 if(rec.meta.dmChannelId&&rec.meta.dmMessageId){await api("PATCH","/channels/"+rec.meta.dmChannelId+"/messages/"+rec.meta.dmMessageId,body)}
 else{const dm=await sendDM(rec.meta.memberId,body);rec.meta.dmChannelId=dm.channelId;rec.meta.dmMessageId=dm.messageId;await updateRecord(rec)}
 try{await upsertPortal(rec.meta.memberId)}catch(e){console.log("COACHING_PORTAL_UPDATE_FAILED",String(e.message||e).slice(0,120))}
 return true;
}
async function allRequests(userId){
 const out=[];let before=null;
 for(let page=0;page<10;page++){
  const rows=await api("GET","/channels/"+MANAGEMENT+"/messages?limit=100"+(before?"&before="+before:""));
  if(!Array.isArray(rows)||!rows.length)break;
  for(const m of rows){const meta=metaOf(m);if(meta&&m.author?.id===APP&&(!userId||meta.memberId===userId)){meta.id=m.id;out.push({message:m,meta,values:valuesOf(m)})}}
  before=rows[rows.length-1].id;if(rows.length<100)break;
 }
 return out;
}
async function setVoice(rec,grant){
 const route="/channels/"+VOICE+"/permissions/"+rec.meta.memberId;
 if(grant){
  const channel=await api("GET","/channels/"+VOICE);
  const existing=(channel.permission_overwrites||[]).find(o=>o.id===rec.meta.memberId&&Number(o.type)===1);
  if(!rec.meta.voiceGranted)rec.meta.voicePrevious=existing?{allow:existing.allow||"0",deny:existing.deny||"0"}:null;
  const allow=(BigInt(existing?.allow||rec.meta.voicePrevious?.allow||"0")|1048576n).toString();
  const deny=(BigInt(existing?.deny||rec.meta.voicePrevious?.deny||"0")&~1048576n).toString();
  await api("PUT",route,{type:1,allow,deny});rec.meta.voiceGranted=true;
 }else if(rec.meta.voiceGranted){
  if(rec.meta.voicePrevious)await api("PUT",route,{type:1,allow:rec.meta.voicePrevious.allow,deny:rec.meta.voicePrevious.deny});
  else await api("DELETE",route);
  rec.meta.voiceGranted=false;delete rec.meta.voicePrevious;
 }
}
async function saveStatus(rec,status,actor,appointment){
 const old=rec.meta.status;
 if(closedStatuses.has(old)&&!closedStatuses.has(status))throw Error("This request is closed and cannot be reopened from this control");
 if(status==="Scheduled"&&old!=="Approved - Scheduling"&&old!=="Scheduled")throw Error("Approve the request before scheduling");
 if(status==="Active Coaching"&&old!=="Scheduled"&&old!=="Active Coaching")throw Error("Schedule the session before activating it");
 if(status==="Completed"&&old!=="Active Coaching"&&old!=="Scheduled")throw Error("Only a scheduled or active session can be completed");
 if(status==="Cancelled"&&closedStatuses.has(old))throw Error("This request is already closed");
 if(status==="Withdrawn"&&!activeStatuses.has(old))throw Error("This request can no longer be withdrawn");
 if(status==="Scheduled")await setVoice(rec,true);
 if(["Completed","Declined","Withdrawn","Cancelled"].includes(status))await setVoice(rec,false);
 rec.meta.status=status;rec.meta.updatedAt=new Date().toISOString();rec.meta.lastActor=actor;
 if(appointment!==undefined)rec.meta.appointment=appointment;
 await updateRecord(rec);try{await updateDM(rec)}catch(e){console.log("COACHING_DM_UPDATE_FAILED",String(e.message||e).slice(0,140))}
 try{await postPrivateLog(rec.meta.id,"STATUS CHANGE",actor,old+" -> "+status+(appointment?" | "+appointment:""))}catch(e){console.log("COACHING_AUDIT_LOG_FAILED",String(e.message||e).slice(0,120))}
}
async function postPrivateLog(recordId,kind,actor,text){
 await api("POST","/channels/"+MANAGEMENT+"/messages",{content:"**"+kind+" - Request "+recordId+"**\nBy <@"+actor+">:\n"+clean(text,1600),allowed_mentions:quiet});
}
async function makeRequest(i,f){
 const uid=i.member?.user?.id||i.user?.id,rawHandle=clean(f.tiktok,24).replace(/^@/,""),rawUrl=safeUrl(f.profile);
 const urlMatch=rawUrl.match(/^https:\/\/(?:www\.)?tiktok\.com\/@([\w.]+)\/?$/i);
 const handle=rawHandle||urlMatch?.[1]||"",url=rawUrl||(handle?"https://www.tiktok.com/@"+handle:"");
 const verifiedUrl=url.match(/^https:\/\/(?:www\.)?tiktok\.com\/@([\w.]+)\/?$/i);
 const topic=clean(f.topics,500),goals=clean([f.short_goals,f.long_goals,f.priorities,f.success].filter(Boolean).join("\n"),1000),preferred=clean(f.preferred,250);
 if(!uid||(!rawHandle&&!rawUrl)||!/^[A-Za-z0-9._]{2,24}$/.test(handle)||!verifiedUrl||(rawHandle&&verifiedUrl[1].toLowerCase()!==rawHandle.toLowerCase())||topic.length<3||goals.length<10||preferred.length<5||clean(f.alternate,100).length<10||f.consent!=="agree"){
  await editOriginal(i,"Your request was not submitted. Check your TikTok username/profile link, topic, goals, and preferred date/time with time zone, then try again.");return;
 }
 try{localAppointmentToUtc(preferred,f.timezone);localAppointmentToUtc(f.alternate,f.timezone)}catch(e){await editOriginal(i,"Enter both appointment options as valid YYYY-MM-DD at HH:MM dates in your selected time zone.");return;}
 if(pendingUsers.has(uid)){await editOriginal(i,"Your earlier request is still processing. No duplicate request was created.");return}
 pendingUsers.add(uid);
 try{
  const prior=await allRequests(uid),active=prior.find(r=>activeStatuses.has(r.meta.status));
  if(active){await editOriginal(i,"You already have an active coaching request: "+active.meta.id+". Use My Requests to check its status.");return}
  const createdAt=new Date().toISOString(),meta={v:1,memberId:uid,status:"Pending Review",createdAt,updatedAt:createdAt,voiceGranted:false,appointment:null,dmChannelId:null,dmMessageId:null};
  const vals={"Member":"<@"+uid+">","TikTok Username":"@"+handle,"TikTok Profile":url,"Coaching Topic":topic,"Coaching Areas":topic,"Current Situation":clean(f.situation,900),"Goals / Priorities / Success Criteria":goals,"Goals / Challenges":clean(f.challenges,700),"Support Needed":clean(f.support,700),"Other Available Days/Times":clean(f.windows,300)||"Not provided","Preferred Date/Time + Time Zone":preferred+" | Time zone: "+f.timezone,"Session Length":clean(f.length,80),"Commitment / Expectations":clean([f.commitment,f.expectations].filter(Boolean).join("\n"),1000),"Privacy Consent":f.consent==="agree"?"Agreed":"Not agreed","Coach Preference":clean(f.coach,120)||"No preference","Supporting Materials":clean(f.materials,500)||"Not provided","Alternate Availability":clean(f.alternate+" | Time zone: "+f.timezone,250)||"Not provided","Additional Details":clean(f.additionalDetails,1000)||"Not provided"};
  const m=await api("POST","/channels/"+MANAGEMENT+"/messages",{embeds:[recordEmbed(meta,vals)],components:[],allowed_mentions:quiet});meta.id=m.id;
  try{const dm=await sendDM(uid,{embeds:[dmEmbed(meta,vals)],components:memberButtons(meta.id,meta.status),allowed_mentions:quiet});meta.dmChannelId=dm.channelId;meta.dmMessageId=dm.messageId}
  catch(e){meta.dmFailed=true;console.log("COACHING_DM_FAILED",String(e.message||e).slice(0,160))}
  await updateRecord({message:m,meta,values:vals});
  await editOriginal(i,meta.dmFailed?"Your request was delivered to authorized staff, but I could not send your private receipt. Enable DMs from this server and use My Requests to retry.":"Your coaching request was submitted privately. Your receipt and status controls were sent to your DMs.");
 }finally{pendingUsers.delete(uid)}
}
async function upsertPortal(uid){
 const dm=await openDM(uid),marker="coach:portal:v1:"+uid;
 const rows=await allRequests(uid),recent=rows.slice(0,10);
 const history=recent.length?recent.map(r=>"**"+r.meta.status+"** — "+clean(r.values["Coaching Topic"]||"Coaching request",90)+"\nRequest "+r.meta.id+" · "+new Date(r.meta.createdAt).toLocaleDateString("en-US")+(r.meta.appointment?" · "+clean(r.meta.appointment,90):"")).join("\n\n"):"You have no coaching requests yet.";
 const body={flags:32768,components:[{type:17,accent_color:0x5865f2,components:[
  {type:10,content:"## 🔒 Private Coaching Portal\nYour private coaching dashboard. Request coaching, review your request history, and follow status updates here. Your information is visible only to you and authorized staff.\n\n### Recent Requests\n"+history.slice(0,2600)},
  {type:1,components:[{type:2,style:3,label:"Request Coaching",custom_id:"coach:request"},{type:2,style:2,label:"My Requests",custom_id:"coach:mine"},{type:2,style:5,label:"Coaching Information",url:"https://discord.com/channels/"+G+"/"+REQUEST}]},
  {type:10,content:"-# "+marker}
 ]}],allowed_mentions:quiet};
 const messages=await api("GET","/channels/"+dm.id+"/messages?limit=100");
 const found=(Array.isArray(messages)?messages:[]).find(m=>m.author?.id===APP&&(m.components||[]).some(c=>(c.components||[]).some(x=>x.type===10&&String(x.content||"").includes(marker))));
 if(found)await api("PATCH","/channels/"+dm.id+"/messages/"+found.id,body);
 else await api("POST","/channels/"+dm.id+"/messages",body);
 return true;
}
async function myRequests(i){
 const uid=i.member?.user?.id||i.user?.id;
 await callback(i,6);
 await upsertPortal(uid);
}

function staff(i){
 const uid=i.member?.user?.id||i.user?.id,roles=i.member?.roles||[],perms=BigInt(i.member?.permissions||"0");
 return uid===ownerId||roles.includes(MOD)||roles.includes(ADMIN)||(perms&8n)!==0n;
}
function staffDashboardButtons(){
 return [
  {type:1,components:[{type:2,style:1,label:"Pending",custom_id:"coach:queue:pending"},{type:2,style:2,label:"Approved",custom_id:"coach:queue:approved"},{type:2,style:2,label:"Scheduled",custom_id:"coach:queue:scheduled"},{type:2,style:2,label:"Active",custom_id:"coach:queue:active"},{type:2,style:2,label:"Completed",custom_id:"coach:queue:completed"}]},
  {type:1,components:[{type:2,style:2,label:"Declined",custom_id:"coach:queue:declined"},{type:2,style:2,label:"Withdrawn",custom_id:"coach:queue:withdrawn"},{type:2,style:2,label:"Cancelled",custom_id:"coach:queue:cancelled"},{type:2,style:2,label:"All Requests",custom_id:"coach:queue:all"},{type:2,style:2,label:"Reports",custom_id:"coach:reports"}]},
  {type:1,components:[{type:2,style:2,label:"Activity History",custom_id:"coach:history"},{type:2,style:2,label:"Workflow Settings",custom_id:"coach:settings"},{type:2,style:2,label:"Refresh",custom_id:"coach:queue:refresh"}]},
  {type:1,components:[{type:5,custom_id:"coach:lookup",placeholder:"Member Lookup",min_values:1,max_values:1}]}
 ];
}
async function queueView(i,status){
 if(!staff(i)||i.channel_id!==MANAGEMENT||i.guild_id!==G||i.message?.author?.id!==APP)return callback(i,4,{content:"Staff access is required."});
 await callback(i,6);
 const rows=await allRequests(),filtered=status==="all"?rows:rows.filter(r=>{
  if(status==="closed")return closedStatuses.has(r.meta.status);
  if(status==="pending")return ["Pending Review","Awaiting Member Response"].includes(r.meta.status);
  return r.meta.status.toLowerCase().startsWith(status);
 });
 const counts={};for(const r of rows)counts[r.meta.status]=(counts[r.meta.status]||0)+1;
 const lines=filtered.slice(0,10).map(r=>"["+r.meta.status+"] "+clean(r.values["TikTok Username"]||r.meta.memberId,50)+" · "+clean(r.values["Coaching Topic"]||"",80)+" · https://discord.com/channels/"+G+"/"+MANAGEMENT+"/"+r.meta.id);
 const desc="**Total requests:** "+rows.length+"\n"+Object.entries(counts).map(([k,v])=>k+": "+v).join(" · ")+"\n\n"+(lines.join("\n")||"No matching requests.");
 await api("PATCH","/channels/"+MANAGEMENT+"/messages/"+i.message.id,{embeds:[{title:"1-on-1 Coaching Management - "+status.toUpperCase(),description:desc.slice(0,4000),color:0x5865f2,footer:{text:"coach:dashboard:staff:v1"}}],components:staffDashboardButtons(),allowed_mentions:quiet});
}
function adminOrOwner(i){
 const uid=i.member?.user?.id||i.user?.id,roles=i.member?.roles||[],perms=BigInt(i.member?.permissions||"0");
 return uid===ownerId||roles.includes(ADMIN)||(perms&8n)!==0n;
}
async function updateStaffDashboard(i,embed,alreadyAck){
 if(!staff(i)||i.guild_id!==G||i.channel_id!==MANAGEMENT||i.message?.author?.id!==APP)throw Error("Staff dashboard access denied");
 if(!alreadyAck)await callback(i,6);
 await api("PATCH","/channels/"+MANAGEMENT+"/messages/"+i.message.id,{embeds:[embed],components:staffDashboardButtons(),allowed_mentions:quiet});
}
async function reportsView(i){
 if(!staff(i)||i.guild_id!==G||i.channel_id!==MANAGEMENT||i.message?.author?.id!==APP)throw Error("Staff access is required");
 await callback(i,6);
 const rows=await allRequests(),counts={};for(const r of rows)counts[r.meta.status]=(counts[r.meta.status]||0)+1;
 const order=["Pending Review","Awaiting Member Response","Approved - Scheduling","Scheduled","Active Coaching","Completed","Declined","Withdrawn","Cancelled"];
 const lines=order.map(k=>"**"+k+":** "+(counts[k]||0));
 const done=counts.Completed||0,closed=(counts.Completed||0)+(counts.Declined||0)+(counts.Withdrawn||0)+(counts.Cancelled||0);
 lines.push("**Total requests:** "+rows.length,"**Closed requests:** "+closed,"**Completion share of all requests:** "+(rows.length?Math.round(done/rows.length*100):0)+"%");
 await updateStaffDashboard(i,{title:"Coaching Reports",description:lines.join("\\n"),color:0x5865f2,footer:{text:"coach:dashboard:staff:v1"}},true);
}
async function historyView(i){
 if(!staff(i)||i.guild_id!==G||i.channel_id!==MANAGEMENT||i.message?.author?.id!==APP)throw Error("Staff access is required");
 await callback(i,6);
 const rows=await api("GET","/channels/"+MANAGEMENT+"/messages?limit=100");
 const logs=rows.filter(m=>m.author?.id===APP&&typeof m.content==="string"&&/(STATUS CHANGE|PRIVATE STAFF NOTE|CLARIFICATION REQUEST|MEMBER RESPONSE|SESSION NOTES|MEMBER ADDITIONAL DETAILS|COACH ASSIGNED|REQUEST REOPENED)/.test(m.content)).slice(0,12);
 const desc=logs.length?logs.map(m=>new Date(m.timestamp).toLocaleString("en-US")+"\\n"+clean(m.content,250)+"\\nhttps://discord.com/channels/"+G+"/"+MANAGEMENT+"/"+m.id).join("\\n\\n"):"No activity has been recorded yet.";
 await updateStaffDashboard(i,{title:"Coaching Activity History",description:desc.slice(0,4000),color:0x5865f2,footer:{text:"coach:dashboard:staff:v1"}},true);
}
async function settingsView(i){
 if(!adminOrOwner(i)||i.guild_id!==G||i.channel_id!==MANAGEMENT)throw Error("Only the server Owner or Administrators can view workflow settings");
 const desc="**Read-only workflow configuration**\\nRequest channel: <#"+REQUEST+">\\nManagement channel: <#"+MANAGEMENT+">\\nCoaching voice channel: <#"+VOICE+">\\nModerator role: <@&"+MOD+">\\nAdministrator role: <@&"+ADMIN+">\\n\\nMembers see only their own DM receipts. Staff records and notes remain in the private management channel. Voice CONNECT is granted to the scheduled member and removed when a session is completed, cancelled, declined, or withdrawn.\\n\\nThis panel is informational; it does not modify role permissions or system configuration.";
 await updateStaffDashboard(i,{title:"Coaching Workflow Settings",description:desc,color:0x5865f2,footer:{text:"coach:dashboard:staff:v1"}});
}
async function lookupView(i){
 if(!staff(i)||i.guild_id!==G||i.channel_id!==MANAGEMENT||i.message?.author?.id!==APP)throw Error("Staff access is required");
 const uid=i.data?.values?.[0];if(!uid)throw Error("Select a server member");
 await callback(i,6);
 const rows=await allRequests(uid),desc=rows.length?rows.slice(0,12).map(r=>"**"+r.meta.status+"** · "+clean(r.values["Coaching Topic"]||"Coaching request",100)+" · "+r.meta.id+"\\nhttps://discord.com/channels/"+G+"/"+MANAGEMENT+"/"+r.meta.id).join("\\n\\n"):"No coaching requests were found for <@"+uid+">.";
 await api("PATCH","/channels/"+MANAGEMENT+"/messages/"+i.message.id,{embeds:[{title:"Coaching Member Lookup",description:desc.slice(0,4000),color:0x5865f2,footer:{text:"coach:dashboard:staff:v1"}}],components:staffDashboardButtons(),allowed_mentions:quiet});
}
async function assignCoach(i,id){
 if(!staff(i)||i.guild_id!==G||i.channel_id!==MANAGEMENT)throw Error("Staff access is required");
 const selected=i.data?.values?.[0];if(!selected)throw Error("Select a coach");
 await callback(i,6);
 const member=await api("GET","/guilds/"+G+"/members/"+selected),roles=member.roles||[];
 if(member.user?.bot||!(selected===ownerId||roles.includes(MOD)||roles.includes(ADMIN)))throw Error("Only a server Owner, Administrator, or Moderator can be assigned");
 const rec=await getRecord(id),actor=i.member?.user?.id||i.user?.id;
 rec.meta.assignedTo=selected;rec.meta.updatedAt=new Date().toISOString();rec.meta.lastActor=actor;
 await updateRecord(rec);try{await updateDM(rec)}catch(e){console.log("COACHING_DM_UPDATE_FAILED",String(e.message||e).slice(0,120))}
 await postPrivateLog(id,"COACH ASSIGNED",actor,"Assigned coach: <@"+selected+">");
 try{await sendDM(selected,{embeds:[{title:"Coaching Request Assigned",description:"You have been assigned to request "+id+" for <@"+rec.meta.memberId+">. Open the staff-only request record in the Coaching Management channel.",color:0x5865f2}],allowed_mentions:quiet})}catch(e){console.log("COACHING_ASSIGN_DM_FAILED",String(e.message||e).slice(0,120))}
}
async function ensureDashboard(channelId,kind){
 const rows=await api("GET","/channels/"+channelId+"/messages?limit=100"),marker="coach:dashboard:"+kind+":v1";
 const found=rows.find(m=>m.author?.id===APP&&m.embeds?.[0]?.footer?.text===marker);
 const body=kind==="member"?{
  embeds:[{title:"1-on-1 Coaching Request",description:"Request personalized coaching from the creator team.\n\n**How it works**\n1. Submit your request below.\n2. Staff review your TikTok profile, goals, and availability.\n3. Staff may ask for clarification, then approve or decline.\n4. If approved, staff coordinate your appointment and grant access to the private coaching voice room.\n5. Attend your session; staff record completion.\n\n**Application:** Complete five short native Discord forms for your TikTok profile, coaching areas and goals, support needs, coaching expectations and consent, and preferred plus alternative appointment availability. Your Discord identity is captured automatically. Request details are private to staff; your personal status dashboard is delivered by DM.\n\n**Privacy:** Members cannot view other members' requests. Do not post personal details in this channel.",color:0x5865f2,footer:{text:marker}}],components:[{type:1,components:[{type:2,style:3,label:"Request Coaching",custom_id:"coach:request"},{type:2,style:2,label:"My Requests",custom_id:"coach:mine"}]}],allowed_mentions:quiet
 }:{
  embeds:[{title:"1-on-1 Coaching Management",description:"Staff-only request management dashboard.\n\nReview requests, communicate with members, approve or decline, schedule/reschedule sessions, grant or revoke voice access, record private staff notes, and close completed cases. Each request is stored as a separate staff-only record below. Owner and Administrators retain full authority; Moderators handle routine operations.",color:0x5865f2,footer:{text:marker}}],components:staffDashboardButtons(),allowed_mentions:quiet
 };
 if(found)await api("PATCH","/channels/"+channelId+"/messages/"+found.id,body);else await api("POST","/channels/"+channelId+"/messages",body);
}
function requestFormFields(step){
 const text=(id,label,style,required,max,placeholder)=>({id,label,kind:"text",style,required,max,placeholder});
 const select=(id,label,options,multi=false,required=true)=>({id,label,kind:"select",options,multi,required});
 if(step==="identity")return [
  text("tiktok","TikTok username (optional)",1,false,24,"Without the @ sign"),
  text("profile","TikTok profile URL (optional)",1,false,220,"https://www.tiktok.com/@username")
 ];
 if(step==="goals")return [
  select("topics","Coaching areas",[
   ["LIVE strategy and growth","live_growth"],["Audience growth","audience_growth"],["Content strategy","content_strategy"],
   ["LIVE battles","live_battles"],["Community building and moderation","community"],["Branding","branding"],
   ["Monetization and business","monetization"],["Leadership and team development","leadership"],["Other","other"]
  ],true,true),
  text("situation","Current situation and experience",2,true,900,"Describe where you are now"),
  text("short_goals","Short-term goals",2,true,700,"What do you want to accomplish first?"),
  text("long_goals","Long-term goals",2,true,700,"What do you want to build toward?"),
  text("priorities","Top priorities",2,true,500,"What matters most right now?")
 ];
 if(step==="support")return [
  text("success","How will you measure success?",2,true,700,"What outcomes or indicators will show progress?"),
  text("challenges","Challenges or obstacles",2,false,700,"What is getting in the way?"),
  text("support","Support you need",2,true,700,"What would make coaching useful?"),
  select("coach","Coach preference",[
   ["No preference","none"],["Strategy and accountability","strategy"],["Hands-on practical guidance","hands_on"],["Encouraging and supportive","supportive"],["Direct feedback and challenge","direct"]
  ],false,false),
  text("materials","Analytics or supporting links",2,false,500,"TikTok, video, screenshots, or analytics links")
 ];
 if(step==="commitment")return [
  text("commitment","Time and effort you can commit",2,true,700,"What can you realistically put into the plan?"),
  text("expectations","What do you expect from your coach?",2,true,700,"Describe the support and communication you expect"),
  select("consent","Privacy and coaching consent",[
   ["I understand and agree to the coaching request being reviewed privately by authorized coaching staff","agree"],
   ["I do not agree","decline"]
  ],false,true)
 ];
 return [
  text("timezone","Your time zone (IANA name)",1,true,60,"America/New_York"),
  text("preferred","Preferred appointment date and time",1,true,100,"YYYY-MM-DD at HH:MM (24-hour time)"),
  text("alternate","Alternative appointment date and time",1,true,100,"A separate backup date/time, same format"),
  text("windows","Other available days and time windows",2,false,300,"Additional days/times you can attend"),
  select("length","Preferred session length",[
   ["30 minutes","30"],["45 minutes","45"],["60 minutes","60"],["No preference","flexible"]
  ],false,true)
 ];
}
function openRequestForm(i){
 const uid=i.member?.user?.id||i.user?.id;
 const session=crypto.randomUUID().replace(/-/g,"").slice(0,24);
 formSessions.set(session,{uid,channelId:i.channel_id,guildId:i.guild_id,createdAt:Date.now(),data:{}});
 return modal(i,"coach:form:identity:"+session,"Coaching Request - Profile",requestFormFields("identity"));
}
async function continueRequestForm(i,id){
 const m=id.match(/^coach:form:(identity|goals|support|commitment|availability):([a-f0-9]{24})$/);
 if(!m)throw Error("Invalid coaching form session");
 const step=m[1],session=m[2],uid=i.member?.user?.id||i.user?.id,s=formSessions.get(session);
 if(!s||s.uid!==uid||Date.now()-s.createdAt>30*60*1000){formSessions.delete(session);throw Error("This form session expired. Start a new coaching request.");}
 Object.assign(s.data,modalFields(i));
 s.createdAt=Date.now();
 if(step==="identity")return modal(i,"coach:form:goals:"+session,"Coaching Request - Goals",requestFormFields("goals"));
 if(step==="goals")return modal(i,"coach:form:support:"+session,"Coaching Request - Support",requestFormFields("support"));
 if(step==="support")return modal(i,"coach:form:commitment:"+session,"Coaching Request - Expectations",requestFormFields("commitment"));
 if(step==="commitment")return modal(i,"coach:form:availability:"+session,"Coaching Request - Availability",requestFormFields("availability"));
 formSessions.delete(session);
 const f=s.data;
 const extra=[f.short_goals?"Short-term goals: "+f.short_goals:"",f.long_goals?"Long-term goals: "+f.long_goals:"",f.priorities?"Priorities: "+f.priorities:"",f.success?"Success criteria: "+f.success:"",f.challenges?"Challenges: "+f.challenges:"",f.commitment?"Commitment: "+f.commitment:"",f.expectations?"Coach expectations: "+f.expectations:""].filter(Boolean).join("\n");
 f.additionalDetails=extra;
 await callback(i,5,{});
 await makeRequest(i,f);
}

async function bootstrap(){
 try{
  const botAuthSecret=Bun.env.COACHING_BOT005_AUTH_SECRET||"",relayAuthSecret=Bun.env.COACHING_RELAY_AUTH_SECRET||"";
  if(botAuthSecret.length<32||botAuthSecret.length>512||relayAuthSecret.length<32||relayAuthSecret.length>512||botAuthSecret===relayAuthSecret)throw Error("Distinct Bot 005 and Relay authentication secrets are required");
  const idempotencyToken=Bun.env.COACHING_IDEMPOTENCY_TOKEN||"";
  let idempotencyUrl;
  try{idempotencyUrl=new URL(Bun.env.COACHING_IDEMPOTENCY_URL||"")}catch{throw Error("Durable coaching idempotency endpoint is invalid")}
  const idempotencyHost=idempotencyUrl.hostname.toLowerCase().replace(/\.$/,"");
  if(idempotencyToken.length<32||idempotencyToken.length>512||
     idempotencyUrl.protocol!=="https:"||idempotencyUrl.pathname!=="/coaching/interaction/claim"||
     idempotencyUrl.username||idempotencyUrl.password||idempotencyUrl.search||idempotencyUrl.hash||
     idempotencyHost==="localhost"||idempotencyHost.endsWith(".localhost")||
     idempotencyHost.endsWith(".local")||idempotencyHost.endsWith(".internal")||
     idempotencyHost.endsWith(".lan")||idempotencyHost.endsWith(".home")||
     idempotencyHost.endsWith(".test")||idempotencyHost.endsWith(".invalid")||
     !idempotencyHost.includes(".")||idempotencyHost.includes("railway")||idempotencyHost.endsWith(".rlwy.net")||
     /^\d{1,3}(\.\d{1,3}){3}$/.test(idempotencyHost)||idempotencyHost.startsWith("[")) {
   throw Error("Public HTTPS durable coaching idempotency endpoint and token are required");
  }
  coachingIdempotencyEndpoint=idempotencyUrl.href;
  if(Bun.env.AUTHORIZED_GUILD_ID!==G||Bun.env.APPLICATION_ID!==APP||!token()||Bun.env.WRITES_ENABLED!=="true")throw Error("Guild, application, token, or write authorization mismatch");
  const [self,guild,request,management,voice]=await Promise.all([api("GET","/users/@me"),api("GET","/guilds/"+G),api("GET","/channels/"+REQUEST),api("GET","/channels/"+MANAGEMENT),api("GET","/channels/"+VOICE)]);
  if(self.id!==APP||guild.id!==G||request.guild_id!==G||management.guild_id!==G||voice.guild_id!==G||request.type!==0||management.type!==0||voice.type!==2)throw Error("Coaching channel identity/type verification failed");
  ownerId=guild.owner_id;
  const everyone=management.permission_overwrites?.find(o=>o.id===G&&Number(o.type)===0);
  if(!everyone||(BigInt(everyone.deny||"0")&1024n)===0n)throw Error("Management channel is not private");
  const reqEveryone=request.permission_overwrites?.find(o=>o.id===G&&Number(o.type)===0);
  if(!reqEveryone||(BigInt(reqEveryone.allow||"0")&1024n)===0n||(BigInt(reqEveryone.deny||"0")&2048n)===0n)throw Error("Public request channel is not configured read-only");
  const voiceEveryone=voice.permission_overwrites?.find(o=>o.id===G&&Number(o.type)===0);
  if(!voiceEveryone||(BigInt(voiceEveryone.deny||"0")&1048576n)===0n)throw Error("Coaching voice channel is not locked by default");
  

 await ensureDashboard(REQUEST,"member");await ensureDashboard(MANAGEMENT,"staff");
  ready=true;console.log("COACHING_WORKFLOW_READY",JSON.stringify({guild:G,request:REQUEST,management:MANAGEMENT,voice:VOICE}));
 }catch(e){ready=false;lastError=String(e.message||e);console.log("COACHING_WORKFLOW_BOOTSTRAP_FAILED",lastError)}
}
function localAppointmentToUtc(when,tz){
 const m=String(when).match(/^(\d{4})-(\d{2})-(\d{2})\s+at\s+(\d{2}):(\d{2})$/i);
 if(!m)throw Error("Use the appointment format YYYY-MM-DD at HH:MM");
 const [y,mo,d,h,mi]=m.slice(1).map(Number),base=Date.UTC(y,mo-1,d,h,mi),check=new Date(base);
 if(check.getUTCFullYear()!==y||check.getUTCMonth()+1!==mo||check.getUTCDate()!==d||h>23||mi>59)throw Error("Enter a valid calendar date and 24-hour time");
 let fmt;try{fmt=new Intl.DateTimeFormat("en-US",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"})}catch{throw Error("Enter a valid IANA time zone, such as America/New_York")}
 const parts=Object.fromEntries(fmt.formatToParts(new Date(base)).map(p=>[p.type,p.value]));
 const localAsUtc=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute));
 const candidate=new Date(base-(localAsUtc-base)),v=Object.fromEntries(fmt.formatToParts(candidate).map(p=>[p.type,p.value]));
 if(Number(v.year)!==y||Number(v.month)!==mo||Number(v.day)!==d||Number(v.hour)!==h||Number(v.minute)!==mi)throw Error("That local time does not exist in this time zone because of a daylight-saving change. Choose another time.");
 if(candidate.getTime()<Date.now()+5*60*1000)throw Error("Choose an appointment at least five minutes in the future");
 return candidate.toISOString();
}
async function processStaffAction(i,action,id){
 if(!staff(i)||i.guild_id!==G||i.channel_id!==MANAGEMENT)throw Error("Staff authorization failed");
 if(action==="clarify")return modal(i,"coach:staffclarify:"+id,"Request More Information",[["question","What information is needed?",2,true,900,"Please clarify..."]]);
 if(action==="schedule")return modal(i,"coach:staffschedule:"+id,"Schedule Coaching Session",[["when","Appointment date and local time",1,true,120,"YYYY-MM-DD at HH:MM"],["timezone","Time zone",1,true,60,"America/New_York"],["notes","Session notes (optional)",2,false,500,"Agenda or preparation"]]);
 if(action==="note")return modal(i,"coach:staffnote:"+id,"Add Private Staff Note",[["note","Private staff note",2,true,900,"Staff-only note"]]);
 const rec=await getRecord(id),actor=i.member?.user?.id||i.user?.id;
 if(action==="approve"){if(!["Pending Review","Awaiting Member Response"].includes(rec.meta.status))throw Error("Only pending requests can be approved");return saveStatus(rec,"Approved - Scheduling",actor)}
 if(action==="decline"){if(closedStatuses.has(rec.meta.status))throw Error("This request is already closed");return saveStatus(rec,"Declined",actor)}
 if(action==="activate"){if(rec.meta.status!=="Scheduled")throw Error("Schedule the session before activating it");return saveStatus(rec,"Active Coaching",actor)}
 if(action==="complete")return saveStatus(rec,"Completed",actor);
 if(action==="cancel")return saveStatus(rec,"Cancelled",actor);
 if(action==="reopen"){
  if(!adminOrOwner(i))throw Error("Only the server Owner or Administrators can reopen closed requests");
  if(!closedStatuses.has(rec.meta.status))throw Error("Only closed requests can be reopened");
  await setVoice(rec,false);const old=rec.meta.status;rec.meta.status="Pending Review";rec.meta.appointment=null;delete rec.meta.appointmentAt;delete rec.meta.remindersSent;delete rec.meta.timezone;rec.meta.updatedAt=new Date().toISOString();rec.meta.lastActor=actor;
  await updateRecord(rec);try{await updateDM(rec)}catch(e){console.log("COACHING_DM_UPDATE_FAILED",String(e.message||e).slice(0,120))}
  await postPrivateLog(id,"REQUEST REOPENED",actor,old+" -> Pending Review");return;
 }
 throw Error("Unknown staff action");
}
async function handleModal(i,id){
 const f=modalFields(i),uid=i.member?.user?.id||i.user?.id;
 if(id.startsWith("coach:form:")){await continueRequestForm(i,id);return}
 if(id==="coach:submit"){await callback(i,5,{});await makeRequest(i,f);return}
 const match=id.match(/^coach:(staffschedule|staffclarify|staffnote|dmrespond|dmdetails):(\d{17,22})$/);if(!match)return;
 const kind=match[1],rid=match[2];
 await callback(i,5,{});
 const rec=await getRecord(rid);
 if(kind.startsWith("staff")&&!staff(i))throw Error("Staff authorization failed");
 if(kind.startsWith("dm")&&rec.meta.memberId!==uid)throw Error("This request belongs to another member");
 if(kind==="staffschedule"){
  if(rec.meta.status!=="Approved - Scheduling"&&rec.meta.status!=="Scheduled")throw Error("Approve the request before scheduling");
  const when=clean(f.when,120),tz=clean(f.timezone,60),notes=clean(f.notes,500);
  const appointmentAt=localAppointmentToUtc(when,tz);
  await setVoice(rec,true);rec.meta.status="Scheduled";rec.meta.appointment=when+" ("+tz+")";rec.meta.timezone=tz;rec.meta.appointmentAt=appointmentAt;rec.meta.remindersSent={};rec.meta.updatedAt=new Date().toISOString();rec.meta.lastActor=uid;
  if(notes)await postPrivateLog(rid,"SESSION NOTES",uid,notes);
  await updateRecord(rec);try{await updateDM(rec)}catch(e){console.log("COACHING_DM_UPDATE_FAILED",String(e.message||e).slice(0,140))}
  try{await postPrivateLog(rid,"STATUS CHANGE",uid,"Scheduled: "+rec.meta.appointment)}catch(e){console.log("COACHING_AUDIT_LOG_FAILED",String(e.message||e).slice(0,120))}
  await editOriginal(i,"Session scheduled. The member has been granted access to the private coaching voice room.");
 }else if(kind==="staffclarify"){
  const q=clean(f.question,900);if(q.length<5)throw Error("Enter the information requested");
  rec.meta.status="Awaiting Member Response";rec.meta.lastStaffMessage=q;rec.meta.updatedAt=new Date().toISOString();
  await postPrivateLog(rid,"CLARIFICATION REQUEST",uid,q);await updateRecord(rec);await updateDM(rec);await editOriginal(i,"Clarification request sent to the member.");
 }else if(kind==="staffnote"){
  const note=clean(f.note,900);if(note.length<3)throw Error("Enter a staff note");
  await postPrivateLog(rid,"PRIVATE STAFF NOTE",uid,note);await editOriginal(i,"Private staff note recorded.");
 }else if(kind==="dmrespond"){
  const response=clean(f.response,1000);if(response.length<3)throw Error("Enter a response");
  await postPrivateLog(rid,"MEMBER RESPONSE",uid,response);rec.meta.status="Pending Review";rec.meta.lastStaffMessage="The member sent a response.";rec.meta.updatedAt=new Date().toISOString();await updateRecord(rec);await updateDM(rec);await editOriginal(i,"Your response was sent privately to staff.");
 }else if(kind==="dmdetails"){
  const alt=clean(f.alternate,500),details=clean(f.details,700);
  if(alt)rec.values["Alternate Availability"]=alt;if(details)rec.values["Additional Details"]=details;
  await postPrivateLog(rid,"MEMBER ADDITIONAL DETAILS",uid,[alt,details].filter(Boolean).join("\n"));
  await updateRecord(rec);await updateDM(rec);await editOriginal(i,"Your additional details were sent privately to staff.");
 }
}
async function handle(i){
 const id=String(i.data?.custom_id||"");if(!id.startsWith("coach:"))return;
 const uid=i.user?.id||i.member?.user?.id;
 if(!uid){try{await callback(i,4,{content:"Member identity could not be verified."})}catch{};return}
 const actionKey=uid+":"+id;
 if(pendingActions.has(actionKey)){
  try{await callback(i,4,{content:"This action is already processing. Please wait."})}catch{}
  return;
 }
 pendingActions.add(actionKey);
 try{
  if(i.application_id!==APP)throw Error("Application identity mismatch");
  if(i.type===5){await handleModal(i,id);return}
  if(i.guild_id&&i.guild_id!==G)throw Error("Guild scope mismatch");
  if(id==="coach:request"){
   if(i.guild_id){if(i.channel_id!==REQUEST)throw Error("Use the public coaching request dashboard");await callback(i,6);return upsertPortal(uid)}
   return openRequestForm(i);
  }
  if(id==="coach:mine"){
   if(i.guild_id&&i.channel_id!==REQUEST)throw Error("Use the public coaching request dashboard");
   return myRequests(i);
  }
  if(id.startsWith("coach:queue:")){const q=id.split(":")[2]||"all";return queueView(i,q==="refresh"?"all":q)}
  if(id==="coach:reports")return reportsView(i);
  if(id==="coach:history")return historyView(i);
  if(id==="coach:settings")return settingsView(i);
  if(id==="coach:lookup")return lookupView(i);
  const assign=id.match(/^coach:staff:assign:(\d{17,22})$/);if(assign)return assignCoach(i,assign[1]);
  const sm=id.match(/^coach:staff:(approve|decline|clarify|schedule|activate|complete|cancel|note|reopen):(\d{17,22})$/);
  if(sm){
   if(!staff(i)||i.channel_id!==MANAGEMENT||i.guild_id!==G)throw Error("Staff access is required");
   const action=sm[1],rid=sm[2];if(["clarify","schedule","note"].includes(action))return processStaffAction(i,action,rid);
   await callback(i,6);await processStaffAction(i,action,rid);return;
  }
  const dm=id.match(/^coach:dm:(status|respond|details|withdraw):(\d{17,22})$/);
  if(dm){
   const action=dm[1],rid=dm[2];
   if(i.guild_id)throw Error("This private request does not belong to you");
   if(action==="respond")return modal(i,"coach:dmrespond:"+rid,"Respond to Coaching Staff",[["response","Your response",2,true,1000,"Write your response"]]);
   if(action==="details")return modal(i,"coach:dmdetails:"+rid,"Add Coaching Details",[["alternate","Alternate availability (optional)",2,false,500,"Other dates/times"],["details","Additional details (optional)",2,false,700,"Anything staff should know"]]);
   await callback(i,6);
   const rec=await getRecord(rid);
   if(rec.meta.memberId!==uid)throw Error("This private request does not belong to you");
   if(action==="withdraw")return saveStatus(rec,"Withdrawn",uid);
   try{await updateDM(rec)}catch(e){console.log("COACHING_DM_REFRESH_FAILED",String(e.message||e))}
   return;
  }
  throw Error("Unknown coaching control");
 }catch(e){
  console.log("COACHING_INTERACTION_FAILED",String(e.message||e).slice(0,240));
  try{
   if(i.__acknowledged)await followup(i,"I couldn't complete that action. Please try again or contact staff.");
   else await callback(i,4,{content:"I couldn't complete that action. Please try again or contact staff."});
  }catch(fallbackError){console.log("COACHING_INTERACTION_FALLBACK_FAILED",String(fallbackError?.name||"unknown"))}
 }finally{
  pendingActions.delete(actionKey);
 }
}
Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||3000),async fetch(req){
 const url=new URL(req.url);
 if(req.method==="GET"&&url.pathname==="/healthz")return Response.json({status:"ok",service:"Coaching Workflow",ready,errorPresent:Boolean(lastError)});
 if(req.method==="GET"&&url.pathname==="/readyz")return Response.json({ready,errorPresent:Boolean(lastError)},{status:ready?200:503});
 if(req.method==="POST"&&url.pathname==="/interaction"){
  const contentLength=Number(req.headers.get("content-length")||0);
  if(Number.isFinite(contentLength)&&contentLength>262144)return Response.json({error:"payload-too-large"},{status:413});
  if(!(req.headers.get("content-type")||"").toLowerCase().includes("application/json"))
   return Response.json({error:"unsupported-media-type"},{status:415});
  let rawBody;try{rawBody=await req.text()}catch{return Response.json({error:"invalid-body"},{status:400})}
  if(new TextEncoder().encode(rawBody).byteLength>262144)return Response.json({error:"payload-too-large"},{status:413});
  const auth=await verifyCoachingRequest({
   source:req.headers.get("x-coaching-source"),
   timestamp:req.headers.get("x-coaching-timestamp"),
   signature:req.headers.get("x-coaching-signature"),
   body:rawBody,
   secrets:{
    bot005:Bun.env.COACHING_BOT005_AUTH_SECRET||"",
    "coaching-relay":Bun.env.COACHING_RELAY_AUTH_SECRET||""
   }
  });
  if(!auth.ok)return Response.json({error:"unauthorized"},{status:401});
  let i;try{i=JSON.parse(rawBody)}catch{return Response.json({error:"invalid-json"},{status:400})}
  if(!i||typeof i!=="object"||Array.isArray(i)||typeof i.id!=="string"||
     !/^\d{17,22}$/.test(i.id)||!String(i?.data?.custom_id||"").startsWith("coach:"))return Response.json({ignored:true});
  if(!ready||!coachingIdempotencyEndpoint)return Response.json({error:"not-ready"},{status:503});
  const now=Date.now();for(const [key,ts] of seenInteractions)if(now-ts>900000)seenInteractions.delete(key);
  if(seenInteractions.has(i.id))return Response.json({duplicate:true});
  let claimResponse,claimPayload;
  try{
   claimResponse=await fetch(coachingIdempotencyEndpoint,{
    method:"POST",
    headers:{authorization:"Bearer "+(Bun.env.COACHING_IDEMPOTENCY_TOKEN||""),"content-type":"application/json",accept:"application/json"},
    body:JSON.stringify({interactionId:i.id,source:auth.source}),
    signal:AbortSignal.timeout(5000)
   });
   claimPayload=await claimResponse.json();
  }catch{return Response.json({error:"idempotency-unavailable"},{status:503})}
  if(!claimResponse.ok||claimPayload?.ok!==true||typeof claimPayload.claimed!=="boolean")
   return Response.json({error:"idempotency-unavailable"},{status:503});
  if(!claimPayload.claimed)return Response.json({duplicate:true});
  seenInteractions.set(i.id,now);void handle(i);return Response.json({accepted:true});
 }
 return Response.json({error:"not-found"},{status:404});
}});
void bootstrap();
