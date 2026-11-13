// UMM_FANCLUB_ALL_ROOT_ATTACHMENTS_V4 — retain every root source attachment across checkpoint, success, and recovery edits.
// UMM_FANCLUB_FAILED_STAGE_NONDELETE_V3 — retained failed uploads and archive evidence, never silently delete source.
// UMM_FANCLUB_NATIVE_MEDIA_INLINE_V2 — retained media galleries use attachment:// filenames, not signed CDN links.
// UMM_FANCLUB_STAGING_PRESERVE_V1 — preserve original media attachments and staging chain until independently vaulted.

import { Client, GatewayIntentBits, Events, PermissionFlagsBits, MessageFlags, AttachmentBuilder } from "discord.js@14.27.0";
import sharp from "sharp@0.34.5";
import { createHash } from "node:crypto";
import { zipSync, unzipSync } from "fflate@0.8.2";
import ffmpegPath from "ffmpeg-static@5.3.0";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const TOKEN = Bun.env.DISCORD_BOT_TOKEN || "";
const GUILD = Bun.env.AUTHORIZED_GUILD_ID || "";
const MGMT = Bun.env.FANCLUB_MANAGEMENT_CHANNEL_ID || "";
const DEST = Bun.env.FANCLUB_LEVELUPS_CHANNEL_ID || "";
const OWNER = Bun.env.FANCLUB_OWNER_NAME || "Creator";
const STAFF = (Bun.env.FANCLUB_STAFF_ROLE_IDS || "").split(",").filter(Boolean);
const client = new Client({intents:[GatewayIntentBits.Guilds]});
const view = s => ({type:10,content:s});
const button = (id,label,style=2) => ({type:2,custom_id:id,label,style});
const row = components => ({type:1,components});
const box = nodes => [{type:17,accent_color:0x5865f2,components:nodes}];
const setting = {flags:MessageFlags.IsComponentsV2|MessageFlags.SuppressNotifications,allowedMentions:{parse:[]}};
const managementReply = {...setting,flags:MessageFlags.IsComponentsV2|MessageFlags.SuppressNotifications};
const encode = (staff,kind,ident) => staff+":"+kind+":"+ident;
const decode = raw => {const x=raw.split(":");return x.length===3 && /^\d{16,21}$/.test(x[0]) && ["u","h"].includes(x[1]) && /^[\w.]{2,32}$/.test(x[2]) ? {staff:x[0],kind:x[1],ident:x[2]} : null;};
const member = (kind,id) => kind==="u" ? "<@"+id+">" : "@"+id;

const STYLE_OPTIONS=[
 {label:"Classic Celebration",value:"classic",description:"Warm, straightforward congratulations"},
 {label:"Energetic Celebration",value:"energetic",description:"Exciting, festive recognition"},
 {label:"Heartfelt Tribute",value:"heartfelt",description:"Personal and appreciative"},
 {label:"Premium Milestone",value:"premium",description:"Ceremonial milestone recognition"}
];
const TIER=level=>level===50?["Level 50 Celebration","🏆"]:level>=45?["Exceptional Milestone","💎"]:level>=40?["Elite Milestone","👑"]:level>=35?["Outstanding Dedication","🌟"]:level>=30?["Major Milestone","🎖️"]:level>=20?["Dedicated Supporter","🔥"]:level>=10?["Growing Supporter","✨"]:["Fan Club Milestone","🎉"];
function announcement(kind,id,level,style="classic"){
 const [title,emoji]=TIER(level),who=member(kind,id);
 const actual={30:"A major milestone worth celebrating! Your dedication and continued support deserve special recognition.",35:"Level 35 is an outstanding achievement. Your continued loyalty and support are truly appreciated!",40:"Level 40 is an elite Fan Club achievement. Your remarkable dedication deserves the spotlight!",45:"Level 45 is an exceptional milestone! Your continued dedication has brought you so close to Level 50.",50:"LEVEL 50! An extraordinary TikTok Fan Club achievement. Today we celebrate your remarkable journey and the dedication that brought you here!"};
 const detail=actual[level]||(level>=46?"Another exceptional step toward Level 50 — your Fan Club journey keeps shining!":level>=41?"An incredible elite-level accomplishment — congratulations!":level>=36?"Your support continues to make a difference. Thank you!":level>=31?"Another milestone in your remarkable Fan Club journey!":level>=20?"Your dedication is growing stronger every day!":level>=10?"We appreciate your continued participation and support!":"Thank you for joining this Fan Club journey!");
 const rank="**TikTok Fan Club Level "+level+"** in **"+OWNER+"'s Fan Club**";
 let main,ending;
 if(style==="energetic"){main="🎊🎉 BIG NEWS! "+who+" just reached "+rank+"!\n\n"+detail;ending="🔥 Let's celebrate this milestone together!";}
 else if(style==="heartfelt"){main="❤️ A heartfelt congratulations to "+who+" for reaching "+rank+".\n\n"+detail;ending="Your continued support means so much. Thank you! ❤️";}
 else if(style==="premium"){main=emoji+" **Special Recognition** "+emoji+"\n\nPlease join us in recognizing "+who+" for reaching "+rank+".\n\n"+detail;ending=level===50?"🏆 **Level 50 — a truly extraordinary achievement!**":"✨ Your commitment deserves special appreciation.";}
 else{main="🎉 Congratulations to "+who+" for reaching "+rank+"!\n\n"+detail;ending="Thank you for your continued support and dedication! ❤️";}
 return emoji+" **TikTok Fan Club Milestone · "+title+"**\n## 🆙 Congratulations!\n\n"+main+"\n\n"+ending;
}
function stylePanel(actor,kind,id,level){
 return box([
  row([{type:3,custom_id:"fclub:style:"+encode(actor,kind,id)+":"+level,placeholder:"Select celebration style",min_values:1,max_values:1,options:STYLE_OPTIONS}]),
  row([button("fclub:cancel:"+encode(actor,kind,id),"Cancel")]),
  view("## 🎨 Choose Celebration Style\n**Member:** "+member(kind,id)+"\n**Milestone:** TikTok Fan Club Level "+level+" · "+TIER(level)[0])
 ]);
}

function dashboard(){
 return box([
   row([{type:5,custom_id:"fclub:member",placeholder:"Select Discord Member",min_values:1,max_values:1}]),
   row([button("fclub:manual","Enter TikTok Handle",1),button("fclub:instructions","How It Works")]),
   view("## 🆙 TikTok Fan Club Level-Up Management\n-# Moderator tools · "+OWNER+"'s TikTok Fan Club\n\n**1.** Select a Discord member above, or enter their TikTok handle manually.\n**2.** Choose the level range (1–25 or 26–50), then the exact level.\n**3.** Choose a celebration style (Classic, Energetic, Heartfelt or Premium).\n**4.** Upload up to 10 original photos/videos in any mix. No automatic compression or video transcoding.\n**5.** Preview and publish the verified milestone.\n\nPublishes only to <#"+DEST+">. This does **not** award Discord XP, roles, or TikTok Fan Club levels. Confirm the member's level on TikTok before posting.")
 ]);
}
function rangePanel(actor,kind,id){
 const prefix="fclub:range:"+encode(actor,kind,id);
 return box([
  row([{type:3,custom_id:prefix,placeholder:"Choose Fan Club level range",min_values:1,max_values:1,options:[{label:"Levels 1–25",value:"1"},{label:"Levels 26–50",value:"26"}]}]),
  row([button("fclub:cancel:"+encode(actor,kind,id),"Cancel")]),
  view("## 🆙 Select TikTok Fan Club Level\n**Member:** "+member(kind,id)+"\n**Creator:** "+OWNER+"\n\nChoose the level range first. This is TikTok Fan Club recognition, not Discord XP.")
 ]);
}
function levelPanel(actor,kind,id,base){
 const options=Array.from({length:25},(_,i)=>{const n=base+i;return {label:"Level "+n,value:String(n),description:"TikTok Fan Club Level "+n};});
 return box([
  row([{type:3,custom_id:"fclub:level:"+encode(actor,kind,id),placeholder:"Select exact level ("+base+"–"+(base+24)+")",min_values:1,max_values:1,options}]),
  row([button("fclub:cancel:"+encode(actor,kind,id),"Cancel")]),
  view("## 🆙 Choose Exact Level\n**Member:** "+member(kind,id)+"\n**Range:** "+base+"–"+(base+24)+"\n\nSelect the verified TikTok Fan Club level.")
 ]);
}


function previewPanel(actor,kind,id,level,style="classic",media=[],notice="",tail="0"){
 const photos=media.filter(x=>mediaKind(x.name)==="image").length;
 const videos=media.filter(x=>mediaKind(x.name)==="video").length;
 const audios=media.filter(x=>mediaKind(x.name)==="audio").length;
 const lines="**Media:** "+photos+" photo"+(photos===1?"":"s")+" · "+videos+" video"+(videos===1?"":"s")+" · "+audios+" audio · "+media.length+"/10 original files.\n";
 const status=notice?"\n⚠️ "+notice+"\n":"";
 const suffix=encode(actor,kind,id)+":"+level+":"+style+":"+(tail||"0");
 const add=button("fclub:photo:"+suffix,"Add Photos / Videos / Audio",1);
 if(media.length>=MEDIA_MAX)add.disabled=true;
 const nodes=[
  row([button("fclub:publish:"+suffix,"Publish Milestone",3),add,button("fclub:remove:"+suffix,"Clear Media",2),button("fclub:cancel:"+encode(actor,kind,id),"Cancel",4)]),
  view("## 🔎 Preview · Not Published\n\n"+announcement(kind,id,level,style)+"\n\n"+lines+"Staff-only drafts retain unchanged original files. Unsupported images can receive PNG playback copies, compatible videos can be remuxed to MP4 with no re-encoding, and audio can receive a separate playable MP4 cover-video (AAC playback encoding is lossy). Original media stays unchanged. All previews are subject to Discord size limits."+status+"\n-# Verify the TikTok milestone first; this never changes Discord XP."),
  ...renderMedia(media,true)
 ];
 return packContainers(nodes);
}
const permitted=i=>i.guildId===GUILD && (i.guild?.ownerId===i.user.id || i.memberPermissions?.has(PermissionFlagsBits.Administrator) || (Array.isArray(i.member?.roles)?i.member.roles.some(r=>STAFF.includes(r)):i.member?.roles?.cache?.some(r=>STAFF.includes(r.id))));
async function respondError(i,msg){
 if(i.replied||i.deferred) return i.followUp({content:msg,flags:MessageFlags.SuppressNotifications,allowedMentions:{parse:[]}});
 return i.reply({content:msg,flags:MessageFlags.SuppressNotifications,allowedMentions:{parse:[]}});
}
async function ensureDashboard(){
 const c=await client.channels.fetch(MGMT);
 if(!c||!c.isTextBased()||!c.messages) throw new Error("Management channel unavailable");
 const latest=await c.messages.fetch({limit:50});
 const found=latest.find(m=>m.author.id===client.user.id && m.components?.some(z=>JSON.stringify(z.toJSON?z.toJSON():z).includes("fclub:member")));
 if(found){
  const components=found.components.map(c=>typeof c.toJSON==="function"?c.toJSON():c);
  let migrated=false;
  for(const group of components)for(const item of group.components||[]){
   if(item.type===10&&typeof item.content==="string"&&item.content.includes("**4.** Optionally upload an image that displays inline.")){
    item.content=item.content.replace("**4.** Optionally upload an image that displays inline.","**4.** Upload up to 10 original photos/videos in any mix. No automatic compression or video transcoding.");
    migrated=true;
   }
  }
  for(const group of components)for(const item of group.components||[]){
   if(item.type===10&&typeof item.content==="string"&&item.content.includes("**4.** Upload up to 10 original photos/videos in any mix.")){
    item.content=item.content.replace("**4.** Upload up to 10 original photos/videos in any mix. No automatic compression or video transcoding.","**4.** Add up to 10 original photos, videos and audio clips. Originals stay unchanged; supported formats display inline. For incompatible formats, the bot creates an extra inline preview when possible. Audio's MP4 playback copy uses AAC encoding; the original audio remains lossless.");
    migrated=true;
   }
  }
  if(migrated){
   await found.edit({...setting,components});
   console.log("FANCLUB_DASHBOARD_MEDIA_GUIDANCE_MIGRATED_ONCE "+found.id);
  }else console.log("FANCLUB_DASHBOARD_PRESENT "+found.id+" (no format enforcement)");
  return;
 }
 console.warn("FANCLUB_DASHBOARD_MISSING_MANUAL_REVIEW_REQUIRED (no automatic recreation)");
}



