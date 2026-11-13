import { createHash } from "node:crypto";

type Source = {url:string; label?:string; trusted?:boolean};
type Hit = {url:string; image:string; alt:string; source:string; evidence:string; confidence:number; tag:string};
const e = Bun.env;
const NAME = e.GALLERY_CREATOR || "Creator";
const HANDLE = (e.GALLERY_HANDLE || "").toLowerCase().replace(/^@/, "");
const GUILD = e.GUILD_ID || "";
const FORUM = e.GALLERY_FORUM_ID || "";
const TOKEN = e.DISCORD_BOT_TOKEN || "";
const MODE = "review"; // PHOTO_V3_PREDEPLOY: no automatic web publishing
const SEARCH_KEY = e.BRIGHTDATA_API_TOKEN || e.BRIGHTDATA_API_KEY || e.SERPER_API_KEY || e.BRAVE_SEARCH_API_KEY || e.SERPAPI_API_KEY || "";
const MAX_PAGES = Math.min(100, Math.max(1, Number(e.GALLERY_MAX_PAGES || "24")));
const MAX_HITS = Math.min(400, Math.max(1, Number(e.GALLERY_MAX_HITS || "120")));
const MAX_DEPTH = Math.min(3, Math.max(0, Number(e.GALLERY_MAX_DEPTH || "2")));
const sources:Source[] = JSON.parse(e.GALLERY_SOURCES_JSON || "[]");
const allowed = new Set((e.GALLERY_ALLOWED_HOSTS || "").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean));
for (const item of sources) { try {allowed.add(new URL(item.url).hostname.toLowerCase())} catch {} }
const aliases = [NAME, HANDLE, ...(e.GALLERY_ALIASES || "").split("|")]
  .map(x=>x.toLowerCase().replace(/^@/,"").replace(/[^a-z0-9]/g,"")).filter(x=>x.length>=4);
