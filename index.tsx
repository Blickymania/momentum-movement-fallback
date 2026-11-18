import {Client,Events,GatewayIntentBits} from "discord.js@14.27.0";
// Shared native Discord widgets. All state is recovered from guild-owned messages.
const CW_QUIET={parse:[],users:[],roles:[],replied_user:false};
const cwSlug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const cwClean=(s,n=1000)=>String(s||'').trim().slice(0,n).replace(/@(everyone|here)/gi,'@\u200b$1');
const cwButtons=m=>(m.components||[]).flatMap(r=>r.components||[]);
const cwLabel=(label,component,description)=>({type:18,label,...(description?{description}:{}),component});
const cwText=(custom_id,required=true,max_length=500,placeholder,style=1)=>({type:4,custom_id,style,required,max_length,...(placeholder?{placeholder}: {})});
function cwAllowedMedia(file){if(!file)return false;const type=String(file.content_type||'').toLowerCase().split(';')[0],name=String(file.filename||'').toLowerCase();const mime=/^(?:image\/(?:png|jpeg|webp|gif|avif|heic|heif|tiff|bmp)|video\/(?:mp4|quicktime|webm|x-m4v|x-matroska|x-msvideo|x-ms-wmv|mpeg|ogg)|audio\/(?:mpeg|mp4|wav|x-wav|flac|ogg|opus|aac|aiff|x-m4a|x-caf|x-ms-wma|amr))$/i;const ext=/\.(?:png|jpe?g|webp|gif|avif|heic|heif|tif?f|bmp|mp4|mov|qt|m4v|webm|mkv|avi|wmv|mpeg|mpg|ogv|mp3|wav|wave|flac|ogg|opus|m4a|aac|aif|aiff|wma|amr|caf)$/i;return mime.test(type)||ext.test(name);}
function cwPanel(kind,c){
 const live=kind==="live";
 const buttons=[
  {type:2,style:live?4:1,label:live?"Post My LIVE":"Submit Event",custom_id:"cw:"+kind+":open"},
  {type:2,style:2,label:"How It Works",custom_id:"cw:"+kind+":guide"}
 ];
 const help=live?"**Share your livestream.** Paste your TikTok LIVE link here or select **Post My LIVE**. The form includes Box Battle and authorized SOS options. Ended sessions retain their original history.":"**Share a confirmed upcoming event.** Authorized moderators can provide its title, host, date/time, description, HTTPS link, and up to 10 original photos, videos, or audio files. Uploads are limited to 20 MiB per file and 24 MiB total.";
 return {flags:32768,content:null,embeds:[],components:[
  {type:1,components:buttons},
  {type:17,accent_color:c.color,components:[
    {type:10,content:"## "+(live?"🔴 LIVE NOW":"📅 UPCOMING EVENTS")},
    {type:14,divider:true,spacing:1},
    {type:10,content:help},
    {type:10,content:"-# "+c.name+" • "+(live?"LIVE submissions & preserved history":"Confirmed events only")+" • No ephemeral responses"}
  ]}
 ],allowed_mentions:CW_QUIET};
}
function cwModal(kind){
 if(kind==='live')return {custom_id:'cw:live:submit',title:'Post My LIVE',components:[
  cwLabel('TikTok LIVE link',cwText('url',true,500,'https://www.tiktok.com/@creator/live')),
  cwLabel('What is happening?',cwText('description',false,700,'A short description',2)),
  cwLabel('LIVE options',{type:22,custom_id:'options',options:[{label:'Box Battle',value:'box_battle'},{label:'SOS — owner/admin only',value:'sos'}],min_values:0,max_values:2,required:false}),
  cwLabel('Box Battle: who are you supporting?',cwText('support',false,80,'Name or @handle')),
  cwLabel('Box Battle: Discord member (optional)',{type:5,custom_id:'member',min_values:0,max_values:1,required:false},'Select a member instead of entering a participant name.')
 ]};
 return {custom_id:'cw:event:submit',title:'Submit an Upcoming Event',components:[
  cwLabel('Event title',cwText('title',true,100)),
  cwLabel('Host / creator and event description',cwText('details',true,700,'Host: Name\nDescription: What attendees can expect',2)),
  cwLabel('Start and end · use ET or CT',cwText('schedule',true,150,'2026-11-15 7:00 PM ET | 2026-11-15 9:00 PM ET'),'YYYY-MM-DD h:mm AM/PM ET or CT | end in the same format.'),
  cwLabel('Event / livestream link',cwText('link',true,500,'https://...')),
   cwLabel('Event media (optional)',{type:19,custom_id:'flyer',min_values:0,max_values:10,required:false},'Upload up to 10 original photos, videos, or audio files. Keep the combined upload under 24 MiB.')
 ]};
}
function cwEventStart(input,now=Date.now()){
 const m=String(input||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+(ET|CT|UTC)$/i);
 if(!m)throw Error('Use YYYY-MM-DD h:mm AM/PM ET or CT for each time.');
 const [,ys,mos,ds,hs,mins,ap,z]=m,y=+ys,mo=+mos,d=+ds,h=(+hs%12)+(ap.toUpperCase()==='PM'?12:0),minute=+mins;
 if(+hs<1||+hs>12||minute>59||mo<1||mo>12||d<1||d>31)throw Error('Enter a valid calendar date and time.');
 const zone={ET:'America/New_York',CT:'America/Chicago',UTC:'UTC'}[z.toUpperCase()],matches=[];
 const f=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const nominal=Date.UTC(y,mo-1,d,h,minute);
 for(let offset=-14;offset<=14;offset++){
  const candidate=nominal+offset*3600000,p=Object.fromEntries(f.formatToParts(candidate).map(x=>[x.type,x.value]));
  if(+p.year===y&&+p.month===mo&&+p.day===d&&+p.hour===h&&+p.minute===minute)matches.push(candidate);
 }
 if(matches.length!==1)throw Error('This time is invalid or ambiguous during daylight saving. Use UTC for that time.');
 if(matches[0]<=now||matches[0]>now+2*366*86400000)throw Error('Choose a future event within the next two years.');
 return matches[0];
}
async function cwLiveUrl(text,request=fetch){
 const raw=String(text||'').match(/https:\/\/[^\s<>()]+/i)?.[0]?.replace(/[.,!]+$/,'');if(!raw)return null;
 for(const method of ['HEAD','GET']){
  let u;try{u=new URL(raw)}catch{return null;}
  for(let hop=0;hop<4;hop++){
   if(u.protocol!=='https:'||!['tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'].includes(u.hostname)||u.username||u.password||u.port)return null;
   const m=u.pathname.match(/^\/@([a-z0-9._]{2,30})\/live\/?$/i);if(m)return {url:'https://www.tiktok.com/@'+m[1]+'/live',handle:m[1]};
   if(!['vm.tiktok.com','vt.tiktok.com'].includes(u.hostname)&&!/^\/t\/[a-z0-9_-]+\/?$/i.test(u.pathname))return null;
   let r;try{r=await request(u.href,{method,redirect:'manual',signal:AbortSignal.timeout(4000)})}catch{break;}
   if(![301,302,303,307,308].includes(r.status)||!r.headers.get('location'))break;
   try{u=new URL(r.headers.get('location'),u)}catch{return null;}
   if(!['tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'].includes(u.hostname))break;
  }
 }
 return null;
}
function cwRuntime(config){
 const CUTOVER=Bun.env.LIVE_V2_CUTOVER==="true";
 const {guildId,appId,token,name,color}=config;
 const channels={live:null,event:null,archive:null,general:null};
 const panels={},entries=new Map(),locks=new Set(),sosLocks=new Set(),sosRecent=new Map();let timer=null,ready=false;
 const now=config.now||(()=>Date.now());
 let panelTimer=null;
 function queueLivePanel(){if(panelTimer)clearTimeout(panelTimer);panelTimer=setTimeout(()=>{panelTimer=null;void reconcile('live').catch(e=>log('live-panel-reposition-held',{reason:String(e.message).slice(0,160)}));},750);panelTimer.unref?.();}
 const log=(event,data={})=>console.log(JSON.stringify({event:'creator-widget-'+event,guildId,...data}));
 async function api(path,method='GET',body){
  if(config.request)return config.request(path,method,body);
  for(let attempt=0;attempt<3;attempt++){
   const headers={Authorization:'Bot '+token};let data;
   if(body instanceof FormData)data=body;else if(body!==undefined){headers['Content-Type']='application/json';data=JSON.stringify(body);}
   const r=await fetch('https://discord.com/api/v10'+path,{method,headers,...(data===undefined?{}:{body:data}),signal:AbortSignal.timeout(15000)});
   const value=r.status===204?{}:await r.json().catch(()=>({}));
   if(r.status===429&&method==='GET'&&attempt<2){await new Promise(res=>setTimeout(res,Math.min(16000,Number(value.retry_after||3)*1000+300)));continue;}
   if(!r.ok)throw Error('Discord '+r.status+' '+method+' '+path.replace(/\/interactions\/.*/,'/interactions/[private]').replace(/\/webhooks\/.*/,'/webhooks/[private]'));
   return value;
  }
 }
 const message=(ch,id)=>'/channels/'+ch+'/messages'+(id?'/'+id:'');
 const stamp=t=>'<t:'+Math.floor(t/1000)+':t>';
 const ended=m=>/^⚫ ENDED LIVE/.test(m.embeds?.[0]?.title||'')||m.embeds?.[0]?.fields?.some(f=>f.name==='Status'&&f.value==='⚫ Ended');
 const ownerOf=m=>cwButtons(m).find(b=>/^cw:(?:live|event):manage:/.test(b.custom_id||''))?.custom_id?.split(':')[3]||m.embeds?.[0]?.fields?.find(f=>f.name==='Shared by')?.value?.match(/^<@(\d+)>$/)?.[1];
 const expiryOf=m=>ended(m)?0:Number(cwButtons(m).find(b=>/^cw:(?:live|event):manage:/.test(b.custom_id||''))?.custom_id?.split(':')[4]||0)*1000;
 const controls=(kind,owner,end,extra=[])=>[{type:1,components:[...extra,{type:2,style:2,label:kind==='live'?'Manage LIVE':'Manage Event',custom_id:'cw:'+kind+':manage:'+owner+':'+Math.floor(end/1000)},...(kind==='live'?[{type:2,style:2,label:'View History',custom_id:'cw:live:history'}]:[])]}];
 const permitted=(i,owner)=>i.member?.user?.id===owner||Boolean(BigInt(i.member?.permissions||'0')&(8n|32n|8192n));
 const callback=async(i,type,data)=>{const result=await api('/interactions/'+i.id+'/'+i.token+'/callback','POST',{type,...(data?{data}:{})});i._cwAcknowledged=true;return result;};
 const receipt=async(i,text,components=[])=>{
   if(!i._cwAcknowledged)await callback(i,6);
   const kind=String(i.data?.custom_id||"").split(":")[1],msgId=i.message?.id||panels[kind],ch=channels[kind]||i.channel_id;
   if(!msgId){log("inline-note-no-origin",{action:i.data?.custom_id||"",message:String(text).slice(0,150)});return null;}
   const current=await api(message(ch,msgId));
   if(current.author?.id!==appId)return null;
   const note=String(text||"").trim().slice(0,1500);
   if((Number(current.flags||0)&32768)!==0){
     const payload=cwPanel(kind,{...channels,guildId,name,color});
     payload.components[1].components.push({type:14,divider:true,spacing:1},{type:10,content:"### Update\n"+note});
     if(components?.length)payload.components.splice(1,0,...components);
     await api(message(ch,msgId),"PATCH",{content:null,embeds:[],flags:32768,components:payload.components,allowed_mentions:CW_QUIET});
     return null;
   }
   const embed=current.embeds?.[0];if(!embed)return null;
   const history=note.startsWith("**LIVE History**"),guide=note.startsWith("**Post a LIVE**")||note.startsWith("**Submit an event**");
   const fields=(embed.fields||[]).filter(f=>!["Panel feedback","LIVE History","How It Works"].includes(f.name));
   fields.push({name:history?"LIVE History":guide?"How It Works":"Panel feedback",value:note.slice(0,1000)||"Action processed.",inline:false});
   await api(message(ch,msgId),"PATCH",{embeds:[{...embed,fields}],allowed_mentions:CW_QUIET});
   return null;
  };
 function remember(m,kind){if(m.author?.id!==appId||!ownerOf(m))return;entries.set(m.id,{id:m.id,kind,channel:m.channel_id||channels[kind],owner:ownerOf(m),expires:expiryOf(m),url:m.embeds?.[0]?.url,title:m.embeds?.[0]?.title?.replace(/^📅 /,''),startsAt:Number(m.embeds?.[0]?.fields?.find(f=>f.name==='When')?.value?.match(/<t:(\d+):/)?.[1]||0)*1000});}
 function schedule(){if(timer)clearTimeout(timer);const next=Math.min(...[...entries.values()].map(e=>e.expires).filter(Boolean));if(Number.isFinite(next)){timer=setTimeout(()=>{void maintain().catch(e=>log('maintenance-held',{reason:String(e.message).slice(0,160)}));},Math.min(2147483647,Math.max(1000,next-now())));timer.unref?.();}}
 async function recover(kind,all=false){
  const found=[];let before='';
  do{const batch=await api(message(channels[kind])+'?limit=100'+(before?'&before='+before:''));
   if(!Array.isArray(batch))throw Error('Channel history is unavailable.');
   for(const m of batch){remember(m,kind);found.push(m);}
   const next=batch.at(-1)?.id;if(!all||batch.length<100||!next||next===before)break;before=next;
  }while(true);return found;
 }
 async function reconcile(kind){ if(CUTOVER&&kind==="live")return;
  const ch=channels[kind],recent=await recover(kind,true);
  const candidates=recent.filter(m=>m.author?.id===appId&&(cwButtons(m).some(b=>b.custom_id==='cw:'+kind+':open')||m.embeds?.some(e=>kind==='live'?/WHO.S LIVE NOW|LIVE NOW/i.test(e.title||''):/UPCOMING EVENTS/i.test(e.title||''))));
  const payload=cwPanel(kind,{...channels,guildId,name,color});
  const current=candidates[0],moveToBottom=kind==='live'&&current&&recent[0]?.id!==current.id;
  const panel=(!current||moveToBottom)?await api(message(ch),'POST',payload):await api(message(ch,current.id),'PATCH',payload);
  panels[kind]=panel.id;
  if(panel.pinned)await api('/channels/'+ch+'/pins/'+panel.id,'DELETE');
  const read=await api(message(ch,panel.id));if(!cwButtons(read).some(b=>b.custom_id==='cw:'+kind+':open'))throw Error('Widget readback failed.');
  if(moveToBottom)for(const old of candidates.filter(m=>m.id!==panel.id&&cwButtons(m).some(b=>b.custom_id==='cw:'+kind+':open')))try{await api(message(ch,old.id),'DELETE');}catch(error){log('old-panel-cleanup-held',{kind,messageId:old.id,reason:String(error.message).slice(0,120)});}
  log('panel-verified',{kind,channelId:ch,messageId:panel.id});
 }
 
 async function compactPriorLives(){ if(CUTOVER)return;
  const posts=await recover('live');
  for(const m of posts){
   if(m.author?.id!==appId||!ownerOf(m)||!m.embeds?.[0]?.url)continue;
   const old=m.embeds[0],liveStatus=(old.fields||[]).some(f=>f.name==='Status'&&f.value==='🟢 Active');
   const oldFields=old.fields||[];
   const fields=oldFields.filter(f=>!(f.name==='Status'&&f.value==='🟢 Active')&&!(f.name==='SOS'&&f.value==='Not requested')).map(f=>
    f.name==='Active until'||f.name==='Auto-expires at'?
      {...f,name:'Auto-expires at',value:String(f.value||'').replace(/(<t:\d+):F>/,'$1:t>')}:f);
   const content=String(m.content||'').trim()===String(old.url||'').trim()?'':m.content||'';
   const changed=content!==(m.content||'')||JSON.stringify(fields)!==JSON.stringify(oldFields);
   if(!changed)continue;
   try{await api(message(channels.live,m.id),'PATCH',{content,embeds:[{...old,fields}],allowed_mentions:CW_QUIET});log('compact-legacy-live',{messageId:m.id,active:liveStatus});}
   catch(e){log('compact-legacy-live-held',{messageId:m.id,reason:String(e.message).slice(0,160)});}
  }
 }
 async function init(){
  const me=await api('/users/@me');if(me.id!==appId)throw Error('Bot identity mismatch.');
  const list=await api('/guilds/'+guildId+'/channels');
  for(const [key,slug]of Object.entries({live:'live-now',event:'upcoming-events',archive:'archived-flyers',general:'general-chat'})){
   let matches=list.filter(c=>(key==='archive'?c.type===15:c.type===0)&&cwSlug(c.name)===slug);
   if(key==='general'&&matches.length>1)matches=matches.filter(c=>cwSlug(list.find(p=>p.id===c.parent_id)?.name)==='engagement-center');
   if(matches.length!==1)throw Error('Expected one '+slug+' channel.');channels[key]=matches[0].id;
  }
  await reconcile('live');await compactPriorLives();await reconcile('event');ready=true;await maintain();log('ready',{channels});return channels;
 }
 async function publishLive({url,description='',support='',boxBattle=false,sos=false,hours=2,owner,files=[],nonce}){
  if(sos&&!await sosAuthorized(owner))throw Error('Only the server owner or administrators may send SOS alerts. Submit the LIVE without SOS.');
  const item=await cwLiveUrl(url,config.fetch||fetch);if(!item)throw Error('This share link could not be resolved. Paste a direct https://www.tiktok.com/@handle/live link.');
  if(boxBattle&&!support.trim())throw Error('Enter the Box Battle participant you are supporting.');
  const key=item.url.toLowerCase();if(locks.has(key))throw Error('This LIVE is already being processed.');locks.add(key);
  try{
   await recover('live');
   const duplicate=[...entries.values()].find(e=>e.kind==='live'&&e.url?.toLowerCase()===key&&e.expires>now());if(duplicate)throw Error('This creator already has an active LIVE: https://discord.com/channels/'+guildId+'/'+channels.live+'/'+duplicate.id);
   const end=now()+([1,2,4,8].includes(+hours)?+hours:2)*3600000;
   const payload={...(nonce?{nonce:String(nonce),enforce_nonce:true}:{}),content:'',embeds:[{title:'🔴 '+(boxBattle?'BOX BATTLE':'LIVE NOW')+' · @'+item.handle,url:item.url,color,
    description:cwClean(description,700)||'Join the livestream and show your support.',fields:[...(boxBattle?[{name:'Supporting',value:cwClean(support,80),inline:true}]:[]),{name:'Shared by',value:'<@'+owner+'>',inline:true},{name:'Auto-expires at',value:stamp(end),inline:true}],footer:{text:name+' • LIVE Now'}}],
    components:controls('live',owner,end,[{type:2,style:5,label:'Watch LIVE',url:item.url}]),allowed_mentions:CW_QUIET};
   const posted=await send(channels.live,payload,files);remember(posted,'live');schedule();
   let note='LIVE posted.';if(sos)try{note+=' '+await sendSOS(posted);}catch{note+=' SOS delivery is unconfirmed; contact a moderator.';}
   // The post must remain the SOS target until the alert completes; only then
   // rotate the bottom widget, so an uncertain panel update cannot mask SOS state.
   try{await reconcile('live');}catch(error){log('live-panel-reposition-held',{reason:String(error.message).slice(0,160)});}
   log('live-published',{messageId:posted.id});return {post:posted,note};
  }finally{locks.delete(key);}
 }
 async function endLive(post){
  if(post.author?.id!==appId||!ownerOf(post)||!post.embeds?.[0]?.url)throw Error('LIVE ownership or post could not be verified.');
  if(ended(post))return 'This LIVE is already ended; its history remains visible.';
  const original=post.embeds[0],endedAt=now(),fields=(original.fields||[]).filter(f=>!['Status','Ended at','Active until','Auto-expires at'].includes(f.name)).map(f=>f.name==='SOS'&&/^(Sending|Sent to)/.test(f.value||'')?{...f,value:'Resolved'}:f);
  fields.push({name:'Status',value:'⚫ Ended',inline:true},{name:'Ended at',value:stamp(endedAt),inline:true});
  const suffix=(original.title||'').split(' · ').slice(1).join(' · '),title='⚫ ENDED LIVE'+(suffix?' · '+suffix:'');
  await api(message(channels.live,post.id),'PATCH',{embeds:[{...original,title,fields}],components:[{type:1,components:[{type:2,style:2,label:'View History',custom_id:'cw:live:history'}]}],allowed_mentions:CW_QUIET});
  const verified=await api(message(channels.live,post.id));
  if(!ended(verified)||!cwButtons(verified).some(b=>b.custom_id==='cw:live:history'))throw Error('Ended LIVE history readback failed; listing retained.');
  remember(verified,'live');schedule();log('live-ended-history-kept',{messageId:post.id});return 'LIVE ended. Its post and View History remain in LIVE NOW.';
 }
 async function sosAuthorized(actor){
   if(!/^\d{15,22}$/.test(String(actor||'')))return false;
   const [guild,member,roles]=await Promise.all([
     api('/guilds/'+guildId),
     api('/guilds/'+guildId+'/members/'+actor),
     api('/guilds/'+guildId+'/roles')
   ]);
   if(guild?.id!==guildId||!Array.isArray(member?.roles)||!Array.isArray(roles))throw Error('SOS authorization could not be verified.');
   if(actor===guild.owner_id)return true;
   const ids=new Set([guildId,...member.roles]);
   return roles.some(r=>ids.has(r.id)&&((BigInt(r.permissions||'0')&8n)===8n));
 }
 async function sendSOS(post){
  const requester=ownerOf(post);if(!await sosAuthorized(requester))throw Error('SOS blocked: server owner or administrator approval required.');
  if(sosLocks.has(post.id))return 'SOS is already being processed.';sosLocks.add(post.id);let hostLock=null;
  try{
   const current=await api(message(channels.live,post.id));if(current.author?.id!==appId||expiryOf(current)<=now())throw Error('This LIVE has ended.');
   const embed=current.embeds?.[0],url=embed?.url;if(!url)throw Error('LIVE URL is unavailable.');
   hostLock='url:'+url.toLowerCase();if(sosLocks.has(hostLock)){hostLock=null;return 'SOS is already being processed.';}sosLocks.add(hostLock);
   if(embed.fields?.some(f=>f.name==='SOS'&&!['Not requested','Resolved'].includes(f.value)))return 'SOS was already requested.';
   if((sosRecent.get(url)||0)>now()-3600000)return 'The one-hour SOS cooldown is active.';
   let before='';
   do{const prior=await api(message(channels.general)+'?limit=100'+(before?'&before='+before:''));
    if(prior.some(m=>m.author?.id===appId&&m.content?.startsWith('@everyone 🚨 **SOS')&&m.content.includes(url)&&Date.parse(m.timestamp)>now()-3600000))return 'The one-hour SOS cooldown is active.';
    const next=prior.at(-1)?.id,oldest=Date.parse(prior.at(-1)?.timestamp||0);
    if(prior.length<100||!next||next===before||oldest<now()-3600000)break;before=next;
   }while(true);
   const patch=value=>api(message(channels.live,current.id),'PATCH',{embeds:[{...embed,fields:[...(embed.fields||[]).filter(f=>f.name!=='SOS'),{name:'SOS',value,inline:true}]}],allowed_mentions:CW_QUIET});
   await patch('Sending to General Chat');sosRecent.set(url,now());
   try{await api(message(channels.general),'POST',{content:'@everyone 🚨 **SOS — LIVE SUPPORT NEEDED**\n'+embed.title.replace(/^🔴 /,'')+' needs support.\n'+url+'\nhttps://discord.com/channels/'+guildId+'/'+channels.live+'/'+post.id,allowed_mentions:{parse:['everyone']}});}
   catch(e){await patch('Delivery unconfirmed — contact a moderator').catch(()=>{});throw e;}
   await patch('Sent to General Chat');return 'SOS sent to General Chat.';
  }finally{sosLocks.delete(post.id);if(hostLock)sosLocks.delete(hostLock);}
 }
 async function download(file){
  const u=new URL(file.url);if(u.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname)||!u.pathname.startsWith('/attachments/')||!Number.isSafeInteger(Number(file.size))||Number(file.size)<=0||Number(file.size)>20*1024*1024)throw Error('Each original media file must be under 20 MiB.');
  const r=await (config.fetch||fetch)(u.href,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('The original attachment could not be downloaded.');
  const bytes=await r.arrayBuffer();if(bytes.byteLength!==file.size)throw Error('Attachment size verification failed.');return {...file,bytes};
 }
 async function send(channel,payload,files=[]){
  if(!files.length)return api(message(channel),'POST',payload);
  if(files.length>10)throw Error('Upload no more than 10 media files.');
  if(files.reduce((n,f)=>n+f.size,0)>24*1024*1024)throw Error('Keep this submission under 24 MiB in total.');
  const loaded=await Promise.all(files.map(download));if(loaded.length>10||loaded.reduce((n,f)=>n+f.size,0)>24*1024*1024)throw Error('Keep this submission to 10 files and 24 MiB total.');
  const data=new FormData();data.append('payload_json',JSON.stringify({...payload,attachments:loaded.map((f,id)=>({id,filename:f.filename}))}));
  loaded.forEach((f,id)=>data.append('files['+id+']',new Blob([f.bytes],{type:f.content_type}),f.filename));return api(message(channel),'POST',data);
 }
 async function eventPublish(i,values){
  const [startText,endText,...extra]=String(values.schedule||'').split('|');if(!endText||extra.length)throw Error('Enter both the start and end times, separated by |.');
  const start=cwEventStart(startText,now()),end=cwEventStart(endText,now());if(end<=start||end-start>7*86400000)throw Error('The end must follow the start and be within seven days.');
  const title=cwClean(values.title,100),rawDetails=String(values.details||'').trim(),hostLine=rawDetails.split(/\r?\n/)[0]||'',hostMatch=hostLine.match(/^Host:\s*(.+)$/i),host=cwClean(hostMatch?.[1]||'',100),description=cwClean(rawDetails.replace(/^Host:\s*.*(?:\r?\n|$)/i,'').replace(/^Description:\s*/i,''),700);if(!title||!description)throw Error('Enter the event title and description. Optionally include Host: on the first line.');
  let link;try{link=new URL(values.link)}catch{throw Error('Enter a complete HTTPS event link.');}if(link.protocol!=='https:'||link.username||link.password)throw Error('Use a valid HTTPS event link.');
  const files=(values.flyer||[]).map(id=>i.data?.resolved?.attachments?.[id]);if(files.length>10||files.some(f=>!cwAllowedMedia(f)))throw Error('Upload up to 10 supported photo, video, or audio files.');
  const duplicateKey='event:'+title.toLowerCase()+':'+start;if(locks.has(duplicateKey))throw Error('This event is already being processed.');locks.add(duplicateKey);
  try{
   await recover('event');if([...entries.values()].some(e=>e.kind==='event'&&e.title?.toLowerCase()===title.toLowerCase()&&e.startsAt===start))throw Error('This event is already posted in Upcoming Events.');
   const existing=await api('/guilds/'+guildId+'/scheduled-events');if(existing.some(e=>e.name===title&&Date.parse(e.scheduled_start_time)===start))throw Error('This event is already on the server calendar.');
   const owner=i.member.user.id;
   const fmt=zone=>new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(start);
   const body={nonce:i.id,enforce_nonce:true,content:link.href,embeds:[{title:'📅 '+title,url:link.href,color,description:'Hosted by **'+(host||'Not specified')+'**\n\n'+description,fields:[{name:'When',value:fmt('America/New_York')+' ET · '+fmt('America/Chicago')+' CT\n'+stamp(start)+' → '+stamp(end)},{name:'Submitted by',value:'<@'+owner+'>'}],footer:{text:name+' • Upcoming Events'}}],components:controls('event',owner,end),allowed_mentions:CW_QUIET};
   const posted=await send(channels.event,body,files);remember(posted,'event');schedule();
   let note='Event posted.';
   try{
    const event=await api('/guilds/'+guildId+'/scheduled-events','POST',{name:title,privacy_level:2,entity_type:3,entity_metadata:{location:link.href.length<=100?link.href:'Online · full event link in description'},scheduled_start_time:new Date(start).toISOString(),scheduled_end_time:new Date(end).toISOString(),description:'Host: '+(host||'Not specified')+'\n'+description+'\n'+link.href+'\nhttps://discord.com/channels/'+guildId+'/'+channels.event+'/'+posted.id});
    await api(message(channels.event,posted.id),'PATCH',{components:controls('event',owner,end,[{type:2,style:5,label:'Event Details & Remind Me',url:'https://discord.com/events/'+guildId+'/'+event.id}]),allowed_mentions:CW_QUIET});note+=' Added to the server calendar.';
   }catch(e){log('calendar-held',{messageId:posted.id,reason:String(e.message).slice(0,140)});note+=' Calendar sync needs a moderator; the original flyer is preserved in your post.';}
   return note;
  }finally{locks.delete(duplicateKey);}
 }
 async function interaction(i){ if(CUTOVER&&String(i.data?.custom_id||"").startsWith("cw:live:"))return;
  const id=i.data?.custom_id||'';if(i.guild_id!==guildId||![3,5].includes(i.type)||!id.startsWith('cw:'))return false;
  const [,kind,action,owner,expires]=id.split(':');if(!['live','event'].includes(kind)||i.channel_id!==channels[kind])return false;
  if(kind==='event'&&['open','submit'].includes(action)&&!(BigInt(i.member?.permissions||'0')&(2048n|8n)))return callback(i,4,{content:'Event submissions are limited to authorized moderators.'});
  try{
   if(action==='open'){
    if(i.message?.author?.id!==appId||i.message.id!==panels[kind])return callback(i,6);
    return callback(i,9,cwModal(kind));
   }
   if(action==='history'&&kind==='live'){
    await callback(i,6);const postId=i.message?.id;
    if(!/^\d{15,22}$/.test(postId||''))return receipt(i,'Open View History on the original LIVE post.');
    const post=await api(message(channels.live,postId));if(post.author?.id!==appId||!ownerOf(post))return receipt(i,'History is available only on verified LIVE posts.');
    const e=post.embeds?.[0]||{},fields=e.fields||[],value=name=>fields.find(f=>f.name===name)?.value||'Not specified';
    return receipt(i,'**LIVE History**\nStatus: '+(ended(post)?'⚫ Ended':'🟢 Active')+'\nHost: '+(e.title||'').split(' · ').slice(1).join(' · ')+'\nShared by: '+value('Shared by')+'\nPosted: '+stamp(Date.parse(post.timestamp))+'\n'+(ended(post)?'Ended: '+value('Ended at'):'Active until: '+value('Active until'))+'\nSOS: '+value('SOS')+'\nLink: '+e.url);
   }
   if(action==='guide')return receipt(i,kind==='live'?'**Post a LIVE**\nUse Post My LIVE or paste a TikTok LIVE link. Choose Box Battle and name who you support. SOS is optional and sends one support alert to General Chat.\nYour post lasts 1, 2, 4 or 8 hours. End it early with Manage LIVE. Direct links identify the host; unresolved share links need a direct @handle/live URL.':'**Submit an event**\nAuthorized moderators enter the title, description, HTTPS link, and confirmed start/end times in ET or CT. Include Host: Name on the first line of the description when available. Add up to 10 original photos, videos, or audio files (20 MiB each; 24 MiB total). A verified calendar link appears when calendar creation succeeds. No mass mentions are sent.');
   if(action==='manage'){
    if(i.message?.author?.id!==appId||ownerOf(i.message)!==owner||!permitted(i,owner))return callback(i,6);
    if(kind==='live'&&ended(i.message))return receipt(i,'This LIVE has ended. Its original post and View History remain visible.');
    const buttons=kind==='live'?[{type:2,style:2,label:'End LIVE',custom_id:'cw:live:end:'+i.message.id},{type:2,style:1,label:'Set Duration',custom_id:'cw:live:extend:'+i.message.id},{type:2,style:2,label:'Edit Description',custom_id:'cw:live:edit:'+i.message.id},{type:2,style:4,label:'Send SOS',custom_id:'cw:live:sos:'+i.message.id},{type:2,style:2,label:'Resolve SOS',custom_id:'cw:live:resolve:'+i.message.id}]:[{type:2,style:2,label:'Archive Event Flyer',custom_id:'cw:event:archive:'+i.message.id}];
    await callback(i,6);
     const latest=await api(message(i.channel_id,i.message.id));
     const base=(latest.components||[]).filter(r=>!(r.components||[]).some(x=>/^cw:(?:live|event):(?:end|extend|edit|sos|resolve|archive|hours-)/.test(x.custom_id||'')));
     await api(message(i.channel_id,i.message.id),'PATCH',{components:[...base,{type:1,components:buttons}],allowed_mentions:CW_QUIET});
     return receipt(i,kind==='live'?'Manage your LIVE using the controls beneath the original buttons.':'Manage the event using the controls beneath the original buttons.');
   }
   if(kind==='live'&&['edit','extend'].includes(action)){
    if(!/^\d{15,22}$/.test(owner||''))throw Error('Use the current LIVE controls.');
    const post=await api(message(channels.live,owner));
    if(post.author?.id!==appId||!ownerOf(post)||!permitted(i,ownerOf(post)))throw Error('Only the original poster or a moderator can manage this LIVE.');
    if(action==='edit')return callback(i,9,{custom_id:'cw:live:edit-submit:'+owner,title:'Edit LIVE Description',components:[cwLabel('Description (optional)',{...cwText('description',false,700,'What is happening?',2),value:cwClean(post.embeds?.[0]?.description,700)})]});
    await callback(i,6);
     const latest=await api(message(channels.live,owner));
     const base=(latest.components||[]).filter(r=>!(r.components||[]).some(x=>/^cw:live:(?:end|extend|edit|sos|resolve|archive|hours-)/.test(x.custom_id||'')));
     await api(message(channels.live,owner),'PATCH',{components:[...base,{type:1,components:[1,2,4,8].map(h=>({type:2,style:2,label:h+' hour'+(h===1?'':'s'),custom_id:'cw:live:hours-'+h+':'+owner}))}],allowed_mentions:CW_QUIET});
     return receipt(i,'Choose how many hours to extend this LIVE using the controls below the original navigation.');
   }
   await callback(i,6);
   if(action==='submit'){
    const values={};for(const row of i.data.components||[])for(const c of row.component?[row.component]:row.components||[])values[c.custom_id]=c.values||c.value||'';
    if(kind==='event')return receipt(i,await eventPublish(i,values));
    const options=values.options||[];const member=values.member?.[0]||'';if(member&&!/^\d{17,20}$/.test(member))throw Error('Select a valid Discord member.');if(member&&String(values.support||'').trim())throw Error('Enter a participant OR select a Discord member, not both.');const support=member?'<@'+member+'>':values.support;const result=await publishLive({url:values.url,description:values.description,support,boxBattle:options.includes('box_battle'),sos:options.includes('sos'),hours:2,owner:i.member.user.id,nonce:i.id});return receipt(i,result.note+' https://discord.com/channels/'+guildId+'/'+channels.live+'/'+result.post.id);
   }
   if(kind==='live'&&(action==='edit-submit'||action==='resolve'||action.startsWith('hours-'))){
    if(!/^\d{15,22}$/.test(owner||''))throw Error('Use the current LIVE controls.');
    const post=await api(message(channels.live,owner)),postedBy=ownerOf(post);
    if(post.author?.id!==appId||!postedBy||!permitted(i,postedBy))throw Error('Only the original poster or a moderator can manage this LIVE.');
    const embed=post.embeds?.[0];if(!embed?.url)throw Error('LIVE listing could not be verified.');
    if(action==='edit-submit'){
      let description='';for(const row of i.data.components||[])for(const c of row.component?[row.component]:row.components||[])if(c.custom_id==='description')description=String(c.value||'');
      if(description.length>700)throw Error('Description is too long.');
      await api(message(channels.live,owner),'PATCH',{embeds:[{...embed,description:cwClean(description,700)||'Join the livestream and show your support.'}],allowed_mentions:CW_QUIET});
      return receipt(i,'LIVE description updated.');
    }
    if(action==='resolve'){
      const fields=(embed.fields||[]).map(f=>f.name==='SOS'?{...f,value:'Resolved'}:f);
      await api(message(channels.live,owner),'PATCH',{embeds:[{...embed,fields}],allowed_mentions:CW_QUIET});
      return receipt(i,'SOS resolved. No further alert was sent.');
    }
    const hours=Number(action.slice(6));if(![1,2,4,8].includes(hours))throw Error('Choose 1, 2, 4, or 8 hours.');
    const end=now()+hours*3600000;
    const components=(post.components||[]).map(row=>({...row,components:(row.components||[]).map(b=>(b.custom_id||'').startsWith('cw:live:manage:')?{...b,custom_id:'cw:live:manage:'+postedBy+':'+Math.floor(end/1000)}:b)}));
    const fields=(embed.fields||[]).map(f=>['Active until','Auto-expires at'].includes(f.name)?{...f,name:'Auto-expires at',value:stamp(end)}:f);
    await api(message(channels.live,owner),'PATCH',{embeds:[{...embed,fields}],components,allowed_mentions:CW_QUIET});
    const saved=entries.get(owner);if(saved){saved.expires=end;schedule();}
    return receipt(i,'LIVE duration updated to '+hours+' hour'+(hours===1?'':'s')+' from now.');
   }
   if(['end','sos','archive'].includes(action)){
    if(!/^\d{15,22}$/.test(owner||''))throw Error('Use the current post controls.');const post=await api(message(channels[kind],owner));
    if(post.author?.id!==appId||!ownerOf(post)||!permitted(i,ownerOf(post)))throw Error('Only the original poster or a moderator can manage this post.');
    if(action==='sos')return receipt(i,await sendSOS(post));
    if(action==='end'&&kind==='live')return receipt(i,await endLive(post));
    if(action==='archive'&&expiryOf(post)>now())throw Error('This event has not ended. Keep its flyer in Upcoming Events.');
    await retire(post,kind);return receipt(i,'Event flyer archived.');
   }
   return receipt(i,'Use the current widget controls.');
  }catch(e){log('interaction-held',{kind,action,reason:String(e.message).slice(0,160)});return receipt(i,String(e.message).slice(0,1600)).catch(()=>{});}
 }
 async function retire(post,kind){
  if(kind==='live')return endLive(post);
  if(kind==='event')throw Error('Native forum archiving awaits verified transfer; original event kept.');
  const lock='retire:'+post.id;if(locks.has(lock))throw Error('This post is already being processed.');locks.add(lock);
  try{
   if(kind==='event'&&(post.attachments||[]).length){
    const source='https://discord.com/channels/'+guildId+'/'+channels.event+'/'+post.id;
    const archivePayload={nonce:post.id,enforce_nonce:true,content:(post.content||'')+'\n[Original submission]('+source+')',embeds:post.embeds,components:[],allowed_mentions:CW_QUIET};
    let prior=null,before='';
    do{const batch=await api(message(channels.archive)+'?limit=100'+(before?'&before='+before:''));
     prior=batch.find(m=>m.author?.id===appId&&m.content===archivePayload.content);
     const next=batch.at(-1)?.id;if(prior||batch.length<100||!next||next===before)break;before=next;
    }while(true);
    const dest=prior||await send(channels.archive,archivePayload,post.attachments);
    const check=await api(message(channels.archive,dest.id));
    if(check.author?.id!==appId||check.attachments?.length!==post.attachments.length)throw Error('Archive readback failed; source kept.');
    const digest=async file=>{const f=await download(file);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',f.bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');};
    for(let n=0;n<post.attachments.length;n++){
     const original=post.attachments[n],copy=check.attachments[n];
     if(original.filename!==copy.filename||original.size!==copy.size||await digest(original)!==await digest(copy))throw Error('Original media verification failed; source kept.');
    }
   }
   await api(message(channels[kind],post.id),'DELETE');entries.delete(post.id);schedule();
  }finally{locks.delete(lock);}
 }
 async function maintain(){
  for(const e of [...entries.values()])if((!CUTOVER||e.kind!=='live')&&e.expires&&e.expires<=now())try{const post=await api(message(e.channel,e.id));if(post.author?.id===appId&&ownerOf(post))await retire(post,e.kind);}catch(error){if(/Discord 404 /.test(String(error.message))){entries.delete(e.id);continue;}log('expiry-held',{messageId:e.id,reason:String(error.message).slice(0,140)});e.expires=now()+60000;}
  schedule();
 }
 async function direct(msg){ if(CUTOVER)return;
  if(!ready||msg.guild_id!==guildId||msg.channel_id!==channels.live||msg.webhook_id)return;
  if(msg.author?.bot){if(msg.author.id!==appId)queueLivePanel();return;}
  if(!/https:\/\/\S*tiktok\.com\b/i.test(msg.content||'')){queueLivePanel();return;}
  try{
   const result=await publishLive({url:msg.content,description:String(msg.content).replace(/https:\/\/\S+/g,'').replace(/^\s*(?:SOS|#SOS)\s*:?/i,'').trim(),sos:/^\s*(?:SOS|#SOS)(?:\s|:|$)/i.test(msg.content),owner:msg.author.id,nonce:msg.id});
   if(!msg.attachments?.length&&msg.author?.id!=="1276370255152812045"){const verify=await api(message(channels.live,result.post.id));if(verify.author?.id===appId&&ownerOf(verify)===msg.author.id)await api(message(channels.live,msg.id),'DELETE');}
  }catch(e){log('direct-held',{source:msg.id,reason:String(e.message).slice(0,160)});queueLivePanel();}
 }
 return {channels,init,interaction,direct,publishLive,eventPublish,maintain,ready:()=>ready};
}





const token=String(Bun.env.DISCORD_BOT_TOKEN||'').trim();
if(!token)throw Error('DISCORD_BOT_TOKEN is unavailable');
const widget=cwRuntime({guildId:'1565048205970767992',appId:'1565304619838742598',token,name:'Dawn Dotta',color:3848880});
let client=null,lastClose=null,gatewayReady=false,started=false;
Bun.serve({hostname:'0.0.0.0',port:Number(Bun.env.PORT||8080),fetch(req){const p=new URL(req.url).pathname;if(p==='/preflight')return (async()=>{try{const headers={Authorization:'Bot '+token};const [id,channels]=await Promise.all([fetch('https://discord.com/api/v10/users/@me',{headers,signal:AbortSignal.timeout(9000)}),fetch('https://discord.com/api/v10/guilds/1565048205970767992/channels',{headers,signal:AbortSignal.timeout(9000)})]);const bot=id.ok?await id.json():{},list=channels.ok?await channels.json():[];const needed=['live-now','upcoming-events','archived-flyers','general-chat'];const found=needed.map(n=>({name:n,matches:list.filter(x=>cwSlug(x.name)===n&&x.type===(n==='archived-flyers'?15:0)).length}));const passed=id.ok&&channels.ok&&bot.id==='1565304619838742598'&&found.every(x=>x.matches===1);return Response.json({ready:passed,botMatches:bot.id==='1565304619838742598',guildScope:'1565048205970767992',channels:found,active:Bun.env.LISTENER_RUNTIME_ACTIVE==='true',writesOnPreflight:false},{status:passed?200:503})}catch(e){return Response.json({ready:false,errorType:e?.name||'unknown'},{status:503})}})();return ['/health','/healthz'].includes(p)?Response.json({ready:widget.ready()&&gatewayReady,lastClose},{status:widget.ready()&&gatewayReady?200:503}):Response.json({error:'not-found'},{status:404})}});
async function connect(withContent=true){
 client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,...(withContent?[GatewayIntentBits.MessageContent]:[])],allowedMentions:{parse:[]}});
 client.on('raw',p=>{if(p.t==='INTERACTION_CREATE')void widget.interaction(p.d).catch(()=>console.error('creator-widget-interaction-error'));if(p.t==='MESSAGE_CREATE')void widget.direct(p.d).catch(()=>console.error('creator-widget-message-error'))});
 client.on(Events.ShardDisconnect,e=>{gatewayReady=false;lastClose=e.code;console.warn(JSON.stringify({event:'creator-widget-gateway-disconnected',code:e.code}));});
 client.on(Events.ShardResume,()=>{gatewayReady=true;});
 client.on(Events.Error,()=>console.error('creator-widget-gateway-error'));
 client.once(Events.ClientReady,async()=>{gatewayReady=true;if(!started){try{await widget.init();started=true}catch(e){console.error(JSON.stringify({event:'creator-widget-startup-held',reason:String(e.message).slice(0,160)}));}}console.log(JSON.stringify({event:'creator-widget-gateway-ready',withContent}));});
 try{await client.login(token)}catch(e){
  await client.destroy();
  if(withContent&&(lastClose===4014||/disallowed intents/i.test(String(e.message)))){console.warn(JSON.stringify({event:'creator-widget-content-intent-unavailable',formsAvailable:true,pastedLinksAvailable:false}));await connect(false);}
  else{console.error(JSON.stringify({event:'creator-widget-login-held',code:lastClose,reason:String(e.message).replace(/Bot\s+\S+/g,'[private]').slice(0,120)}));}
 }
}
if(Bun.env.LISTENER_RUNTIME_ACTIVE==='true')await connect();else console.log(JSON.stringify({event:'team-momentum-listener-standby',active:false,noDiscordWrites:true}));

void (async function listenerReadOnlyStartupCheck(){
 try{
  await Bun.sleep(350);
  const response=await fetch('http://127.0.0.1:'+String(Bun.env.PORT||8080)+'/preflight',{signal:AbortSignal.timeout(12000)});
  const result=await response.json();
  console.log(JSON.stringify({event:'TEAM_MOMENTUM_LISTENER_PREFLIGHT',ready:response.status===200&&result.ready===true,botMatches:result.botMatches,channels:result.channels,active:result.active,writes:false}));
 }catch(e){console.error(JSON.stringify({event:'TEAM_MOMENTUM_LISTENER_PREFLIGHT',ready:false,errorType:e?.name||'unknown',writes:false}));}
})();