const active=new Set(),uploading=new Set();
const MEDIA_MAX=10;
const MiB=1024*1024;
const MAX_BATCH_BYTES=24*MiB;
const BOT_FILE_LIMIT=Number(Bun.env.FANCLUB_BOT_UPLOAD_LIMIT_BYTES)||20*MiB;
const STAGE_NOTE="🗂️ Milestone draft original media · Staff only · Not published";
const STAGE_ARCHIVE_NOTE="🔒 Milestone draft verified original archive · Staff only · Not published";
const STAGE_ARCHIVE_RE=/^fc-stage-preserved-([a-f0-9]{64})\.zip$/i;
const PHOTO_EXT=new Set(["jpg","jpeg","jfif","png","gif","webp","avif","heic","heif","tif","tiff","bmp"]);
const VIDEO_EXT=new Set(["mp4","mov","qt","webm","m4v","mkv","avi","wmv","3gp","mpeg","mpg","mts","m2ts","ogv"]);
const AUDIO_EXT=new Set(["mp3","wav","wave","flac","ogg","opus","m4a","aac","aiff","aif","wma","amr","caf"]);
const INLINE_EXT=new Set(["jpg","jpeg","png","gif","webp","avif","mp4","webm","mov"]);
const NEW_FILE=/^fc-original-([a-f0-9]{64})\.([a-z0-9]{2,8})$/i;
const OLD_FILE=/^fanclub-photo\.(?:jpg|jpeg|png|gif|webp)$/i;
const extension=name=>String(name||"").toLowerCase().split(".").pop();
function mediaKind(name){
 const e=extension(name);
 return PHOTO_EXT.has(e)?"image":VIDEO_EXT.has(e)?"video":AUDIO_EXT.has(e)?"audio":null;
}
function listStageArchives(message){return [...(message?.attachments?.values?.()||[])].filter(a=>STAGE_ARCHIVE_RE.test(a.name||""));}
function listMedia(message){
 return [...(message?.attachments?.values?.()||[])].filter(a=>NEW_FILE.test(a.name||"")||OLD_FILE.test(a.name||""));
}
function packContainers(nodes){
 const blocks=[];
 for(let i=0;i<nodes.length;i+=8)blocks.push({type:17,accent_color:0x5865f2,components:nodes.slice(i,i+8)});
 return blocks;
}
function renderMedia(media,remote=false,priority=[]){
 const photos=media.filter(a=>mediaKind(a.name)==="image"&&INLINE_EXT.has(extension(a.name)));
 const candidates=media.filter(a=>mediaKind(a.name)==="video"&&INLINE_EXT.has(extension(a.name)));
 const copies=candidates.filter(a=>String(a.name).startsWith("fc-inline-"));
 const mediaHash=f=>String(f?.name||f||"").match(/^fc-(?:inline|original)-([a-f0-9]{64})\./i)?.[1]||null;
 const previewed=new Set(copies.map(mediaHash).filter(Boolean));
 const videos=candidates.filter(f=>String(f.name||"").startsWith("fc-inline-")||!previewed.has(mediaHash(f)));
 if(priority.length){
  const position=f=>priority.findIndex(n=>mediaHash(n)&&mediaHash(n)===mediaHash(f));
  videos.sort((a,b)=>{const x=position(a),y=position(b);return (x<0?999:x)-(y<0?999:y);});
 }
 const shown=new Set([...photos,...videos]);
 const other=media.filter(a=>!shown.has(a));
 const nodes=[];
 for(const file of videos)nodes.push({type:12,items:[{media:{url:file.url||"attachment://"+file.name},description:"Playable full-width video · "+(file.description||"Discord-compatible playback")} ]});
 if(photos.length)nodes.push({type:12,items:photos.map(a=>({media:{url:a.url||"attachment://"+a.name},description:"Original photo · "+(a.description||"Unmodified upload")}))});
 for(const file of other){
  if(remote)nodes.push(view("📎 **Original "+(mediaKind(file.name)||"media")+" retained:** "+String(file.description||file.name).slice(0,140)+"\n-# Unmodified original; compatible video playback is displayed in its own panel when published."));
  else nodes.push({type:13,file:{url:"attachment://"+file.name}});
 }
 return nodes;
}
function effectiveLimit(interaction){
 const memberLimit=Number(interaction.attachmentSizeLimit)||20*MiB;
 const guildLimit=Number(interaction.guild?.maximumUploadLimit)||20*MiB;
 return Math.min(memberLimit,guildLimit,BOT_FILE_LIMIT,MAX_BATCH_BYTES);
}
function safeDeclaredSize(file){
 const n=Number(file?.size);
 return Number.isFinite(n)&&n>0?n:MAX_BATCH_BYTES;
}
function groupBySize(files){
 const result=[];let batch=[],size=0;
 for(const f of files){
  const n=safeDeclaredSize(f);
  if(n>MAX_BATCH_BYTES)throw Error("FILE_EXCEEDS_DISCORD_MESSAGE_LIMIT");
  if(batch.length&&(size+n>MAX_BATCH_BYTES||batch.length>=10)){
   result.push(batch);batch=[];size=0;
  }
  batch.push(f);size+=n;
 }
 if(batch.length)result.push(batch);
 return result;
}
// FANCLUB_COMPACT_MEDIA_PUBLISHER_V3: native videos share batches; legacy formats retain safe fallback.
function groupByVideoPriority(files){
 const videos=files.filter(f=>mediaKind(f.name)==="video");
 if(!videos.length)return groupBySize(files);
 const others=files.filter(f=>mediaKind(f.name)!=="video");
 const ordered=[videos[0],...others,...videos.slice(1)];
 const result=[];let batch=[],size=0,containsVideo=false,containsNonNativeVideo=false;
 for(const f of ordered){
  const n=safeDeclaredSize(f),isVideo=mediaKind(f.name)==="video";
  const nonNativeVideo=isVideo&&!INLINE_EXT.has(extension(f.name));
  if(n>MAX_BATCH_BYTES)throw Error("FILE_EXCEEDS_DISCORD_MESSAGE_LIMIT");
  if(batch.length&&(size+n>MAX_BATCH_BYTES||batch.length>=10||(isVideo&&containsVideo&&(nonNativeVideo||containsNonNativeVideo)))){
   result.push(batch);batch=[];size=0;containsVideo=false;containsNonNativeVideo=false;
  }
  batch.push(f);size+=n;
  if(isVideo){containsVideo=true;if(nonNativeVideo)containsNonNativeVideo=true;}
 }
 if(batch.length)result.push(batch);
 return result;
}
async function originalBytes(file,limit){
 if(!file?.url)throw Error("MEDIA_MISSING");
 if(file.size!==undefined&&(!Number.isFinite(Number(file.size))||Number(file.size)<1||Number(file.size)>limit))throw Error("MEDIA_EXCEEDS_DISCORD_LIMIT");
 const url=new URL(file.url);
 if(url.protocol!=="https:"||!["cdn.discordapp.com","cdn.discord.com","media.discordapp.net"].includes(url.hostname))throw Error("MEDIA_NOT_DISCORD_CDN");
 const res=await fetch(url.toString(),{signal:AbortSignal.timeout(45000),redirect:"error"});
 if(!res.ok)throw Error("MEDIA_DOWNLOAD_"+res.status);
 const stated=Number(res.headers.get("content-length")||0);
 if(stated>limit)throw Error("MEDIA_EXCEEDS_DISCORD_LIMIT");
 if(!res.body)throw Error("MEDIA_RESPONSE_MISSING");
 const reader=res.body.getReader(),chunks=[];
 let total=0;
 try{
  while(true){
   const part=await reader.read();
   if(part.done)break;
   total+=part.value.byteLength;
   if(total>limit)throw Error("MEDIA_STREAM_EXCEEDS_DISCORD_LIMIT");
   chunks.push(Buffer.from(part.value));
  }
 }catch(e){await reader.cancel().catch(()=>{});throw e;}
 if(total===0)throw Error("MEDIA_EMPTY");
 const buf=Buffer.concat(chunks,total);
 if(file.size!==undefined&&Number(file.size)!==total)throw Error("MEDIA_BYTE_COUNT_MISMATCH");
 return buf;
}
function validVideoBytes(raw,name){
 const e=extension(name);
 const iso=raw.length>=12&&(raw.toString("ascii",4,8)==="ftyp"||raw.toString("ascii",4,8)==="moov"||raw.toString("ascii",4,8)==="mdat");
 const ebml=raw.length>4&&raw[0]===0x1a&&raw[1]===0x45&&raw[2]===0xdf&&raw[3]===0xa3;
 const riff=raw.length>=12&&raw.toString("ascii",0,4)==="RIFF"&&raw.toString("ascii",8,12)==="AVI ";
 const asf=raw.length>=16&&raw.subarray(0,16).equals(Buffer.from([0x30,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11,0xa6,0xd9,0x00,0xaa,0x00,0x62,0xce,0x6c]));
 const mpeg=raw.length>=4&&raw[0]===0&&raw[1]===0&&raw[2]===1&&(raw[3]===0xba||raw[3]===0xb3);
 const ts=raw.length>=389&&((raw[0]===0x47&&raw[188]===0x47&&raw[376]===0x47)||(raw[4]===0x47&&raw[196]===0x47&&raw[388]===0x47));
 const ogg=raw.length>=4&&raw.toString("ascii",0,4)==="OggS";
 if(["mp4","mov","qt","m4v","3gp"].includes(e))return iso;
 if(["webm","mkv"].includes(e))return ebml;
 if(e==="avi")return riff;
 if(e==="wmv")return asf;
 if(["mpeg","mpg"].includes(e))return mpeg;
 if(["mts","m2ts"].includes(e))return ts;
 if(e==="ogv")return ogg;
 return false;
}

