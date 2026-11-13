const G="1565048205970767992",APP="1565304619838742598",MANAGEMENT="1569552611995287745",VOICE="1569552605003124883",API="https://discord.com/api/v10";
const token=()=>Bun.env.DISCORD_BOT_TOKEN||"",quiet={parse:[],users:[],roles:[],replied_user:false};
async function api(method,path,body){
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch(API+path,{method,headers:{authorization:"Bot "+token(),"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(9000)});
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null}catch{data={message:raw.slice(0,180)}}
  if(r.status===429&&attempt<2){await Bun.sleep(Math.min(2500,Math.max(300,Number(r.headers.get("retry-after")||1)*1000)));continue}
  if(!r.ok)throw Error("Discord "+method+" "+path+" "+r.status+" "+String(data?.message||raw).slice(0,160));
  return data;
 }
 throw Error("Discord rate-limit retry limit");
}
async function dm(uid,title,description){
 const ch=await api("POST","/users/@me/channels",{recipient_id:uid});
 return api("POST","/channels/"+ch.id+"/messages",{embeds:[{title,description:description.slice(0,3500),color:0x5865f2}],allowed_mentions:quiet});
}
function parseMeta(m){
 const s=m?.embeds?.[0]?.footer?.text||"";
 if(!s.startsWith("coach:record:v1:"))return null;
 try{return JSON.parse(s.slice("coach:record:v1:".length))}catch{return null}
}
async function persist(m,meta){
 const embeds=(m.embeds||[]).map((e,i)=>i===0?{...e,footer:{...(e.footer||{}),text:"coach:record:v1:"+JSON.stringify(meta)}}:e);
 await api("PATCH","/channels/"+MANAGEMENT+"/messages/"+m.id,{embeds,components:m.components||[],allowed_mentions:quiet});
}
async function scan(){
 if(Bun.env.AUTHORIZED_GUILD_ID!==G||Bun.env.APPLICATION_ID!==APP||!token()||Bun.env.WRITES_ENABLED!=="true")throw Error("Reminder worker authorization/configuration mismatch");
 let before=null,scanned=0,sent=0;
 for(let page=0;page<10;page++){
  const rows=await api("GET","/channels/"+MANAGEMENT+"/messages?limit=100"+(before?"&before="+before:""));
  if(!Array.isArray(rows)||!rows.length)break;
  for(const m of rows){
   const meta=parseMeta(m);if(!meta||m.author?.id!==APP||meta.status!=="Scheduled"||!meta.appointmentAt)continue;
   const at=Date.parse(meta.appointmentAt);if(!Number.isFinite(at)||at<=Date.now())continue;
   scanned++;meta.remindersSent=meta.remindersSent||{};
   const delta=at-Date.now(),due24=delta<=30*60*60*1000&&delta>18*60*60*1000,due1=delta<=90*60*1000&&delta>0;
   const tasks=[];
   if(due24&&!meta.remindersSent.member24h)tasks.push(["member24h",meta.memberId,"Your coaching session is about 24 hours away.","member"]);
   if(due24&&meta.assignedTo&&meta.assignedTo!==meta.memberId&&!meta.remindersSent.coach24h)tasks.push(["coach24h",meta.assignedTo,"A coaching session you are assigned to is about 24 hours away.","coach"]);
   if(due1&&!meta.remindersSent.member1h)tasks.push(["member1h",meta.memberId,"Your coaching session is coming up soon.","member"]);
   if(due1&&meta.assignedTo&&meta.assignedTo!==meta.memberId&&!meta.remindersSent.coach1h)tasks.push(["coach1h",meta.assignedTo,"A coaching session you are assigned to is coming up soon.","coach"]);
   let changed=false;
   for(const [key,uid,lead,recipient] of tasks){
    const description=lead+"\n\n**Appointment:** "+String(meta.appointment||"See your request DM").slice(0,240)+"\n**Voice room:** <#"+VOICE+">\nJoin at the scheduled time. If you need to change the appointment, use the Respond to Staff control on your original coaching request DM.";
    try{await dm(uid,"1-on-1 Coaching Reminder",description);meta.remindersSent[key]=new Date().toISOString();changed=true;sent++;console.log("COACHING_REMINDER_SENT",JSON.stringify({request:m.id,kind:key,recipient}))}
    catch(e){console.log("COACHING_REMINDER_DM_FAILED",JSON.stringify({request:m.id,kind:key,error:String(e.message||e).slice(0,140)}))}
   }
   if(changed)await persist(m,meta);
  }
  before=rows[rows.length-1].id;if(rows.length<100)break;
 }
 console.log("COACHING_REMINDER_RUN_COMPLETE",JSON.stringify({guild:G,scanned,sent,at:new Date().toISOString()}));
}
await scan();