const seen = new Set<string>();
const found = new Map<string,Hit>();
const gaps:Array<{url:string;reason:string}> = [];
const stats = {pages:0, images:0, trusted:0, review:0, existing:0, published:0, blocked:0, searchProvider:!!SEARCH_KEY};
function log(type:string, value:Record<string,unknown>={}) {
  console.log(JSON.stringify({system:"creator-gallery-discovery",version:"1.0.0",creator:NAME,guild:GUILD,type,...value}));
}
function normalized(s:string){return s.toLowerCase().replace(/&(?:amp|quot|#39);/g,"").replace(/[^a-z0-9]/g,"")}
function identity(s:string){const n=normalized(s);return aliases.some(a=>n.includes(a))}
function safeUrl(url:string, parent?:string):string|null {
  try {
    const u=new URL(url,parent);
    if(u.protocol!=="https:"||u.username||u.password||!allowed.has(u.hostname.toLowerCase())) return null;
    if(!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(u.hostname)) return null;
    u.hash="";
    return u.toString();
  } catch {return null}
}
function attr(tag:string,name:string){
  const match=tag.match(new RegExp("(?:^|\\s)"+name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i"));
  return (match?.[1] || match?.[2] || match?.[3] || "").replace(/&amp;/g,"&");
}
async function fetchText(url:string):Promise<{body:string;final:string}|null>{
  let current=safeUrl(url);
  if(!current) return null;
  for(let i=0;i<4;i++){
    const res=await fetch(current,{headers:{"User-Agent":"CreatorGalleryArchiveBot/1.0 (public-source-citation-only)","Accept":"text/html,application/xhtml+xml"},redirect:"manual",signal:AbortSignal.timeout(13000)});
    if([301,302,303,307,308].includes(res.status)){
      const next=safeUrl(res.headers.get("location")||"",current);
      if(!next) throw Error("unapproved_redirect");
      current=next;continue;
    }
    if(!res.ok) throw Error("http_"+res.status);
    const type=res.headers.get("content-type")||"";
    if(!type.includes("text/html")) throw Error("not_html");
    const size=Number(res.headers.get("content-length")||0);
    if(size>3000000) throw Error("page_too_large");
    const text=await res.text();
    if(text.length>3000000) throw Error("page_too_large");
    return {body:text,final:current};
  }
  throw Error("too_many_redirects");
}
function rankHit(h:Hit){const prev=found.get(h.image.split("?")[0]);if(!prev||prev.confidence<h.confidence)found.set(h.image.split("?")[0],h)}
function inspect(url:string,html:string,source:Source,depth:number):string[]{
  const links:string[]=[];
  stats.pages++;
  const pageIdentity=identity((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"");
  // Include lazy-loaded and responsive media; do not interpret URL/alt as identity proof.
  const imgs=html.match(/<img\b[^>]{0,2500}>/gi)||[];
  for(const item of imgs){
    const alt=attr(item,"alt");
    const responsive=attr(item,"srcset")||attr(item,"data-srcset");
    const candidates=[
      attr(item,"data-src"),attr(item,"data-original"),attr(item,"data-lazy-src"),attr(item,"src"),
      ...responsive.split(",").map(s=>s.trim().split(/\s+/)[0])
    ].filter(Boolean).slice(0,9);
    for(const src of candidates){
      let image:string;
      try{image=new URL(src,url).toString()}catch{continue}
      if(!image.startsWith("https://"))continue;
      if(/(?:avatar-placeholder|tracking|pixel|logo|favicon|icon|sprite)/i.test(image))continue;
      const direct=identity(alt),namedImage=identity(image);
      if(!direct&&!namedImage&&!pageIdentity)continue;
      const page=new URL(url);
      const onNamedCreatorAccount=Boolean(HANDLE) &&
        /(^|\.)(instagram\.com|tiktok\.com|lemon8-app\.com|threads\.net|facebook\.com|youtube\.com)$/i.test(page.hostname) &&
        normalized(page.pathname).includes(normalized(HANDLE));
      const confidence=source.trusted&&direct&&onNamedCreatorAccount?0.98:direct?0.92:namedImage?0.70:0.35;
      const tag=/career|realtor|business|nurse|artist|music|athlet|marathon|running/i.test(alt)?"Career":"Portraits";
      rankHit({url,image,alt,source:source.label||source.url,
        evidence:direct?"creator_naming_in_image_alt":namedImage?"creator_naming_in_media_url":"creator_named_on_page_needs_review",confidence,tag});
      stats.images++;
    }
  }
  // Social preview images remain review-only candidates, not authorized native uploads.
  const metaTags=html.match(/<meta\b[^>]{0,2500}>/gi)||[];
  for(const tag of metaTags){
    const key=(attr(tag,"property")||attr(tag,"name")).toLowerCase();
    if(!["og:image","og:image:secure_url","twitter:image","twitter:image:src"].includes(key))continue;
    const src=attr(tag,"content");
    let image:string;
    try{image=new URL(src,url).toString()}catch{continue}
    if(!image.startsWith("https://")||/(?:tracking|pixel|logo|favicon|icon|sprite)/i.test(image))continue;
    if(!pageIdentity&&!identity(image))continue;
    rankHit({url,image,alt:"",source:source.label||source.url,
      evidence:"page_metadata_image_needs_review",confidence:0.42,tag:"Needs Review"});
    stats.images++;
  }
  // Related pages only within the creator's approved host; no generic web-wide crawling.
  if(depth<MAX_DEPTH){
    const anchors=html.match(/<a\b[^>]{0,1500}>/gi)||[];
    for(const tag of anchors){
      const href=attr(tag,"href");
      const u=safeUrl(href,url);
      if(!u||seen.has(u)||/\.(?:jpg|jpeg|png|gif|webp|pdf|mp4)(?:\?|$)/i.test(u))continue;
      const context=tag+" "+u;
      if(identity(context)||/\/(?:creator|gallery|media|photo|portfolio|about|press|profile)/i.test(u))links.push(u);
      if(links.length>=MAX_PAGES)break;
    }
  }
  return links;
}
/* Additional image providers — Serper + Bright Data Google Images dataset.
 * Search hits ALWAYS enter the review queue: search relevance cannot certify identity, rights, or original file quality.
 * Keep API credentials in Railway Variables; this source contains no secrets.
 */
async function searchBrightDataAndSerper(){
  const bdToken=e.BRIGHTDATA_API_TOKEN||e.BRIGHTDATA_API_KEY||"";
  const bdDataset=e.BRIGHTDATA_DATASET_ID||"gd_m0cda3zn1y9cr8l8yr"; // Bright Data's published Google Images scraper ID
  const serperKey=e.SERPER_API_KEY||"";
  if(!bdToken&&!serperKey)return false;
  const names=[NAME,HANDLE,...(e.GALLERY_ALIASES||"").split("|")].map(s=>String(s||"").trim()).filter(s=>s.length>=4);
  const queries=[NAME+" photos",'"'+NAME+'" portraits',HANDLE?"@"+HANDLE+" photos":NAME+" gallery",
    ...names.slice(2,5).map(s=>'"'+s+'" photos'),NAME+" public appearances"];
  const limit=Math.min(8,Math.max(1,Number(e.GALLERY_SEARCH_QUERY_LIMIT||"4")));
  const unique=[...new Set(queries)].slice(0,limit);
  let added=0,requests=0;
  const onlyHttps=(s:unknown)=>{
    if(typeof s!=="string")return "";
    try{
      const u=new URL(s);
      if(u.protocol!=="https:"||u.username||u.password||u.port)return "";
      const h=u.hostname.toLowerCase();
      if(h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h.endsWith(".internal")||
         /^\d+\.\d+\.\d+\.\d+$/.test(h)||h.includes(":"))return "";
      return u.toString();
    }catch{return ""}
  };
  function register(image:unknown,page:unknown,title:unknown,provider:string,license?:unknown){
    const imageUrl=onlyHttps(image);
    const sourceUrl=onlyHttps(page);
    if(!imageUrl||!sourceUrl||/(?:tracking|pixel|favicon|sprite)\b/i.test(imageUrl))return;
    const heading=String(title||"").slice(0,160);
    const matched=identity(heading+" "+sourceUrl+" "+imageUrl);
    const tag=/flyer|poster|promo|lineup/i.test(heading)?"Promotional Art":
      /award|milestone|achievement/i.test(heading)?"Achievements":"Needs Review";
    rankHit({url:sourceUrl,image:imageUrl,alt:heading,source:provider,
      evidence:(matched?"search_context_match_unverified":"search_query_match_unverified")+
        (license?"_license_claim_review_required":""),
      confidence:matched?0.60:0.35,tag});
    added++;
  }
  if(bdToken){
    const budget=Math.min(unique.length,Math.max(1,Math.min(3,Number(e.GALLERY_BRIGHTDATA_QUERY_LIMIT||"1"))));
    for(const q of unique.slice(0,budget)){
      let snapshot="";
      try{
        const google=new URL("https://www.google.com/search");
        google.searchParams.set("q",q);
        google.searchParams.set("udm","2");
        google.searchParams.set("gl","us");
        google.searchParams.set("hl","en");
        const endpoint=new URL("https://api.brightdata.com/datasets/v3/scrape");
        endpoint.searchParams.set("dataset_id",bdDataset);
        endpoint.searchParams.set("format","json");
        const headers={"Authorization":"Bearer "+bdToken,"Content-Type":"application/json"};
        const res=await fetch(endpoint,{method:"POST",headers,
          body:JSON.stringify({input:[{url:google.toString()}]}),signal:AbortSignal.timeout(65000)});
        requests++;
        if(!res.ok)throw Error("scrape_http_"+res.status);
        let data:any=await res.json();
        if(res.status===202||data?.snapshot_id){
          snapshot=String(data.snapshot_id||"");
          if(!/^s(?:d)?_[a-zA-Z0-9_]+$/.test(snapshot))throw Error("invalid_snapshot_id");
          let ready=false;
          for(let i=0;i<6;i++){
            await Bun.sleep(3000);
            const p=await fetch("https://api.brightdata.com/datasets/v3/progress/"+snapshot,
              {headers:{"Authorization":"Bearer "+bdToken},signal:AbortSignal.timeout(14000)});
            if(!p.ok)throw Error("snapshot_progress_http_"+p.status);
            const state=await p.json();
            if(state.status==="failed")throw Error("snapshot_failed");
            if(state.status==="ready"){ready=true;break}
          }
          if(!ready){log("BRIGHTDATA_SNAPSHOT_PENDING",{snapshotId:snapshot,query:q,needsResume:true});continue}
          const r=await fetch("https://api.brightdata.com/datasets/v3/snapshot/"+snapshot+"?format=json",
            {headers:{"Authorization":"Bearer "+bdToken},signal:AbortSignal.timeout(20000)});
          if(!r.ok)throw Error("snapshot_http_"+r.status);
          data=await r.json();
        }
        const items=Array.isArray(data)?data:Array.isArray(data?.data)?data.data:Array.isArray(data?.results)?data.results:[];
        for(const hit of items.slice(0,150)){
          let source=hit.source_url||hit.source_link||hit.link||hit.url||"";
          if(/google\.[^/]+\/imgres/.test(String(source))){
            try{
              const u=new URL(source);
              source=u.searchParams.get("imgrefurl")||source;
            }catch{}
          }
          register(hit.image_url||hit.imageUrl,source,hit.title,"brightdata_google_images",hit.license);
        }
        log("BRIGHTDATA_QUERY_COMPLETE",{query:q,records:items.length,snapshotId:snapshot||null});
      }catch(ex){gaps.push({url:"brightdata_google_images",reason:String(ex).slice(0,150)});if(snapshot)log("BRIGHTDATA_SNAPSHOT_REVIEW",{snapshotId:snapshot})}
    }
  }
  log("ADDITIONAL_IMAGE_SEARCH_COMPLETE",{providers:[bdToken?"brightdata":null].filter(Boolean),
    requests,candidateRows:added,autoPublished:0});
  return true;
}

async function searchProvider(){
  const additionalProvidersEnabled=await searchBrightDataAndSerper();
  const brave=e.BRAVE_SEARCH_API_KEY||"";
  const serp=e.SERPAPI_API_KEY||"";
  if(!brave&&!serp){if(!additionalProvidersEnabled)log("IMAGE_SEARCH_UNCONFIGURED",{required:["BRIGHTDATA_API_TOKEN","SERPER_API_KEY"],searchesRun:0});return}
  const names=[NAME,HANDLE,...(e.GALLERY_ALIASES||"").split("|")].map(x=>String(x).trim()).filter(x=>x.length>3);
  const queries=[NAME+" photos",'"'+NAME+'" portraits',HANDLE?"@"+HANDLE+" photos":NAME+" gallery",
    ...names.slice(2,5).map(x=>'"'+x+'" photos'),NAME+" public appearances"];
  const limited=[...new Set(queries)].slice(0,Math.min(8,Math.max(1,Number(e.GALLERY_SEARCH_QUERY_LIMIT||"4"))));
  let requests=0,added=0;
  function add(image:string,url:string,title:string,from:string){
    if(typeof image!=="string"||typeof url!=="string")return;
    let i:URL,u:URL;
    try{i=new URL(image);u=new URL(url)}catch{return}
    if(i.protocol!=="https:"||u.protocol!=="https:"||i.username||u.username)return;
    const h=i.hostname.toLowerCase();
    if(h==="localhost"||h.endsWith(".local")||h.endsWith(".internal")||/^\d+\.\d+\.\d+\.\d+$/.test(h)||h.includes(":"))return;
    if(/(?:pixel|sprite|tracking|favicon)/i.test(i.pathname))return;
    const matched=identity(String(title||"")+" "+url+" "+image);
    const tag=/promo|flyer|poster/i.test(title)?"Promotional Art":/milestone|award|achievement/i.test(title)?"Achievements":"Needs Review";
    rankHit({url,image,alt:String(title||"").slice(0,180),source:from,
      evidence:matched?"unverified_search_context":"unverified_search_query",
      confidence:matched?0.60:0.35,tag});
    added++;
  }
  for(const q of limited){
    if(brave){
      try{
        const uri=new URL("https://api.search.brave.com/res/v1/images/search");
        uri.searchParams.set("q",q);uri.searchParams.set("count","80");uri.searchParams.set("safesearch","strict");
        const r=await fetch(uri,{headers:{"Accept":"application/json","X-Subscription-Token":brave},signal:AbortSignal.timeout(20000)});
        requests++;if(!r.ok)throw Error("brave_"+r.status);
        const body=await r.json();
        for(const hit of body.results||[])add(hit.properties?.url,hit.url,hit.title||"","brave_images");
      }catch(err){gaps.push({url:"brave_images",reason:String(err).slice(0,140)})}
    }
    if(serp){
      try{
        const uri=new URL("https://serpapi.com/search.json");
        uri.searchParams.set("engine","google_images");uri.searchParams.set("q",q);uri.searchParams.set("api_key",serp);
        const r=await fetch(uri,{signal:AbortSignal.timeout(20000)});
        requests++;if(!r.ok)throw Error("serpapi_"+r.status);
        const body=await r.json();if(body.error)throw Error(String(body.error).slice(0,120));
        for(const hit of body.images_results||[])add(hit.original,hit.link,hit.title||"","google_images");
      }catch(err){gaps.push({url:"google_images",reason:String(err).slice(0,140)})}
    }
  }
  log("IMAGE_SEARCH_COMPLETE",{providers:[brave?"brave":null,serp?"google_images":null].filter(Boolean),queries:limited,requests,candidatesFound:added});
}
async function discord(path:string){
  if(!TOKEN)throw Error("bot_token_missing");
  for(let attempt=0;attempt<3;attempt++){
    const res=await fetch("https://discord.com/api/v10"+path,{headers:{Authorization:"Bot "+TOKEN},signal:AbortSignal.timeout(12000)});
    if(res.status===429 && attempt<2){const data=await res.json();await Bun.sleep(Math.min(9000,1000*Number(data.retry_after||1)));continue}
    if(!res.ok)throw Error("discord_"+res.status+"_"+path.split("?")[0]);
    return await res.json();
  }
  throw Error("discord_rate_limited");
}
async function getCurrent(){
  const known=new Set<string>();
  if(!TOKEN||!FORUM||!GUILD){gaps.push({url:"discord",reason:"read_access_not_configured"});return {known,complete:false}}
  let complete=true;
  try {
    const threads:any[]=[];
    const active=await discord("/guilds/"+GUILD+"/threads/active");
    threads.push(...(active.threads||[]).filter((x:any)=>x.parent_id===FORUM));
    let before="";
    for(let page=0;page<4;page++){
      const archive=await discord("/channels/"+FORUM+"/threads/archived/public?limit=100"+(before?"&before="+encodeURIComponent(before):""));
      threads.push(...(archive.threads||[]));
      if(!archive.has_more)break;
      before=archive.threads?.at(-1)?.thread_metadata?.archive_timestamp||"";
      if(!before||page===3){complete=false;break}
    }
    for(const t of [...new Map(threads.map(x=>[x.id,x])).values()].slice(0,250)){
      try {
        let cursor="";
        for(let page=0;page<3;page++){
          const messages=await discord("/channels/"+t.id+"/messages?limit=100"+(cursor?"&before="+cursor:""));
          if(!Array.isArray(messages))break;
          for(const m of messages){
            const data=[m.content||"",...(m.embeds||[]).flatMap((e:any)=>[e.url||"",e.image?.url||"",e.description||""])];
            for(const match of data.join("\n").matchAll(/https:\/\/[^\s<>)\]]+/g)){
              known.add(match[0].replace(/[.,]+$/,"").split("?")[0]);
            }
          }
          if(messages.length<100)break;
          cursor=messages.at(-1)?.id||"";
          if(page===2)complete=false;
        }
      } catch(err){complete=false;gaps.push({url:"discord_thread:"+t.id,reason:String(err).slice(0,100)})}
    }
  }catch(err){complete=false;gaps.push({url:"discord",reason:String(err).slice(0,120)})}
  return {known,complete};
}

/* Native, lossless import. Hard-gated by approved image manifest and explicit opt-in.
 * Neither web search hits nor guesses about identity/rights may be auto-published.
 * Does not forward, delete, modify, or move any existing gallery content.
 */
async function importApprovedNative(inventoryComplete:boolean){
  if(MODE!=="approved_links" || e.GALLERY_ENABLE_NATIVE_IMPORT!=="true")return;
  let approved:any[];
  try{approved=JSON.parse(e.GALLERY_APPROVED_MEDIA_JSON||"[]");if(!Array.isArray(approved))throw Error("not_array")}
  catch(err){log("NATIVE_IMPORT_BAD_MANIFEST",{error:String(err)});return}
  if(!approved.length){log("NATIVE_IMPORT_NO_APPROVED_MEDIA");return}
  if(!inventoryComplete||!TOKEN){log("NATIVE_IMPORT_HELD_INCOMPLETE_GALLERY_INVENTORY");return}
  const forum=await discord("/channels/"+FORUM);
  if(forum.guild_id!==GUILD||forum.type!==15)throw Error("native_import_forum_scope_mismatch");
  const me=await discord("/users/@me");
  if(!me.bot)throw Error("native_import_bot_mismatch");
  let imported=0,already=0,held=0;
  const max=Math.max(1,Math.min(5,Number(e.GALLERY_MAX_NATIVE_IMPORTS||"2")));
  const digest=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
  function safeExternal(input:string){
    try{
      const u=new URL(input);
      const h=u.hostname.toLowerCase();
      if(u.protocol!=="https:"||u.username||u.password||u.port||
        h==="localhost"||h.endsWith(".local")||h.endsWith(".internal")||
        /^\d+\.\d+\.\d+\.\d+$/.test(h)||h.includes(":"))throw Error("invalid_host");
      return u.toString();
    }catch{throw Error("unsafe_external_url")}
  }
  async function fetchImage(url:string,verifyMime=true){
    const res=await fetch(safeExternal(url),{redirect:"error",signal:AbortSignal.timeout(24000)});
    if(!res.ok)throw Error("image_http_"+res.status);
    const declared=Number(res.headers.get("content-length")||0);
    if(declared>10_000_000)throw Error("image_oversize");
    const mime=(res.headers.get("content-type")||"").split(";")[0].toLowerCase();
    if(verifyMime&&!["image/png","image/jpeg","image/webp","image/gif"].includes(mime))throw Error("image_type_unsupported");
    const bytes=new Uint8Array(await res.arrayBuffer());
    if(!bytes.length||bytes.length>10_000_000)throw Error("image_invalid_bytes");
    const actual=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?"image/png":
      bytes[0]===255&&bytes[1]===216?"image/jpeg":
      String.fromCharCode(...bytes.slice(0,3))==="GIF"?"image/gif":
      String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&
      String.fromCharCode(...bytes.slice(8,12))==="WEBP"?"image/webp":"unknown";
    if(actual==="unknown"||(verifyMime&&actual!==mime))throw Error("image_signature_mismatch");
    return {bytes,mime:actual,sha:digest(bytes)};
  }
  async function isDuplicate(threadId:string,size:number,sha:string){
    let cursor="";
    for(let page=0;page<4;page++){
      const messages=await discord("/channels/"+threadId+"/messages?limit=100"+(cursor?"&before="+cursor:""));
      if(!Array.isArray(messages))throw Error("thread_read_incomplete");
      for(const m of messages)for(const a of m.attachments||[]){
        if(a.size!==size||!/^image\//.test(a.content_type||""))continue;
        const u=new URL(a.url);
        if(!["cdn.discordapp.com","media.discordapp.net"].includes(u.hostname))throw Error("unsafe_discord_attachment");
        const copy=await fetch(a.url,{redirect:"error",signal:AbortSignal.timeout(20000)});
        if(!copy.ok)throw Error("attachment_unverifiable");
        const b=new Uint8Array(await copy.arrayBuffer());
        if(b.length!==a.size)throw Error("attachment_size_mismatch");
        if(digest(b)===sha)return true;
      }
      if(messages.length<100)return false;
      if(page===3)throw Error("thread_inventory_exceeds_safe_limit");
      cursor=messages.at(-1).id;
    }
    return false;
  }
  for(const item of approved.slice(0,max)){
    try{
      if(item.creatorVerified!==true||item.reuseAuthorized!==true||!String(item.approvedBy||"").trim())
        throw Error("identity_and_image_rights_approval_required");
      const source=safeExternal(item.sourceUrl),imageUrl=safeExternal(item.imageUrl);
      const threadId=String(item.threadId||"");
      if(!/^\d{17,20}$/.test(threadId))throw Error("target_thread_id_required");
      const thread=await discord("/channels/"+threadId);
      if(thread.guild_id!==GUILD||thread.parent_id!==FORUM)throw Error("thread_outside_gallery");
      const original=await fetchImage(imageUrl);
      if(await isDuplicate(threadId,original.bytes.length,original.sha)){
        already++;log("NATIVE_IMPORT_DUPLICATE_SKIPPED",{threadId,sha256:original.sha});continue;
      }
      const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"}[original.mime]||"jpg";
      const filename="creator-photo."+ext;
      const caption=String(item.caption||"").replace(/@everyone|@here/gi,"").trim().slice(0,160);
      const body=new FormData();
      body.append("payload_json",JSON.stringify({
        content:caption,flags:4096,allowed_mentions:{parse:[]},attachments:[{id:0,filename}]
      }));
      body.append("files[0]",new File([original.bytes],filename,{type:original.mime}),filename);
      const response=await fetch("https://discord.com/api/v10/channels/"+threadId+"/messages",
        {method:"POST",headers:{"Authorization":"Bot "+TOKEN},body,signal:AbortSignal.timeout(30000)});
      const message=await response.json().catch(()=>({}));
      if(!response.ok)throw Error("discord_upload_http_"+response.status);
      const attachment=message.attachments?.[0];
      if(!attachment||attachment.size!==original.bytes.length||!attachment.url)
        throw Error("native_upload_receipt_missing_review_message_"+String(message.id||""));
      const saved=await fetchImage(attachment.url,false);
      if(saved.sha!==original.sha)throw Error("native_upload_checksum_failed_review_message_"+message.id);
      imported++;stats.published++;
      log("NATIVE_IMPORT_VERIFIED",{threadId,messageId:message.id,sourcePage:source,sha256:original.sha});
    }catch(err){held++;log("NATIVE_IMPORT_HELD",{source:String(item?.sourceUrl||"").slice(0,120),reason:String(err).slice(0,160)})}
  }
  log("NATIVE_IMPORT_COMPLETE",{imported,already,held,approved:approved.length,processed:Math.min(max,approved.length)});
}

async function run(){
  if(!GUILD||!FORUM||!HANDLE||(sources.length===0&&!SEARCH_KEY)){log("CONFIG_INCOMPLETE",{hasGuild:!!GUILD,hasForum:!!FORUM,hasHandle:!!HANDLE,sources:sources.length});return}
  if(MODE!=="review"&&MODE!=="approved_links"){log("INVALID_MODE",{mode:MODE});return}
  const queue=sources.map(s=>({url:s.url,source:s,depth:0}));
  while(queue.length&&stats.pages<MAX_PAGES){
    const item=queue.shift()!;
    const u=safeUrl(item.url);
    if(!u||seen.has(u))continue;
    seen.add(u);
    try{
      const page=await fetchText(u);
      if(!page)throw Error("source_not_allowed");
      const more=inspect(page.final,page.body,item.source,item.depth);
      for(const link of more){if(!seen.has(link))queue.push({url:link,source:item.source,depth:item.depth+1})}
    }catch(err){stats.blocked++;gaps.push({url:u,reason:String(err).slice(0,120)})}
  }
  await searchProvider();
  const {known,complete}=await getCurrent();
  const review:Hit[]=[];
  const candidates:Hit[]=[];
  for(const hit of [...found.values()].sort((a,b)=>b.confidence-a.confidence).slice(0,MAX_HITS)){
    if(known.has(hit.image.split("?")[0])||known.has(hit.url.split("?")[0])){stats.existing++;continue}
    if(hit.confidence>=0.95 && hit.evidence==="creator_naming_in_image_alt")candidates.push(hit);
    else review.push(hit);
  }
  stats.trusted=candidates.length;
  stats.review=review.length;
  // Automatic publishing is off by default. Never publish if inventory is incomplete.
  // No media is downloaded or rehosted, and no existing content is edited or deleted.
  if(MODE==="approved_links"&&complete&&TOKEN){
    const forum=await discord("/channels/"+FORUM);
    if(forum.guild_id!==GUILD||forum.type!==15)throw Error("forum_scope_mismatch");
    // This worker never creates/updates threads directly: a distinct single-publisher
    // service must import its signed review manifest after creator approval.
    log("PUBLISHER_HANDOFF_REQUIRED",{eligible:candidates.length});
  }
  log("DISCOVERY_COMPLETE",{stats, inventoryComplete:complete,
      candidates:candidates.slice(0,25).map(h=>({source:h.source,url:h.url,image:h.image,confidence:h.confidence,tag:h.tag})),
      review:review.slice(0,25).map(h=>({source:h.source,url:h.url,image:h.image,evidence:h.evidence})),
      gaps:gaps.slice(0,40),processedSources:[...seen].slice(0,40)});
  await importApprovedNative(complete);
}

async function retireDawnNativeDuplicates(){
 if(e.GALLERY_DELETE_VERIFIED_SOURCE!=="true")return;
 if(!TOKEN||!FORUM||!GUILD){log("CLEANUP_DISABLED_CONFIG");return}
 const sources=new Set((e.GALLERY_CLEANUP_SOURCE_CHANNELS||"").split(",").filter(x=>/^\d{17,20}$/.test(x)));
 if(!sources.size){log("CLEANUP_DISABLED_NO_ALLOWED_SOURCES");return}
 const forum=await discord("/channels/"+FORUM);
 if(forum.guild_id!==GUILD||forum.type!==15)throw Error("CLEANUP_FORUM_MISMATCH");
 const me=await discord("/users/@me");
 if(!me.bot)throw Error("CLEANUP_BOT_IDENTITY_FAILED");
 const active=await discord("/guilds/"+GUILD+"/threads/active");
 let threads=(active.threads||[]).filter(t=>t.parent_id===FORUM);
 const archived=await discord("/channels/"+FORUM+"/threads/archived/public?limit=100");
 threads.push(...(archived.threads||[]));
 threads=[...new Map(threads.map(x=>[x.id,x])).values()].slice(0,120);
 let verified=0,deleted=0,held=0;
 const hash=b=>createHash("sha256").update(b).digest("hex");
 const phototype=a=>/^image\/(png|jpe?g|webp|gif)$/i.test(a?.content_type||"");
 async function getBytes(asset){
  if(!asset?.url||!phototype(asset)||asset.size<1||asset.size>20*1024*1024)throw Error("UNSUPPORTED_ASSET");
  const url=new URL(asset.url);
  if(url.protocol!=="https:"||!["cdn.discordapp.com","media.discordapp.net"].includes(url.hostname))throw Error("INVALID_CDN_ORIGIN");
  const r=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error("PHOTO_FETCH_"+r.status);
  const b=new Uint8Array(await r.arrayBuffer());
  if(b.length!==asset.size)throw Error("PHOTO_SIZE_MISMATCH");
  return b;
 }
 async function deleteOriginal(ch,m){
  const res=await fetch("https://discord.com/api/v10/channels/"+ch+"/messages/"+m,{
   method:"DELETE",headers:{Authorization:"Bot "+TOKEN},signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw Error("SOURCE_DELETE_HTTP_"+res.status);
 }
 for(const t of threads){
  const arr=await discord("/channels/"+t.id+"/messages?limit=100");
  if(!Array.isArray(arr)||arr.length===100){held++;continue}
  for(const post of arr){
   if(deleted>=5)break;
   if(post.author?.id!==me.id||!post.attachments?.length||post.message_reference||post.message_snapshots?.length)continue;
   const rx=/Original message ID: (\d{17,20})\s*\nOriginal(?: source)?: https:\/\/discord\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})/;
   const match=(post.content||"").match(rx);
   if(!match||match[1]!==match[4]||match[2]!==GUILD||!sources.has(match[3]))continue;
   try {
    const channel=await discord("/channels/"+match[3]);
    if(channel.guild_id!==GUILD||channel.type!==0)throw Error("SOURCE_NOT_TEXT_CHANNEL");
    const src=await discord("/channels/"+match[3]+"/messages/"+match[4]);
    if(!src.author?.bot||src.pinned||src.message_reference||src.message_snapshots?.length||src.poll||
      src.thread||(src.reactions||[]).length||(src.embeds||[]).length||(src.components||[]).length||
      (src.sticker_items||[]).length||(src.flags||0)!==0)throw Error("SOURCE_METADATA_NOT_LOSSLESS");
    const srcFiles=src.attachments||[],dstFiles=post.attachments||[];
    if(!srcFiles.length||srcFiles.length!==dstFiles.length||srcFiles.some(a=>!phototype(a)))throw Error("SOURCE_FILE_COUNT_OR_TYPE");
    if(!(post.content||"").startsWith(src.content?(src.content+"\n\n"):"Original author:"))throw Error("SOURCE_CAPTION_NOT_PRESERVED");
    if(!(post.content||"").includes("Original timestamp: "+src.timestamp))throw Error("SOURCE_TIMESTAMP_NOT_PRESERVED");
    for(const a of srcFiles){
      const matches=dstFiles.filter(b=>b.filename===a.filename&&b.size===a.size);
      if(matches.length!==1)throw Error("DEST_ASSET_AMBIGUOUS");
      const [aBytes,bBytes]=await Promise.all([getBytes(a),getBytes(matches[0])]);
      if(hash(aBytes)!==hash(bBytes))throw Error("SHA256_MISMATCH");
    }
    verified++;
    const reread=await discord("/channels/"+match[3]+"/messages/"+match[4]);
    if(reread.content!==src.content||reread.edited_timestamp!==src.edited_timestamp||
      reread.pinned||(reread.reactions||[]).length||
      JSON.stringify(reread.attachments.map(x=>[x.id,x.filename,x.size]))!==JSON.stringify(srcFiles.map(x=>[x.id,x.filename,x.size])))
      throw Error("ORIGINAL_CHANGED");
    await deleteOriginal(match[3],match[4]);
    deleted++;
    log("SOURCE_DUPLICATE_DELETED_VERIFIED",{source:src.id,channel:match[3],destination:post.id,thread:t.id,sha256Assets:srcFiles.length});
   }catch(err){held++;log("SOURCE_RETAINED",{source:match[4],reason:String(err).slice(0,180)})}
  }
 }
 log("DUPLICATE_RETIREMENT_FINISHED",{verified,deleted,held,threadsScanned:threads.length});
}

await run().catch(err=>{log("FATAL",{error:String(err).slice(0,220)});process.exitCode=1});
log("PHOTO_V3_LEGACY_DUPLICATE_RETIREMENT_DISABLED",{reason:"master_vault_not_verified"});