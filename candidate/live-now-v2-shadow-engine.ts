/**
 * Source-only LIVE NOW V2 migration candidate.
 * Derived from the preserved recovered/railway snapshot.
 * Gateway activation is deliberately blocked until this workload has its own
 * ownership lease/fence and an independently verified hard-stop path.
 * Do not add production secrets or remove the activation guard prematurely.
 */
import { createLiveNowPanelRepairAudit } from "../implementation/live-now-panel-repair-adapter.mjs";

// LIVE_CENTER_PREMIUM_LAYOUT_V3_20261110
// SILENT_PERSISTENT_LIVE_DASHBOARD_V1: keep native V2 flag and suppress push on dashboard creation, not authorized LIVE/SOS alerts.
// LIVE_NOW_PHOTO_FIRST_FALLBACK_GUARD_20261106
// UMM_LEGACY_CONVERSION_ACCURACY_V6 — Discord permits V2 conversion if content/embeds are cleared; retain old panel until safe review.
// UMM_LEGACY_DASHBOARD_MIGRATION_HOLD_V5 — never PATCH a legacy embed into native V2 dashboard, never create duplicate panel.
// UMM_AVIF_INLINE_COPY_V4 — original AVIF preserved; separate lossless PNG inline display copy.
// UMM_DISCORD_20M_AND_AVATAR_FALLBACK_V3 — safe default per-file cap, no hard dependency on TikTok avatar.
// UMM_LIVE_SHA256_READBACK_V2 — byte-level native upload verification; preserve partial publication on readback uncertainty.
// UMM_LIVE_REQUEST_BUDGET_V1 — preserve all source bytes, split safe native batches, no deletes.
import {Client,Events,GatewayIntentBits,PermissionFlagsBits,ModalBuilder,ActionRowBuilder,TextInputBuilder,TextInputStyle,FileUploadBuilder,LabelBuilder,UserSelectMenuBuilder,CheckboxBuilder} from "discord.js@14.27.0";
import {TikTokLiveConnection} from "tiktok-live-connector@2.5.0";
import sharp from "sharp@0.34.5";
const VER="2.2.2",G=String(Bun.env.LIVE_V2_GUILD_ID||""),C=String(Bun.env.LIVE_V2_CHANNEL_ID||""),A=String(Bun.env.LIVE_V2_BOT_ID||"1565304619838742598"),GENERAL=String(Bun.env.LIVE_V2_GENERAL_ID||""),BRAND=String(Bun.env.LIVE_V2_COMMUNITY||"Community"),TOKEN=String(Bun.env.DISCORD_BOT_TOKEN||""),ACTIVE=Bun.env.LIVE_V2_ACTIVE==="true",PUBLISH=Bun.env.LIVE_V2_PANEL_PUBLISH==="true",PASTE=Bun.env.LIVE_V2_PASTE_ENABLED==="true",QUIET={parse:[],users:[],roles:[],replied_user:false};
if(ACTIVE)throw Error("LIVE NOW V2 candidate refuses Gateway activation until independent workload ownership fencing and hard-stop proof are integrated.");
let lastError=null,gateway=false,lastEvent=null,panelId=null;const recent=new Map(),sosInflight=new Set(),pendingSubmissions=new Map(),okId=x=>/^\d{17,22}$/.test(String(x)),safe=(s,n=900)=>String(s||"").trim().replace(/@(everyone|here)/gi,"@\u200b$1").slice(0,n),delay=ms=>new Promise(r=>setTimeout(r,ms)),ts=n=>"<t:"+Math.floor(n/1000)+":f>",url=h=>"https://www.tiktok.com/@"+h+"/live",path=id=>"/channels/"+C+"/messages"+(id?"/"+id:""),info=(msg,...rest)=>console.log(JSON.stringify({event:msg,version:VER,guild:G,...(rest[0]||{})}));
async function api(path,method="GET",body){if(!TOKEN)throw Error("Bot token unavailable");for(let i=0;i<4;i++){const r=await fetch("https://discord.com/api/v10"+path,{method,headers:{Authorization:"Bot "+TOKEN,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});const raw=await r.text();let data={};try{data=JSON.parse(raw)}catch{}if(r.status===429){await delay(Math.max(1000,Math.min(20000,Number(data.retry_after||2)*1000+400)));continue}if(!r.ok)throw Error("Discord "+r.status+" "+safe(data.message||raw,120));return data}throw Error("Discord API retry limit")}
const acceptedTikTokHost=h=>["www.tiktok.com","m.tiktok.com","vm.tiktok.com","vt.tiktok.com","tiktok.com"].includes(String(h).toLowerCase());
const directTikTokHandle=s=>{try{const u=new URL(String(s));if(u.protocol!=="https:"||!acceptedTikTokHost(u.hostname))return null;return u.pathname.match(/^\/@([a-z0-9._]{2,30})\/live\/?$/i)?.[1]||null}catch{return null}};
const candidateLinks=s=>(String(s||"").match(/https:\/\/[^\s<>"']+/gi)||[]).map(u=>u.replace(/[)\],.!?]+$/g,""));
const handle=s=>{for(const raw of candidateLinks(s)){const h=directTikTokHandle(raw);if(h)return h}return null};
const isTikTokLiveCandidate=raw=>{try{const u=new URL(String(raw));return u.protocol==="https:"&&acceptedTikTokHost(u.hostname)&&(!!directTikTokHandle(raw)||/^\/t\//.test(u.pathname)||["vm.tiktok.com","vt.tiktok.com"].includes(u.hostname))}catch{return false}};
async function resolveHandle(s){
 const direct=handle(s);if(direct)return direct;
 for(const raw of candidateLinks(s)){
  let current;try{current=new URL(raw)}catch{continue}
  if(current.protocol!=="https:"||!acceptedTikTokHost(current.hostname))continue;
  if(!(/^\/t\//.test(current.pathname)||["vm.tiktok.com","vt.tiktok.com"].includes(current.hostname)))continue;
  for(let hop=0;hop<5;hop++){
   const h=directTikTokHandle(current.toString());if(h)return h;
   if(current.protocol!=="https:"||!acceptedTikTokHost(current.hostname))break;
   try{
    const response=await fetch(current.toString(),{method:"GET",redirect:"manual",signal:AbortSignal.timeout(5500)});
    const loc=response.headers.get("location");void response.body?.cancel().catch(()=>{});
    if(!loc)break;
    const next=new URL(loc,current);
    if(next.protocol!=="https:"||!acceptedTikTokHost(next.hostname))break;
    current=next;
   }catch{break}
  }
 }
 return null;
}
function buttons(m){let a=[];const walk=l=>{for(const x of l||[]){if(x.type===2)a.push(x);walk(x.components)}};walk(m.components);return a}
const has=(m,id)=>buttons(m).some(x=>x.custom_id===id),own=m=>String(m.author?.id||"")===A,panelMatch=m=>own(m)&&buttons(m).some(x=>["ln2:post","cw:live:open","live-now:v1:open"].includes(x.custom_id)),fld=(e,n)=>(e.fields||[]).find(x=>x.name===n)?.value||"";
function state(m){
 const e=m.embeds?.[0]||{},s=fld(e,"LIVE Status");
 if(s.includes("ENDED"))return "ENDED";
 if(s.includes("VERIFIED LIVE"))return "VERIFIED LIVE";
 if(s.includes("STAFF CONFIRMED"))return "STAFF CONFIRMED";
 if(s.includes("UNVERIFIED"))return "UNVERIFIED";
 if(s.includes("EXPIRED"))return "EXPIRED";
 if(/ENDED LIVE/.test(e.title||"")||fld(e,"Status")==="⚫ Ended")return "ENDED";
 return "";
}
function dualTime(ms){const d=new Date(ms),fmt=z=>new Intl.DateTimeFormat("en-US",{timeZone:z,month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(d);return fmt("America/New_York")+" ET · "+fmt("America/Chicago")+" CT"}
function elapsed(ms){const n=Math.max(0,Math.floor(ms/1000)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h+"h "+m+"m "+s+"s"}
function epoch(value){return Number(String(value||"").match(/<t:(\d+):/)?.[1]||0)*1000}
const isRecord=m=>own(m)&&!!fld(m.embeds?.[0]||{},"LIVE Record")&&(!m.channel_id||String(m.channel_id)===C)&&(!m.channelId||String(m.channelId)===C);
async function scan(pages=5){let result=[],before="";for(let n=0;n<pages;n++){const a=await api(path()+"?limit=100"+(before?"&before="+before:""));if(!Array.isArray(a))break;result.push(...a);if(a.length<100)break;const next=a.at(-1)?.id;if(!okId(next)||next===before)break;before=next}return result}
function panel(view="dashboard",records=[],notice=""){
 if(typeof view==="boolean")view=view?"history":"dashboard";
 const page=["dashboard","share","current","history","guide"].includes(view)?view:"dashboard";
 const historyRecords=records.filter(m=>["ENDED","EXPIRED"].includes(state(m)));
 const liveRecords=records.filter(m=>["VERIFIED LIVE","STAFF CONFIRMED"].includes(state(m)));
 const lines=(items,empty)=>items.length?items.slice(0,8).map((m,i)=>{const e=m.embeds?.[0]||{},h=handle(e.url||"");return(i+1)+". "+safe(h?"@"+h:e.title,80)+" · "+(state(m)||"Historical")+" · [Open original](https://discord.com/channels/"+G+"/"+C+"/"+m.id+")"}).join("\n"):empty;
 const nav=[{type:2,style:page==="dashboard"?1:2,label:"Overview",custom_id:"ln2:page:dashboard"},{type:2,style:page==="share"?1:2,label:"Share LIVE",custom_id:"ln2:page:share"},{type:2,style:page==="current"?1:2,label:"Current LIVE",custom_id:"ln2:page:current"},{type:2,style:page==="history"?1:2,label:"History",custom_id:"ln2:page:history"},{type:2,style:page==="guide"?1:2,label:"How It Works",custom_id:"ln2:page:guide"}];
 const heading=page==="dashboard"?"YOUR DASHBOARD":page==="share"?"SHARE A LIVE":page==="current"?"CURRENT LIVE":page==="history"?"LIVE HISTORY":"HOW IT WORKS";
 let body="";
 if(page==="dashboard")body="### YOUR LIVE CENTER\nYour central LIVE control panel. Use the page navigation above; every page keeps this LIVE CENTER dashboard and its controls.\n\n### START A SPOTLIGHT\n**01 · TikTok LIVE link**  Enter the active broadcast link first.\n**02 · Is this a Box Battle?**  Choose YES or NO before selecting anyone.\n**03 · Creator to promote**  Select one server member, or enter the TikTok username manually.\n**04 · LIVE description**  Add the required description shown on the Creator Spotlight card.";
 if(page==="share")body="### START A CREATOR SPOTLIGHT\n**01 · TikTok LIVE link**  Select POST LIVE NOW to enter the active broadcast link.\n**02 · Is this a Box Battle?**  Choose YES or NO before the creator selector appears.\n**03 · Creator selection**  Choose one server member or use the manual TikTok username fallback.\n**04 · LIVE description**  Required. The description appears on the published Creator Spotlight card.\n\nThe selected page and all navigation remain part of this LIVE CENTER dashboard.";
 if(page==="current")body="### ACTIVE CREATOR SPOTLIGHTS\n"+lines(liveRecords,"No currently verified LIVE broadcasts were found in the scanned channel history.")+"\n\nOnly verified active broadcasts are listed here. The published cards remain in #live-now.";
 if(page==="history")body="### PREVIOUS LIVE BROADCASTS\n"+lines(historyRecords,"No completed or expired LIVE records were found in the scanned channel history.")+"\n\nHistorical Creator Spotlight posts remain preserved in #live-now.";
 if(page==="guide")body="### HOW LIVE CENTER WORKS\n**01 · Link**  Enter a TikTok LIVE link.\n**02 · Box Battle**  Answer YES or NO before creator selection.\n**03 · Creator**  Select one creator to promote using the server member dropdown, or enter a TikTok username manually. Never select an opponent or list the whole battle.\n**04 · Description**  Enter the required LIVE description.\n**05 · Publish**  POST LIVE NOW verifies the active broadcast and publishes the Creator Spotlight.\n**SOS**  A separate staff-approved action; ordinary LIVE announcements never ping @everyone.";
 return {flags:36864,content:null,embeds:[],components:[{type:17,accent_color:0x0755c9,components:[
  {type:10,content:"## 🔴 LIVE CENTER  ·  "+safe(BRAND,80)+"\n-# CREATOR SPOTLIGHT"},
  {type:10,content:"**Your community. Your moment.**\nA persistent control center for verified TikTok LIVE Creator Spotlights."},
  {type:14,divider:true,spacing:1},
  {type:1,components:[{type:2,style:1,label:"POST LIVE NOW",custom_id:"ln2:post"}]},
  {type:1,components:nav},
  ...(page==="history"?[{type:1,components:[{type:2,style:2,label:"Return to Dashboard",custom_id:"ln2:close"}]}]:[]),
  {type:14,divider:true,spacing:1},
  {type:10,content:"### "+heading+"\n"+body},
  ...(notice?[{type:14,divider:true,spacing:1},{type:10,content:"**Submission update**  "+safe(notice,700)}]:[]),
  {type:10,content:"-# VERIFIED TIKTOK LIVE  ·  PERSISTENT DASHBOARD ON EVERY PAGE  ·  HISTORY PRESERVED  ·  SOS REQUIRES STAFF APPROVAL"}
 ]}],allowed_mentions:QUIET}
}
function card(h,desc,author,support,avatar,displayName,verified,hostName,hostUserId,supportUserId){
 const now=Date.now(),name=safe(displayName||("@"+h),70),icon=avatar?"attachment://"+avatar.filename:null,start=Number(verified?.startAt||now),battle=!!support;
 const fields=[
  {name:"LIVE Status",value:"🟢 VERIFIED LIVE",inline:true},
  {name:"LIVE Duration",value:elapsed(now-start)+(verified?.actualStart?" (TikTok stream start)":" (observed since first verification)"),inline:true},
  {name:verified?.actualStart?"LIVE Start":"First verified at",value:ts(start)+" · "+dualTime(start)},
  ...(verified?.title?[{name:"LIVE Title",value:safe(verified.title,200)}]:[]),
  {name:battle?"Box Battle Participant":"LIVE Host",value:hostUserId?"<@"+hostUserId+">":safe(hostName,80),inline:true},
  {name:"Shared by",value:"<@"+author+">",inline:true},
  {name:"LIVE Record",value:"@"+h+" · "+String(verified?.roomId||"verified"),inline:false},
  ...(battle?[{name:"Box Battle",value:"TikTok elimination battle",inline:true}]:[])
 ];
 const e={title:"✨ CREATOR SPOTLIGHT · LIVE NOW",url:url(h),color:0xc8a96b,description:safe(desc,350),author:{name:name+" · @"+h,...(icon?{icon_url:icon}:{})},fields,footer:{text:BRAND+" • Verified from the active TikTok LIVE room"}};
 if(icon)e.thumbnail={url:icon};
 return {content:null,embeds:[e],components:[{type:1,components:[{type:2,style:5,label:"Join LIVE",url:url(h)},{type:2,style:4,label:"Request SOS Alert",custom_id:"ln2:sos_request"},{type:2,style:2,label:"Manage LIVE",custom_id:"ln2:manage"},{type:2,style:2,label:"View History",custom_id:"ln2:history"}]}],allowed_mentions:QUIET}
}
/* LIVE NOW AVATAR V2: TikTok link -> highest listed profile image -> exact bytes -> native Discord attachment */
async function tiktokProfileAvatar(h){
  const endpoint="https://www.tiktok.com/@"+h+"/live";
  const page=await fetch(endpoint,{signal:AbortSignal.timeout(12500),headers:{"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36","Accept":"text/html,application/xhtml+xml,*/*"}});
  if(!page.ok)throw Error("TikTok profile photo unavailable ("+page.status+"); original LIVE link retained");
  const html=await page.text();
  if(!html.toLowerCase().includes(h.toLowerCase()))throw Error("TikTok profile identity could not be verified");
  const metadata=html.match(/"avatarLarger":"([^"]+)"/);
  if(!metadata)throw Error("TikTok did not expose a public profile avatar; original LIVE link retained");
  let raw;try{raw=JSON.parse('"'+metadata[1]+'"')}catch{throw Error("TikTok avatar metadata could not be decoded")}
  let current;try{current=new URL(raw)}catch{throw Error("TikTok avatar URL invalid")}
  const trusted=u=>u.protocol==="https:"&&/^(?:[a-z0-9-]+\.)*tiktokcdn(?:-us|-eu)?\.com$/i.test(u.hostname);
  if(!trusted(current))throw Error("TikTok avatar came from an unapproved CDN");
  let response;
  for(let n=0;n<4;n++){
    response=await fetch(current.href,{redirect:"manual",signal:AbortSignal.timeout(16000),headers:{"Accept":"image/webp,image/jpeg,image/png,image/gif,image/avif,image/*"}});
    if(response.status>=300&&response.status<400){
      const loc=response.headers.get("location");if(!loc)throw Error("TikTok image redirect missing");
      const dest=new URL(loc,current);if(!trusted(dest))throw Error("TikTok image redirect left approved CDN");
      current=dest;continue
    }
    break
  }
  const mime=String(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
  const types={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif","image/avif":"avif"};
  if(!response.ok||!types[mime])throw Error("TikTok profile avatar is not a supported photo");
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength<512||bytes.byteLength>10*1024*1024)throw Error("TikTok profile avatar failed image size checks");
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
  let displayName=h;const nick=html.match(/"nickname":"((?:\\.|[^"\\])*)"/);if(nick){try{displayName=safe(JSON.parse('"'+nick[1]+'"'),70)||h}catch{}}
  info("live-v2-avatar-extracted",{creator:h,displayName,bytes:bytes.byteLength,mime,sha256:hash});
  return {filename:"tiktok-avatar-"+h+"."+types[mime],contentType:mime,size:bytes.byteLength,bytes,sha256:hash,displayName};
}
async function postNativeMedia(payload,uploads){
  if(!Array.isArray(uploads)||!uploads.length)return api(path(),"POST",payload);
  if(uploads.length>10)throw Error("Maximum 10 source files per LIVE submission, including the profile photo");
  const types={"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp","image/avif":"avif","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov"};
  const MAX_SINGLE=19*1024*1024, MAX_TOTAL=80*1024*1024, MAX_REQUEST=25*1024*1024; // Below Discord's default 20 MiB per-file cap.
  const files=[];let total=0;
  for(let i=0;i<uploads.length;i++){
    const file=uploads[i],mime=String(file.contentType||file.content_type||"").split(";")[0].toLowerCase(),ext=types[mime];
    if(!ext)throw Error("Unsupported photo/video format. Original source remains unchanged.");
    let bytes;
    if(file.bytes instanceof ArrayBuffer)bytes=file.bytes;
    else{
      const u=new URL(String(file.url||""));
      if(u.protocol!=="https:"||!["cdn.discordapp.com","media.discordapp.net"].includes(u.hostname))throw Error("Untrusted media source. Original retained.");
      if(Number(file.size||0)>MAX_SINGLE)throw Error("File exceeds the safe single-message attachment budget. Original retained.");
      const response=await fetch(u.toString(),{redirect:"error",signal:AbortSignal.timeout(25000)});
      if(!response.ok)throw Error("Could not retrieve original media. Original retained.");
      bytes=await response.arrayBuffer();
      if(Number(file.size||0)>0&&bytes.byteLength!==Number(file.size))throw Error("Media size does not match the original attachment; publication held.");
    }
    if(!bytes.byteLength||bytes.byteLength>MAX_SINGLE)throw Error("Individual media exceeds safe native inline request budget. Original retained.");
    total+=bytes.byteLength;
    if(total>MAX_TOTAL)throw Error("Combined media exceeds the bounded intake budget. Original retained.");
    const filename=file.bytes instanceof ArrayBuffer?file.filename:"live-media-"+i+"."+ext;
    if(mime==="image/avif"){
      // Discord embed attachment:// covers accept PNG/JPEG/GIF/WEBP, not AVIF.
      // Publish a separate pixel-preserving PNG display copy, without altering AVIF original bytes.
      let preview;
      try{preview=await sharp(new Uint8Array(bytes),{limitInputPixels:80000000}).png({palette:false,compressionLevel:9}).toBuffer();}
      catch(error){throw Error("AVIF inline display copy could not be generated; original source retained.");}
      if(!preview.length||preview.length>MAX_SINGLE)throw Error("AVIF inline PNG exceeds safe upload budget; original source retained.");
      total+=preview.length;
      if(total>MAX_TOTAL)throw Error("AVIF display copy exceeds media batch budget; original source retained.");
      files.push({filename:"live-inline-avif-"+i+".png",mime:"image/png",bytes:preview});
    }
    files.push({filename,mime,bytes});
  }
  const groups=[];let batch=[],batchBytes=0;
  for(const f of files){
    if(batch.length && (batchBytes+f.bytes.byteLength>MAX_SINGLE || batch.length>=10)){groups.push(batch);batch=[];batchBytes=0;}
    batch.push(f);batchBytes+=f.bytes.byteLength;
  }
  if(batch.length)groups.push(batch);
  async function uploadBatch(data,items,showCover){
    const attachments=items.map((f,i)=>({id:i,filename:f.filename}));
    const body={...data,attachments};
    const cover=showCover?items.find(f=>["image/png","image/jpeg","image/webp","image/gif"].includes(f.mime)):null;
    if(cover&&body.embeds?.length){const first=body.embeds[0],uri="attachment://"+cover.filename;body.embeds=[{...first,thumbnail:{url:uri},author:first.author?{...first.author,icon_url:uri}:first.author},...body.embeds.slice(1)];}
    const payloadJson=JSON.stringify(body);
    const bytes=items.reduce((n,f)=>n+f.bytes.byteLength,0);
    if(bytes+new TextEncoder().encode(payloadJson).length+65536>MAX_REQUEST)throw Error("Discord total multipart request limit exceeded; originals retained.");
    const form=new FormData();form.set("payload_json",payloadJson);
    for(let i=0;i<items.length;i++)form.set("files["+i+"]",new Blob([items[i].bytes],{type:items[i].mime}),items[i].filename);
    const response=await fetch("https://discord.com/api/v10"+path(),{method:"POST",headers:{Authorization:"Bot "+TOKEN},body:form,signal:AbortSignal.timeout(65000)});
    const raw=await response.text();let posted={};try{posted=JSON.parse(raw)}catch{}
    if(!response.ok){info("live-v2-native-upload-held",{status:response.status,apiCode:posted.code||null,reason:safe(posted.message||"Rejected by Discord",140)});throw Error("Native upload HTTP "+response.status+"; originals retained.")}
    if(!posted.id)throw Error("Native upload response missing a message ID; inspect Discord before retrying.");
    try{
      const visible=await api(path(posted.id));
      const disclosed=[...(visible.attachments||[]),...(posted.attachments||[])];
      const images=[...(visible.embeds||[]),...(posted.embeds||[])].flatMap(e=>[e.image?.url,e.thumbnail?.url,e.author?.icon_url].filter(Boolean));
      const filenameOf=u=>{try{return decodeURIComponent(new URL(u).pathname.split("/").pop()||"")}catch{return ""}};
      for(let i=0;i<items.length;i++){
        const uploaded=disclosed.find(a=>a.filename===items[i].filename);
        if(uploaded&&Number(uploaded.size)!==items[i].bytes.byteLength)throw Error("Native upload attachment length mismatch");
        const imageUrl=images.find(u=>filenameOf(u)===items[i].filename);
        const u=new URL(String(uploaded?.url||imageUrl||""));
        if(u.protocol!=="https:"||!["cdn.discordapp.com","media.discordapp.net"].includes(u.hostname))throw Error("Native Discord media URL unavailable or untrusted");
        const returned=await fetch(u.toString(),{redirect:"error",headers:{"Accept-Encoding":"identity"},signal:AbortSignal.timeout(35000)});
        if(!returned.ok)throw Error("Published Discord media not readable; HTTP "+returned.status);
        const retrieved=await returned.arrayBuffer();
        if(retrieved.byteLength!==items[i].bytes.byteLength)throw Error("Published Discord media size changed");
        const digest=b=>crypto.subtle.digest("SHA-256",b).then(d=>Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join(""));
        const [expected,actual]=await Promise.all([digest(items[i].bytes),digest(retrieved)]);
        if(expected!==actual)throw Error("Published Discord media SHA-256 mismatch");
      }
      if(cover&&!(visible.embeds||[]).some(e=>e.image?.url))throw Error("LIVE cover photo was not rendered inline");
    }catch(e){
      e.publishedMessage=posted; // Preserve the known message and never blind-retry its POST.
      throw e;
    }
    info("live-v2-media-batch-verified",{message:posted.id,attachments:items.length,originalBytes:bytes,groupCount:groups.length,sha256Checked:true,inlineCover:!!cover});
    return posted;
  }
  let original=null;
  for(let i=0;i<groups.length;i++){
    const data=i===0?payload:{
      content:"📎 Additional original LIVE media · part "+(i+1)+" of "+groups.length,
      message_reference:{message_id:original.id,channel_id:C,guild_id:G,fail_if_not_exists:true},
      allowed_mentions:QUIET,
      nonce:original.id.slice(-18)+String(i).padStart(2,"0"),enforce_nonce:true
    };
    try{
      const posted=await uploadBatch(data,groups[i],i===0);
      if(i===0)original=posted;
    }catch(error){
      if(!original&&error?.publishedMessage?.id)original=error.publishedMessage;
      if(!original)throw error;
      info("live-v2-extra-media-held",{record:original.id,failedBatch:i+1,totalBatches:groups.length,reason:safe(error?.message||error,140),originalsDeleted:0});
      const warning="🔗 TikTok stream submitted · verification pending. ⚠️ Some additional media could not be published; staff review required. Original uploads were not deleted.";
      await api(path(original.id),"PATCH",{content:warning,allowed_mentions:QUIET}).catch(()=>{});
      return {...original,mediaHeld:true};
    }
  }
  return original;
}
async function verifyTikTokLive(h){
 const connection=new TikTokLiveConnection(h,{});
 const bounded=async(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("TikTok verification timed out")),ms)})]).finally(()=>clearTimeout(timer))};
 const first=await bounded(connection.fetchIsLive(h),18000);
 if(first!==true)throw Error("TikTok does not confirm that this creator is LIVE right now; nothing was posted");
 const room=await bounded(connection.fetchRoomId(h),18000);
 if(!/^\d{12,22}$/.test(String(room)))throw Error("TikTok did not return a valid active room ID; nothing was posted");
 const second=await bounded(connection.fetchIsLive(h),18000);
 if(second!==true)throw Error("TikTok LIVE status changed or could not be reconfirmed; nothing was posted");
 let infoData=null,title="",startAt=Date.now(),actualStart=false;
 try{
  infoData=await bounded(connection.fetchRoomInfo(String(room)),18000);
  const owner=infoData?.owner?.uniqueId??infoData?.owner?.unique_id??infoData?.data?.owner?.uniqueId??infoData?.data?.owner?.unique_id??infoData?.data?.room?.owner?.unique_id??infoData?.room_info?.owner?.unique_id??null;
  if(owner&&String(owner).replace(/^@/,"").toLowerCase()!==h.toLowerCase())throw Error("TikTok room owner does not match the submitted host");
  title=String(infoData?.title??infoData?.stream_title??infoData?.data?.title??infoData?.data?.room?.title??infoData?.room_info?.title??"").trim().slice(0,200);
  const candidates=[infoData?.create_time,infoData?.start_time,infoData?.createTime,infoData?.startTime,infoData?.data?.create_time,infoData?.data?.start_time,infoData?.room?.create_time,infoData?.data?.room?.create_time,infoData?.room_info?.create_time,infoData?.data?.room_info?.create_time];
  for(const value of candidates){if(value===null||value===undefined||value==="")continue;const n=Number(value),ms=n<10000000000?n*1000:n;if(Number.isSafeInteger(n)&&ms>0&&ms<=Date.now()&&Date.now()-ms<=7*86400000){startAt=ms;actualStart=true;break}}
 }catch(error){if(/owner does not match/.test(String(error?.message||error)))throw error;info("live-v2-room-details-limited",{creator:h,reason:safe(error?.message||error,120)})}
 return {roomId:String(room),startAt,actualStart,title,checkedAt:Date.now()}
}
async function fetchTikTokLiveStatus(h){
 const connection=new TikTokLiveConnection(h,{});
 const result=await Promise.race([connection.fetchIsLive(h),new Promise((_,reject)=>setTimeout(()=>reject(Error("TikTok status timeout")),16000))]);
 if(typeof result!=="boolean")throw Error("TikTok LIVE status was not a reliable boolean");
 return result
}
async function submit(h,desc,author,nonce,support,hostName,hostUserId,supportUserId){
 if(!h)throw Error("Use a direct TikTok @handle/live link");
 if(!String(desc||"").trim())throw Error("LIVE description is required");
 if(!String(hostName||"").trim())throw Error("Select a Discord member or enter the LIVE host manually");
 const key=h.toLowerCase(),now=Date.now();
 if(recent.has(key)&&now-recent.get(key)<30000)throw Error("A submission is already being processed");
 recent.set(key,now);
 try{
  const entries=await scan(6),prior=entries.find(m=>isRecord(m)&&handle(m.embeds?.[0]?.url||"")?.toLowerCase()===key&&["VERIFIED LIVE","STAFF CONFIRMED"].includes(state(m))&&Date.parse(m.timestamp)>now-7200000);
  if(prior)throw Error("This creator already has a recent active LIVE record");
  const verified=await verifyTikTokLive(h);
  const avatar=await tiktokProfileAvatar(h);
  if(!avatar?.bytes?.byteLength)throw Error("TikTok profile photo could not be verified; nothing was posted");
  const payload={...card(h,desc,author,support,avatar,avatar.displayName||h,verified,hostName,hostUserId,supportUserId),...(nonce?{nonce:String(nonce),enforce_nonce:true}:{})};
  return await postNativeMedia(payload,[avatar]);
 }catch(e){recent.delete(key);throw e}
}
async function note(m,t){if(!own(m))return;if(panelMatch(m))return api(path(m.id),"PATCH",panel(false,[],t));if(!isRecord(m))return;const e=m.embeds[0],fields=(e.fields||[]).filter(f=>f.name!=="Latest update");fields.push({name:"Latest update",value:safe(t,700)});return api(path(m.id),"PATCH",{embeds:[{...e,fields}],allowed_mentions:QUIET})}
async function verify(){if(!okId(G)||!okId(C)||!okId(A))throw Error("Invalid guild, channel or bot ID");if(!TOKEN)return {ready:false,reason:"DISCORD_BOT_TOKEN not configured"};const [me,ch]=await Promise.all([api("/users/@me"),api("/channels/"+C)]);const valid=me.id===A&&ch.guild_id===G&&ch.type===0&&/live-now/i.test(ch.name);return {ready:valid,botMatches:me.id===A,channelMatches:ch.guild_id===G&&ch.type===0,channelName:ch.name,mode:ACTIVE?"active":"shadow"}}
async function expireUnverified(){
  if(!ACTIVE||!gateway)return;
  try{
    const messages=await scan(7);
    const now=Math.floor(Date.now()/1000);
    let changed=0;
    for(const m of messages){
      if(changed>=12)break;
      if(!isRecord(m)||state(m)!=="UNVERIFIED")continue;
      const e=m.embeds?.[0]||{},value=fld(e,"Review after"),deadline=Number(value.match(/<t:(\d+):f>/)?.[1]||0);
      if(!deadline||now<deadline)continue;
      const fields=(e.fields||[]).map(f=>f.name==="LIVE Status"?{...f,value:"⚪ EXPIRED · Never verified"}:f);
      await api(path(m.id),"PATCH",{embeds:[{...e,title:"⚪ LIVE submission expired · unverified",color:0x64748b,fields}],allowed_mentions:QUIET});
      changed++;
    }
    if(changed)info("live-v2-unverified-expired",{count:changed});
  }catch(e){lastError=safe(e.message,160);console.error("[LIVE-V2] Expiration check held: "+lastError)}
}
async function syncLiveChannelTopic(){
 const expected="🔴 "+safe(BRAND,80)+" · LIVE NOW. Submit from the persistent LIVE CENTER dashboard or paste a TikTok LIVE link in this channel. Enter the link first, answer Is this a Box Battle? YES/NO, select the one creator to promote using the server member selector or manual TikTok username fallback, then enter the required LIVE description. Dashboard and native-link submissions use the same verification and Creator Spotlight publisher. One verified card per broadcast; ended cards and history stay here. Routine LIVE posts never ping @everyone. SOS requires staff approval and may ping @everyone only in General Chat.";
 try{
  const current=await api("/channels/"+C);
  if(current.topic!==expected){
   await api("/channels/"+C,"PATCH",{topic:expected});
   const check=await api("/channels/"+C);
   if(check.topic!==expected)throw Error("LIVE channel topic read-back mismatch");
   info("live-v2-channel-topic-verified",{channel:C});
  }
 }catch(error){info("live-v2-channel-topic-held",{channel:C,reason:safe(error?.message||error,160)})}
}
async function publishPanel(){
 await syncLiveChannelTopic();
 const all=await scan(7),newer=all.filter(m=>own(m)&&has(m,"ln2:post"));
 if(newer.length>1)throw Error("Duplicate v2 dashboard: stopped without deleting messages");
 if(newer.length===1){
  panelId=newer[0].id;
  await api(path(panelId),"PATCH",panel());
  const check=await api(path(panelId));
  if(!has(check,"ln2:post")||!JSON.stringify(check.components).includes("POST LIVE NOW"))throw Error("Existing dashboard update read-back failed");
  return panelId;
 }
 const old=all.find(panelMatch);
 if(old){info("live-v2-legacy-panel-migration-held",{channel:C,legacyPanelId:old.id,reason:"legacy_panel_preserved_for_controlled_conversion",legacyWrites:0,duplicateDashboardsCreated:0});throw Error("Legacy LIVE NOW panel preserved; controlled conversion required.")}
 const result=await api(path(),"POST",panel()),check=await api(path(result.id));
 if(!has(check,"ln2:post"))throw Error("Panel read-back did not match");
 panelId=result.id;return panelId
}
/* LIVE_V2_PANEL_AUDIT_REPAIR_V1 — reuses the existing 30-minute audit; no new timer. */
let lastPanelAudit=null;
const runLiveNowPanelRepairAudit=createLiveNowPanelRepairAudit({
 scanMessages:scan,
 publishOrAdoptPanel:publishPanel,
 getPanelId:()=>panelId,
 setPanelId:id=>{panelId=id},
 botId:A
});
async function passiveAudit(){
 if(!ACTIVE||!gateway||!PUBLISH)return;
 try{
  const result=await runLiveNowPanelRepairAudit();
  const healthy=result.status==="healthy"||result.status==="repaired";
  const outcome={
   healthy,
   count:result.status==="held"?result.count:1,
   legacy:result.status==="held"?result.legacy:0,
   at:new Date().toISOString(),
   panel:result.panelId||null,
   ...(result.status==="held"?{reason:result.reason}:{})
  };
  if(!lastPanelAudit||lastPanelAudit.healthy!==outcome.healthy||lastPanelAudit.count!==outcome.count||lastPanelAudit.legacy!==outcome.legacy||lastPanelAudit.panel!==outcome.panel)
   console.log("[LIVE-V2 AUDIT] "+JSON.stringify(outcome));
  if(result.status==="repaired")info("live-v2-panel-repaired",{repair:result.repair,panel:result.panelId});
  if(result.status==="held")info("live-v2-panel-repair-held",{reason:result.reason,count:result.count,legacy:result.legacy});
  lastPanelAudit=outcome;
 }catch(error){
  const outcome={healthy:false,error:safe(error?.message||error,150),at:new Date().toISOString()};
  if(!lastPanelAudit||lastPanelAudit.healthy||lastPanelAudit.error!==outcome.error)console.warn("[LIVE-V2 AUDIT] "+JSON.stringify(outcome));
  lastPanelAudit=outcome;
 }
}

function linkModal(){
 const linkField=new TextInputBuilder().setCustomId("url").setStyle(TextInputStyle.Short).setPlaceholder("Insert TikTok LIVE Link Here").setRequired(true).setMaxLength(250);
 return new ModalBuilder().setCustomId("ln2:link:dashboard").setTitle("LIVE CENTER · Start Spotlight").addLabelComponents(
  new LabelBuilder().setLabel("01 — TikTok LIVE link").setDescription("Required · enter the active broadcast link first").setTextInputComponent(linkField)
 )
}
function modal(boxBattle=false,defaultUrl="",context="dashboard"){
 const hostLabel=boxBattle?"Box Battle participant":"LIVE host";
 return new ModalBuilder().setCustomId("ln2:submit:"+(boxBattle?"yes":"no")+":"+context).setTitle(boxBattle?"LIVE CENTER · Box Battle Participant":"LIVE CENTER · Regular LIVE Host").addLabelComponents(
  new LabelBuilder().setLabel("01 — "+hostLabel+" · Discord member").setDescription("Choose one creator from this server").setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId("host_member").setPlaceholder(boxBattle?"Select Box Battle participant":"Select LIVE host").setMinValues(0).setMaxValues(1)),
  new LabelBuilder().setLabel("Manual TikTok username").setDescription("Use if the creator is not listed in the member dropdown").setTextInputComponent(new TextInputBuilder().setCustomId("host_manual").setStyle(TextInputStyle.Short).setPlaceholder("Enter TikTok username or creator name").setRequired(false).setMaxLength(80)),
  new LabelBuilder().setLabel("02 — LIVE description").setDescription("Required · displayed on the Creator Spotlight card").setTextInputComponent(new TextInputBuilder().setCustomId("desc").setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(350))
 )
}
function battleManualModal(pendingMessageId){return new ModalBuilder().setCustomId("ln2:battle_manual_submit:"+String(pendingMessageId)).setTitle("LIVE CENTER · Box Battle Participant").addLabelComponents(
 new LabelBuilder().setLabel("Participant name or @username").setTextInputComponent(new TextInputBuilder().setCustomId("support_manual").setStyle(TextInputStyle.Short).setPlaceholder("Enter the participant being supported").setRequired(true).setMaxLength(80))
)}
async function staff(i){try{if(i.guild.ownerId===i.user.id)return true;const p=(await i.guild.members.fetch(i.user.id)).permissions;return p.has(PermissionFlagsBits.Administrator)||p.has(PermissionFlagsBits.ManageMessages)}catch{return false}}
async function sosStaff(i){try{return i.guild.ownerId===i.user.id||(await i.guild.members.fetch(i.user.id)).permissions.has(PermissionFlagsBits.Administrator)}catch{return false}}
async function setState(m,flag,user){
 if(!isRecord(m))throw Error("This is not a verified LIVE record");
 if(["ENDED","EXPIRED"].includes(state(m)))throw Error("LIVE already ended");
 const e=m.embeds[0],now=Date.now(),start=epoch(fld(e,"LIVE Start"))||epoch(fld(e,"First verified at"))||epoch(fld(e,"Verified since"));
 const fields=(e.fields||[]).filter(f=>!["LIVE Status","End detected","Marked ended","LIVE Duration"].includes(f.name));
 fields.unshift({name:"LIVE Status",value:"⚫ ENDED",inline:true});
 fields.push({name:"LIVE Duration",value:start?elapsed(now-start)+" (final observed duration)":"Unavailable — start time not supplied by TikTok",inline:true});
 fields.push({name:"End detected",value:dualTime(now)});
 return api(path(m.id),"PATCH",{embeds:[{...e,title:"⚫ LIVE ENDED · Creator Spotlight",color:0x64748b,fields,footer:{text:BRAND+" • Ended broadcast · History preserved"}}],components:[{type:1,components:[{type:2,style:5,label:"Open TikTok",url:e.url},{type:2,style:2,label:"View History",custom_id:"ln2:history"}]}],allowed_mentions:QUIET})
}
async function refreshObservedDurations(){
 if(!ACTIVE||!gateway)return;
 try{
  const messages=await scan(7);let changed=0;
  for(const m of messages){
   if(changed>=20)break;
   if(!isRecord(m)||!["VERIFIED LIVE","STAFF CONFIRMED"].includes(state(m)))continue;
   const e=m.embeds[0],h=handle(e.url||""),start=epoch(fld(e,"LIVE Start"))||epoch(fld(e,"First verified at"))||epoch(fld(e,"Verified since"));
   if(state(m)==="VERIFIED LIVE"&&h){
    try{
     const first=await fetchTikTokLiveStatus(h);
     if(first===false){await delay(1800);const second=await fetchTikTokLiveStatus(h);if(second===false){await setState(m,"ENDED",A);changed++;continue}}
    }catch(error){info("live-v2-end-check-held",{record:m.id,reason:safe(error?.message||error,120)})}
   }
   if(!start)continue;
   const fields=(e.fields||[]).map(f=>f.name==="LIVE Duration"?{...f,value:elapsed(Date.now()-start)+(fld(e,"LIVE Start")?" (TikTok stream duration)":" (observed since verification)")}:f);
   if(!fields.some(f=>f.name==="LIVE Duration"))fields.push({name:"LIVE Duration",value:elapsed(Date.now()-start)+" (observed since verification)",inline:true});
   await api(path(m.id),"PATCH",{embeds:[{...e,fields}],allowed_mentions:QUIET});changed++;
  }
  if(changed)info("live-v2-duration-and-end-refresh",{updated:changed});
 }catch(e){lastError=safe(e.message,160);console.error("[LIVE-V2] Duration refresh held: "+lastError)}
}
async function interaction(i){
 if(i.guildId!==G||i.channelId!==C||i.applicationId!==A||!i.customId?.startsWith("ln2:"))return;
 const action=i.customId.slice(4);lastEvent=new Date().toISOString();info("live-v2-interaction-received",{action,kind:i.isModalSubmit()?"modal":i.isUserSelectMenu()?"user_select":i.isButton()?"button":"other"});
 const ownerOf=m=>fld(m.embeds?.[0]||{},"Shared by")==="<@"+i.user.id+">"||fld(m.embeds?.[0]||{},"Submitted by")==="<@"+i.user.id+">";
 const dashboardNotice=async message=>{if(!panelId)return;const d=await api(path(panelId));return note(d,message)};
 const publishPending=async(pending,pendingMessageId,supportName,supportUserId)=>{
  if(!pending||Date.now()-pending.createdAt>600000){pendingSubmissions.delete(String(pendingMessageId));throw Error("This Box Battle step expired. Nothing was posted; please use POST NOW again.")}
  const h=await resolveHandle(pending.input);if(!h)throw Error("TikTok LIVE URL could not be resolved; nothing was posted");
  const result=await submit(h,pending.desc,pending.author,pending.nonce,supportName,pending.hostName,pending.hostUserId,supportUserId);
  pendingSubmissions.delete(String(pendingMessageId));
  await api(path(pendingMessageId),"DELETE").catch(()=>{});
  info("live-v2-post-now-published",{message:result.id,creator:h,boxBattle:!!supportName});
  return result
 };
 try{
  if(i.isButton()){
   if(action==="post")return i.showModal(linkModal());
   if(action.startsWith("native_no:")||action.startsWith("native_yes:")){
    const [kind,sourceId,authorId]=action.split(":");
    if(!okId(sourceId)||!okId(authorId)||!i.message)return;
    if(i.user.id!==authorId)return note(i.message,"Only the member who shared this TikTok LIVE link can submit it.");
    const prompt=await api(path(i.message.id));
    const link=promptLink(prompt);
    if(!prompt?.id||prompt.author?.id!==A||prompt.channel_id!==C||!link||(!has(prompt,"ln2:native_yes:"+sourceId+":"+authorId)&&!has(prompt,"ln2:native_no:"+sourceId+":"+authorId)))return note(i.message,"The original member TikTok LIVE link could not be verified from this LIVE CENTER prompt. Nothing was submitted.");
    return i.showModal(modal(kind==="native_yes",link,"native:"+sourceId+":"+i.message.id+":"+authorId));
   }
   if(action.startsWith("dashboard_no:")||action.startsWith("dashboard_yes:")){
    const [kind,authorId]=action.split(":");
    if(!okId(authorId)||!i.message||i.user.id!==authorId)return note(i.message,"Only the member who started this LIVE submission can continue.");
    const prompt=await api(path(i.message.id)),link=promptLink(prompt);
    if(!prompt?.id||prompt.author?.id!==A||prompt.channel_id!==C||!link)return note(i.message,"The LIVE submission prompt is unavailable. Nothing was submitted.");
    return i.showModal(modal(kind==="dashboard_yes",link,"dashboard:"+prompt.id+":"+authorId));
   }
   if(action==="battle_manual"){
    const pending=pendingSubmissions.get(String(i.message.id));
    if(!pending||pending.author!==i.user.id)return note(i.message,"This Box Battle step is not assigned to you or has expired.");
    return i.showModal(battleManualModal(i.message.id));
   }
   await i.deferUpdate();
   if(action==="guide")return api(path(panelId||i.message.id),"PATCH",panel("guide"));
   if(action==="close")return api(path(panelId||i.message.id),"PATCH",panel("dashboard"));
   if(action==="history"){
    const all=await scan(10),records=all.filter(m=>own(m)&&(state(m)==="ENDED"||state(m)==="EXPIRED"));
    const dashboard=panelId?{id:panelId}:panelMatch(i.message)?i.message:all.find(m=>own(m)&&has(m,"ln2:post"));
    if(!dashboard){info("live-v2-history-held",{reason:"Persistent dashboard unavailable"});return}
    return api(path(dashboard.id),"PATCH",panel("history",records))
   }
   if(action.startsWith("page:")){
    const page=action.slice(5);
    if(!["dashboard","share","current","history","guide"].includes(page))return;
    const all=["current","history"].includes(page)?await scan(10):[];
    const records=page==="current"?all.filter(m=>own(m)&&["VERIFIED LIVE","STAFF CONFIRMED"].includes(state(m))):page==="history"?all.filter(m=>own(m)&&["ENDED","EXPIRED"].includes(state(m))):[];
    const dashboard=panelId?{id:panelId}:all.find(m=>own(m)&&has(m,"ln2:post"))||(panelMatch(i.message)?i.message:null);
    if(!dashboard){info("live-v2-page-held",{page,reason:"Persistent dashboard unavailable"});return}
    return api(path(dashboard.id),"PATCH",panel(page,records))
   }
   if(action==="battle_cancel"){
    const pending=pendingSubmissions.get(String(i.message.id));
    if(!pending||pending.author!==i.user.id)return note(i.message,"This Box Battle step is not assigned to you.");
    pendingSubmissions.delete(String(i.message.id));
    return api(path(i.message.id),"PATCH",{content:"⚪ **Canceled** · No LIVE card was published.",embeds:[],components:[],allowed_mentions:QUIET})
   }
   if(action==="manage"){
    if(!isRecord(i.message))return;
    const isStaff=await staff(i);
    if(!ownerOf(i.message)&&!isStaff){info("live-v2-action-denied",{action:"manage"});return}
    const e=i.message.embeds[0];
    return api(path(i.message.id),"PATCH",{components:[{type:1,components:[{type:2,style:5,label:"Open TikTok",url:e.url},{type:2,style:2,label:"End LIVE",custom_id:"ln2:end"},{type:2,style:4,label:"Request SOS Alert",custom_id:"ln2:sos_request"},{type:2,style:2,label:"View History",custom_id:"ln2:history"}]}],allowed_mentions:QUIET})
   }
   if(action==="end"){
    if(!(await staff(i))&&!ownerOf(i.message)){info("live-v2-action-denied",{action});return}
    return setState(i.message,"ENDED",i.user.id)
   }
   if(action==="sos_request"){
    if(!isRecord(i.message)||(!ownerOf(i.message)&&!(await sosStaff(i)))){info("live-v2-action-denied",{action});return}
    if(state(i.message)!=="VERIFIED LIVE")return note(i.message,"SOS requests are available only while this broadcast is verified LIVE.");
    const e=i.message.embeds[0],old=fld(e,"SOS Status");
    if(/PENDING|SENT|APPROVED/i.test(old))return note(i.message,"An SOS request is already pending or has already been sent for this broadcast.");
    const fields=(e.fields||[]).filter(f=>f.name!=="SOS Status").concat([{name:"SOS Status",value:"🟡 PENDING STAFF APPROVAL"}]);
    return api(path(i.message.id),"PATCH",{embeds:[{...e,fields}],components:[{type:1,components:[{type:2,style:5,label:"Open TikTok",url:e.url},{type:2,style:1,label:"Approve SOS Alert",custom_id:"ln2:sos_approve"},{type:2,style:2,label:"Decline SOS",custom_id:"ln2:sos_decline"},{type:2,style:2,label:"View History",custom_id:"ln2:history"}]}],allowed_mentions:QUIET})
   }
   if(action==="sos_approve"){
    if(!(await sosStaff(i))||!isRecord(i.message)||state(i.message)!=="VERIFIED LIVE"||!okId(GENERAL)){info("live-v2-action-denied",{action});return}
    const id=String(i.message.id),link="https://discord.com/channels/"+G+"/"+C+"/"+id;
    if(sosInflight.has(id))return note(i.message,"SOS is already being processed for this stream");
    sosInflight.add(id);
    try{
     const fresh=await api(path(id)),e=fresh.embeds?.[0]||{},status=fld(e,"SOS Status");
     if(!isRecord(fresh)||state(fresh)!=="VERIFIED LIVE"||!status.includes("PENDING"))throw Error("SOS is no longer pending for a verified LIVE");
     const h=handle(e.url||""),live=await verifyTikTokLive(h);
     if(!String(fld(e,"LIVE Record")).includes(live.roomId))throw Error("The TikTok room changed; SOS was not sent");
     const prior=await api("/channels/"+GENERAL+"/messages?limit=100");
     if(prior.some(m=>(m.content||"").includes(link)))return note(i.message,"SOS already sent for this broadcast");
     await api("/channels/"+GENERAL+"/messages","POST",{content:"@everyone 🚨 **SOS · LIVE SUPPORT NEEDED**\n"+safe(e.title,160)+"\n"+link,nonce:"SOS-"+id,enforce_nonce:true,allowed_mentions:{parse:["everyone"]}});
     const fields=(e.fields||[]).filter(f=>!["SOS Status","SOS receipt"].includes(f.name)).concat([{name:"SOS Status",value:"✅ APPROVED AND SENT"},{name:"SOS receipt",value:"Sent by <@"+i.user.id+"> · "+ts(Date.now())}]);
     return api(path(id),"PATCH",{embeds:[{...e,fields}],components:[{type:1,components:[{type:2,style:5,label:"Open TikTok",url:e.url},{type:2,style:2,label:"Manage LIVE",custom_id:"ln2:manage"},{type:2,style:2,label:"View History",custom_id:"ln2:history"}]}],allowed_mentions:QUIET})
    }finally{sosInflight.delete(id)}
   }
   if(action==="sos_decline"){
    if(!(await sosStaff(i))||!isRecord(i.message)){info("live-v2-action-denied",{action});return}
    const e=i.message.embeds[0],status=fld(e,"SOS Status");
    if(!status.includes("PENDING"))return note(i.message,"There is no pending SOS request to decline.");
    const fields=(e.fields||[]).filter(f=>f.name!=="SOS Status").concat([{name:"SOS Status",value:"Declined by staff"}]);
    return api(path(i.message.id),"PATCH",{embeds:[{...e,fields}],components:[{type:1,components:[{type:2,style:5,label:"Open TikTok",url:e.url},{type:2,style:2,label:"Manage LIVE",custom_id:"ln2:manage"},{type:2,style:2,label:"View History",custom_id:"ln2:history"}]}],allowed_mentions:QUIET})
   }
   return
  }
  if(i.isUserSelectMenu()&&action==="battle_participant"){
   await i.deferUpdate();
   const pending=pendingSubmissions.get(String(i.message.id));
   if(!pending||pending.author!==i.user.id)return note(i.message,"This Box Battle step is not assigned to you or has expired.");
   const member=await i.guild.members.fetch(i.values[0]);
   if(member.user.bot)return note(i.message,"Bot accounts cannot be Box Battle participants.");
   try{return await publishPending(pending,i.message.id,member.displayName||member.user.username,member.id)}
   catch(error){pendingSubmissions.delete(String(i.message.id));return api(path(i.message.id),"PATCH",{content:"⚪ **LIVE not posted** · "+safe(error?.message||error,250),embeds:[],components:[],allowed_mentions:QUIET})}
  }
  if(i.isModalSubmit()&&action==="link:dashboard"){
   if(i.message)await i.deferUpdate();else await i.deferReply({ephemeral:false});
   const input=(i.fields.getTextInputValue("url")||"").trim();
   try{
    if(!isTikTokLiveCandidate(input))throw Error("Enter a valid TikTok LIVE link, not a profile or video link.");
    const h=await resolveHandle(input);if(!h)throw Error("TikTok LIVE link could not be resolved. Use a direct @handle/live link or supported TikTok short link.");
    const payload=dashboardPrompt(input,i.user.id);
    let posted;
    if(i.message)posted=await api(path(),"POST",payload);
    else posted=await i.editReply(payload);
    info("live-v2-dashboard-link-captured",{prompt:posted.id,author:i.user.id,creator:h});
    return
   }catch(error){
    const reason=safe(error?.message||error,220);
    if(i.message)return dashboardNotice("LIVE link not accepted: "+reason);
    return i.editReply("LIVE link not accepted: "+reason)
   }
  }
  if(i.isModalSubmit()&&action.startsWith("submit:")){
   const parts=action.split(":"),mode=parts[1],origin=parts[2]||"dashboard",sourceId=origin==="native"?parts[3]:null,promptId=origin==="native"?parts[4]:parts[3],authorId=origin==="native"?parts[5]:parts[4];
   if(!["yes","no"].includes(mode))throw Error("Invalid LIVE submission type");
   if(!okId(promptId)||!okId(authorId)||(origin==="native"&&!okId(sourceId)))throw Error("LIVE submission reference is invalid");
   if(!["native","dashboard"].includes(origin))throw Error("Unknown LIVE submission source");
   if(i.user.id!==authorId)throw Error("Only the member who started this LIVE submission can publish it.");
   if(i.message)await i.deferUpdate();else await i.deferReply({ephemeral:false});
   const desc=(i.fields.getTextInputValue("desc")||"").trim(),manual=(i.fields.fields.get("host_manual")?.value||"").trim(),selected=i.fields.getSelectedUsers("host_member")?.values().next().value||null;
   try{
    const prompt=await api(path(promptId));
    if(!prompt?.id||prompt.author?.id!==A||prompt.channel_id!==C)throw Error("The LIVE submission prompt is no longer available");
    const input=promptLink(prompt);
    if(!input)throw Error("The original TikTok LIVE link could not be verified");
    if(origin==="native"){
     if(!has(prompt,"ln2:native_yes:"+sourceId+":"+authorId)&&!has(prompt,"ln2:native_no:"+sourceId+":"+authorId))throw Error("The original member TikTok LIVE link could not be verified from this LIVE CENTER prompt");
    }else if(!has(prompt,"ln2:dashboard_yes:"+authorId)&&!has(prompt,"ln2:dashboard_no:"+authorId)){
     throw Error("The dashboard submission choice is no longer valid");
    }
    if(!desc)throw Error("LIVE description is required");
    if(!selected&&!manual)throw Error(mode==="yes"?"Select the Box Battle participant or enter their TikTok username manually":"Select the LIVE host or enter their TikTok username manually");
    let hostName=manual,hostUserId=null;
    if(selected){
     if(selected.bot)throw Error("Bot accounts cannot be promoted as LIVE hosts or Box Battle participants");
     const member=await i.guild.members.fetch(selected.id);
     if(member.user.bot)throw Error("Bot accounts cannot be promoted");
     hostName=member.displayName||member.user.username;hostUserId=member.id;
    }
    const h=await resolveHandle(input);
    if(!h)throw Error("TikTok LIVE URL could not be resolved; use a direct @handle/live link or a supported TikTok short link");
    const result=await submit(h,desc,i.user.id,i.id,mode==="yes"?"TikTok Box Battle":"",hostName,hostUserId,null);
    const recordUrl="https://discord.com/channels/"+G+"/"+C+"/"+result.id;
    await api(path(promptId),"PATCH",selectionStatus(input,authorId,"🟢 Creator Spotlight published. [Open the published LIVE card]("+recordUrl+")."));
    if(origin==="native")info("live-v2-native-submit-published",{source:sourceId,prompt:promptId,record:result.id});
    else info("live-v2-dashboard-submit-published",{prompt:promptId,record:result.id});
    await dashboardNotice("Creator Spotlight published successfully: "+recordUrl);
    if(!i.message)return i.editReply("Creator Spotlight published: "+recordUrl);
    return
   }catch(error){
    const reason=safe(error?.message||error,240),status="⚪ **LIVE not published** · "+reason+"\nThe original TikTok link and submission history are preserved.";
    await api(path(promptId),"PATCH",selectionStatus(input,authorId,status)).catch(()=>{});
    await dashboardNotice("POST LIVE held: "+reason+". No Creator Spotlight was published.");
    if(!i.message)return i.editReply("LIVE not published: "+reason);
    return
   }
  }
  if(i.isModalSubmit()&&action.startsWith("battle_manual_submit:")){
   const pendingMessageId=action.slice("battle_manual_submit:".length);
   if(!okId(pendingMessageId))throw Error("Invalid Box Battle request reference. Nothing was posted.");
   if(i.message)await i.deferUpdate();else await i.deferReply({ephemeral:false});
   const pending=pendingSubmissions.get(String(pendingMessageId)),support=(i.fields.getTextInputValue("support_manual")||"").trim();
   if(!pending||pending.author!==i.user.id){if(i.message)return dashboardNotice("This Box Battle step expired or is not assigned to you. Nothing was posted.");return i.editReply("This Box Battle step expired or is not assigned to you. Nothing was posted.");}
   if(!support){if(i.message)return note(i.message,"A Box Battle participant is required.");return i.editReply("A Box Battle participant is required. Nothing was posted.");}
   try{const result=await publishPending(pending,pendingMessageId,support,null);if(!i.message)return i.editReply("Box Battle LIVE published: https://discord.com/channels/"+G+"/"+C+"/"+result.id);return result}
   catch(error){pendingSubmissions.delete(String(pendingMessageId));const msg={content:"⚪ **LIVE not posted** · "+safe(error?.message||error,250),embeds:[],components:[],allowed_mentions:QUIET};await api(path(pendingMessageId),"PATCH",msg).catch(()=>{});if(!i.message)return i.editReply("LIVE not posted: "+safe(error?.message||error,220));return}
  }
 }catch(e){
  lastError=safe(e.message,160);info("live-v2-action-held",{action,reason:lastError});
  try{if(!i.deferred&&!i.replied)await i.deferUpdate();if(i.message)await note(i.message,lastError);else await dashboardNotice(lastError)}catch{}
 }
}
function promptLink(m){
 const texts=[];const walk=items=>{for(const item of items||[]){if(typeof item.content==="string")texts.push(item.content);walk(item.components)}};
 walk(m?.components);return texts.flatMap(candidateLinks).find(isTikTokLiveCandidate)||"";
}
function dashboardPrompt(link,authorId){
 return {flags:36864,content:null,embeds:[],components:[{type:17,accent_color:0x0755c9,components:[
  {type:10,content:"## 🔴 LIVE CENTER · SUBMISSION\n-# CREATOR SPOTLIGHT · STEP 02 OF 04"},
  {type:1,components:[{type:2,style:2,label:"Overview",custom_id:"ln2:page:dashboard"},{type:2,style:2,label:"Share LIVE",custom_id:"ln2:page:share"},{type:2,style:2,label:"Current LIVE",custom_id:"ln2:page:current"},{type:2,style:2,label:"History",custom_id:"ln2:page:history"},{type:2,style:2,label:"How It Works",custom_id:"ln2:page:guide"}]},
  {type:14,divider:true,spacing:1},
  {type:10,content:"**TikTok LIVE link**\n"+safe(link,250)},
  {type:10,content:"### Is this a Box Battle?\nChoose YES to promote one Box Battle participant, or NO to promote the regular LIVE host. The creator selector appears only after this choice."},
  {type:1,components:[
   {type:2,style:3,label:"🟢 NO · REGULAR LIVE",custom_id:"ln2:dashboard_no:"+authorId},
   {type:2,style:1,label:"✨ YES · BOX BATTLE",custom_id:"ln2:dashboard_yes:"+authorId}
  ]},
  {type:10,content:"-# ONE CREATOR ONLY · SERVER MEMBER SELECTOR OR MANUAL TIKTOK USERNAME · REQUIRED LIVE DESCRIPTION"}
 ]}],allowed_mentions:QUIET}
}
function selectionStatus(link,authorId,message){
 return {flags:36864,content:null,embeds:[],components:[{type:17,accent_color:0x0755c9,components:[
  {type:10,content:"## 🔴 LIVE CENTER · SUBMISSION\\n-# CREATOR SPOTLIGHT · STATUS"},
  {type:1,components:[{type:2,style:1,label:"POST LIVE NOW",custom_id:"ln2:post"}]},
  {type:1,components:[{type:2,style:2,label:"Overview",custom_id:"ln2:page:dashboard"},{type:2,style:2,label:"Share LIVE",custom_id:"ln2:page:share"},{type:2,style:2,label:"Current LIVE",custom_id:"ln2:page:current"},{type:2,style:2,label:"History",custom_id:"ln2:page:history"},{type:2,style:2,label:"How It Works",custom_id:"ln2:page:guide"}]},
  {type:14,divider:true,spacing:1},
  {type:10,content:"**TikTok LIVE link**\\n"+safe(link,250)},
  {type:10,content:"### "+safe(message,500)},
  {type:10,content:"-# LIVE CENTER DASHBOARD · SAME CONTROLS ON EVERY PAGE"}
 ]}],allowed_mentions:QUIET}
}
function nativePrompt(link,sourceId,authorId,notice=""){
 return {flags:36864,content:null,embeds:[],components:[{type:17,accent_color:0x0755c9,components:[
  {type:10,content:"## 🔴 LIVE CENTER · SUBMISSION\n-# CREATOR SPOTLIGHT · STEP 02 OF 04"},
  {type:1,components:[{type:2,style:2,label:"Overview",custom_id:"ln2:page:dashboard"},{type:2,style:2,label:"Share LIVE",custom_id:"ln2:page:share"},{type:2,style:2,label:"Current LIVE",custom_id:"ln2:page:current"},{type:2,style:2,label:"History",custom_id:"ln2:page:history"},{type:2,style:2,label:"How It Works",custom_id:"ln2:page:guide"}]},
  {type:14,divider:true,spacing:1},
  {type:10,content:"**TikTok LIVE link**\n"+safe(link,250)},
  {type:10,content:"### Is this a Box Battle?\nChoose YES to promote one Box Battle participant, or NO to promote the regular LIVE host. The creator selector appears only after this choice."},
  {type:1,components:[
   {type:2,style:3,label:"🟢 NO · REGULAR LIVE",custom_id:"ln2:native_no:"+sourceId+":"+authorId},
   {type:2,style:1,label:"✨ YES · BOX BATTLE",custom_id:"ln2:native_yes:"+sourceId+":"+authorId}
  ]},
  ...(notice?[{type:10,content:"### "+safe(notice,500)}]:[]),
  {type:10,content:"-# ONE CREATOR ONLY · SERVER MEMBER SELECTOR OR MANUAL TIKTOK USERNAME · REQUIRED LIVE DESCRIPTION"}
 ]}],allowed_mentions:QUIET}
}
function nativePrompt(link,sourceId,authorId,notice=""){
 return {flags:36864,content:null,embeds:[],components:[{type:17,accent_color:0x0755c9,components:[
  {type:10,content:"## 🔴 LIVE CENTER · SUBMISSION\\n-# CREATOR SPOTLIGHT · STEP 02 OF 04"},
  {type:1,components:[{type:2,style:2,label:"Overview",custom_id:"ln2:page:dashboard"},{type:2,style:2,label:"Share LIVE",custom_id:"ln2:page:share"},{type:2,style:2,label:"Current LIVE",custom_id:"ln2:page:current"},{type:2,style:2,label:"History",custom_id:"ln2:page:history"},{type:2,style:2,label:"How It Works",custom_id:"ln2:page:guide"}]},
  {type:14,divider:true,spacing:1},
  {type:10,content:"**TikTok LIVE link**\\n"+safe(link,250)},
  {type:10,content:"### Is this a Box Battle?\\nChoose YES to promote one Box Battle participant, or NO to promote the regular LIVE host. The creator selector appears only after this choice. The raw link message is removed after capture when Discord permissions allow it."},
  {type:1,components:[
   {type:2,style:3,label:"🟢 NO · REGULAR LIVE",custom_id:"ln2:native_no:"+sourceId+":"+authorId},
   {type:2,style:1,label:"✨ YES · BOX BATTLE",custom_id:"ln2:native_yes:"+sourceId+":"+authorId}
  ]},
  ...(notice?[{type:10,content:"### "+safe(notice,500)}]:[]),
  {type:10,content:"-# ONE CREATOR ONLY · SERVER MEMBER SELECTOR OR MANUAL TIKTOK USERNAME · REQUIRED LIVE DESCRIPTION"}
 ]}],allowed_mentions:QUIET}
}
async function newMessage(m){
 if(!ACTIVE||m.guildId!==G||m.channelId!==C||m.author.bot||!m.content)return;
 const link=candidateLinks(m.content).find(isTikTokLiveCandidate);
 if(!link)return;
 try{
  const prompt=await api(path(),"POST",{...nativePrompt(link,m.id,m.author.id),nonce:"LN"+m.id,enforce_nonce:true});
  info("live-v2-native-link-captured",{sourceMessage:m.id,promptMessage:prompt.id,author:m.author.id});
  try{await api(path(m.id),"DELETE");info("live-v2-native-raw-link-removed",{sourceMessage:m.id,promptMessage:prompt.id})}
  catch(error){lastError=safe(error?.message||error,160);info("live-v2-native-raw-link-removal-held",{sourceMessage:m.id,reason:lastError});await api(path(prompt.id),"PATCH",nativePrompt(link,m.id,m.author.id,"The original plain-link message could not be removed by the bot. A moderator must remove it." )).catch(()=>{})}
 }catch(error){lastError=safe(error?.message||error,160);info("live-v2-native-link-capture-held",{sourceMessage:m.id,reason:lastError})}
}
try{
 const link=linkModal().toJSON(),no=modal(false).toJSON(),yes=modal(true).toJSON(),linkLabels=link.components.filter(x=>x.type===18),labels=no.components.filter(x=>x.type===18),yesLabels=yes.components.filter(x=>x.type===18),field=(items,id)=>items.find(x=>x.component?.custom_id===id)?.component;
 const linkField=field(linkLabels,"url"),creatorField=field(labels,"host_member"),manualField=field(labels,"host_manual"),descriptionField=field(labels,"desc");
 const checks=[
  ["link_first_entry_modal",link.custom_id==="ln2:link:dashboard"&&linkLabels.length===1&&linkField?.required===true],
  ["exact_link_placeholder",linkField?.placeholder==="Insert TikTok LIVE Link Here"],
  ["server_member_dropdown",creatorField?.type===5],
  ["manual_tiktok_username_fallback",manualField?.type===4],
  ["mandatory_live_description",descriptionField?.required===true],
  ["creator_modal_excludes_link",!field(labels,"url")&&!field(yesLabels,"url")],
  ["three_creator_fields",labels.length===3&&yesLabels.length===3],
  ["box_battle_participant_label",yesLabels.some(x=>x.label==="01 — Box Battle participant · Discord member")],
  ["regular_live_host_label",labels.some(x=>x.label==="01 — LIVE host · Discord member")],
  ["mode_custom_ids",no.custom_id==="ln2:submit:no:dashboard"&&yes.custom_id==="ln2:submit:yes:dashboard"]
 ];
 console.log("[LIVE-V2] FORM SELFTEST "+JSON.stringify({passed:checks.every(x=>x[1]),checks}));
}catch(e){console.error("[LIVE-V2] FORM SELFTEST FAILED "+String(e.stack||e.message||e).slice(0,900))}


const urlChecks=[
 ["normal",handle("https://www.tiktok.com/@Sample_Creator/live")==="Sample_Creator"],
 ["mobile",handle("https://m.tiktok.com/@Example.01/live?lang=en")==="Example.01"],
 ["spoofed",handle("https://evil.example/?next=https://www.tiktok.com/@bad/live")===null],
 ["video",handle("https://www.tiktok.com/@someone/video/7777777777777777777")===null],
 ["nonTikTok",handle("https://example.org/@someone/live")===null],
 ["native_live_candidate",isTikTokLiveCandidate("https://www.tiktok.com/@Sample_Creator/live")],
 ["native_short_link_candidate",isTikTokLiveCandidate("https://vm.tiktok.com/ZSample/")],
 ["native_video_rejected",!isTikTokLiveCandidate("https://www.tiktok.com/@someone/video/7777777777777777777")],
 ["native_spoofed_rejected",!isTikTokLiveCandidate("https://evil.example/?next=https://www.tiktok.com/@bad/live")]
];
console.log("[LIVE-V2] URL SELFTEST "+JSON.stringify({passed:urlChecks.every(x=>x[1]),results:urlChecks}));
/* LIVE_V2_COMPONENT_SELFTEST_20261110 — pure checks; no Discord writes */
const componentAudit=(()=>{
 const main=panel(),history=panel(true,[{id:"1560000000000000000",author:{id:A},channel_id:C,embeds:[{title:"Ended LIVE",url:url("sample_creator"),fields:[{name:"LIVE Record",value:"@sample_creator"},{name:"LIVE Status",value:"⚫ ENDED"}]}]}]);
 const normal=card("sample_creator","Sample description",A,"",null,"Sample Creator",{roomId:"123456789012",startAt:Date.now(),actualStart:true,title:"Sample LIVE"},"Sample Host",A,null);
 const battle=card("sample_creator","Sample description",A,"TikTok Box Battle",null,"Sample Creator",{roomId:"123456789012",startAt:Date.now(),actualStart:true,title:"Sample LIVE"},"Sample Participant",A,null);
 const record={...normal,author:{id:A},channel_id:C},ids=buttons({components:main.components}).map(x=>x.custom_id),checks=[
  ["persistent_dashboard",(main.flags&32768)===32768],
  ["persistent_page_navigation",["ln2:page:dashboard","ln2:page:share","ln2:page:current","ln2:page:history","ln2:page:guide"].every(id=>ids.includes(id))],
  ["persistent_post_control_on_all_pages",["dashboard","share","current","history","guide"].every(v=>buttons({components:panel(v,[]).components}).some(x=>x.custom_id==="ln2:post"))],
  ["single_post_live_now_control",ids.includes("ln2:post")&&!ids.includes("ln2:post_yes")],
  ["approved_four_step_order",JSON.stringify(main).indexOf("01 · TikTok LIVE link")<JSON.stringify(main).indexOf("02 · Is this a Box Battle?")&&JSON.stringify(main).indexOf("02 · Is this a Box Battle?")<JSON.stringify(main).indexOf("03 · Creator to promote")&&JSON.stringify(main).indexOf("03 · Creator to promote")<JSON.stringify(main).indexOf("04 · LIVE description")],
  ["dashboard_controls_above_instructions",JSON.stringify(main).indexOf("POST LIVE NOW")<JSON.stringify(main).indexOf("START A SPOTLIGHT")],
  ["premium_dashboard_copy",JSON.stringify(main).includes("Your community. Your moment.")],
  ["no_review_language",!JSON.stringify(main).toLowerCase().includes("submit for review")],
  ["history_close",buttons({components:history.components}).some(x=>x.custom_id==="ln2:close")],
  ["historical_links",JSON.stringify(history).includes("/1560000000000000000")],
  ["verified_live_default",state(record)==="VERIFIED LIVE"],
  ["record_identity",isRecord(record)],
  ["host_attribution",fld(normal.embeds[0],"LIVE Host")==="<@"+A+">"&&fld(normal.embeds[0],"Shared by")==="<@"+A+">"],
  ["no_box_battle_badge_when_no",!fld(normal.embeds[0],"Box Battle")],
  ["box_battle_badge_when_yes",fld(battle.embeds[0],"Box Battle")==="TikTok elimination battle"],
  ["creator_spotlight_card_title",normal.embeds[0].title.includes("CREATOR SPOTLIGHT")],
  ["join_live_action",buttons({components:normal.components}).some(x=>x.label==="Join LIVE"&&x.url===url("sample_creator"))],
  ["separate_sos_action",buttons({components:normal.components}).some(x=>x.custom_id==="ln2:sos_request")],
  ["safe_mentions",main.allowed_mentions?.parse?.length===0&&normal.allowed_mentions?.parse?.length===0],
  ["creator_url_validation",handle("https://www.tiktok.com/@test_handle/live")==="test_handle"],
  ["native_link_prompt_yes_no",buttons({components:nativePrompt("https://www.tiktok.com/@test_handle/live","1560000000000000000","1560000000000000001").components}).some(x=>x.custom_id==="ln2:native_yes:1560000000000000000:1560000000000000001")&&buttons({components:nativePrompt("https://www.tiktok.com/@test_handle/live","1560000000000000000","1560000000000000001").components}).some(x=>x.custom_id==="ln2:native_no:1560000000000000000:1560000000000000001")],
  ["premium_choice_prompt",!!(dashboardPrompt("https://www.tiktok.com/@test_handle/live","1560000000000000001").flags&32768)&&dashboardPrompt("https://www.tiktok.com/@test_handle/live","1560000000000000001").components[0].type===17],
  ["choice_prompt_link_roundtrip",promptLink(dashboardPrompt("https://www.tiktok.com/@test_handle/live","1560000000000000001"))==="https://www.tiktok.com/@test_handle/live"],
  ["dashboard_link_prompt_yes_no",buttons({components:dashboardPrompt("https://www.tiktok.com/@test_handle/live","1560000000000000001").components}).some(x=>x.custom_id==="ln2:dashboard_yes:1560000000000000001")&&buttons({components:dashboardPrompt("https://www.tiktok.com/@test_handle/live","1560000000000000001").components}).some(x=>x.custom_id==="ln2:dashboard_no:1560000000000000001")],
  ["native_link_prompt_keeps_dashboard",["ln2:page:dashboard","ln2:page:share","ln2:page:current","ln2:page:history","ln2:page:guide"].every(id=>JSON.stringify(nativePrompt("https://www.tiktok.com/@test_handle/live","1560000000000000001",A)).includes(id))],
  ["native_link_prompt_uses_one_clean_card_flow",!JSON.stringify(nativePrompt("https://www.tiktok.com/@test_handle/live","1560000000000000001",A)).includes("original link stays in the channel")],
  ["native_link_prompt_notice_is_scoped",JSON.stringify(nativePrompt("https://www.tiktok.com/@test_handle/live","1560000000000000001",A,"submission received")).includes("submission received")],
  ["selection_status_keeps_dashboard",JSON.stringify(selectionStatus("https://www.tiktok.com/@test_handle/live",A,"Test")).includes("ln2:post")&&JSON.stringify(selectionStatus("https://www.tiktok.com/@test_handle/live",A,"Test")).includes("ln2:page:current")],
 ];
 return {passed:checks.every(x=>x[1]),checks};
})();
console.log("[LIVE-V2] COMPONENT SELFTEST "+JSON.stringify(componentAudit));


const service=Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||8080),fetch(req){const route=new URL(req.url).pathname;if(route==="/ready")return Response.json({gateway,panelReady:!PUBLISH||!!panelId},{status:gateway&&(!PUBLISH||!!panelId)?200:503});if(route==="/health")return Response.json({version:VER,mode:ACTIVE?"active":"shadow",guild:G,channel:C,bot:A,gateway,lastError,lastEvent,panelId,online:true});if(route==="/preflight")return verify().then(d=>Response.json(d,{status:d.ready?200:503})).catch(e=>Response.json({ready:false,error:safe(e.message,180)},{status:503}));return new Response("not found",{status:404})}});
info("live-v2-started",{port:service.port,mode:ACTIVE?"active":"shadow"});
if(ACTIVE){
  const verified=await verify();
  if(!verified.ready)throw Error("LIVE V2 identity preflight failed");
  async function connect(withContent){
    const intents=[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages];
    if(withContent)intents.push(GatewayIntentBits.MessageContent);
    const client=new Client({intents,allowedMentions:{parse:[]}});
    let lastGatewayCode=null;
    client.on(Events.InteractionCreate,i=>void interaction(i));
    client.on(Events.MessageCreate,m=>void newMessage(m));
    client.on(Events.ShardDisconnect,e=>{lastGatewayCode=e.code;gateway=false;console.warn("[LIVE-V2] Gateway disconnected code="+e.code)});
    client.on(Events.Error,e=>{lastError=safe(e.message,150);console.error("[LIVE-V2] Gateway error "+lastError)});
    client.once(Events.ClientReady,()=>{
      gateway=true;
      console.log("[LIVE-V2] READY guild="+G+" bot="+client.user.id+" contentIntent="+withContent);
      if(PUBLISH)void publishPanel().then(id=>{console.log("[LIVE-V2] PANEL VERIFIED id="+id);void passiveAudit()}).catch(e=>console.error("[LIVE-V2] PANEL HELD "+safe(e.message,140)));
      void expireUnverified();setInterval(()=>void expireUnverified(),300000).unref?.();void refreshObservedDurations();setInterval(()=>void refreshObservedDurations(),60000).unref?.();setInterval(()=>void passiveAudit(),1800000).unref?.();
    });
    try{await client.login(TOKEN)}catch(e){
      await client.destroy().catch(()=>{});
      if(withContent&&(lastGatewayCode===4014||/disallowed intent/i.test(String(e.message)))){
        console.warn("[LIVE-V2] Message-content intent unavailable; forms remain available");
        return connect(false);
      }
      throw e;
    }
  }
  await connect(true);
}else info("live-v2-shadow",{writes:false});

if(!ACTIVE){void verify().then(x=>console.log('[LIVE-V2 PREFLIGHT] ready='+x.ready+' botMatches='+x.botMatches+' channelMatches='+x.channelMatches+' name='+x.channelName)).catch(e=>console.error('[LIVE-V2 PREFLIGHT ERROR] '+safe(e.message,160)));}
