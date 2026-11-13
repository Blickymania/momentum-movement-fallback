// UMM_GALLERY_PHOTO_FIRST_ATTESTATION_V12_20261107 — photo first, one native photo per non-guide thread; no writes.
// UMM_FULL_THREAD_MEDIA_HISTORY_V11 — bounded pagination and verified starter identity, no false pass on hidden older attachments.
// UMM_LEGACY_VIDEO_COVER_REVIEW_V10 — retain original video threads, require native photo for photo-bearing galleries, report cover gaps.
// UMM_GALLERY_PHOTO_FIRST_RULE_V9 — gallery covers must be native starter photos; audio/video cannot replace the photo cover.
// UMM_PREFLIGHT_SOURCE_GUILD_SCOPE_V8 — independent guild and message identity verification for provenance reads.
// UMM_ARCHIVE_ROTATING_CANARY_V7 — rotate three read-only provenance samples through complete archived inventory.
// UMM_ARCHIVE_VAULT_ATTESTATION_V6 — receipt+vault diagnosis without falsely certifying deleted original sources.
// UMM_PREFLIGHT_LEGACY_PROVENANCE_V5 — legacy receipt fallback and video-first; no false success before vault checks.
// UMM_ARCHIVE_PAGINATED_PREFLIGHT_V4 — archive read-only pagination and conversion-aware original checks.
// UMM_PREFLIGHT_GUILD_SCOPED_V2 — read-only, no hard-coded archive guild or forum.
import {createHash} from 'node:crypto';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
// PHOTO_MANAGEMENT_V3_PRELAUNCH_CANARY
// Read-only, guild-scoped media readiness audit. NO Discord write methods, NO storage writes.
type Json = Record<string,unknown>;
const env=Bun.env;
const LOG=(event:string,detail:Json={})=>console.log(JSON.stringify({event,component:"photo-v3-preflight",guild:env.PHOTO_V3_EXPECTED_GUILD_ID||"",...detail}));
if(env.PHOTO_V3_PREFLIGHT_ENABLED!=="true"){
 LOG("PREFLIGHT_HELD",{reason:"not_enabled",discordWrites:0,storageWrites:0,sourceDeletes:0});
} else {
 const gid=env.PHOTO_V3_EXPECTED_GUILD_ID||"";
 const forumId=env.PHOTO_V3_GALLERY_FORUM_ID||"";
 const token=env.DISCORD_BOT_TOKEN||env.DISCORD_TOKEN||"";
 const maxThreads=Math.min(30,Math.max(1,Number(env.PHOTO_V3_MAX_THREADS||"15")));
 LOG("PREFLIGHT_CONFIG_CHECK",{guildIdValid:/^\d{17,20}$/.test(gid),forumIdValid:/^\d{17,20}$/.test(forumId),expectedBotIdValid:/^\d{17,20}$/.test(env.PHOTO_V3_EXPECTED_BOT_ID||""),tokenConfigured:!!token,guildIdMatches:gid==="1565048205970767992",forumIdMatches:forumId==="1565643519891079198"});if(!/^\d{17,20}$/.test(gid)||!/^\d{17,20}$/.test(forumId)||!token)throw Error("PRECHECK_CONFIG_MISSING");
 const root="https://discord.com/api/v10";
 async function get(path:string){
   if(!/^\/(?:users\/@me|guilds\/\d{17,20}|channels\/\d{17,20})(?:[\/?].*)?$/.test(path))throw Error("READ_SCOPE_DENIED");
   for(let tries=0;tries<3;tries++){
     const r=await fetch(root+path,{headers:{authorization:"Bot "+token},signal:AbortSignal.timeout(20000)});
     const t=await r.text();LOG("PREFLIGHT_HTTP_READ",{path,status:r.status});let data:any={};try{data=t?JSON.parse(t):{}}catch{throw Error("BAD_RESPONSE")}
     if(r.status===429&&tries<2){await Bun.sleep(Math.min(15000,Math.ceil(Number(data.retry_after||2)*1000)+300));continue}
     if(!r.ok)throw Error("DISCORD_READ_HTTP_"+r.status);
     return data;
   }
   throw Error("READ_RATE_LIMITED");
 }
 async function archivedComplete(id:string){
   const all:any[]=[];let before="";
   for(let page=0;page<20;page++){
     const x=await get("/channels/"+id+"/threads/archived/public?limit=100"+(before?"&before="+encodeURIComponent(before):""));
     if(!Array.isArray(x?.threads))throw Error("ARCHIVED_RESPONSE_INVALID");
     all.push(...x.threads);
     if(!x.has_more)return {threads:all,has_more:false,pages:page+1};
     const next=x.threads.at(-1)?.thread_metadata?.archive_timestamp;
     if(!next||next===before)throw Error("ARCHIVED_CURSOR_STALLED");
     before=next;
   }
   return {threads:all,has_more:true,pages:20};
 }
 async function completeThreadMessages(id:string){
   const all:any[]=[];let before="";
   for(let page=0;page<10;page++){
     const msgs=await get("/channels/"+id+"/messages?limit=100"+(before?"&before="+encodeURIComponent(before):""));
     if(!Array.isArray(msgs))throw Error("THREAD_MESSAGE_RESPONSE_INVALID");
     all.push(...msgs);
     if(msgs.length<100)return all;
     const cursor=msgs.at(-1)?.id;
     if(!cursor||cursor===before)throw Error("THREAD_MESSAGE_CURSOR_STALLED");
     before=cursor;
   }
   throw Error("THREAD_MESSAGE_SCAN_LIMIT_REACHED");
 }
 try{
   const [me,guild,forum,active,archived]=await Promise.all([
     get("/users/@me"),get("/guilds/"+gid),get("/channels/"+forumId),
     get("/guilds/"+gid+"/threads/active"),archivedComplete(forumId)
   ]);
   if(!me.bot||me.id!==env.PHOTO_V3_EXPECTED_BOT_ID||guild.id!==gid||forum.guild_id!==gid||forum.type!==15||forum.default_forum_layout!==2)throw Error("GUILD_OR_FORUM_SCOPE_MISMATCH");
   const threadMap=new Map<string,any>();
   for(const t of [...(active.threads||[]),...(archived.threads||[])])if(t.parent_id===forumId)threadMap.set(t.id,t);
   const threads=[...threadMap.values()].slice(0,maxThreads);
   let attachments=0,lowRes=0,nativeStarter=0,externalCover=0,noCover=0,unreadable=0,scanned=0;
   const galleryHolds: Array<{thread:string,reason:string,nativePhotos:number,starterNative:number}> = [];
   for(const t of threads){
     try{
       const messages=await get("/channels/"+t.id+"/messages?limit=100");
       if(!Array.isArray(messages))throw Error("BAD_MESSAGES");
       if(messages.length===100){unreadable++;continue}
       scanned++;
       const starter=messages.find((m:any)=>m.id===t.id);
       const images=messages.flatMap((m:any)=>(m.attachments||[]).filter((a:any)=>String(a.content_type||"").startsWith("image/")));
       attachments+=images.length;
       lowRes+=images.filter((a:any)=>Math.max(Number(a.width||0),Number(a.height||0))<=250).length;
       const nativeStarterPhotos=(starter?.attachments||[]).filter((a:any)=>String(a.content_type||"").startsWith("image/")).length;
       if(nativeStarterPhotos>0)nativeStarter++;
       else if((starter?.embeds||[]).some((e:any)=>e.image?.url||e.thumbnail?.url))externalCover++;
       else noCover++;
       const isGuide=/posting[\s-]?guide|gallery[\s-]?guide|^📌/i.test(String(t.name||""));
       if(!isGuide&&(nativeStarterPhotos!==1||images.length!==1)){
         const issue={thread:t.id,reason:nativeStarterPhotos!==1?"native_photo_starter_required":"one_photo_per_thread_required",nativePhotos:images.length,starterNative:nativeStarterPhotos};
         galleryHolds.push(issue);
         LOG("GALLERY_PHOTO_FIRST_HOLD",{...issue,photoSourcePreserved:true,discordWrites:0,sourceDeletes:0});
       }
     }catch{unreadable++}
   }

   // Strict read-only proof: original Discord bytes -> native gallery starter -> S3 vault object.
   // Never publish, delete, or copy content during this audit.
   const guildChannels=await get("/guilds/"+gid+"/channels");
    if(!Array.isArray(guildChannels))throw Error("EVENT_FORUM_CHANNELS_UNAVAILABLE");
    const eventMatches=guildChannels.filter(c=>c.guild_id===gid&&c.type===15&&/(?:event.media.archive|archived.flyers)/i.test(String(c.name||"")));
    if(eventMatches.length!==1)throw Error("EVENT_ARCHIVE_AMBIGUOUS_OR_MISSING");
    const eventForumId=eventMatches[0].id;
   const eventsForum=await get("/channels/"+eventForumId);
   if(eventsForum.guild_id!==gid||eventsForum.type!==15||eventsForum.default_forum_layout!==2)throw Error("EVENT_ARCHIVE_SCOPE_INVALID");
   const eventsArchived=await archivedComplete(eventForumId);
   const eventPopulation=[...new Map([...(active.threads||[]),...(eventsArchived.threads||[])].filter(t=>t.parent_id===eventForumId).map(t=>[t.id,t])).values()];
    const sampleOffset=eventPopulation.length?(Math.floor(Date.now()/86400000)*3)%eventPopulation.length:0;
    const eventThreadCandidates=Array.from({length:Math.min(3,eventPopulation.length)},(_,i)=>eventPopulation[(sampleOffset+i)%eventPopulation.length]);
   const eventThreads=[];
   for(const candidate of eventThreadCandidates){
    const guideMessages=await completeThreadMessages(candidate.id);
    const guideStarter=guideMessages.find(m=>m.id===candidate.id);
    const isGuide=guideStarter?.author?.id===env.PHOTO_V3_EXPECTED_BOT_ID&&/ARCHIVE ONLY\s*[—-]\s*EVENT MEDIA/i.test(String(guideStarter?.content||""))&&(guideStarter?.attachments||[]).length===0&&guideMessages.every(m=>(m.attachments||[]).length===0);
    if(isGuide){LOG("EVENT_ARCHIVE_GUIDE_EXCLUDED",{thread:candidate.id,reason:"bot_authored_rules_post_not_event_media",discordWrites:0,sourceDeletes:0});continue;}
    eventThreads.push(candidate);
   }
   if(eventsArchived.has_more){LOG("EVENT_ARCHIVE_SAMPLE_INCOMPLETE",{reason:"more_archived_threads",sampleCount:eventThreads.length,inventoryComplete:false});}
   const s3Ready=["PHOTO_V3_S3_ENDPOINT","PHOTO_V3_S3_BUCKET","PHOTO_V3_S3_ACCESS_KEY_ID","PHOTO_V3_S3_SECRET_ACCESS_KEY"].every(k=>!!env[k]&&!String(env[k]).startsWith("$"+"{{"));
   let eventImagesVerified=0,eventVideosVerified=0,eventAudioVerified=0, vaultObjectsVerified=0, eventHolds=0,archiveVaultAttested=0,legacyCoverReview=0;
   const sha256=data=>createHash("sha256").update(data).digest("hex");
   const loadImage=async a=>{
     if(!a||!a.url||!Number(a.size)||Number(a.size)>30*1024*1024)throw Error("IMAGE_OR_SIZE_MISSING");
     const u=new URL(a.url);
     if(u.protocol!=="https:"||!["cdn.discordapp.com","media.discordapp.net"].includes(u.hostname))throw Error("IMAGE_HOST_DENIED");
     const response=await fetch(a.url,{redirect:"error",signal:AbortSignal.timeout(30000)});
     if(!response.ok)throw Error("IMAGE_DOWNLOAD_"+response.status);
     const bytes=new Uint8Array(await response.arrayBuffer());
     if(bytes.length!==Number(a.size))throw Error("IMAGE_LENGTH_MISMATCH");
     return bytes;
   };
   const storage=s3Ready?new S3Client({region:env.PHOTO_V3_S3_REGION||"auto",endpoint:env.PHOTO_V3_S3_ENDPOINT,forcePathStyle:false,credentials:{accessKeyId:env.PHOTO_V3_S3_ACCESS_KEY_ID,secretAccessKey:env.PHOTO_V3_S3_SECRET_ACCESS_KEY},maxAttempts:2}):null;

   let legacyMatched=0,legacyIdentical=0,legacyDifferent=0,legacyMissing=0,legacyUnreadable=0,legacyVaultVerified=0,legacyVaultMissing=0;
   const legacyDifferences=[];
   try{
    const legacyThreadId="1566085474534170736";
    const legacyChannel=await get("/channels/1565592613795532893");
    const legacyThread=await get("/channels/"+legacyThreadId);
    if(legacyChannel.guild_id!==gid||legacyThread.guild_id!==gid||legacyThread.parent_id!==legacyChannel.id)throw Error("LEGACY_GALLERY_SCOPE_MISMATCH");
    const [legacyMessages,...galleryMessagePages]=await Promise.all([
     completeThreadMessages(legacyThreadId),
     ...threads.map(t=>get("/channels/"+t.id+"/messages?limit=100"))
    ]);
    const legacyFiles=legacyMessages.flatMap(m=>(m.attachments||[]).filter(a=>String(a.content_type||"").startsWith("image/")));
    const galleryFiles=galleryMessagePages.flat().flatMap(m=>(m.attachments||[]).filter(a=>String(a.content_type||"").startsWith("image/")));
    const byFilename=new Map();
    for(const file of galleryFiles){const arr=byFilename.get(file.filename)||[];arr.push(file);byFilename.set(file.filename,arr);}
    const pairs=[];
    for(const original of legacyFiles){
     const candidates=byFilename.get(original.filename)||[];
     const match=candidates.find(a=>Number(a.size)===Number(original.size))||candidates[0];
     if(!match){legacyMissing++;continue;}
     legacyMatched++;
     try{
      const [oldBytes,newBytes]=await Promise.all([loadImage(original),loadImage(match)]);
      const oldHash=sha256(oldBytes),newHash=sha256(newBytes);
      const same=oldHash===newHash;
      if(same)legacyIdentical++;else{legacyDifferent++;legacyDifferences.push({filename:original.filename,legacyBytes:oldBytes.length,galleryBytes:newBytes.length,legacySha256:oldHash,gallerySha256:newHash});}
      if(s3Ready&&storage){
       const ext=String(original.filename||"").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,6)||"bin";
       try{
        const object=await storage.send(new GetObjectCommand({Bucket:env.PHOTO_V3_S3_BUCKET,Key:"objects/sha256/"+oldHash.slice(0,2)+"/"+oldHash+"."+ext}));
        if(!object.Body)throw Error("EMPTY_VAULT_OBJECT");
        const vaultBytes=new Uint8Array(await object.Body.transformToByteArray());
        if(vaultBytes.length===oldBytes.length&&sha256(vaultBytes)===oldHash)legacyVaultVerified++;
        else legacyVaultMissing++;
       }catch{legacyVaultMissing++;}
      }
      pairs.push({filename:original.filename,bytes:oldBytes.length,dimensions:[Number(original.width||0),Number(original.height||0)],identical:same,sha256:oldHash});
     }catch(error){legacyUnreadable++;pairs.push({filename:original.filename,reason:String(error?.message||error).slice(0,100)});}
    }
    LOG("LEGACY_GALLERY_HASH_AUDIT",{legacyFiles:legacyFiles.length,galleryFiles:galleryFiles.length,matched:legacyMatched,byteIdentical:legacyIdentical,different:legacyDifferent,missing:legacyMissing,unreadable:legacyUnreadable,lowResolution:legacyFiles.filter(a=>Math.max(Number(a.width||0),Number(a.height||0))<=250).length,vaultVerified:legacyVaultVerified,vaultMissing:legacyVaultMissing,differences:legacyDifferences.slice(0,5),discordWrites:0,storageWrites:0,sourceDeletes:0});
   }catch(error){
    LOG("LEGACY_GALLERY_HASH_AUDIT_HELD",{reason:String(error?.message||error).slice(0,140),discordWrites:0,storageWrites:0,sourceDeletes:0});
   }

   for(const thread of eventThreads){
      let starterForFallback=null;
      try{
       const [msgs,starter]=await Promise.all([completeThreadMessages(thread.id),get("/channels/"+thread.id+"/messages/"+thread.id)]);
       if(!msgs.some(m=>m.id===thread.id)||starter?.id!==thread.id)throw Error("STARTER_NOT_PRESENT_IN_COMPLETE_HISTORY");
        starterForFallback=starter||null;
       const native=(a)=>String(a?.content_type||'').startsWith('image/')||String(a?.content_type||'').startsWith('video/')||String(a?.content_type||'').startsWith('audio/');
       const media=msgs.flatMap(m=>(m.attachments||[]).filter(native));
       const photos=media.filter(a=>String(a.content_type||'').startsWith('image/'));
       if(!starter||!Array.isArray(starter.attachments)||starter.attachments.length!==1||media.length!==1||!native(starter.attachments[0]))throw Error("MEDIA_FIRST_SINGLE_FILE_RULE");
       const mediaKind=String(starter.attachments[0].content_type||"").split("/")[0];
       if(photos.length&&!(mediaKind==="image"&&photos.length===1))throw Error("PHOTO_GALLERY_STARTER_RULE");
       if(!photos.length){legacyCoverReview++;LOG("LEGACY_NONPHOTO_MEDIA_REVIEW",{thread:thread.id,mediaKind,galleryCoverVerified:false,sourceDeletes:0,discordWrites:0});}
       const originLink=String(starter.content||"").match(/https:\/\/discord\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})/);
       const imageId=String(starter.content||"").match(/\*\*Source image ID:\*\* (\d{17,20})/);
       if(!originLink||originLink[1]!==gid)throw Error("ORIGINAL_SOURCE_LINK_MISSING_OR_WRONG_GUILD");
       const originChannel=await get("/channels/"+originLink[2]);
       if(originChannel.guild_id!==gid)throw Error("ORIGINAL_SOURCE_CROSS_GUILD_DENIED");
       const src=await get("/channels/"+originLink[2]+"/messages/"+originLink[3]);
       if(src?.id!==originLink[3]||src.channel_id!==originLink[2])throw Error("ORIGINAL_SOURCE_IDENTITY_MISMATCH");
       const srcFiles=(src.attachments||[]).filter(a=>/^(image|video|audio)\//.test(String(a.content_type||"")));
        const declaredFilename=String(starter.content||"").match(/\*\*Original filename:\*\*\s*([^\n]+)/i)?.[1]?.trim();
        const original=imageId?srcFiles.find(a=>a.id===imageId[1]):(declaredFilename?srcFiles.find(a=>a.filename===declaredFilename):srcFiles.length===1?srcFiles[0]:null);
       if(!original)throw Error("ORIGINAL_MEDIA_ATTACHMENT_NOT_UNAMBIGUOUS");
       const [originalBytes,archiveBytes]=await Promise.all([loadImage(original),loadImage(starter.attachments[0])]);
       const digest=sha256(originalBytes);
        const receiptHash=String(starter.content||"").match(/\*\*Original SHA-256:\*\*\s*([a-f0-9]{64})/i)?.[1]?.toLowerCase();
        if(receiptHash&&receiptHash!==digest)throw Error("ORIGINAL_RECEIPT_HASH_MISMATCH");
       const galleryDigest=sha256(archiveBytes),hasConversionReceipt=String(starter.content||"").includes("**Display conversion:**");
        if(galleryDigest!==digest&&!hasConversionReceipt)throw Error("GALLERY_SHA256_MISMATCH_UNACKNOWLEDGED");
       if(!storage)throw Error("VAULT_SETTINGS_UNAVAILABLE");
       const ext=String(original.filename||"").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,6)||"bin";
       const key="objects/sha256/"+digest.slice(0,2)+"/"+digest+"."+ext;
       const copy=await storage.send(new GetObjectCommand({Bucket:env.PHOTO_V3_S3_BUCKET,Key:key}));
       if(!copy.Body)throw Error("VAULT_OBJECT_EMPTY");
       const vaulted=new Uint8Array(await copy.Body.transformToByteArray());
       if(sha256(vaulted)!==digest||vaulted.length!==originalBytes.length)throw Error("VAULT_SHA256_MISMATCH");
       vaultObjectsVerified++;if(mediaKind==="image")eventImagesVerified++;else if(mediaKind==="video")eventVideosVerified++;else eventAudioVerified++;
        LOG("PRELAUNCH_MEDIA_VERIFIED",{thread:thread.id,sourceMessage:src.id,sourceImage:original.id,sha256:digest,originalBytes:originalBytes.length,galleryBytes:archiveBytes.length,vaultBytes:vaulted.length,verifiedOriginalCopies:2,verifiedDisplayCopy:1,displayConverted:galleryDigest!==digest,displaySha256:galleryDigest,discordWrites:0,storageWrites:0,sourceDeletes:0});
     }catch(error){
        eventHolds++;
        const reason=String(error?.message||error);
        if(starterForFallback&&/(ORIGINAL_SOURCE_LINK_MISSING|DISCORD_READ_HTTP_404|ORIGINAL_MEDIA_ATTACHMENT_NOT_UNAMBIGUOUS)/.test(reason)){
          try{
            const content=String(starterForFallback.content||"");
            const receiptHash=content.match(/\*\*Original SHA-256:\*\*\s*([a-f0-9]{64})/i)?.[1]?.toLowerCase();
            const originalFilename=content.match(/\*\*Original filename:\*\*\s*([^\n]+)/i)?.[1]?.trim();
            if(!receiptHash||!originalFilename)throw Error("HISTORICAL_ORIGINAL_RECEIPT_INCOMPLETE");
            if(!storage)throw Error("VAULT_SETTINGS_UNAVAILABLE");
            const archived=await loadImage(starterForFallback.attachments?.[0]);
            if(sha256(archived)!==receiptHash)throw Error("ARCHIVE_RECEIPT_HASH_MISMATCH");
            const ext=originalFilename.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,6)||"bin";
            const key="objects/sha256/"+receiptHash.slice(0,2)+"/"+receiptHash+"."+ext;
            const obj=await storage.send(new GetObjectCommand({Bucket:env.PHOTO_V3_S3_BUCKET,Key:key}));
            if(!obj.Body)throw Error("VAULT_RECEIPT_OBJECT_MISSING");
            const bytes=new Uint8Array(await obj.Body.transformToByteArray());
            if(bytes.length!==archived.length||sha256(bytes)!==receiptHash)throw Error("ARCHIVE_VAULT_RECEIPT_MISMATCH");
            archiveVaultAttested++;
            LOG("PRELAUNCH_ARCHIVE_VAULT_ATTESTED_ONLY",{thread:thread.id,sha256:receiptHash,bytes:bytes.length,sourceIndependentlyVerified:false,originalSourceUnreachable:true,readyToPublish:false,discordWrites:0,sourceDeletes:0});
          }catch(verificationError){LOG("PRELAUNCH_ARCHIVE_ATTESTATION_HELD",{thread:thread.id,reason:String(verificationError?.message||verificationError).slice(0,125),originalsDeleted:0})}
        }
        LOG("PRELAUNCH_MEDIA_HOLD",{thread:thread.id,code:reason.slice(0,125),originalsDeleted:0})
      }
   }
   LOG("PRELAUNCH_INTEGRITY",{eventThreadsFound:eventThreads.length,eventThreadPopulation:eventPopulation.length,sampleOffset,eventImagesVerified,eventVideosVerified,eventAudioVerified,legacyCoverReview,vaultObjectsVerified,archiveVaultAttested,eventHolds,sourceDeletes:0,discordWrites:0,storageWrites:0});
   if(eventHolds||legacyCoverReview)LOG("PRELAUNCH_MEDIA_BLOCKERS_RECORDED",{eventHolds,legacyCoverReview,readyToPublish:false,discordWrites:0,sourceDeletes:0});
    if(eventThreads.length===0)LOG("EVENT_ARCHIVE_NO_SAMPLE",{reason:"no_active_or_archived_event_threads",integrityNotYetProven:true});

   const inventoryComplete=!archived.has_more&&threadMap.size<=maxThreads&&unreadable===0&&galleryHolds.length===0;
   if(!inventoryComplete){LOG('PRELAUNCH_INVENTORY_INCOMPLETE',{reason:'additional_media_or_unreadable_threads',discordWrites:0,sourceDeletes:0,readyToPublish:false});}
   const readyToPublish=false; // Intentionally hard-disabled until vault, authorization, and rollback are tested.
   LOG("PRELAUNCH_INVENTORY",{threadCount:threadMap.size,scanned,attachments,lowRes,nativeStarter,externalCover,noCover,unreadable,inventoryComplete:!archived.has_more&&threadMap.size<=maxThreads&&unreadable===0,readyToPublish,galleryIntegrityHolds:galleryHolds,discordWrites:0,storageWrites:0,sourceDeletes:0,configuredVault:!!env.PHOTO_V3_S3_BUCKET});
 }catch(e){LOG("PREFLIGHT_FAILED",{code:String(e).slice(0,140),discordWrites:0});await Bun.sleep(1200);process.exitCode=1}
}
