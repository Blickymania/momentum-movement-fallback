// Momentum Movement original 4K PNG download gateway.
// All 6 photos remain native, distinct Discord-hosted media. No file conversion.
// Reads original bot-authored gallery messages and forwards validated image bytes on demand.
const G="1565048205970767992",A="1565304619838742598",CH="1565048207178862765";
const BOT=Bun.env.DISCORD_BOT_TOKEN||"";
if(Bun.env.APPLICATION_ID!==A||Bun.env.AUTHORIZED_GUILD_ID!==G||!BOT)throw Error("Logo Gateway: guild/application credentials mismatch");
const SOURCES={
 official:{
   message:"1566870647156777110",
   transparent:{id:"1566870643574702090",file:"Momentum_Movement_Official_Logo_Transparent_4096.png"},
   black:{id:"1566870644979671170",file:"Momentum_Movement_Official_Logo_Black_4096.png"},
   white:{id:"1566870646338879670",file:"Momentum_Movement_Official_Logo_White_4096.png"}
 },
 merch:{
   message:"1566870677020221642",
   transparent:{id:"1566870671911428116",file:"Momentum_Merch_Logo_Transparent_4096.png"},
   black:{id:"1566870673446408193",file:"Momentum_Merch_Logo_Black_4096.png"},
   white:{id:"1566870674796969984",file:"Momentum_Merch_Logo_White_4096.png"}
 }
};
const CACHE=new Map(),PENDING=new Map();let successfulDownloads=0,failedDownloads=0;
const log=(event,data={})=>console.log(JSON.stringify({event:"momentum_logo_"+event,service:"Logo Gateway",...data}));
function collectMedia(nodes,arr=[]){
 for(const n of nodes||[]){
  if(n?.type===12&&Array.isArray(n.items)){
   for(const item of n.items)if(item?.media?.url)arr.push(item.media);
  }
  if(Array.isArray(n?.components))collectMedia(n.components,arr);
 }
 return arr;
}
async function fetchGallery(logo,refresh=false){
 const existing=CACHE.get(logo);
 if(!refresh&&existing&&Date.now()-existing.when<180000)return existing.urls;
 if(PENDING.has(logo))return PENDING.get(logo);
 const task=(async()=>{
  const source=SOURCES[logo];
  let msg;
  for(let tries=0;tries<3;tries++){
   const r=await fetch("https://discord.com/api/v10/channels/"+CH+"/messages/"+source.message,
   {headers:{"Authorization":"Bot "+BOT},signal:AbortSignal.timeout(15000)});
   msg=await r.json().catch(()=>({}));
   if(r.status===429){
    if(tries===2)throw Error("source_rate_limited");
    await Bun.sleep(Math.min(25000,Math.max(1200,Math.ceil(Number(msg.retry_after||2)*1000)+350)));
    continue;
   }
   if(!r.ok)throw Error("gallery_lookup_http_"+r.status);
   break;
  }
  if(msg?.author?.id!==A||msg?.channel_id!==CH||!(Number(msg?.flags||0)&32768))throw Error("gallery_owner_or_channel_mismatch");
  const media=collectMedia(msg.components);
  const verified={};
  for(const background of ["transparent","black","white"]){
   const expected=source[background];
   const matching=media.filter(m=>{
    try {
     const u=new URL(m.url);
     return u.protocol==="https:"&&u.hostname==="cdn.discordapp.com"&&
      u.pathname==="/attachments/"+CH+"/"+expected.id+"/"+expected.file&&
      Number(m.width)===4096&&Number(m.height)===4096;
    }catch{return false}
   });
   if(matching.length!==1)throw Error("exact_media_asset_missing_"+logo+"_"+background);
   const url=matching[0].url;
   const expiry=new URL(url).searchParams.get("ex");
   if(expiry&&/^[a-f0-9]+$/i.test(expiry)&&Number.parseInt(expiry,16)*1000<Date.now()+30000)
     throw Error("Discord_CDN_signature_expired_"+logo+"_"+background);
   verified[background]=url;
  }
  CACHE.set(logo,{when:Date.now(),urls:verified});
  return verified;
 })().finally(()=>PENDING.delete(logo));
 PENDING.set(logo,task);
 return task;
}
function htmlPage(){
 const entry=(logo,label,order)=>"<section><h2>"+order+" — "+label+"</h2><ul>"+["transparent","black","white"].map(bg=>{
  const path="/download/"+logo+"/"+bg;
  return "<li><a href=\""+path+"\">Download "+label+" — "+bg[0].toUpperCase()+bg.slice(1)+" Background (PNG, 4096 × 4096)</a></li>";
 }).join("")+"</ul></section>";
 return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Momentum Movement Official Logos</title><style>body{font:16px system-ui,sans-serif;max-width:800px;margin:6vh auto;padding:0 24px;background:#0c1323;color:#e7f5ff}a{color:#6ddcff}li{margin:12px 0}section{border-bottom:1px solid #344b64;padding:15px 0}</style></head><body><h1>Momentum Movement — Official Logo Downloads</h1><p>Two independent 4K PNG logos. Choose the exact background; every link downloads a separate original image.</p>"+entry("official","Momentum Movement Official Logo","01")+entry("merch","Momentum Merch Logo","02")+"</body></html>";
}
Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||8080),async fetch(request){
 const u=new URL(request.url),path=u.pathname;
 if(path==="/healthz")return Response.json({service:"Momentum Movement Logo Gateway",ready:true,assetsConfigured:6,
  gateway:"original_discord_media",downloads:successfulDownloads,failures:failedDownloads,publicRouting:true});
 if(path==="/")return new Response(htmlPage(),{headers:{"content-type":"text/html; charset=utf-8","cache-control":"public,max-age=300","x-content-type-options":"nosniff"}});
 const m=path.match(/^\/(download|preview)\/(official|merch)\/(transparent|black|white)(?:\.png)?$/);
 if(!m)return new Response("Not found",{status:404});
 if(request.method!=="GET"&&request.method!=="HEAD")return new Response("Method not allowed",{status:405});
 const [,mode,logo,background]=m;const file=SOURCES[logo][background].file;
 if(request.method==="HEAD")return new Response(null,{headers:{"content-type":"image/png","content-disposition":mode==="download"?"attachment; filename=\""+file+"\"":"inline; filename=\""+file+"\"","x-content-type-options":"nosniff"}});
 try{
  let urls=await fetchGallery(logo);
  let upstream=null;
  for(let retry=0;retry<2;retry++){
   upstream=await fetch(urls[background],{redirect:"error",signal:AbortSignal.timeout(27000),headers:{"accept":"image/png"}});
   if(upstream.ok)break;
   if(retry===0&&(upstream.status===403||upstream.status===404)){CACHE.delete(logo);urls=await fetchGallery(logo,true);continue}
   throw Error("source_http_"+upstream.status);
  }
  if(!upstream?.ok)throw Error("source_unavailable");
  const length=Number(upstream.headers.get("content-length")||0);
  if(length>30*1024*1024)throw Error("asset_too_large");
  const bytes=new Uint8Array(await upstream.arrayBuffer());
  if(bytes.length<8||bytes.length>30*1024*1024||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71||bytes[4]!==13||bytes[5]!==10||bytes[6]!==26||bytes[7]!==10)throw Error("source_not_real_PNG");
  successfulDownloads++;log("download_success",{logo,background,bytes:bytes.length});
  return new Response(bytes,{headers:{"content-type":"image/png",
   "content-disposition":(mode==="download"?"attachment":"inline")+"; filename=\""+file+"\"",
   "content-length":String(bytes.length),"cache-control":"public,max-age=300",
   "x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; sandbox"}});
 }catch(err){
  failedDownloads++;log("download_deferred",{logo,background,reason:err instanceof Error?err.message.slice(0,100):"unknown"});
  return new Response("This original PNG cannot be retrieved right now. No substitute image has been served.",{status:503,headers:{"cache-control":"no-store","content-type":"text/plain; charset=utf-8"}});
 }
}});
log("gateway_ready",{guild:G,assets:6,mediaSource:"Discord original 4096px PNG gallery"});