// UMM_RETRY_FAIRNESS_AND_CAP_V6 — finite scan limits, bounded retry share, fail-closed 5000-item durable backlog.
// UMM_MAX_SOURCE_LIMIT_VALIDATED_V5 — fail closed for invalid large-file configuration, never stream unbounded media.
// UMM_ARCHIVE_PAGE_FAIL_CLOSED_V4 — reject empty-but-more archived forum pages, never silently skip histories.
// UMM_FAIR_ARCHIVE_SCAN_V3 — advance by actual sources visited, load up to 2000 archive threads per forum.
// UMM_RETRY_SOURCE_ALLOWLIST_V2 — reject stale/unapproved media retry targets before remote reads.
// UMM_BUDGET_DEFER_NO_SKIP_V4 — persist deferred attachment IDs before advancing archive cursor.
// UMM_RETRY_BACKLOG_V1 — durable, rotating failed-original queue; never deletes source media.
// UMM_STREAM_LARGE_ORIGINAL_V1 — optional, fail-closed large media streaming and S3 multipart checksum readback.
// UMM_VAULT_MIXED_MEDIA_V1 — native original bytes for photos, videos and audio; never publish or delete.

import { createHash } from "node:crypto";
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import {Upload} from "@aws-sdk/lib-storage";
import {createReadStream,createWriteStream} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Readable,Transform} from "node:stream";
import {pipeline} from "node:stream/promises";

