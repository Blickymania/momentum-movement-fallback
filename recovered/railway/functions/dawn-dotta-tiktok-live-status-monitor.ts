import {TikTokLiveConnection} from "tiktok-live-connector@2.5.0";
// Independent Momentum Movement TikTok LIVE Status Monitor.
// Only the preexisting LIVE Stats voice channel can be renamed; owner-controlled category and order are unrestricted.
// No Discord message, LIVE announcement, permission, role, or channel creation.
const G="1565048205970767992",APP="1565304619838742598";
const STAT="1566030504635924600";
const TOKEN=Bun.env.DISCORD_BOT_TOKEN||"";
const DIAG=Bun.env.LIVE_MONITOR_DIAGNOSTIC==="true";
const WRITES=Bun.env.ENABLE_VERIFIED_LIVE_WRITES==="true"&&!DIAG;
const report={event:"momentum_verified_live_status",guild:G,readOnly:!WRITES,creatorValidated:false,
 verifiedStatus:"unverified",roomValidated:false,verifiedStart:false,
 proposedName:null,currentName:null,writes:0,reason:null,source:"tiktok-live-connector"};
if(Bun.env.APPLICATION_ID!==APP||Bun.env.AUTHORIZED_GUILD_ID!==G||!TOKEN)throw Error("Strict guild/app/token scope mismatch");
const raw=String(Bun.env.SOCIAL_TIKTOK_HANDLE||"").trim().replace(/^@/,"").toLowerCase();
let handle="";
try {
 const u=new URL(String(Bun.env.SOCIAL_TIKTOK_URL||""));
 const m=u.pathname.match(/^\/@([a-z0-9._]{2,30})\/?$/i);
 if(u.protocol!=="https:"||!["tiktok.com","www.tiktok.com"].includes(u.hostname)||u.username||u.password||u.port||!m)throw Error("invalid_official_url");
 if(!raw||raw!==m[1].toLowerCase())throw Error("creator_handle_url_mismatch");
 handle=raw;report.creatorValidated=true;
}catch(error){report.reason=error instanceof Error?error.message:"unknown_configuration"}
async function discord(method,path,body){
 for(let n=0;n<3;n++){
  const r=await fetch("https://discord.com/api/v10"+path,{method,
   headers:{Authorization:"Bot "+TOKEN,"Content-Type":"application/json"},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(14000)});
  const j=await r.json().catch(()=>({}));
  if(r.status===429){if(n===2)throw Error("discord_rate_limited");await Bun.sleep(Math.max(1250,Math.min(30000,Number(j.retry_after||2)*1000+400)));continue}
  if(!r.ok)throw Error("discord_"+method+"_"+r.status);
  return j;
 }
 throw Error("discord_retries_exhausted");
}
function formatElapsed(ms){
 const minutes=Math.floor((Date.now()-ms)/60000);
 if(minutes<0||minutes>10080)return "ON AIR";
 const h=Math.floor(minutes/60),m=minutes%60;
 return (h>0?h+"h ":"")+m+"m";
}
function observedStart(info){
 const owner=info?.owner?.uniqueId??info?.owner?.unique_id??info?.data?.owner?.uniqueId??info?.data?.owner?.unique_id??info?.data?.room?.owner?.unique_id??info?.room_info?.owner?.unique_id??null;
 if(owner && String(owner).replace(/^@/,"").toLowerCase()!==handle)throw Error("TikTok room owner mismatch");
 const values=[info?.create_time,info?.start_time,info?.createTime,info?.startTime,info?.data?.create_time,info?.data?.start_time,info?.room?.create_time,info?.data?.room?.create_time,info?.room_info?.create_time,info?.data?.room_info?.create_time];
 for(const v of values){
  if(v===null||v===undefined||v==="")continue;
  const n=Number(v);
  if(!Number.isSafeInteger(n))continue;
  const ms=n<10000000000?n*1000:n;
  if(ms>0&&ms<=Date.now()&&Date.now()-ms<=7*86400000)return ms;
 }
 return null;
}
async function verify(){
 if(!report.creatorValidated)throw Error("creator_source_not_verified");
 const tiktok=new TikTokLiveConnection(handle,{});
 const bounded=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("TikTok_verification_timeout")),ms)})]).finally(()=>clearTimeout(timer));};
 const live=await bounded(tiktok.fetchIsLive(handle),21000);
 if(typeof live!=="boolean")throw Error("TikTok_boolean_status_unavailable");
 if(live===false){
  await Bun.sleep(1500);
  const second=await bounded(tiktok.fetchIsLive(handle),21000);
  if(second!==false)throw Error("TikTok_offline_confirmation_not_consistent");
  report.verifiedStatus="offline";return "⚫ Dawn Dotta is NOT LIVE";
 }
 const room=await bounded(tiktok.fetchRoomId(handle),19000);
 if(!/^\d{12,22}$/.test(String(room)))throw Error("TikTok_room_unverified");
 report.roomValidated=true;report.verifiedStatus="live";
 let start=null;
 try{
  const info=await bounded(tiktok.fetchRoomInfo(room),18000);
  start=observedStart(info);
 }catch(error){if(error instanceof Error&&error.message==="TikTok room owner mismatch")throw error;report.reason=error instanceof Error?error.message.slice(0,85):"room_info_unavailable";}
 if(!start){const prior=String(original||"").match(/^🔴 Dawn Dotta is LIVE \((?:(\d+)h )?(\d+)m\)$/u)||String(original||"").match(/^🔴 Dawn Dotta LIVE • (?:(\d+)h )?(\d+)m$/u);start=prior?Date.now()-(Number(prior[1]||0)*60+Number(prior[2]))*60000:Date.now();}
 report.verifiedStart=!!start;
 return "🔴 Dawn Dotta is LIVE ("+formatElapsed(start)+")";
}
try{
 if(!report.creatorValidated)throw Error("official_tiktok_profile_unverified");
 const channel=await discord("GET","/channels/"+STAT);
 if(channel.id!==STAT||channel.guild_id!==G||channel.type!==2)throw Error("stats_channel_scope_drift");
  const original=String(channel.name||"");
  const labelCandidate=original.normalize("NFKC").replace(/[\uFE0E\uFE0F\u200B-\u200D\u2060\uFEFF]/gu,"").replace(/[ \t]+/gu," ").trim();
  const approvedLabel=/^(?:📡 LIVE Status (?:🔴|⚫|❔)|(?:🔴 Dawn Dotta is LIVE \((?:\d+h )?\d+m\)|⚫ Dawn Dotta is NOT LIVE|[🔴⚫] Dawn Dotta LIVE •))/u;
  if(!approvedLabel.test(labelCandidate)){
   report.labelDiagnostic={rawLength:original.length,rawCodepoints:Array.from(original).map(ch=>ch.codePointAt(0).toString(16)),normalizedLength:labelCandidate.length,normalizedCodepoints:Array.from(labelCandidate).map(ch=>ch.codePointAt(0).toString(16))};
   throw Error("approved_live_channel_label_changed");
  }
  report.currentName=original;
 let expected;
 try{expected=await verify()}
 catch(err){
  report.reason=err instanceof Error?err.message.slice(0,110):"unknown";
  // A temporary verification error must not falsely switch the creator offline.
 }
 if(expected&&expected!==original){
  // Live duration updates are throttled to at most once every 10 minutes of elapsed difference.
  const currentMinutes=original.match(/🔴 Dawn Dotta is LIVE \((?:(\d+)h )?(\d+)m\)/u);
  const newMinutes=expected.match(/🔴 Dawn Dotta is LIVE \((?:(\d+)h )?(\d+)m\)/u);
  const sameLive=!!currentMinutes&&!!newMinutes;
  const before=sameLive?Number(currentMinutes[1]||0)*60+Number(currentMinutes[2]):null;
  const next=sameLive?Number(newMinutes[1]||0)*60+Number(newMinutes[2]):null;
  const throttle=sameLive&&next>=before&&next-before<10;
  if(!throttle){
   report.proposedName=expected;
   if(WRITES){
    const latest=await discord("GET","/channels/"+STAT);
    if(latest.id!==STAT||latest.guild_id!==G||latest.name!==original||latest.type!==2)
      throw Error("concurrent_live_channel_change");
    const patched=await discord("PATCH","/channels/"+STAT,{name:expected});
    if(patched.id!==STAT||patched.name!==expected)throw Error("live_counter_patch_unverified");
    report.writes=1;
   }
  }
 }
}catch(err){report.reason=err instanceof Error?err.message.slice(0,140):"unknown"}
if(DIAG)throw Error("MM_VERIFIED_LIVE_PLAN:"+JSON.stringify(report));
console.log(JSON.stringify(report));