function validAudioBytes(raw,name){
 const e=extension(name);
 const starts=x=>raw.toString("ascii",0,x.length)===x;
 const mp3=starts("ID3")||(raw.length>3&&raw[0]===255&&(raw[1]&0xe0)===0xe0&&(raw[1]&0x18)!==0x08);
 const wave=starts("RIFF")&&raw.toString("ascii",8,12)==="WAVE";
 const aiff=starts("FORM")&&["AIFF","AIFC"].includes(raw.toString("ascii",8,12));
 const mp4=raw.length>12&&raw.toString("ascii",4,8)==="ftyp";
 const asf=raw.length>16&&raw.subarray(0,16).equals(Buffer.from([0x30,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11,0xa6,0xd9,0x00,0xaa,0x00,0x62,0xce,0x6c]));
 if(e==="mp3")return mp3;
 if(["wav","wave"].includes(e))return wave;
 if(e==="flac")return starts("fLaC");
 if(["ogg","opus"].includes(e))return starts("OggS");
 if(e==="m4a")return mp4;
 if(e==="aac")return raw.length>7&&raw[0]===255&&(raw[1]&0xf6)===0xf0;
 if(["aif","aiff"].includes(e))return aiff;
 if(e==="wma")return asf;
 if(e==="amr")return starts("#!AMR");
 if(e==="caf")return starts("caff");
 return false;
}
function needsInlineCopy(file){
 const kind=mediaKind(file.filename);
 return kind==="audio"||((kind==="image"||kind==="video")&&!INLINE_EXT.has(extension(file.filename)));
}