const env = Bun.env;
const G = env.GUILD_ID || "";
const TOKEN = env.DISCORD_BOT_TOKEN || "";
let FORUMS = (env.PHOTO_FORUM_IDS || "").split(",").filter(Boolean);
let DIRECT = [...new Set([...(env.PHOTO_CHANNEL_IDS || "").split(",").filter(Boolean), ...(env.EVENT_CHANNEL_IDS || "").split(",").filter(Boolean)])];
const bounded=(value,fallback,min,max)=>{const n=Number(value??fallback);return Number.isSafeInteger(n)?Math.min(max,Math.max(min,n)):fallback;};
const MAX_ITEMS=bounded(env.MAX_MEDIA_PER_RUN,40,2,80);
const MAX_THREADS=bounded(env.MAX_THREADS_PER_RUN,35,1,80);
const ROOT = "https://discord.com/api/v10";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const log = (kind, details = {}) => console.log(JSON.stringify({system:"original-media-vault",kind,guild:G,...details}));
const snow = s => /^\d{17,20}$/.test(s || "");
const mime = n => ({jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",heic:"image/heic",heif:"image/heif",avif:"image/avif",bmp:"image/bmp",tif:"image/tiff",tiff:"image/tiff",mp4:"video/mp4",mov:"video/quicktime",m4v:"video/x-m4v",webm:"video/webm",mkv:"video/x-matroska",avi:"video/x-msvideo",wmv:"video/x-ms-wmv", "3gp":"video/3gpp",mpeg:"video/mpeg",mpg:"video/mpeg",ogv:"video/ogg",mp3:"audio/mpeg",wav:"audio/wav",wave:"audio/wav",flac:"audio/flac",ogg:"audio/ogg",opus:"audio/ogg",m4a:"audio/mp4",aac:"audio/aac",aif:"audio/aiff",aiff:"audio/aiff",wma:"audio/x-ms-wma",amr:"audio/amr",caf:"audio/x-caf"})[n] || "application/octet-stream";
const ext = n => ((n || "").split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,6);
let attempted=0,saved=0,reused=0,held=0,lowRes=0;
async function discord(path) {
  for(let i=0;i<4;i++) {
    const r=await fetch(ROOT+path,{headers:{"Authorization":"Bot "+TOKEN},signal:AbortSignal.timeout(19000)});
    const raw=await r.text();
    let data;try{data=raw?JSON.parse(raw):{}}catch{data={message:raw.slice(0,90)}}
    if(r.status===429 && i<3){await Bun.sleep(Math.min(12000,Math.max(1000,Number(data.retry_after||2)*1000)));continue}
    if(!r.ok)throw Error("discord_"+r.status+"_"+String(data.message||"").slice(0,90));
    return data;
  }
  throw Error("rate_limited");
}
async function fetchAsset(a) {
  if(!a?.url || !a.size || a.size>30*1024*1024)throw Error("size_or_url");
  const u=new URL(a.url);
  if(u.protocol!=="https:" || !["cdn.discordapp.com","media.discordapp.net"].includes(u.hostname))throw Error("unsafe_attachment_host");
  const opts={redirect:"error",headers:{"Accept-Encoding":"identity","Cache-Control":"no-transform"},signal:AbortSignal.timeout(28000)};
  const res=await fetch(u.toString(),opts);
  if(!res.ok)throw Error("cdn_"+res.status);
  const b=new Uint8Array(await res.arrayBuffer());
  if(!b.length || b.length>30*1024*1024)throw Error("download_size_invalid");
  if(b.length!==Number(a.size)){
    const magic=Array.from(b.slice(0,12)).map(x=>x.toString(16).padStart(2,"0")).join("");
    log("SOURCE_BYTE_DIAGNOSTIC",{attachment:a.id,declaredSize:Number(a.size),downloadedSize:b.length,
      declaredType:String(a.content_type||""),responseType:String(res.headers.get("content-type")||""),
      responseLength:String(res.headers.get("content-length")||""),responseEncoding:String(res.headers.get("content-encoding")||""),
      filenameExtension:ext(a.filename),cdnHost:u.hostname,magic});
    const isPng=b.length>32&&magic.startsWith("89504e470d0a1a0a")&&String.fromCharCode(...b.slice(12,16))==="IHDR";
    const encoded=String(res.headers.get("content-encoding")||"").trim();
    const forbiddenParams=["format","quality","width","height","size"].some(k=>u.searchParams.has(k));
    // Discord's image/jpeg metadata may describe an optimized JPEG, while the original attachment
    // URL still serves the full PNG file. Preserve the original PNG only with strict provenance proof.
    if(!(u.hostname==="cdn.discordapp.com" && ext(a.filename)==="png" &&
      String(a.content_type||"").toLowerCase()==="image/jpeg" &&
      String(res.headers.get("content-type")||"").toLowerCase().startsWith("image/png") &&
      !encoded && !forbiddenParams && isPng))throw Error("attachment_size_changed_unverified");
    const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
    const width=view.getUint32(16),height=view.getUint32(20);
    if(!width||!height||width>18000||height>18000||
       (Number(a.width)>0 && width!==Number(a.width))||
       (Number(a.height)>0 && height!==Number(a.height)))throw Error("png_dimensions_mismatch");
    const check=await fetch(u.toString(),{redirect:"error",headers:{"Accept-Encoding":"identity","Cache-Control":"no-store, no-transform"},signal:AbortSignal.timeout(28000)});
    if(!check.ok)throw Error("original_png_recheck_"+check.status);
    const twice=new Uint8Array(await check.arrayBuffer());
    if(twice.length!==b.length||sha(twice)!==sha(b))throw Error("original_png_repeat_hash_mismatch");
    log("ORIGINAL_CDN_PNG_VERIFIED",{attachment:a.id,discordReportedSize:Number(a.size),cdnOriginalSize:b.length,
      width,height,sha256:sha(b),retriesVerified:2,originalUrlHost:u.hostname,sourceRetained:true});
  }
  return b;
}
async function main(){
  if(!snow(G)||!TOKEN||!env.S3_ACCESS_KEY_ID||!env.S3_SECRET_ACCESS_KEY||!env.S3_BUCKET||!env.S3_ENDPOINT)throw Error("missing_configuration");
  if([...FORUMS,...DIRECT].some(x=>!snow(x)))throw Error("invalid_channel_id");
  const s3=new S3Client({region:"auto",endpoint:env.S3_ENDPOINT,forcePathStyle:false,credentials:{accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY},maxAttempts:2});
  const client={
    async exists(key){
      try{await s3.send(new HeadObjectCommand({Bucket:env.S3_BUCKET,Key:key}));return true}
      catch(error){if(error?.$metadata?.httpStatusCode===404 || ["NotFound","NoSuchKey","NoSuchBucketKey"].includes(error?.name))return false;throw error}
    },
    async write(key,data,options={}){
      await s3.send(new PutObjectCommand({Bucket:env.S3_BUCKET,Key:key,Body:data,ContentType:options.type||"application/octet-stream"}));
    },
    file(key){
      async function bytes(){const res=await s3.send(new GetObjectCommand({Bucket:env.S3_BUCKET,Key:key}));return new Uint8Array(await res.Body.transformToByteArray())}
      async function text(){return new TextDecoder().decode(await bytes())}
      return {bytes,text,json:async()=>JSON.parse(await text())}
    }
  };
  // Stream large native attachments to a temporary file, then multipart-upload the exact original bytes.
  // This is opt-in until a real S3 restore drill and storage headroom test have passed.
  async function storeLargeOriginal(a,entry,m){
    if(env.UMM_LARGE_MEDIA_ENABLED!=="true")throw Error("large_media_streaming_not_enabled");
    const declared=Number(a.size),limitMiB=Number(env.UMM_MAX_SOURCE_MB||250);
    if(!Number.isFinite(limitMiB)||!Number.isInteger(limitMiB)||limitMiB<31||limitMiB>500)throw Error("invalid_large_media_config");
    const maxSize=limitMiB*1024*1024;
    if(!Number.isSafeInteger(declared)||declared<=30*1024*1024||declared>maxSize)throw Error("large_media_size_exceeds_stream_budget");
    const url=new URL(String(a.url||""));
    if(url.protocol!=="https:"||!["cdn.discordapp.com","media.discordapp.net"].includes(url.hostname))throw Error("large_media_unsafe_host");
    const folder=await mkdtemp(join(tmpdir(),"umm-media-"));
    const local=join(folder,"original.bin");
    try{
      const response=await fetch(url.toString(),{redirect:"error",headers:{"Accept-Encoding":"identity","Cache-Control":"no-transform"},signal:AbortSignal.timeout(90000)});
      if(!response.ok||!response.body)throw Error("large_media_download_http_"+response.status);
      if(String(response.headers.get("content-encoding")||"").trim())throw Error("large_media_encoded_response");
      const digest=createHash("sha256");let total=0;
      const monitor=new Transform({transform(chunk,encoding,callback){
        total+=chunk.length;
        if(total>maxSize||total>declared)return callback(new Error("large_media_stream_over_limit"));
        digest.update(chunk);callback(null,chunk);
      }});
      await pipeline(Readable.fromWeb(response.body),monitor,createWriteStream(local,{flags:"wx",mode:0o600}));
      if(total!==declared)throw Error("large_media_original_size_mismatch");
      const checksum=digest.digest("hex"),extension=ext(a.filename);
      const objectKey="objects/sha256/"+checksum.slice(0,2)+"/"+checksum+"."+(extension||"bin");
      const receiptKey="receipts/"+G+"/"+entry.id+"/"+m.id+"/"+a.id+".json";
      const alreadyStored=await client.exists(objectKey);
      if(!alreadyStored){
        const header=new Uint8Array(await Bun.file(local).slice(0,24).arrayBuffer());
        const isPng=extension==="png"&&header.length>=8&&
          header[0]===137&&header[1]===80&&header[2]===78&&header[3]===71&&
          header[4]===13&&header[5]===10&&header[6]===26&&header[7]===10;
        const upload=new Upload({client:s3,params:{Bucket:env.S3_BUCKET,Key:objectKey,Body:createReadStream(local),ContentType:isPng?"image/png":(a.content_type||mime(extension))},queueSize:2,partSize:8*1024*1024,leavePartsOnError:false});
        await upload.done();
      }
      const remote=await s3.send(new GetObjectCommand({Bucket:env.S3_BUCKET,Key:objectKey}));
      if(!remote.Body)throw Error("large_media_vault_object_empty");
      const verification=createHash("sha256");let verifiedBytes=0;
      for await(const part of remote.Body){
        const bytes=part instanceof Uint8Array?part:new Uint8Array(part);
        verifiedBytes+=bytes.length;
        if(verifiedBytes>declared)throw Error("large_media_remote_overflow");
        verification.update(bytes);
      }
      if(verifiedBytes!==declared||verification.digest("hex")!==checksum)throw Error("large_media_vault_sha256_mismatch");
      if(alreadyStored)reused++;else saved++;
      if(!(await client.exists(receiptKey))){
        await client.write(receiptKey,JSON.stringify({version:2,guild:G,channelId:entry.id,messageId:m.id,attachmentId:a.id,originalFilename:a.filename,mediaClass:(String(a.content_type||"").startsWith("audio/")||["mp3","wav","flac","ogg","opus","m4a","aac"].includes(extension)?"audio":String(a.content_type||"").startsWith("image/")||["png","jpg","jpeg","webp","gif","heic","avif"].includes(extension)?"image":"video"),originalSize:declared,sha256:checksum,objectKey,originalStreaming:true,verifiedAt:new Date().toISOString(),sourceTimestamp:m.timestamp,sourceAuthorId:m.author?.id||null}),{type:"application/json"});
      }
      log("STREAMED_ORIGINAL_VERIFIED",{source:m.id,attachment:a.id,bytes:declared,sha256:checksum,vaultReadback:true,originalUnmodified:true,discordWrites:0});
    }finally{await rm(folder,{recursive:true,force:true}).catch(()=>{});}
  }
  async function storeAnyOriginal(a,entry,m){
          if(Number(a.size)>30*1024*1024){await storeLargeOriginal(a,entry,m);return;}
          const bytes=await fetchAsset(a);
          const checksum=sha(bytes);
          const extension=ext(a.filename);
          const objectKey="objects/sha256/"+checksum.slice(0,2)+"/"+checksum+"."+(extension||"bin");
          const receiptKey="receipts/"+G+"/"+entry.id+"/"+m.id+"/"+a.id+".json";
          const originalExists=await client.exists(objectKey);
          if(!originalExists){
            const isPng=extension==="png"&&bytes.length>=24&&
              bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&
              bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
            await client.write(objectKey,bytes,{type:isPng?"image/png":(a.content_type||mime(extension))});
          }
          const verify=await client.file(objectKey).bytes();
          if(sha(verify)!==checksum||verify.length!==bytes.length)throw Error("remote_checksum_mismatch");
          if(originalExists)reused++;else saved++;
          const originalCt=String(a.content_type||"").toLowerCase().split(";")[0];
          const mediaType=originalCt.startsWith("video/")||["mp4","mov","m4v","webm","mkv","avi","wmv","3gp","mpeg","mpg","ogv"].includes(extension)?"video":
            originalCt.startsWith("audio/")||["mp3","wav","wave","flac","ogg","opus","m4a","aac","aif","aiff","wma","amr","caf"].includes(extension)?"audio":"image";
          log("ORIGINAL_MEDIA_READBACK_VERIFIED",{channel:entry.id,source:m.id,attachment:a.id,
            mediaClass:mediaType,bytes:bytes.length,sha256:checksum,objectReused:originalExists,
            metadataMismatch:bytes.length!==Number(a.size),sourcePreserved:true,discordWrites:0,sourceDeletes:0});
          const small=Number(a.width||0)>0 && Number(a.height||0)>0 && Math.max(a.width,a.height)<=400;
          if(small)lowRes++;
          if(!await client.exists(receiptKey)){
            const data={version:1,guild:G,channelId:entry.id,messageId:m.id,attachmentId:a.id,originalFilename:a.filename,mediaClass:(String(a.content_type||"").toLowerCase().startsWith("video/")||["mp4","mov","m4v","webm","mkv","avi","wmv","3gp","mpeg","mpg","ogv"].includes(ext(a.filename))?"video":String(a.content_type||"").toLowerCase().startsWith("audio/")||["mp3","wav","wave","flac","ogg","opus","m4a","aac","aif","aiff","wma","amr","caf"].includes(ext(a.filename))?"audio":"image"),originalSize:bytes.length,discordReportedSize:Number(a.size),discordReportedMime:a.content_type||null,cdnOriginalVerifiedDespiteMetadataMismatch:bytes.length!==Number(a.size),sha256:checksum,objectKey,sourceTimestamp:m.timestamp,sourceAuthorId:m.author?.id||null,width:a.width||null,height:a.height||null,lowResolutionSource:small,verifiedAt:new Date().toISOString()};
            await client.write(receiptKey,JSON.stringify(data),{type:"application/json"});
          }
  }
  log("STORAGE_PROBE",{endpointHost:new URL(env.S3_ENDPOINT).hostname,region:env.S3_REGION||"auto",bucketNameLength:env.S3_BUCKET?.length||0,refUnresolved:[env.S3_BUCKET,env.S3_ACCESS_KEY_ID,env.S3_SECRET_ACCESS_KEY].some(x=>String(x).startsWith("$"+"{{"))});
  const [me,guild,channels,active]=await Promise.all([discord("/users/@me"),discord("/guilds/"+G),discord("/guilds/"+G+"/channels"),discord("/guilds/"+G+"/threads/active")]);
  if(!me.bot||guild.id!==G||!Array.isArray(channels))throw Error("isolation_validation_failed");
  const channelMap=new Map(channels.map(x=>[x.id,x]));
  const configuredForumCount=FORUMS.length,configuredDirectCount=DIRECT.length;
  const validForums=[];
  for(const id of FORUMS){
    const c=channelMap.get(id);
    if(!c||c.guild_id!==G||c.type!==15){
      log("FORUM_SOURCE_SKIPPED",{channel:id,reason:c?"invalid_scope":"not_in_guild_inventory",sourceUntouched:true});
      continue;
    }
    validForums.push(id);
  }
  FORUMS.splice(0,FORUMS.length,...validForums);
  const activeThreadIds=new Set((active.threads||[]).filter(t=>t.guild_id===G).map(t=>t.id));
  const validDirect=[];
  for(const id of DIRECT){
    const c=channelMap.get(id);
    if(c){
      if(c.guild_id===G&&[0,11,12].includes(c.type))validDirect.push(id);
      else log("DIRECT_SOURCE_SKIPPED",{channel:id,reason:"invalid_scope_or_type",sourceUntouched:true});
      continue;
    }
    if(activeThreadIds.has(id)){validDirect.push(id);continue;}
    try{
      const test=await discord("/channels/"+id);
      if(test.guild_id===G&&[0,11,12].includes(test.type))validDirect.push(id);
      else log("DIRECT_SOURCE_SKIPPED",{channel:id,reason:"invalid_scope_or_type",sourceUntouched:true});
    }catch(error){
      if(String(error).includes("discord_404_Unknown Channel")){
        log("DIRECT_SOURCE_SKIPPED",{channel:id,reason:"channel_not_found",sourceUntouched:true});
        continue;
      }
      throw error;
    }
  }
  DIRECT.splice(0,DIRECT.length,...validDirect);
  log("SOURCE_CONFIG_VALIDATED",{configuredForums:configuredForumCount,validForums:validForums.length,configuredDirect:configuredDirectCount,validDirect:validDirect.length,skippedForums:configuredForumCount-validForums.length,skippedDirect:configuredDirectCount-validDirect.length});
  if(!FORUMS.length&&!DIRECT.length)throw Error("no_valid_media_sources");
  const threads=new Map();
  for(const t of active.threads||[])if(FORUMS.includes(t.parent_id))threads.set(t.id,t);
  for(const f of FORUMS){
    let before="";
    for(let p=0;p<20;p++){
      const a=await discord("/channels/"+f+"/threads/archived/public?limit=100"+(before?"&before="+encodeURIComponent(before):""));
      for(const t of a.threads||[])threads.set(t.id,t);
      if(!Array.isArray(a.threads))throw Error("ARCHIVE_THREAD_RESPONSE_INVALID");
      if(a.has_more&&!a.threads.length)throw Error("ARCHIVE_PAGE_EMPTY_BUT_MORE");
      if(!a.has_more)break;
      before=a.threads.at(-1)?.thread_metadata?.archive_timestamp||"";
      if(!before)throw Error("ARCHIVE_CURSOR_MISSING");
      if(p===19&&a.has_more){log("ARCHIVE_TOO_DEEP_FOR_SCAN",{forum:f,pages:20,sourceDeletes:0});process.exitCode=1;}
    }
  }
  const ordered=[...threads.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
  // Each run round-robins explicit approved sources. Persist a message cursor per source
  // so old uploads are eventually reached even when recent channels are busy.
  const stateKey="state/scan-cursor-v2.json";
  let state={cursor:0,before:{},retries:[]};
  if(await client.exists(stateKey)){
    const previous=await client.file(stateKey).json();
    if(previous?.guild===G && typeof previous?.before==="object" && previous.before!==null){
      state={cursor:Math.max(0,Number(previous.cursor)||0),before:previous.before,retries:Array.isArray(previous.retries)?previous.retries.filter(r=>r&&snow(r.channel)&&snow(r.message)&&snow(r.attachment)):[]};
    }
  }
  // Process held originals first; rotate failing entries so they never starve others.
  const retryBudget=Math.min(8,Math.max(1,Math.floor(MAX_ITEMS/2)));
  const retryNow=state.retries.splice(0,Math.min(retryBudget,state.retries.length));
  for(const retry of retryNow){
    if(attempted>=MAX_ITEMS){state.retries.push(retry);continue;}
    attempted++;
    try{
      // A persisted retry ID is not an authorization grant. Recheck the original source allowlist.
      if(!DIRECT.includes(retry.channel)&&!threads.has(retry.channel))
        throw Error("retry_source_not_allowlisted");
      const scope=await discord("/channels/"+retry.channel);
      if(scope.guild_id!==G)throw Error("retry_channel_cross_guild_denied");
      const msg=await discord("/channels/"+retry.channel+"/messages/"+retry.message);
      if(msg?.id!==retry.message||msg.channel_id!==retry.channel)throw Error("retry_message_scope_mismatch");
      const asset=(msg.attachments||[]).find(a=>a.id===retry.attachment);
      if(!asset)throw Error("retry_media_missing");
      await storeAnyOriginal(asset,{id:retry.channel},msg);
      log("MEDIA_RETRY_RECOVERED",{message:retry.message,attachment:retry.attachment,discordWrites:0});
    }catch(err){
      held++;state.retries.push(retry);
      log("MEDIA_RETRY_HELD",{message:retry.message,attachment:retry.attachment,reason:String(err).slice(0,100)});
    }
  }
  function queueRetry(channel,message,attachment){
    if(![channel,message,attachment].every(snow))return;
    if(!state.retries.some(x=>x.channel===channel&&x.message===message&&x.attachment===attachment)){
      if(state.retries.length>=5000)throw Error("MEDIA_RETRY_CAP_NO_CURSOR_ADVANCE");
      state.retries.push({channel,message,attachment});
    }
  }
  if(state.retries.length>5000){log("MEDIA_RETRY_CAP_REVIEW",{pending:state.retries.length});process.exitCode=1;}
  const allSources=[...DIRECT.map(id=>({id,direct:true})),...ordered.map(t=>({id:t.id,direct:false}))];
  const count=Math.min(MAX_THREADS,allSources.length);
  const offset=allSources.length ? state.cursor%allSources.length : 0;
  const queues=[];
  for(let i=0;i<count;i++)queues.push(allSources[(offset+i)%allSources.length]);
  const visited=new Set();
  const PER_SOURCE_BUDGET=10;
  for(const entry of queues){
    if(attempted>=MAX_ITEMS)break;
    if(visited.has(entry.id))continue;
    visited.add(entry.id);
    const pageSize=entry.direct?80:40;
    const before=state.before[entry.id]||"";
    let msgs;
    try{msgs=await discord("/channels/"+entry.id+"/messages?limit="+pageSize+(before?"&before="+encodeURIComponent(before):""));}
    catch(e){held++;log("SOURCE_HELD",{channel:entry.id,reason:String(e).slice(0,90)});continue}
    if(!Array.isArray(msgs)){held++;continue}
    let scannedMedia=0,lastComplete=null,paused=false;
    for(const m of msgs){
      const media=(m.attachments||[]).filter(a=>{
        const extension=ext(a.filename);
        const ct=String(a.content_type||"").toLowerCase().split(";")[0];
        return ct.startsWith("image/") || ct.startsWith("video/") || ct.startsWith("audio/") ||
          ["jpg","jpeg","png","webp","gif","heic","heif","avif","bmp","tif","tiff","mp4","mov","m4v","webm","mkv","avi","wmv","3gp","mpeg","mpg","ogv","mp3","wav","wave","flac","ogg","opus","m4a","aac","aif","aiff","wma","amr","caf"].includes(extension);
      });
      if(media.length && ((scannedMedia>0 && scannedMedia+media.length>PER_SOURCE_BUDGET) || attempted+media.length>MAX_ITEMS)){
        for(const deferred of media)queueRetry(entry.id,m.id,deferred.id);
        log("MEDIA_DEFERRED_TO_RETRY",{channel:entry.id,message:m.id,queued:media.length,reason:"per_run_budget",sourceDeleted:false});
        lastComplete=m.id;
        paused=true;break;
      }
      for(const a of media){
        attempted++;scannedMedia++;
        try{
          await storeAnyOriginal(a,entry,m);
        }catch(e){held++;queueRetry(entry.id,m.id,a.id);log("MEDIA_HELD",{channel:entry.id,message:m.id,attachment:a.id,reason:String(e).slice(0,120),retryQueued:true})}
      }
      lastComplete=m.id;
      if(scannedMedia>=PER_SOURCE_BUDGET){paused=true;break}
    }
    if(lastComplete){
      state.before[entry.id]=(!paused && msgs.length<pageSize)?null:lastComplete;
    }else if(!msgs.length && before){
      state.before[entry.id]=null;
    }
  }
  await client.write(stateKey,JSON.stringify({guild:G,cursor:allSources.length?(offset+visited.size)%allSources.length:0,before:state.before,retries:state.retries,updatedAt:new Date().toISOString(),lastAttempted:attempted,lastHeld:held}),{type:"application/json"});
  const savedState=await client.file(stateKey).json();
  if(savedState.guild!==G)throw Error("state_roundtrip_failed");
  log("COMPLETE",{attempted,saved,reused,held,lowResolutionExistingCopies:lowRes,sourceCount:allSources.length,sourcesVisited:visited.size,pendingRetries:state.retries.length,discordWrites:0,deleteCount:0});
  if(held)log("ATTENTION_REQUIRED",{held,action:"review_source_integrity_and_permissions",originalFilesUntouched:true});
}
await main().catch(e=>{log("FAILED",{reason:String(e).slice(0,190),errorName:e?.name||null,errorCode:String(e?.name||e?.code||e?.status||e?.statusCode||"none"),httpStatus:e?.$metadata?.httpStatusCode||null,attempted,saved,reused,held});process.exitCode=1});