async function videoCodecSummary(raw,ext){
 if(!ffmpegPath)throw Error("CODEC_PROBE_UNAVAILABLE");
 const dir=await mkdtemp(join(tmpdir(),"fanclub-codec-"));
 const input=join(dir,"source."+ext);
 let proc=null,timer=null;
 try{
  await writeFile(input,raw);
  proc=Bun.spawn([ffmpegPath,"-nostdin","-hide_banner","-i",input],{stdout:"ignore",stderr:"pipe"});
  timer=setTimeout(()=>proc.kill(),18000);
  const info=String(await new Response(proc.stderr).text()).slice(0,16000);
  await proc.exited;
  const video=info.match(/Stream #[^\r\n]*?Video:\s*([a-zA-Z0-9_]+)/i)?.[1]?.toLowerCase()||null;
  const audio=info.match(/Stream #[^\r\n]*?Audio:\s*([a-zA-Z0-9_]+)/i)?.[1]?.toLowerCase()||null;
  if(!video)throw Error("CODEC_PROBE_NO_VIDEO");
  return {video,audio};
 }finally{
  if(timer)clearTimeout(timer);
  if(proc&&proc.exitCode===null)proc.kill();
  await rm(dir,{recursive:true,force:true}).catch(()=>{});
 }
}
function copySafeForDiscord(codecs){
 return codecs.video==="h264" && (!codecs.audio||codecs.audio==="aac");
}
function webmSafeForDiscord(codecs){
 return ["vp8","vp9","av1"].includes(codecs.video)&&(!codecs.audio||["opus","vorbis"].includes(codecs.audio));
}
async function shouldBuildPreview(file){
 const kind=mediaKind(file.filename);
 if(kind==="audio")return true;
 if(kind==="image")return !INLINE_EXT.has(extension(file.filename));
 if(kind!=="video")return false;
 const ext=extension(file.filename);
 if(!INLINE_EXT.has(ext))return true;
 const codecs=await videoCodecSummary(file.bytes,ext);
 if(ext==="webm")return !webmSafeForDiscord(codecs);
 return !copySafeForDiscord(codecs);
}

async function ffmpegTo(raw,ext,outputExt,makeArgs,limit,art){
 if(!ffmpegPath)throw Error("INLINE_CONVERTER_UNAVAILABLE");
 const dir=await mkdtemp(join(tmpdir(),"fanclub-preview-"));
 const input=join(dir,"source."+ext),output=join(dir,"preview."+outputExt),cover=join(dir,"cover.png");
 let proc=null,timer=null;
 try{
  await writeFile(input,raw);
  if(art)await writeFile(cover,art);
  proc=Bun.spawn([ffmpegPath,"-nostdin","-y","-hide_banner","-loglevel","error",...makeArgs(input,output,cover)],{stdout:"ignore",stderr:"pipe"});
  timer=setTimeout(()=>proc.kill(),60000);
  const status=await proc.exited;
  clearTimeout(timer);timer=null;
  const err=String(await new Response(proc.stderr).text()).slice(0,250);
  if(status!==0)throw Error("FFMPEG_FAILED_"+status+"_"+err);
  const bytes=await readFile(output);
  if(!bytes.length||bytes.length>limit)throw Error("INLINE_COPY_TOO_LARGE");
  return bytes;
 }finally{
  if(timer)clearTimeout(timer);
  if(proc&&proc.exitCode===null)proc.kill();
  await rm(dir,{recursive:true,force:true}).catch(()=>{});
 }
}
async function makeInlineCopy(file,limit,policyAlreadyChecked=false){
 if(!policyAlreadyChecked && !(await shouldBuildPreview(file)))return null;
 const kind=mediaKind(file.filename),ext=extension(file.filename);
 let bytes,type,label;
 if(kind==="image"){
  const info=await sharp(file.bytes,{animated:false,limitInputPixels:200000000}).metadata();
  if((info.pages||1)>1)throw Error("MULTIFRAME_IMAGE_NO_LOSSLESS_SINGLE_INLINE_FILE");
  bytes=await sharp(file.bytes,{limitInputPixels:200000000}).png({palette:false,compressionLevel:9}).toBuffer();
  type="png";label="PNG inline image display copy · original source preserved byte-for-byte; color profile and metadata may differ";
 }else if(kind==="video"){
  const codecs=await videoCodecSummary(file.bytes,ext);
  if(copySafeForDiscord(codecs)){
   try{
    bytes=await ffmpegTo(file.bytes,ext,"mp4",(src,dst)=>["-i",src,"-map","0:v:0","-map","0:a:0?","-c","copy","-movflags","+faststart",dst],limit);
    label="Inline MP4 H.264/AAC · streams remuxed without re-encoding; original preserved";
   }catch(e){
    console.warn("FANCLUB_COPY_FAILED source="+file.filename+" "+String(e.message||e).slice(0,140));
   }
  }
  if(!bytes&&codecs.video==="h264"&&codecs.audio&&codecs.audio!=="aac"){
   try{
    bytes=await ffmpegTo(file.bytes,ext,"mp4",(src,dst)=>["-i",src,"-map","0:v:0","-map","0:a:0?","-c:v","copy","-c:a","aac","-b:a","160k","-movflags","+faststart",dst],limit);
    label="Inline MP4 · video stream copied losslessly, audio playback encoded AAC; original retained";
   }catch(e){console.warn("FANCLUB_VIDEO_STREAM_COPY_FAILED "+String(e.message||e).slice(0,160));}
  }
  if(!bytes){
   bytes=await ffmpegTo(file.bytes,ext,"mp4",(src,dst)=>["-i",src,"-map","0:v:0","-map","0:a:0?","-vf","scale=w='min(1280,iw)':h=-2","-c:v","libx264","-preset","veryfast","-crf","27","-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-movflags","+faststart",dst],limit);
   label="Inline MP4 H.264/AAC compatible playback · lossy preview, byte-identical original retained";
   console.log("FANCLUB_COMPATIBILITY_TRANSCODE codec="+codecs.video+" audio="+(codecs.audio||"none"));
  }
  type="mp4";
 }else if(kind==="audio"){
  const bars=Array.from({length:28},(_,n)=>{const h=Math.round(15+55*Math.abs(Math.sin(n*0.61)*Math.cos(n*0.27)));return '<rect x="'+(90+n*16)+'" y="'+(280-h/2)+'" width="9" height="'+h+'" rx="4" fill="#7FDEDF"/>';}).join("");
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#17263D"/><circle cx="320" cy="108" r="48" fill="#38566D"/><path d="M298 84v49a15 15 0 1 1 -12 -14V93l44 -10v48a15 15 0 1 1 -12 -14V84z" fill="white"/><rect x="214" y="193" width="212" height="7" rx="4" fill="#7FDEDF"/>'+bars+'</svg>';
  const art=await sharp(Buffer.from(svg)).png().toBuffer();
  bytes=await ffmpegTo(file.bytes,ext,"mp4",(src,dst,cover)=>["-loop","1","-framerate","1","-i",cover,"-i",src,"-map","0:v:0","-map","1:a:0","-c:v","libx264","-preset","ultrafast","-tune","stillimage","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",dst],limit,art);
  type="mp4";label="Inline audio in MP4 player · AAC playback copy is lossy; original audio is kept byte-identical";
 }else return null;
 if(!bytes.length||bytes.length>limit)throw Error("INLINE_COPY_EXCEEDS_DISCORD_LIMIT");
 const filename="fc-inline-"+file.digest+"."+type;
 return {bytes,filename,kind,digest:createHash("sha256").update(bytes).digest("hex"),description:label,label};
}

async function originalUpload(file,limit){
 const name=String(file?.name||"");
 const kind=mediaKind(name);
 if(!kind)throw Error("UNSUPPORTED_MEDIA_FORMAT_"+extension(name));
 const raw=await originalBytes(file,limit);
 if(kind==="image"){
  const m=await sharp(raw,{limitInputPixels:200000000,failOn:"error",page:0}).metadata().catch(()=>null);
  if(!m||!m.width||!m.height||m.width*m.height>200000000)throw Error("INVALID_IMAGE_CONTENT");
 }else if(kind==="video"&&!validVideoBytes(raw,name))throw Error("INVALID_VIDEO_CONTAINER");
 else if(kind==="audio"&&!validAudioBytes(raw,name))throw Error("INVALID_AUDIO_CONTAINER");
 const digest=createHash("sha256").update(raw).digest("hex");
 const originalName=name.replace(/[<>\r\n]/g,"").slice(0,110);
 return {bytes:raw,filename:"fc-original-"+digest+"."+extension(name),description:"Original: "+originalName+" (unmodified)",kind,digest,size:raw.length};
}
function validateMediaEntries(media){
 if(media.length>MEDIA_MAX)throw Error("MORE_THAN_TEN_MEDIA_FILES");
 const known=new Set();
 for(const f of media){
  const sig=f.name.match(NEW_FILE)?.[1]||f.name;
  if(known.has(sig))throw Error("DUPLICATE_MEDIA");
  known.add(sig);
 }
}
function draftTail(message){
 const parts=message?.components?.map(c=>typeof c.toJSON==="function"?c.toJSON():c)||[];
 for(const container of parts)for(const node of container.components||[]){
  if(node.type!==1)continue;
  for(const button of node.components||[]){
   if(!String(button.custom_id||"").startsWith("fclub:photo:"))continue;
   return button.custom_id.split(":")[7]||"0";
  }
 }
 return "0";
}
function draftMediaCount(message){
 const data=JSON.stringify(message?.components?.map(c=>typeof c.toJSON==="function"?c.toJSON():c)||[]);
 const match=data.match(/(\d+)\/10 original files/);
 return match?Number(match[1]):listMedia(message).length;
}

function draftMatches(message,actor,kind,id,level,style,tail){
 const required="fclub:publish:"+encode(actor,kind,id)+":"+level+":"+style+":"+(tail||"0");
 const parts=message?.components?.map(c=>typeof c.toJSON==="function"?c.toJSON():c)||[];
 return parts.some(container=>(container.components||[]).some(node=>node.type===1&&(node.components||[]).some(button=>button.custom_id===required)));
}
function previousMainId(root){
 const parts=JSON.stringify(root?.components?.map(c=>typeof c.toJSON==="function"?c.toJSON():c)||[]);
 const found=parts.match(/https:\/\/discord\.com\/channels\/(\d{16,21})\/(\d{16,21})\/(\d{16,21})/);
 return found&&found[1]===GUILD&&found[2]===DEST?found[3]:null;
}


function verifiedStageMessage(m,botId){
 return m?.author?.id===botId&&m?.channelId===MGMT&&((m.content===STAGE_NOTE&&listMedia(m).length===1)||(m.content===STAGE_ARCHIVE_NOTE&&listStageArchives(m).length===1));
}
async function stagedChainFor(root,tail,channel){
 if(!tail||tail==="0")return [];
 const chain=[],seen=new Set();
 let cursor=tail;
 while(cursor!==root.id){
  if(!/^\d{16,21}$/.test(cursor)||seen.has(cursor)||chain.length>=MEDIA_MAX*2)throw Error("STAGED_CLEANUP_CHAIN_INVALID");
  seen.add(cursor);
  const msg=await channel.messages.fetch(cursor);
  if(!verifiedStageMessage(msg,client.user?.id))throw Error("STAGED_CLEANUP_OWNERSHIP_INVALID");
  chain.push(msg);
  cursor=msg.reference?.messageId||"";
 }
 return chain;
}
async function discardStagedChain(chain){
 // Never delete a milestone's source-media staging chain without a separate immutable-vault receipt.
 console.log("FANCLUB_STAGED_ORIGINALS_RETAINED count="+chain.length+" reason=independent_vault_attestation_pending");
 return 0;
}

async function collectDraftMedia(root,tail,channel){
 const originals=listMedia(root);
 if(tail&&tail!=="0"){
  if(!/^\d{16,21}$/.test(tail))throw Error("INVALID_DRAFT_TAIL");
  const chain=[],archiveFor=new Map(),seen=new Set();
  let cursor=tail;
  while(cursor!==root.id){
   if(!/^\d{16,21}$/.test(cursor)||seen.has(cursor)||seen.size>=MEDIA_MAX*2)throw Error("BROKEN_DRAFT_MEDIA_CHAIN");
   seen.add(cursor);
   const msg=await channel.messages.fetch(cursor);
   if(msg.author?.id!==client.user?.id||msg.channelId!==MGMT)throw Error("DRAFT_MEDIA_OWNERSHIP_FAILURE");
   if(msg.content===STAGE_ARCHIVE_NOTE){
    const archives=listStageArchives(msg);
    if(archives.length!==1||!msg.reference?.messageId)throw Error("DRAFT_ARCHIVE_LINK_INVALID");
    if(archiveFor.has(msg.reference.messageId))throw Error("DRAFT_ARCHIVE_DUPLICATED");
    archiveFor.set(msg.reference.messageId,archives[0]);
   }else if(msg.content===STAGE_NOTE){
    const media=listMedia(msg);
    if(media.length!==1)throw Error("DRAFT_STAGE_NOT_SINGLE_FILE");
    chain.push({messageId:msg.id,media:media[0]});
   }else throw Error("DRAFT_UNRECOGNIZED_STAGE_MESSAGE");
   cursor=msg.reference?.messageId||"";
  }
  if([...archiveFor.keys()].some(id=>!chain.some(m=>m.messageId===id)))throw Error("DRAFT_ARCHIVE_NOT_LINKED_TO_ORIGINAL");
  originals.push(...chain.reverse().map(entry=>{
   const file=entry.media,archive=archiveFor.get(entry.messageId);
   return archive?{name:file.name,url:file.url,size:file.size,description:file.description,archive}:file;
  }));
 }
 validateMediaEntries(originals);
 return originals;
}
async function restoredDraftBytes(file,limit){
 if(!file.archive)return originalBytes(file,limit);
 const packed=await originalBytes(file.archive,limit);
 const members=unzipSync(new Uint8Array(packed));
 const value=members[file.name];
 if(!value)throw Error("ORIGINAL_MISSING_FROM_DRAFT_ARCHIVE");
 const bytes=Buffer.from(value);
 if(bytes.length>limit)throw Error("RESTORED_SOURCE_TOO_LARGE");
 const expected=file.name.match(NEW_FILE)?.[1];
 if(expected&&createHash("sha256").update(bytes).digest("hex")!==expected)throw Error("RESTORED_SOURCE_SHA256_MISMATCH");
 return bytes;
}
function v2FileAttachments(message){
 const components=message?.components?.map(c=>typeof c.toJSON==="function"?c.toJSON():c)||[];
 const files=[];
 for(const group of components){
  for(const child of group.components||[]){
   if(child.type===12){
    for(const item of child.items||[]){
     const media=item.media;
     if(!media?.url||!media?.attachment_id)continue;
     try{
      const url=new URL(media.url);
      const name=decodeURIComponent(url.pathname.split("/").pop()||"");
      if(["cdn.discordapp.com","cdn.discord.com"].includes(url.hostname)&&name)files.push({name,url:media.url});
     }catch{}
    }
   }
   if(child.type===13&&child.file?.url&&child.name){
    try{
     const url=new URL(child.file.url);
     const urlName=decodeURIComponent(url.pathname.split("/").pop()||"");
     if(["cdn.discordapp.com","cdn.discord.com"].includes(url.hostname)&&urlName===child.name)files.push({name:child.name,url:child.file.url,size:child.size});
    }catch{}
   }
  }
 }
 return files;
}
function publishedFiles(message){
 const traditional=[...(message?.attachments?.values?.()||[])].map(a=>({name:a.name,url:a.url,size:a.size}));
 const embedded=v2FileAttachments(message);
 const byName=new Map([...traditional,...embedded].map(a=>[a.name,a]));
 return [...byName.values()];
}

async function verifyPublished(posted,expected,limit){
 const fresh=await posted.channel.messages.fetch({message:posted.id,force:true});
 const available=publishedFiles(fresh);
 for(const e of expected){
  const f=available.find(a=>a.name===e.filename);
  if(!f)throw Error("PUBLISHED_FILE_MISSING");
  const bytes=await originalBytes(f,limit);
  if(createHash("sha256").update(bytes).digest("hex")!==e.digest)throw Error("PUBLISHED_FILE_HASH_MISMATCH");
 }
}
function mp4EssenceSha(bytes){
 let offset=0,found=false;
 const sha=createHash("sha256");
 while(offset+8<=bytes.length){
  const type=bytes.toString("ascii",offset+4,offset+8);
  let len=bytes.readUInt32BE(offset),head=8;
  if(len===1&&offset+16<=bytes.length){len=Number(bytes.readBigUInt64BE(offset+8));head=16;}
  if(len===0)len=bytes.length-offset;
  if(!Number.isSafeInteger(len)||len<head||len+offset>bytes.length)throw Error("INVALID_MP4_BOX");
  if(type==="mdat"){sha.update(bytes.subarray(offset+head,offset+len));found=true;}
  offset+=len;
 }
 if(!found||offset!==bytes.length)throw Error("MP4_ESSENCE_MISSING");
 return sha.digest("hex");
}
async function verifyInlinePlayback(posted,preview,limit){
 const fresh=await posted.channel.messages.fetch({message:posted.id,force:true});
 const found=publishedFiles(fresh).find(a=>a.name===preview.filename);
 if(!found)throw Error("INLINE_MEDIA_COMPONENT_MISSING");
 const bytes=await originalBytes(found,limit);
 if(createHash("sha256").update(bytes).digest("hex")===preview.digest)return;
 if(extension(preview.filename)==="mp4"&&mp4EssenceSha(bytes)===mp4EssenceSha(preview.bytes)){
  console.log("FANCLUB_INLINE_MP4_ESSENCE_VERIFIED_METADATA_NORMALIZED");
  return;
 }
 throw Error("INLINE_PREVIEW_PAYLOAD_CHANGED");
}
async function preserveOriginalArchive(main,original,destination,key,limit){
 const zipName="fc-preserved-"+original.digest+".zip";
 const packed=Buffer.from(zipSync({[original.filename]:new Uint8Array(original.bytes)},{level:0}));
 if(packed.length>limit)throw Error("ORIGINAL_ZIP_EXCEEDS_UPLOAD_LIMIT");
 const recent=await destination.messages.fetch({limit:100}).catch(()=>null);
 let m=recent?.find(x=>x.author.id===client.user.id&&x.reference?.messageId===main.id&&publishedFiles(x).some(a=>a.name===zipName));
 if(!m)m=await destination.send({
  ...setting,
  components:packContainers([view("🔐 **Lossless original preserved**\nExact original bytes and metadata are inside this verified archive. Inline playback appears above.\n-# "+String(original.description||"Original media").slice(0,120)),{type:13,file:{url:"attachment://"+zipName}}]),
  files:[new AttachmentBuilder(packed,{name:zipName})],
  reply:{messageReference:main.id,failIfNotExists:true},
  nonce:nonceFor(key,"zip-"+original.digest),enforceNonce:true,
  allowedMentions:{parse:[],repliedUser:false}
 });
 const file=publishedFiles(await destination.messages.fetch({message:m.id,force:true})).find(a=>a.name===zipName);
 if(!file)throw Error("SOURCE_ZIP_NOT_RENDERED");
 const downloaded=await originalBytes(file,limit);
 if(!downloaded.equals(packed))throw Error("SOURCE_ZIP_HASH_MISMATCH");
 const restored=unzipSync(new Uint8Array(downloaded))[original.filename];
 if(!restored||createHash("sha256").update(restored).digest("hex")!==original.digest)throw Error("SOURCE_ZIP_CONTENT_SHA_MISMATCH");
 console.log("FANCLUB_EXACT_SOURCE_VERIFIED_BY_ZIP name="+original.filename);
}
function nonceFor(rootId,part){
 return createHash("sha256").update(GUILD+":"+rootId+":"+part).digest("hex").slice(0,24);
}
async function universalMemberSelection(i){
 if(!i.inGuild()||i.guildId!==GUILD||!permitted(i)){await respondError(i,"Staff access is required.");return;}
 const allowedChannel=Bun.env.MEMBER_LIFECYCLE_STAFF_CHANNEL_ID||"1568170088241168464";
 if(i.channelId!==allowedChannel){await respondError(i,"This selector is restricted to Member Management.");return;}
 const manualSubmit=i.isModalSubmit()&&i.customId==="ums:manual:submit";
 let dashboard=i.message;
 if(manualSubmit){
  const channel=await client.channels.fetch(allowedChannel);
  if(!channel?.isTextBased())throw Error("Member Management channel unavailable");
  dashboard=await channel.messages.fetch("1568173108555419720");
 }
 if(!dashboard||dashboard.author?.id!==client.user.id){await respondError(i,"Member Management dashboard not found.");return;}
 const flags=Number(dashboard.flags?.bitfield??dashboard.flags??0);
 const currentComponents=dashboard.components.map(x=>x.toJSON());
 const container=currentComponents.find(x=>x.type===17);
 const componentV2=!!(flags&32768)&&!!container&&Array.isArray(container.components);
 const title=componentV2
  ?(container.components||[]).some(x=>x.type===10&&String(x.content||"").includes("Member Administration"))
  :(dashboard.embeds?.[0]?.title||"").includes("Member Administration");
 if(!title){await respondError(i,"Member Management dashboard not found.");return;}
 if(i.isButton()&&i.customId==="ums:manual"){
  await i.showModal({title:"Enter TikTok Handle",custom_id:"ums:manual:submit",components:[{type:1,components:[{type:4,custom_id:"handle",label:"TikTok Handle",style:1,required:true,min_length:2,max_length:32,placeholder:"username (without @)"}]}]});
  return;
 }
 if(!componentV2&&!dashboard.embeds?.length){await respondError(i,"Member Management dashboard layout is not supported.");return;}
 let info="";
 if(i.isUserSelectMenu()&&i.customId==="ums:member"){
  const id=String(i.values?.[0]||"");
  if(!/^\d{17,20}$/.test(id)){await respondError(i,"Invalid Discord member ID.");return;}
  const found=await i.guild.members.fetch(id).catch(()=>null);
  if(!found||found.user.bot){await respondError(i,"This account is not an active human member of this server.");return;}
  info="**"+String(found.displayName).slice(0,70).replace(/@/g,"＠")+"** · <@"+id+">\nDiscord ID: "+id+"\nStatus: Active member · TikTok handle not automatically linked";
 }else if(i.isStringSelectMenu()&&String(i.customId||"").startsWith("ums:former:")){
  const id=String(i.values?.[0]||"");
  const flatten=(items,out=[])=>{for(const item of items||[]){out.push(item);if(Array.isArray(item.components))flatten(item.components,out);}};
  const flat=flatten(currentComponents,[]);
  const foundOption=flat.filter(c=>c.type===3&&c.custom_id===i.customId).flatMap(c=>c.options||[]).find(opt=>String(opt.value)===id);
  if(!/^\d{17,20}$/.test(id)||!foundOption){await respondError(i,"That historical entry is not present in this dashboard.");return;}
  const stillHere=await i.guild.members.fetch(id).catch(()=>null);
  if(stillHere){info="**"+String(stillHere.displayName).slice(0,70).replace(/@/g,"＠")+"** · <@"+id+">\nStatus: Active again; previous record retained";}
  else info="**"+String(foundOption.label||"Historical member").slice(0,70).replace(/@/g,"＠")+"** · Discord ID: "+id+"\nHistorical record · "+String(foundOption.description||"Departure reason unverified").slice(0,100)+"\nNo claim about voluntary departure or deactivation";
 }else if(manualSubmit){
  const handle=String(i.fields.getTextInputValue("handle")||"").trim().replace(/^@/,"");
  if(!/^[A-Za-z0-9._]{2,24}$/.test(handle)){await respondError(i,"Enter a valid TikTok handle (2–24 letters, numbers, underscores, or periods).");return;}
  info="**@"+handle+"**\nExternal TikTok handle · Not verified or automatically linked to a Discord account";
 }else return;
 if(componentV2){
  const next=JSON.parse(JSON.stringify(currentComponents));
  const box=next.find(x=>x.type===17);
  box.components=box.components.filter(x=>!(x.type===10&&String(x.content||"").startsWith("**Selected identity**")));
  const selected={type:10,content:"**Selected identity**\n"+info.slice(0,950)};
  const actionIndex=box.components.findIndex(x=>x.type===1);
  box.components.splice(actionIndex<0?box.components.length:actionIndex,0,selected);
  const payload={content:"",embeds:[],flags:32768,components:next,allowedMentions:{parse:[]}};
  if(manualSubmit){
   await i.deferReply({flags:MessageFlags.SuppressNotifications});
   await dashboard.edit(payload);
   await i.editReply({content:"Member Management dashboard updated. The TikTok handle is recorded as external and is not automatically linked to a Discord account."});
  }else{
   await i.update(payload);
  }
  return;
 }
 const original=dashboard.embeds[0].toJSON();
 original.fields=(original.fields||[]).filter(x=>x.name!=="Selected identity");
 original.fields.push({name:"Selected identity",value:info.slice(0,1000),inline:false});
 await i.update({embeds:[original],components:dashboard.components.map(x=>x.toJSON()),allowedMentions:{parse:[]}});
}

async function universalPublicProfile(i){
 if(!i.inGuild()||i.guildId!==GUILD||i.channelId!=="1565643954811052057"||i.message?.id!=="1566063315191595019"||!i.isUserSelectMenu()||i.customId!=="uniprof:member")return;
 if(i.message.author?.id!==client.user.id)throw Error("Public profile hub ownership check failed");
 await i.deferUpdate();
 const uid=String(i.values?.[0]||"");
 if(!/^\d{17,20}$/.test(uid)){await respondError(i,"Invalid member selection.");return;}
 const member=await i.guild.members.fetch(uid).catch(()=>null);
 if(!member||member.user.bot){await respondError(i,"Select an active server member.");return;}
 const ch=await client.channels.fetch("1565643954811052057");
 if(!ch?.isTextBased())throw Error("Public profile channel unavailable");
 let matched=null,before=undefined;
 for(let page=0;page<6&&!matched;page++){
  const batch=await ch.messages.fetch({limit:100,...(before?{before}:{})});
  for(const m of batch.values()){
   if(m.author?.id!==client.user.id||m.id===i.message.id)continue;
   const structure=JSON.stringify(m.components.map(x=>x.toJSON()));
   const marker="mp26:edit:"+uid;
   if(structure.includes(marker)||structure.includes("mompass:card:"+uid+":")){matched=m;break;}
  }
  if(batch.size<100)break;
  before=batch.lastKey();
 }
 const nickname=String(member.displayName||member.user.username).replace(/[@<>]/g,"").slice(0,70);
 const result="### Member Lookup Result\n**"+nickname+"** · <@"+uid+">\n"+(matched?"[View Public Member Card](https://discord.com/channels/"+GUILD+"/1565643954811052057/"+matched.id+")":"No member-approved public profile has been published.")+"\n-# Public information only · No private profile fields";
 const components=i.message.components.map(x=>x.toJSON());
 const container=components.find(x=>x.type===17);
 if(!container)throw Error("Public member hub layout changed; no edit made");
 container.components=container.components.filter(x=>!(x.type===10&&String(x.content||"").startsWith("### Member Lookup Result")));
 container.components.push({type:10,content:result});
 await i.editReply({components,allowedMentions:{parse:[]}});
}


client.on(Events.InteractionCreate,async i=>{
 try{
  if(!i.isMessageComponent()&&!i.isModalSubmit()) return;
  if(i.customId==="uniprof:member"){await universalPublicProfile(i);return;}
  if(i.customId.startsWith("ums:")){await universalMemberSelection(i);return;}
  if(!i.customId.startsWith("fclub:")) return;
  if(!i.inGuild()||i.guildId!==GUILD||!permitted(i)){await respondError(i,"Only authorized moderators and administrators may use this tool.");return;}
  if(i.channelId!==MGMT){await respondError(i,"This management tool can only be used in Server Tools.");return;}
  if(i.isUserSelectMenu()&&i.customId==="fclub:member"){
   const userId=i.values[0];
   if(!/^\d{17,20}$/.test(String(userId||""))){await respondError(i,"Invalid Discord member selection.");return;}
   const selectedMember=await i.guild.members.fetch(userId).catch(()=>null);
   if(!selectedMember){await respondError(i,"That account is no longer a member of this Discord server. Use Enter TikTok Handle for external accounts.");return;}
   await i.reply({...managementReply,components:rangePanel(i.user.id,"u",userId)});
   return;
  }
  if(i.isButton()&&i.customId==="fclub:manual"){
   await i.showModal({title:"TikTok Fan Club Member",custom_id:"fclub:modal",components:[{type:1,components:[{type:4,custom_id:"handle",label:"Member's TikTok handle",style:1,placeholder:"example_handle (without @)",min_length:2,max_length:32,required:true}]}]});
   return;
  }
  if(i.isModalSubmit()&&i.customId==="fclub:modal"){
   let handle=i.fields.getTextInputValue("handle").trim().replace(/^@/,"");
   if(!/^[a-zA-Z0-9._]{2,24}$/.test(handle)){await respondError(i,"Enter a valid TikTok username (letters, numbers, underscores or periods, up to 24 characters).");return;}
   await i.reply({...managementReply,components:rangePanel(i.user.id,"h",handle)});
   return;
  }
  if(i.isButton()&&i.customId==="fclub:instructions"){
   await i.reply({flags:MessageFlags.SuppressNotifications,content:"Select an existing Discord member or enter a TikTok handle. Select level range 1–25 / 26–50, select the exact level and a writing style, add up to ten original photos, videos or audio files, preview, then publish. Confirm the Fan Club milestone directly on TikTok. Announcements do not change Discord XP.",allowedMentions:{parse:[]}});
   return;
  }
  const pieces=i.customId.split(":");
  const action=pieces[1];
  const target=decode(pieces.slice(2,5).join(":"));
  if(!target || target.staff!==i.user.id){await respondError(i,"This draft belongs to a different moderator. Start from the management dashboard to make your own.");return;}
  if(i.isButton()&&action==="cancel"){
   if(active.has(i.message.id)||uploading.has(i.message.id)){await respondError(i,"This draft is being processed. Cancel after the operation finishes.");return;}
   if(previousMainId(i.message)){await respondError(i,"This milestone has already begun publishing. Review the existing announcement instead of canceling an active publication.");return;}
   await i.deferUpdate();
   const channel=await client.channels.fetch(MGMT);
   const root=await channel.messages.fetch(i.message.id);
   if(previousMainId(root))throw Error("CANCEL_AFTER_PUBLISH_NOT_ALLOWED");
   const staged=await stagedChainFor(root,draftTail(root),channel);
   await root.edit({...setting,attachments:[],components:box([view("✅ Draft canceled. No announcement was posted. Uploaded draft originals are being cleared.")])});
   await discardStagedChain(staged);
   return;
  }
  if(i.isStringSelectMenu()&&action==="range"){
   const base=Number(i.values[0]);
   if(base!==1&&base!==26) throw new Error("Invalid range");
   await i.update({...setting,components:levelPanel(target.staff,target.kind,target.ident,base)});
   return;
  }
  if(i.isStringSelectMenu()&&action==="level"){
   const level=Number(i.values[0]);
   if(!Number.isInteger(level)||level<1||level>50) throw new Error("Invalid level");
   await i.update({...setting,components:stylePanel(target.staff,target.kind,target.ident,level)});
   return;
  }

  if(i.isStringSelectMenu()&&action==="style"){
   const level=Number(pieces[5]),style=i.values[0];
   if(!Number.isInteger(level)||level<1||level>50||!STYLE_OPTIONS.some(x=>x.value===style))throw Error("Invalid style selection");
   await i.update({...managementReply,components:previewPanel(target.staff,target.kind,target.ident,level,style)});
   return;
  }


  if(i.isButton()&&action==="remove"){
   const level=Number(pieces[5]),style=pieces[6];
   if(!Number.isInteger(level)||level<1||level>50||!STYLE_OPTIONS.some(x=>x.value===style))throw Error("LEVEL_OR_STYLE_INVALID");
   if(active.has(i.message.id)||uploading.has(i.message.id)){await respondError(i,"This draft is being processed; try again after it finishes.");return;}
   if(previousMainId(i.message)){await respondError(i,"Publishing has begun. Review the existing announcement rather than clearing its source files.");return;}
   await i.deferUpdate();
   const channel=await client.channels.fetch(MGMT);
   const root=await channel.messages.fetch(i.message.id);
   if(!draftMatches(root,target.staff,target.kind,target.ident,level,style,draftTail(root)))throw Error("STALE_MEDIA_CLEAR_REQUEST");
   if(previousMainId(root))throw Error("MEDIA_CLEAR_AFTER_PUBLISH_NOT_ALLOWED");
   const staged=await stagedChainFor(root,draftTail(root),channel);
   await root.edit({...managementReply,attachments:[],components:previewPanel(target.staff,target.kind,target.ident,level,style,[],"Existing draft media cleared. You can add new media.")});
   await discardStagedChain(staged);
   return;
  }
  if(i.isButton()&&action==="photo"){
   const level=Number(pieces[5]),style=pieces[6],tail=pieces[7]||"0";
   if(!Number.isInteger(level)||level<1||level>50||!STYLE_OPTIONS.some(x=>x.value===style))throw Error("LEVEL_OR_STYLE_INVALID");
   if(active.has(i.message.id)||uploading.has(i.message.id)){await respondError(i,"This draft is processing another upload.");return;}
   const count=draftMediaCount(i.message);
   if(count>=MEDIA_MAX){await respondError(i,"This celebration has ten originals. Use Publish or Clear Media.");return;}
   await i.showModal({
    custom_id:"fclub:upload:"+encode(target.staff,target.kind,target.ident)+":"+level+":"+style+":"+tail,
    title:"Add Photos, Videos and Audio",
    components:[{type:18,label:"Add up to "+(MEDIA_MAX-count)+" media files",description:"Original photos, videos and audio; upload size limits apply.",component:{type:19,custom_id:"media",min_values:1,max_values:MEDIA_MAX-count,required:true}}]
   });
   return;
  }
  if(i.isModalSubmit()&&action==="upload"){
   const level=Number(pieces[5]),style=pieces[6],expectedTail=pieces[7]||"0";
   if(!Number.isInteger(level)||level<1||level>50||!STYLE_OPTIONS.some(x=>x.value===style))throw Error("LEVEL_OR_STYLE_INVALID");
   if(!i.isFromMessage())throw Error("MEDIA_DRAFT_MESSAGE_MISSING");
   const rootId=i.message.id;
   if(uploading.has(rootId)||active.has(rootId)){await respondError(i,"Another operation is running for this draft.");return;}
   uploading.add(rootId);
   try{
    await i.deferUpdate();
    const channel=await client.channels.fetch(MGMT);
    if(!channel?.messages||!channel.isTextBased())throw Error("MANAGEMENT_CHANNEL_UNAVAILABLE");
    const root=await channel.messages.fetch(rootId);
    const actualTail=draftTail(root);
    if(actualTail!==expectedTail||!draftMatches(root,target.staff,target.kind,target.ident,level,style,expectedTail))throw Error("DRAFT_CHANGED_REOPEN_UPLOAD");
    let media=await collectDraftMedia(root,actualTail,channel);
    const incoming=[...i.fields.getUploadedFiles("media",true).values()];
    if(!incoming.length||media.length+incoming.length>MEDIA_MAX)throw Error("MEDIA_COUNT_LIMIT");
    const limit=effectiveLimit(i);
    let nextTail=actualTail,added=0,skipped=0;
    try{
     const seen=new Set(media.map(a=>a.name.match(NEW_FILE)?.[1]).filter(Boolean));
     for(const file of incoming){
      const converted=await originalUpload(file,Math.max(1,limit-4096));
      if(seen.has(converted.digest)){skipped++;continue;}
      const stored=await channel.send({
       content:STAGE_NOTE,
       files:[new AttachmentBuilder(converted.bytes,{name:converted.filename,description:converted.description})],
       reply:{messageReference:nextTail==="0"?rootId:nextTail,failIfNotExists:true},
       flags:MessageFlags.SuppressNotifications,
       allowedMentions:{parse:[],repliedUser:false}
      });
      const proof=stored.attachments.find(a=>a.name===converted.filename);
      let archive=null,tailAfter=stored.id;
      try{
       if(!proof)throw Error("STAGED_FILE_MISSING");
       const stagedBytes=await originalBytes(proof,limit);
       if(createHash("sha256").update(stagedBytes).digest("hex")!==converted.digest){
        const packed=Buffer.from(zipSync({[converted.filename]:new Uint8Array(converted.bytes)},{level:0}));
        if(packed.length>limit)throw Error("ARCHIVED_DRAFT_EXCEEDS_UPLOAD_LIMIT");
        const archiveName="fc-stage-preserved-"+converted.digest+".zip";
        const archiveMsg=await channel.send({
         content:STAGE_ARCHIVE_NOTE,
         files:[new AttachmentBuilder(packed,{name:archiveName})],
         reply:{messageReference:stored.id,failIfNotExists:true},
         flags:MessageFlags.SuppressNotifications,
         allowedMentions:{parse:[],repliedUser:false}
        });
        tailAfter=archiveMsg.id;
        archive=archiveMsg.attachments.find(a=>a.name===archiveName);
        if(!archive)throw Error("STAGED_ARCHIVE_NOT_ATTACHED");
        const confirmed=await originalBytes(archive,limit);
        if(!confirmed.equals(packed)||!Buffer.from(unzipSync(new Uint8Array(confirmed))[converted.filename]||[]).equals(converted.bytes))throw Error("STAGED_ARCHIVE_SHA_MISMATCH");
        tailAfter=archiveMsg.id;
        console.log("FANCLUB_DRAFT_ORIGINAL_ARCHIVED_SHA_VERIFIED file="+converted.filename);
       }
      }catch(e){
       console.warn("FANCLUB_UNVERIFIED_DRAFT_PRESERVED source="+stored.id+" archive="+(tailAfter===stored.id?"none":tailAfter)+" reason="+String(e.message||e).slice(0,150)+" sourceDeleted=false");
       throw e;
      }
      nextTail=tailAfter;
      media.push(archive?{name:proof.name,url:proof.url,size:proof.size,description:proof.description,archive}:proof);
      seen.add(converted.digest);
      added++;
     }
     validateMediaEntries(media);
     await root.edit({...managementReply,attachments:[...(root.attachments?.values?.()||[])].map(a=>({id:a.id})),components:previewPanel(target.staff,target.kind,target.ident,level,style,media,(skipped?"Exact duplicate originals skipped: "+skipped+".":"")+" Stored "+added+" verified original file(s).",nextTail)});
     console.log("FANCLUB_DRAFT_MEDIA_STAGED count="+added+" duplicates="+skipped+" total="+media.length);
    }catch(uploadError){
     console.error("FANCLUB_MEDIA_STAGE_ERROR "+String(uploadError.stack||uploadError));
     await root.edit({...managementReply,attachments:[...(root.attachments?.values?.()||[])].map(a=>({id:a.id})),components:previewPanel(target.staff,target.kind,target.ident,level,style,media,"Upload interrupted: "+String(uploadError.message||uploadError).slice(0,120)+". Verified originals remain in this draft; unverified media posts were retained for staff review.",nextTail)});
    }
   }finally{uploading.delete(rootId);}
   return;
  }
  if(i.isButton()&&action==="publish"){
   const level=Number(pieces[5]),style=pieces[6],expectedTail=pieces[7]||"0";
   if(!Number.isInteger(level)||level<1||level>50||!STYLE_OPTIONS.some(x=>x.value===style))throw Error("LEVEL_OR_STYLE_INVALID");
   const key=i.message.id;
   if(active.has(key)||uploading.has(key)){await respondError(i,"This milestone is already being processed.");return;}
   active.add(key);
   let publishedMainId=null;
   try{
    await i.deferUpdate();
    const channel=await client.channels.fetch(MGMT);
    const root=await channel.messages.fetch(key);
    if(draftTail(root)!==expectedTail||!draftMatches(root,target.staff,target.kind,target.ident,level,style,expectedTail))throw Error("DRAFT_CHANGED_REFRESH_PREVIEW");
    const originals=await collectDraftMedia(root,expectedTail,channel);
    const batches=groupByVideoPriority(originals);
    if(!batches.length)batches.push([]);
    const destination=await client.channels.fetch(DEST);
    if(!destination||!destination.isTextBased()||!destination.messages)throw Error("ANNOUNCEMENT_CHANNEL_MISSING");
    const limit=effectiveLimit(i);
    let main=null,verified=0,total=0,previews=0,previewFailures=0;
    const existingMainId=previousMainId(root);
    if(existingMainId){main=await destination.messages.fetch(existingMainId).catch(()=>null);if(main&&main.author?.id!==client.user.id)throw Error("PREVIOUS_CELEBRATION_NOT_OWNED");}
    for(let index=0;index<batches.length;index++){
     const normalized=[];
     for(const file of batches[index]){
      const bytes=await restoredDraftBytes(file,limit);
      const claimed=file.name.match(NEW_FILE);
      const digest=createHash("sha256").update(bytes).digest("hex");
      if(claimed&&claimed[1]!==digest)throw Error("DRAFT_MEDIA_HASH_MISMATCH");
      normalized.push({bytes,filename:file.name,description:file.description||"Unmodified original",digest});
     }
     if(normalized.reduce((sum,a)=>sum+a.bytes.length,0)>MAX_BATCH_BYTES)throw Error("MEDIA_BATCH_LIMIT");
     const playbackCopies=[];
     for(const original of normalized){
      if(mediaKind(original.filename)!=="video"||!(await shouldBuildPreview(original)))continue;
      const preview=await makeInlineCopy(original,limit,true);
      if(!preview||extension(preview.filename)!=="mp4")throw Error("VIDEO_PLAYBACK_COPY_REQUIRED");
      playbackCopies.push(preview);
     }
     const playbackBytes=playbackCopies.reduce((n,f)=>n+f.bytes.length,0);
     if(playbackBytes>MAX_BATCH_BYTES)throw Error("VIDEO_PLAYBACK_COPIES_EXCEED_MESSAGE_LIMIT");
     const inMessage=[],deferredOriginals=[];
     let bytesInMessage=playbackBytes;
     for(const original of normalized){
      if(bytesInMessage+original.bytes.length<=MAX_BATCH_BYTES&&inMessage.length+playbackCopies.length<10){
       inMessage.push(original);bytesInMessage+=original.bytes.length;
      }else deferredOriginals.push(original);
     }
     const visibleFiles=[...playbackCopies,...inMessage];
     const components=[view(index===0?announcement(target.kind,target.ident,level,style):"🖼️ **Original celebration media · Part "+(index+1)+" of "+batches.length+"**"),...renderMedia(visibleFiles.map(f=>({name:f.filename,description:f.description})),false,normalized.map(f=>f.filename))];
     const args={...setting,components:packContainers(components),nonce:nonceFor(key,index),enforceNonce:true,allowedMentions:{users:target.kind==="u"&&index===0?[target.ident]:[],parse:[],repliedUser:false}};
     if(visibleFiles.length)args.files=visibleFiles.map(f=>new AttachmentBuilder(f.bytes,{name:f.filename,description:f.description}));
     if(index>0)args.reply={messageReference:main.id,failIfNotExists:true};
     let posted=null;
     if(index===0&&main)posted=main;
     if(index>0&&main){
      const recent=await destination.messages.fetch({limit:100}).catch(()=>null);
      posted=recent?.find(m=>m.author.id===client.user.id&&m.reference?.messageId===main.id&&visibleFiles.every(f=>publishedFiles(m).some(a=>a.name===f.filename)))||null;
     }
     if(!posted)posted=await destination.send(args);
     if(!main)main=posted;
     publishedMainId=main.id;
     if(index===0){
      const checkpoint="[View existing celebration](https://discord.com/channels/"+GUILD+"/"+DEST+"/"+main.id+"). Publishing is in progress; please do not start another announcement.";
      await root.edit({...managementReply,attachments:[...(root.attachments?.values?.()||[])].map(a=>({id:a.id})),components:previewPanel(target.staff,target.kind,target.ident,level,style,originals,checkpoint,expectedTail)});
      console.log("FANCLUB_PUBLICATION_CHECKPOINT_SAVED source="+key+" first_post="+main.id);
     }
     total+=normalized.length;
     for(const original of inMessage){
      try{await verifyPublished(posted,[original],limit);verified++;}
      catch(e){
       try{await preserveOriginalArchive(main,original,destination,key,limit);verified++;}
       catch(archE){console.error("FANCLUB_ORIGINAL_ARCHIVE_UNVERIFIED "+original.filename+" "+String(archE.message||archE));}
      }
     }
     for(const preview of playbackCopies){
      try{await verifyInlinePlayback(posted,preview,limit);previews++;}
      catch(e){previewFailures++;console.error("FANCLUB_VIDEO_PLAYBACK_VERIFY_WARNING "+String(e.message||e));}
     }
     for(const original of deferredOriginals){
      const recent=await destination.messages.fetch({limit:100}).catch(()=>null);
      let reply=recent?.find(m=>m.author.id===client.user.id&&m.reference?.messageId===main.id&&publishedFiles(m).some(a=>a.name===original.filename));
      if(!reply){
       reply=await destination.send({
        ...setting,
        components:packContainers([view("📎 **Unmodified original file**\n-# The playable video is shown prominently in the celebration above; originals remain byte-identical."),...renderMedia([{name:original.filename,description:original.description}],false)]),
        files:[new AttachmentBuilder(original.bytes,{name:original.filename,description:original.description})],
        reply:{messageReference:main.id,failIfNotExists:true},
        nonce:nonceFor(key,"original-"+index+"-"+original.digest),enforceNonce:true,allowedMentions:{parse:[],repliedUser:false}
       });
      }
      try{await verifyPublished(reply,[original],limit);verified++;}
      catch(e){
       try{await preserveOriginalArchive(main,original,destination,key,limit);verified++;}
       catch(archE){console.error("FANCLUB_DEFERRED_ORIGINAL_ARCHIVE_UNVERIFIED "+original.filename+" "+String(archE.message||archE));}
      }
     }
     for(const original of normalized){
      if(mediaKind(original.filename)==="video"||!(await shouldBuildPreview(original)))continue;
      try{
       const preview=await makeInlineCopy(original,limit,true);
       if(!preview){previewFailures++;continue;}
       const messages=await destination.messages.fetch({limit:100}).catch(()=>null);
       let display=messages?.find(m=>m.author.id===client.user.id&&m.reference?.messageId===main.id&&publishedFiles(m).some(a=>a.name===preview.filename));
       if(!display){
        display=await destination.send({
         ...setting,
         components:packContainers([view("🎧 **Discord Inline Media Copy**\n"+preview.label+"\n-# Original media is preserved unchanged in the celebration."),...renderMedia([{name:preview.filename,description:preview.description}],false)]),
         files:[new AttachmentBuilder(preview.bytes,{name:preview.filename,description:preview.description})],
         reply:{messageReference:main.id,failIfNotExists:true},
         nonce:nonceFor(key,preview.filename),enforceNonce:true,
         allowedMentions:{parse:[],repliedUser:false}
        });
       }
       await verifyInlinePlayback(display,preview,limit);
       previews++;
       console.log("FANCLUB_INLINE_VERIFIED kind="+preview.kind+" bytes="+preview.bytes.length+" format="+extension(preview.filename));
      }catch(e){
       previewFailures++;
       console.error("FANCLUB_INLINE_CONVERSION_SKIPPED original="+original.filename+" "+String(e.message||e).slice(0,250));
      }
     }
    }
    const perfect=verified===total;
    const result=perfect?"✅ Published — exact originals verified directly or through lossless ZIP archives.":"⚠️ Published with unverified originals. Staff staging has been retained for recovery.";
    await root.edit({...setting,attachments:[...(root.attachments?.values?.()||[])].map(a=>({id:a.id})),components:packContainers([view("## "+result+"\nTikTok Fan Club Level "+level+" for "+member(target.kind,target.ident)+" posted with "+total+" original photo, video and audio files in "+batches.length+" original post(s) and "+previews+" inline display copies. "+(previewFailures?previewFailures+" inline conversions were unavailable; their originals remain attached. ":"")+"\n-# [View celebration](https://discord.com/channels/"+GUILD+"/"+DEST+"/"+main.id+")"),...renderMedia(listMedia(root).map(a=>({...a,url:null})),false)])});
    if(perfect&&total>0){
     console.log("FANCLUB_ORIGINAL_STAGING_RETAINED awaiting_independent_vault_receipts=true source="+key);
    }else if(total>0&&!perfect){
     console.warn("FANCLUB_STAGING_RETAINED_MEDIA_UNVERIFIED count="+total+" verified="+verified);
    }
    console.log("FANCLUB_MILESTONE_PUBLISHED_BATCHED level="+level+" media="+total+" batches="+batches.length+" verified="+verified+" previews="+previews+" skipped="+previewFailures);
   }catch(e){
    console.error("FANCLUB_PUBLISH_BATCH_ERROR "+String(e.stack||e));
    const channel=await client.channels.fetch(MGMT).catch(()=>null);
    const root=await channel?.messages?.fetch(key).catch(()=>null);
    const media=root?await collectDraftMedia(root,expectedTail,channel).catch(()=>[]):[];
    const earlierId=publishedMainId||(root?previousMainId(root):null);
    const earlier=earlierId?(" [View existing celebration](https://discord.com/channels/"+GUILD+"/"+DEST+"/"+earlierId+")"):"";
    if(root)await root.edit({...managementReply,components:previewPanel(target.staff,target.kind,target.ident,level,style,media,"Publishing did not finish: "+String(e.message||e).slice(0,115)+". Preserve this draft. Check the destination before retrying to avoid duplicates."+earlier,expectedTail)}).catch(()=>{});
   }finally{active.delete(key);}
   return;
  }

 }catch(e){
  console.error("FANCLUB_INTERACTION_ERROR "+String(e.stack||e));
  await respondError(i,"The announcement could not be completed. Please review the selection and try again.").catch(()=>{});
 }
});



async function selfTest(){
 let checks=0;
 for(let level=1;level<=50;level++)for(const style of STYLE_OPTIONS.map(x=>x.value)){
  const msg=announcement("h","test_member",level,style);
  if(!msg.includes("TikTok Fan Club Level "+level)||!msg.includes(OWNER))throw Error("ANNOUNCEMENT_TEST_"+level);
  const sample="fc-original-"+"a".repeat(64)+".mp4";
  const tail="12345678901234567890";
  const prev=previewPanel("123456789012345678901","h","test_member",level,style,[{name:sample,url:"https://cdn.discordapp.com/attachments/x/"+sample}], "",tail);
  const raw=JSON.stringify(prev);
  if(!raw.includes("fclub:publish")||!raw.includes("fclub:photo")||!raw.includes("https://cdn.discordapp.com/attachments/"))throw Error("PREVIEW_TEST_"+level);
  const all=raw.match(/fclub:(?:publish|photo|remove):[^"]+/g)||[];
  if(!all.length||all.some(x=>x.length>100))throw Error("CUSTOM_ID_LIMIT_"+level);
  checks++;
 }
 for(const ext of ["jpg","png","webp","avif","heic","tiff"])if(mediaKind("x."+ext)!=="image")throw Error("IMAGE_KIND_"+ext);
 for(const ext of ["mp4","mov","webm","mkv","avi","mts"])if(mediaKind("x."+ext)!=="video")throw Error("VIDEO_KIND_"+ext);
 for(const ext of ["mp3","wav","flac","ogg","opus","m4a","aac","aiff","wma"])if(mediaKind("x."+ext)!=="audio")throw Error("AUDIO_KIND_"+ext);
 if(!validAudioBytes(Buffer.from("fLaCtest"),"a.flac")||validAudioBytes(Buffer.from("notflac"),"a.flac"))throw Error("AUDIO_SIGNATURE_TEST");
 if(!needsInlineCopy({filename:"fc-original-"+"a".repeat(64)+".mp3"}))throw Error("INLINE_AUDIO_POLICY_TEST");
 const mp4=Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
 if(!validVideoBytes(mp4,"x.mp4")||validVideoBytes(Buffer.from("invalid"),"x.mp4"))throw Error("MP4_MAGIC_TEST");
 if(!validVideoBytes(Buffer.from([0x1a,0x45,0xdf,0xa3,0,0]),"x.webm"))throw Error("WEBM_MAGIC_TEST");
 const files=[{name:"fc-original-"+"a".repeat(64)+".png",size:13*MiB},{name:"fc-original-"+"b".repeat(64)+".mp4",size:14*MiB},{name:"fc-original-"+"c".repeat(64)+".mp4",size:1*MiB}];
 const batches=groupBySize(files);
 if(batches.length!==2||batches[0].length!==1||batches[1].length!==2)throw Error("LARGE_MULTIMEDIA_PARTITION_TEST");
 if(renderMedia(files,false).length!==3)throw Error("MIXED_MEDIA_GALLERY_TEST");
 const heroTest=renderMedia([{name:"fc-inline-hero.mp4"},{name:"fc-original-photo.png"},{name:"fc-original-video.mov"}],false);
 if(heroTest.length!==3||heroTest[0].type!==12||heroTest[0].items.length!==1||heroTest[1].type!==12||heroTest[2].type!==12)throw Error("VIDEO_FIRST_LARGEST_PANEL_TEST");
 const originalVideo=20345020,sourcePng=2436522,sourceJpg=286251,playableMp4=20358538;
 if(MAX_BATCH_BYTES!==24*MiB||playableMp4+sourcePng+sourceJpg>MAX_BATCH_BYTES)throw Error("MEDIA_BUNDLE_BUDGET_INSUFFICIENT");
 if(groupByVideoPriority([{name:"fc-original-v.mov",size:originalVideo},{name:"fc-original-a.png",size:sourcePng},{name:"fc-original-b.jpg",size:sourceJpg}]).length!==1)throw Error("VIDEO_FIRST_BUNDLE_SPLIT_REGRESSION");
 const mix=renderMedia([{name:"fc-inline-"+"a".repeat(64)+".mp4"},{name:"fc-original-"+"a".repeat(64)+".mov"},{name:"fc-original-"+"b".repeat(64)+".mov"}],false,["fc-original-"+"b".repeat(64)+".mov","fc-original-"+"a".repeat(64)+".mov"]);
 if(mix.filter(c=>c.type===12).length!==2||mix.filter(c=>c.type===13).length!==1||!JSON.stringify(mix[0]).includes("b".repeat(64)))throw Error("MOV_AND_MP4_GALLERY_PRIORITY_TEST");
 const movBatch=groupByVideoPriority([{name:"first.mov",size:3*MiB},{name:"second.mp4",size:4*MiB},{name:"photo.png",size:1*MiB}]);
 if(movBatch.length!==1||movBatch[0].length!==3)throw Error("MOV_MP4_SAME_MESSAGE_TEST");
 const nativeVideoBatch=groupByVideoPriority([{name:"fc-original-a.mp4",size:3*MiB},{name:"fc-original-b.mp4",size:4*MiB},{name:"fc-original-c.png",size:1*MiB}]);
 if(nativeVideoBatch.length!==1||nativeVideoBatch[0].length!==3)throw Error("COMPACT_TWO_VIDEO_SINGLE_MESSAGE_TEST");
 const oversizedVideoBatch=groupByVideoPriority([{name:"fc-original-a.mp4",size:13*MiB},{name:"fc-original-b.mp4",size:13*MiB}]);
 if(oversizedVideoBatch.length!==2)throw Error("COMPACT_OVERSIZED_VIDEO_SPLIT_TEST");
 if(nonceFor("123",0)===nonceFor("123",1))throw Error("NONCE_UNIQUENESS_TEST");
 const bot="123456789012345678",mid="123456789012345679";
 const stage={id:mid,channelId:MGMT,author:{id:bot},content:STAGE_NOTE,attachments:new Map([[1,{name:"fc-original-"+"c".repeat(64)+".wav"}]]),reference:{messageId:"123456789012345680"}};
 if(!verifiedStageMessage(stage,bot)||verifiedStageMessage({...stage,channelId:"1234"},bot)||verifiedStageMessage({...stage,author:{id:"999"}},bot))throw Error("STAGED_OWNERSHIP_GUARD_TEST");
 const archiveStage={...stage,content:STAGE_ARCHIVE_NOTE,attachments:new Map([[1,{name:"fc-stage-preserved-"+"a".repeat(64)+".zip"}]])};
 if(!verifiedStageMessage(archiveStage,bot)||verifiedStageMessage({...archiveStage,content:STAGE_NOTE},bot))throw Error("STAGED_ARCHIVE_OWNERSHIP_TEST");
 if(previousMainId({components:[{type:17,components:[{type:10,content:"[View existing celebration](https://discord.com/channels/"+GUILD+"/"+DEST+"/"+mid+")"}]}]})!==mid)throw Error("RECOVERY_LINK_TEST");

 const atts={attachments:new Map(files.map((x,i)=>[i,x]))};
 if(listMedia(atts).length!==3)throw Error("MEDIA_RESTART_RECONSTRUCTION_TEST");
 if(new Set([30,35,40,45,50].map(l=>TIER(l)[0])).size!==5)throw Error("SPECIAL_LEVELS_TEST");

 const wav=Buffer.alloc(44+16000);
 wav.write("RIFF",0,"ascii");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8,"ascii");
 wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);
 wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
 wav.write("data",36,"ascii");wav.writeUInt32LE(16000,40);
 for(let n=0;n<8000;n++)wav.writeInt16LE(Math.round(Math.sin(n*Math.PI*2*440/8000)*7000),44+n*2);
 const sha=createHash("sha256").update(wav).digest("hex");
 const generated=await makeInlineCopy({bytes:wav,filename:"fc-original-"+sha+".wav",digest:sha},20*MiB);
 if(!generated||!validVideoBytes(generated.bytes,generated.filename)||generated.bytes.length<1000)throw Error("AUDIO_MP4_CONVERTER_RUNTIME_TEST");
 if(await shouldBuildPreview({bytes:generated.bytes,filename:"fc-original-"+"a".repeat(64)+".mov"}))throw Error("NATIVE_H264_MOV_MUST_NOT_BE_DUPLICATED");
 const srcImg=await sharp({create:{width:20,height:20,channels:3,background:"#3a74a0"}}).tiff().toBuffer();
 const iHash=createHash("sha256").update(srcImg).digest("hex");
 const display=await makeInlineCopy({bytes:srcImg,filename:"fc-original-"+iHash+".tiff",digest:iHash},20*MiB);
 if(!display||display.bytes.toString("hex",0,8)!=="89504e470d0a1a0a")throw Error("IMAGE_PNG_CONVERTER_RUNTIME_TEST");
 const containerBytes=await ffmpegTo(generated.bytes,"mp4","mkv",(input,output)=>["-i",input,"-c","copy",output],20*MiB);
 const cHash=createHash("sha256").update(containerBytes).digest("hex");
 const repacked=await makeInlineCopy({bytes:containerBytes,filename:"fc-original-"+cHash+".mkv",digest:cHash},20*MiB);
 if(!repacked||!validVideoBytes(repacked.bytes,repacked.filename))throw Error("LOSSLESS_VIDEO_REMUX_RUNTIME_TEST");
 const mkvCodec=await videoCodecSummary(containerBytes,"mkv");
 if(mkvCodec.video!=="h264"||!copySafeForDiscord(mkvCodec))throw Error("CODEC_PROBE_H264_TEST");
 const unsupported=await ffmpegTo(generated.bytes,"mp4","mp4",(input,output)=>["-i",input,"-map","0:v:0","-c:v","mpeg4","-q:v","5","-an",output],20*MiB);
 const unsupportedHash=createHash("sha256").update(unsupported).digest("hex");
 const unsupportedInfo=await videoCodecSummary(unsupported,"mp4");
 if(unsupportedInfo.video!=="mpeg4"||!(await shouldBuildPreview({bytes:unsupported,filename:"fc-original-"+unsupportedHash+".mp4",digest:unsupportedHash})))throw Error("UNSUPPORTED_MP4_CODEC_POLICY_TEST");
 const converted=await makeInlineCopy({bytes:unsupported,filename:"fc-original-"+unsupportedHash+".mp4",digest:unsupportedHash},20*MiB);
 const convertedInfo=await videoCodecSummary(converted.bytes,"mp4");
 if(convertedInfo.video!=="h264"||!converted.label.includes("lossy"))throw Error("UNSUPPORTED_MP4_H264_FALLBACK_TEST");

 const incompatible=await ffmpegTo(generated.bytes,"mp4","mkv",(input,output)=>["-i",input,"-map","0:v:0","-map","0:a:0?","-c:v","ffv1","-c:a","copy",output],20*MiB);
 const badHash=createHash("sha256").update(incompatible).digest("hex");
 const fallback=await makeInlineCopy({bytes:incompatible,filename:"fc-original-"+badHash+".mkv",digest:badHash},20*MiB);
 if(!fallback||!validVideoBytes(fallback.bytes,fallback.filename)||!fallback.label.includes("lossy"))throw Error("VIDEO_TRANSCODE_FALLBACK_RUNTIME_TEST");

 console.log("FANCLUB_INLINE_CONVERTER_SELFTEST_PASS wavToMp4="+generated.bytes.length+" tiffToPng="+display.bytes.length+" mkvToMp4="+repacked.bytes.length+" ffv1Fallback="+fallback.bytes.length+" mpeg4ToH264="+converted.bytes.length);
 console.log("FANCLUB_DEEP_SELFTEST_PASS announcements="+checks+" splitBatches=2 checksums=sha256 mediaMax=10 staging=durable videos=validated audio=accepted converter=ffmpeg");
}

client.once(Events.ClientReady,async ()=>{
 console.log("FANCLUB_LISTENER_READY guild="+GUILD+" destination="+DEST);
 await ensureDashboard().catch(e=>console.error("FANCLUB_DASHBOARD_ERROR "+String(e.stack||e)));
});
if(!TOKEN||!GUILD||!MGMT||!DEST||!STAFF.length) throw new Error("Missing required TikTok Fan Club management configuration");
await selfTest();
console.log("FANCLUB_VIDEO_HERO_PLAYBACK_POLICY_ACTIVE_E2E_V3_2026_11_06");
await client.login(TOKEN);
