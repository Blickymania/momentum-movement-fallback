# Read-only recovery snapshot: Dawn Dotta Social Owner Console

- Railway project: Dawn Dotta / Momentum Movement
- Railway service ID: 01588dd4-a338-4e73-a98c-e377e676efd7
- Environment: production
- Runtime image: ghcr.io/railwayapp/function-bun:1.4.4
- Latest deployment: not returned
- Latest deployment status: not returned
- Latest deployment created: not returned
- Source length: 53889 characters
- Extracted from configured start command using local base64 decoding on 2026-11-14 UTC.
- Environment variable names detected in source: AUTHORIZED_GUILD_ID, DISCORD_BOT_TOKEN, PORT
- Environment variable values are not present in this snapshot.
- Secret-literal scan found no common bot token, GitHub token, OpenAI key, private-key, bearer-token or long-base64 pattern.
- This is a read-only recovery artifact, not connected to a deployment target.
- Do not deploy directly; dependencies, gateway ownership, network boundaries, data sources and rollback must be reviewed first.

---


import {Client,GatewayIntentBits,Events,ChannelType,PermissionFlagsBits as P,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags} from "discord.js@14.27.0";
const GUILD="1565048205970767992",PARENT="1565643251783049237",NAME="🔐┃social-management";
const MARKER="SOCIAL_ADMIN_DASHBOARD_V3:"+GUILD,PREFIX="social3:";
const META="SOCIAL_PROPOSAL_V3",CREATOR="Dawn Dotta / Momentum Movement";
const LINKS=[
 ["TikTok","SOCIAL_TIKTOK_URL","SOCIAL_TIKTOK_HANDLE","🎵"],
 ["TikTok LIVE","SOCIAL_TIKTOK_LIVE_URL","","🔴"],
 ["Instagram","SOCIAL_INSTAGRAM_URL","SOCIAL_INSTAGRAM_HANDLE","📸"],
 ["Facebook","SOCIAL_FACEBOOK_URL","SOCIAL_FACEBOOK_USERNAME","🌐"],
 ["Threads","SOCIAL_THREADS_URL","SOCIAL_THREADS_HANDLE","🧵"],
 ["X","SOCIAL_X_URL","SOCIAL_X_HANDLE","𝕏"],
 ["YouTube","SOCIAL_YOUTUBE_URL","","▶️"],
 ["LinkedIn","SOCIAL_LINKEDIN_URL","SOCIAL_LINKEDIN_USERNAME","💼"],
 ["Linktree","SOCIAL_LINKTREE_URL","SOCIAL_LINKTREE_USERNAME","🔗"],
 ["Lemon8","SOCIAL_LEMON8_URL","SOCIAL_LEMON8_HANDLE","🍋"],
 ["Audiomack","SOCIAL_AUDIOMACK_URL","SOCIAL_AUDIOMACK_HANDLE","🎧"],
 ["Apple Music","SOCIAL_APPLE_MUSIC_URL","","🎶"],
 ["Amazon Music","SOCIAL_AMAZON_MUSIC_URL","","🎼"],
 ["Discord","SOCIAL_DISCORD_INVITE_URL","","💬"]
];
const HOSTS={TikTok:["tiktok.com"],"TikTok LIVE":["tiktok.com"],Instagram:["instagram.com"],Facebook:["facebook.com"],Threads:["threads.com"],X:["x.com"],YouTube:["youtube.com"],LinkedIn:["linkedin.com"],Linktree:["linktr.ee"],Lemon8:["lemon8-app.com"],Audiomack:["audiomack.com"],"Apple Music":["music.apple.com"],"Amazon Music":["music.amazon.com","music.amazon.in","music.amazon.co.uk"],Discord:["discord.gg","discord.com"]};
const bot=new Client({intents:[GatewayIntentBits.Guilds]});let boardId=null,channelId=null,ownerId=null;
const noPing={parse:[],users:[],roles:[],repliedUser:false};
const log=(event,meta={})=>console.log(JSON.stringify({event,creator:CREATOR,...meta}));
const urlOK=(url,platform)=>{try{const u=new URL(url);return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&HOSTS[platform]?.some(h=>u.hostname===h||u.hostname==="www."+h)}catch{return false}};
const entries=()=>LINKS.flatMap(([label,key,handle,emoji])=>{const url=Bun.env[key];return url&&urlOK(url,label)?[{label,key,url,emoji,handle:handle?String(Bun.env[handle]||"").slice(0,80):""}]:[]});
const row=(buttons)=>new ActionRowBuilder().addComponents(buttons);
const button=(id,label,style)=>new ButtonBuilder().setCustomId(PREFIX+id).setLabel(label).setStyle(style);

const controls=(mode="home")=>[row([button("refresh","Refresh Dashboard",ButtonStyle.Primary),button("verify","Verify Links",ButtonStyle.Secondary),button("review","Review Proposals",ButtonStyle.Secondary),button("propose","Submit Link",ButtonStyle.Success),button("toggle:"+(mode==="collapsed"?"closed":"open"),mode==="collapsed"?"Show Details":"Hide Details",ButtonStyle.Secondary)]),row([button("approve-latest","Approve Latest",ButtonStyle.Success),button("reject-latest","Reject Latest",ButtonStyle.Danger)])];
const isBoard=m=>m.author.id===bot.user.id&&(m.embeds[0]?.footer?.text===MARKER||m.components?.some(r=>r.components?.some(b=>b.customId===PREFIX+"refresh"||b.data?.custom_id===PREFIX+"refresh")));
const proposalButton=m=>m.components?.flatMap(r=>r.components||[]).map(b=>b.customId||b.data?.custom_id||"").find(id=>id.startsWith(PREFIX+"approve:"))||null;
const isPending=m=>m.author.id===bot.user.id&&(m.embeds[0]?.footer?.text===META+":PENDING"||!!proposalButton(m));
function proposalText(platform,url,handle,status="PENDING"){
 return "## 📝 Social link proposal • "+platform+"\n**Status:** "+status+"\n**Proposed URL:** <"+url+">\n**Handle:** "+(handle||"not specified")+"\n**Owner:** <@"+ownerId+">";
}
function oldProposalText(m){
 const fields=m.embeds[0]?.fields||[];
 const val=n=>fields.find(f=>f.name===n)?.value||"";
 return proposalText(val("Platform")||"Unknown",val("Proposed URL")||"Unknown",val("Handle")||"not specified");
}
function view(mode="home",extra=""){
 const items=entries();
 const links=items.length?items.map(x=>x.emoji+" ["+x.label+"]("+x.url+")"+(x.handle?" · "+x.handle:"")).join("\n").slice(0,3000):"No approved links configured";
 const body=mode==="notice"?"## 📋 Dashboard update\n"+extra:mode==="verify"?"## 🔎 Link verification\n"+extra:mode==="review"?"## 🗂️ Pending proposals\n"+extra:
 "## 🔐 SOCIAL MEDIA COMMAND CENTER\n**"+CREATOR+"** • Owner-only controls\nLive social links come from this creator's Railway Shared Variables. New accounts require approval before Railway values change.\n\n**Approved links**\n"+links+"\n\n**Approval policy**\nApproval does not deploy to Railway. A separate authorized variable update is required.";
 return {flags:MessageFlags.IsComponentsV2,components:[...controls(mode).map(r=>r.toJSON()),...(mode==="collapsed"?[{type:10,content:"-# Details hidden"}]:[{type:17,accent_color:0xA51F42,components:[{type:10,content:body.slice(0,3900)},{type:10,content:"-# Owner-only • Interactive dashboard"}]}])],allowedMentions:noPing};
}
// Permanent guild-local policy: no ephemeral responses. All feedback stays in the owner-only dashboard.
async function boardNotice(i,message){
  if(!i.deferred&&!i.replied)await i.deferUpdate();
  if(!boardId)throw Error("Social command dashboard unavailable");
  const board=await i.channel.messages.fetch(boardId);
  await board.edit({...view("notice",message),content:null,embeds:[]});
}
async function ensure(){
 const guild=await bot.guilds.fetch(GUILD),owner=guild.ownerId; ownerId=owner;
  if(bot.user?.id!=="1565304619838742598")throw Error("Momentum Movement bot application identity mismatch");
 await guild.channels.fetch();
 // Owner-controlled layout: category moves and renames do not disable this private dashboard.
 const self=await guild.members.fetchMe();
 if(!self.permissions.has(P.ViewChannel))throw Error("Bot lacks private dashboard channel visibility");
 const chan=guild.channels.cache.get("1565848585617023088");
 if(!chan||chan.type!==ChannelType.GuildText||chan.guildId!==GUILD)throw Error("Owner-controlled private social-management channel unavailable; no channel recreated");
 const everyone=chan.permissionOverwrites.cache.get(GUILD);
 if(!everyone?.deny.has(P.ViewChannel))throw Error("Owner dashboard channel is not private; refusing to publish");
 channelId=chan.id;
 const history=await chan.messages.fetch({limit:100});const previous=history.filter(isBoard);
 if(previous.size>1)throw Error("Duplicate social admin dashboards require staff review");
 const one=previous.first(),payload=view();
 if(one){boardId=one.id;await one.edit({...payload,content:null,embeds:[]});log("social_admin_dashboard_updated",{channelId,boardId});}
 else{const m=await chan.send({...payload,flags:MessageFlags.IsComponentsV2|MessageFlags.SuppressNotifications});boardId=m.id;log("social_admin_dashboard_created",{channelId,boardId});}
  for(const m of history.values())if(m.author.id===bot.user.id&&m.embeds[0]?.footer?.text===META+":PENDING"&&proposalButton(m)){
   await m.edit({flags:MessageFlags.IsComponentsV2,content:null,embeds:[],components:[...m.components.map(r=>r.toJSON()),{type:10,content:oldProposalText(m)}],allowedMentions:noPing});
  }
}
async function verify(){
 const out=[];
 for(const x of entries()){
  let status="Inconclusive";
  try{
   const request=async(method)=>{const r=await fetch(x.url,{method,redirect:"manual",headers:method==="GET"?{range:"bytes=0-0"}:{},signal:AbortSignal.timeout(6500)});if(r.body)await r.body.cancel().catch(()=>{});return {status:r.status,location:r.headers.get("location")};};
   let res=await request("HEAD");
   if([404,405,410,501].includes(res.status))res=await request("GET");
   if(res.status>=200&&res.status<300)status="Reachable";
   else if(res.status>=300&&res.status<400){
    let target="";try{target=new URL(res.location||"",x.url).toString()}catch{}
    status=target&&urlOK(target,x.label)?"Normal platform redirect":"Redirect needs review";
   }else if([401,403,429,451,999].includes(res.status))status="Platform restricts automated checks";
   else if([404,410].includes(res.status))status="Not found • manual review needed";
   else status="HTTP "+res.status+" • review";
  }catch{status="Network check inconclusive";}
  out.push(x.emoji+" **"+x.label+"**: "+status);
 }
 return out.join("\n").slice(0,1800)||"No approved URLs configured";
}
async function latestProposal(chan){const messages=await chan.messages.fetch({limit:100});return messages.filter(isPending).first()||null;}
async function review(chan){
 const messages=await chan.messages.fetch({limit:100});
 const pending=messages.filter(isPending).map(m=>{
   const t=m.embeds[0]?oldProposalText(m):m.components.filter(c=>c.type===10).map(c=>c.data?.content||c.content||"").join("\n");
   return t+"\n-# Proposal ID "+m.id;
 });
 return pending.length?pending.slice(0,5).join("\n\n---\n\n").slice(0,3200):"No pending proposals among the latest 100 channel messages.";
}
bot.on(Events.InteractionCreate,async i=>{
 if(i.guildId!==GUILD||!i.customId?.startsWith(PREFIX))return;
 if(i.user.id!==ownerId){log("social_control_unauthorized",{action:i.customId});if(i.isRepliable()&&!i.deferred&&!i.replied)await i.deferUpdate().catch(()=>{});return;}
 if(i.channelId!==channelId)return;
 const action=i.customId.slice(PREFIX.length);
 try{
  if(i.isButton()&&(["approve-latest","reject-latest"].includes(action))){
    await i.deferUpdate();
    const msg=await latestProposal(i.channel);
    if(!msg)return void await boardNotice(i,"No pending proposals were found.");
    const approve=action==="approve-latest";
    const old=msg.embeds[0]?oldProposalText(msg):msg.components.filter(c=>c.type===10).map(c=>c.data?.content||c.content||"").join("\n");
    const status=approve?"APPROVED FOR RAILWAY • NOT DEPLOYED":"REJECTED • NO RAILWAY CHANGES";
    const detail=old.replace(/\*\*Status:\*\* PENDING/,"**Status:** "+status);
    await msg.edit({flags:MessageFlags.IsComponentsV2,content:null,embeds:[],components:[{type:10,content:detail.slice(0,3900)}],allowedMentions:noPing});
    log("social_v3_latest_proposal_reviewed",{messageId:msg.id,approved:approve});
    await boardNotice(i,"**Proposal decision**\n"+detail+"\n\nRailway variables remain unchanged until separately authorized.");
    return;
   }
   if(i.isButton()&&(["refresh","verify","review","propose"].includes(action)||action.startsWith("toggle:"))){
   if(action==="propose"){
    const modal=new ModalBuilder().setCustomId(PREFIX+"submit").setTitle("Submit social profile for approval");
    modal.addComponents(
     row([new TextInputBuilder().setCustomId("platform").setLabel("Platform (e.g. Instagram)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)]),
     row([new TextInputBuilder().setCustomId("url").setLabel("Official profile URL (https)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(400)]),
     row([new TextInputBuilder().setCustomId("handle").setLabel("Username or handle").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)]));
    await i.showModal(modal);return;
   }
   await i.deferUpdate();
    const mode=action==="verify"?"verify":action==="review"?"review":action==="toggle:open"?"collapsed":"home";
    const detail=mode==="verify"?await verify():mode==="review"?await review(i.channel):"";
    await i.editReply({...view(mode,detail),content:null,embeds:[]});return;
  }
  if(i.isModalSubmit()&&action==="submit"){
   const input=i.fields.getTextInputValue("platform").trim(),url=i.fields.getTextInputValue("url").trim(),handle=i.fields.getTextInputValue("handle").trim();
   const platform=Object.keys(HOSTS).find(x=>x.toLowerCase()===input.toLowerCase());
   if(!platform||!urlOK(url,platform))return void await boardNotice(i,"❌ Invalid or unsupported platform URL. No proposal was recorded.");
   const m=await i.channel.send({flags:MessageFlags.IsComponentsV2|MessageFlags.SuppressNotifications,components:[{type:10,content:proposalText(platform,url,handle)}],allowedMentions:noPing});
   await m.edit({flags:MessageFlags.IsComponentsV2,content:null,embeds:[],components:[row([button("approve:"+m.id,"Approve for Railway",ButtonStyle.Success),button("reject:"+m.id,"Reject",ButtonStyle.Danger)]).toJSON(),{type:10,content:proposalText(platform,url,handle)}],allowedMentions:noPing});
   log("social_proposal_created",{messageId:m.id,platform});
   await boardNotice(i,"**New proposal — pending owner decision**\n"+proposalText(platform,url,handle)+"\n\nUse Approve Latest or Reject Latest above. The original proposal is retained for audit. Railway variables are unchanged.");return;
  }
  if(i.isButton()&&(action.startsWith("approve:")||action.startsWith("reject:"))){
   const approve=action.startsWith("approve:"),id=action.split(":")[1];
   if(!/^\d{17,22}$/.test(id))return;
   await i.deferUpdate();
   const msg=await i.channel.messages.fetch(id);
   if(!isPending(msg))return void await boardNotice(i,"ℹ️ This proposal is no longer pending.");
   const old=msg.embeds[0]?oldProposalText(msg):msg.components.filter(c=>c.type===10).map(c=>c.data?.content||c.content||"").join("\n");
   const status=approve?"APPROVED FOR RAILWAY • NOT DEPLOYED":"REJECTED • NO RAILWAY CHANGES";
   const content=old.replace(/\*\*Status:\*\* PENDING/,"**Status:** "+status);
   await msg.edit({flags:MessageFlags.IsComponentsV2,content:null,embeds:[],components:[{type:10,content:content.slice(0,3900)}],allowedMentions:noPing});
   log("social_proposal_reviewed",{messageId:id,approved:approve});
   await boardNotice(i,approve?"✅ Approval recorded; no live social variables were changed.":"ℹ️ Proposal rejected. No Railway changes were made.");
  }
  }catch(e){log("social_admin_action_failed",{action,kind:e?.name||"Error"});if(i.isRepliable())await boardNotice(i,"❌ Action failed. No Railway changes were made.").catch(()=>{});}
});

/* DAWN_DB10_PROFILE_HANDLER_V1: guild-scoped, no layout automation, source photos fetched from original Discord messages. */
const DPH={"guild":"1565048205970767992","channel":"1565592613795532893","message":"1566526254260162671","app":"1565304619838742598","intro":"### 🌅 Dawn Dotta — The Complete Journey\n\n**Shameka Dowell / Shameka Carey Dowell** | Nashville-raised, Tennessee-based creator and Momentum Movement owner.\n\nDawn's story combines years of healthcare service, distance running, entrepreneurship, livestream education and community leadership. Her work connects the discipline of medicine and endurance athletics with the encouragement she shares with digital creators.\n\n**Chapters:** Healthcare • Education • Marathon Running • Entrepreneurship • TikTok LIVE • Momentum Movement • Family and Values.","pages":[{"label":"Journey","text":"### 🌅 Dawn Dotta — The Complete Journey\n\n**Shameka Dowell / Shameka Carey Dowell** | Nashville-raised, Tennessee-based creator and Momentum Movement owner.\n\nDawn's story combines years of healthcare service, distance running, entrepreneurship, livestream education and community leadership. Her work connects the discipline of medicine and endurance athletics with the encouragement she shares with digital creators.\n\n**Chapters:** Healthcare • Education • Marathon Running • Entrepreneurship • TikTok LIVE • Momentum Movement • Family and Values.","photos":[{"threadId":"1566577814055157770","messageId":"1566577817561333800","filename":"dd_01_hero_red.png","caption":"Introduction • Main hero portrait against a vibrant red background.","width":200,"height":200},{"threadId":"1566577814055157770","messageId":"1566577823001477246","filename":"dd_02_headshot_curly.png","caption":"Professional headshot on a neutral background.","width":200,"height":198},{"threadId":"1566577871261278248","messageId":"1566578019605155920","filename":"dd_04_selfie.png","caption":"Personal Journey • Smiling close-up portrait taken in a vehicle.","width":200,"height":200},{"threadId":"1566577871261278248","messageId":"1566578067491651744","filename":"dd_06_white_gown_mirror.png","caption":"Personal Journey • White formal gown with a mirror-view portrait.","width":200,"height":200},{"threadId":"1566577871261278248","messageId":"1566578072411578508","filename":"dd_13_black_dress.png","caption":"Personal Journey • Full-length black dress portrait outside a warmly lit building.","width":150,"height":200},{"threadId":"1566577871261278248","messageId":"1566578078036000800","filename":"dd_19_vineyard_actual.png","caption":"Personal Journey • Lifestyle portrait standing among vineyard vines.","width":133,"height":199},{"threadId":"1566577871261278248","messageId":"1566578083782336732","filename":"dd_20_hampton_social.png","caption":"Personal Journey • At a floral Hampton Social venue backdrop.","width":150,"height":200}]},{"label":"Healthcare","text":"### 🩺 Healthcare & Education\n\nDawn Dotta's professional journey includes years of healthcare service. The documented reference list includes Vanderbilt Heart Institute's 2013 report recognizing Shameka Dowell as a member of its ventricular-assist-device (VAD) team, as well as a historical FitStars Nashville biography.\n\nUse the reference dropdown below to review the source names and details.","photos":[{"threadId":"1566577814055157770","messageId":"1566577817561333800","filename":"dd_01_hero_red.png","caption":"Introduction • Main hero portrait against a vibrant red background.","width":200,"height":200},{"threadId":"1566577814055157770","messageId":"1566577823001477246","filename":"dd_02_headshot_curly.png","caption":"Professional headshot on a neutral background.","width":200,"height":198},{"threadId":"1566577863086575778","messageId":"1566577958603329729","filename":"dd_05_green_gown.png","caption":"Professional Portraits • Seated formal portrait in an emerald green gown.","width":199,"height":133},{"threadId":"1566577863086575778","messageId":"1566577997517951157","filename":"dd_09_peach_dress_steps.png","caption":"Professional Portraits • Peach-colored dress portrait on outdoor stone steps.","width":199,"height":133},{"threadId":"1566577863086575778","messageId":"1566578001922105486","filename":"dd_11_peach_dress_garden.png","caption":"Professional Portraits • Seated peach dress portrait among flowers.","width":199,"height":133},{"threadId":"1566577863086575778","messageId":"1566578008993562674","filename":"dd_16_pink_dress.png","caption":"Professional Portraits • Pink dress portrait surrounded by hydrangeas.","width":200,"height":200},{"threadId":"1566577863086575778","messageId":"1566578014224126033","filename":"dd_17_pink_studio_gown.png","caption":"Professional Portraits • Coral-pink studio gown with a long train.","width":160,"height":200}]},{"label":"Running","text":"### 🏃 Running & Endurance\n\nDawn's running history includes the 2017 Tunnel Vision Marathon and photos documenting race medals, long-distance training, and event participation. The existing gallery contains the 26.37-mile 2017 result, a 26.4-mile activity record, a river-route 6.2-mile overlay, a road-race photo, and a Rock 'n' Roll half-marathon image.","photos":[{"threadId":"1566577842160930987","messageId":"1566577845407322222","filename":"dd_08_2017_tunnel_vision.png","caption":"Running • 2017 Tunnel Vision Marathon medal photo and 26.37-mile fitness-app metrics.","width":196,"height":200},{"threadId":"1566577842160930987","messageId":"1566577937325494365","filename":"dd_10_marathon_strava.png","caption":"Running • Marathon medal photo with Strava activity overlay of 26.4 miles.","width":143,"height":199},{"threadId":"1566577842160930987","messageId":"1566577942497202379","filename":"dd_12_river_strava.png","caption":"Running • Medal portrait beside a river and bridge; Strava activity displays 6.2 miles.","width":150,"height":199},{"threadId":"1566577842160930987","messageId":"1566577948117569628","filename":"dd_14_running_road.png","caption":"Running • Action photograph of running a road race, bib number 2025.","width":137,"height":200},{"threadId":"1566577842160930987","messageId":"1566577952689487976","filename":"dd_15_rock_n_roll_race.png","caption":"Running • Rock 'n' Roll Virginia Beach Half Marathon race bib photograph.","width":105,"height":199}]},{"label":"Business","text":"### 💼 Business & Entrepreneurship\n\nDawn's profile brings together healthcare experience, entrepreneurship, and creator development. Her professional portraits are presented here as part of that journey. Additional business claims have been left out pending verified biography sources.","photos":[{"threadId":"1566577863086575778","messageId":"1566577958603329729","filename":"dd_05_green_gown.png","caption":"Professional Portraits • Seated formal portrait in an emerald green gown.","width":199,"height":133},{"threadId":"1566577863086575778","messageId":"1566577997517951157","filename":"dd_09_peach_dress_steps.png","caption":"Professional Portraits • Peach-colored dress portrait on outdoor stone steps.","width":199,"height":133},{"threadId":"1566577863086575778","messageId":"1566578001922105486","filename":"dd_11_peach_dress_garden.png","caption":"Professional Portraits • Seated peach dress portrait among flowers.","width":199,"height":133},{"threadId":"1566577863086575778","messageId":"1566578008993562674","filename":"dd_16_pink_dress.png","caption":"Professional Portraits • Pink dress portrait surrounded by hydrangeas.","width":200,"height":200},{"threadId":"1566577863086575778","messageId":"1566578014224126033","filename":"dd_17_pink_studio_gown.png","caption":"Professional Portraits • Coral-pink studio gown with a long train.","width":160,"height":200}]},{"label":"Creator","text":"### 🎥 Creator Journey\n\nThrough TikTok LIVE, creator education and the StreampreneurX community, Dawn connects her audience with practical encouragement and entertainment. The original creator-gallery messages show her at a creator studio with TikTok signage and beside a ring light.","photos":[{"threadId":"1566577826906505467","messageId":"1566577830803013652","filename":"dd_03_spx_tiktok_visit.png","caption":"Creator Journey • At a creator studio with an SPX T-shirt beside TikTok signage.","width":150,"height":200},{"threadId":"1566577826906505467","messageId":"1566577836968648796","filename":"dd_07_creator_ringlight.png","caption":"Creator Journey • At a ring light with a smartphone in a creator-studio setting.","width":199,"height":133}]},{"label":"Momentum","text":"### 🌅 Momentum Movement\n\nMomentum Movement is Dawn Dotta's independent Discord community, built around personal progress, encouragement and creator support. Her story connects healthcare, endurance running, entrepreneurship and livestream education.","photos":[{"threadId":"1566577871261278248","messageId":"1566578019605155920","filename":"dd_04_selfie.png","caption":"Personal Journey • Smiling close-up portrait taken in a vehicle.","width":200,"height":200},{"threadId":"1566577871261278248","messageId":"1566578067491651744","filename":"dd_06_white_gown_mirror.png","caption":"Personal Journey • White formal gown with a mirror-view portrait.","width":200,"height":200},{"threadId":"1566577871261278248","messageId":"1566578072411578508","filename":"dd_13_black_dress.png","caption":"Personal Journey • Full-length black dress portrait outside a warmly lit building.","width":150,"height":200},{"threadId":"1566577871261278248","messageId":"1566578078036000800","filename":"dd_19_vineyard_actual.png","caption":"Personal Journey • Lifestyle portrait standing among vineyard vines.","width":133,"height":199},{"threadId":"1566577871261278248","messageId":"1566578083782336732","filename":"dd_20_hampton_social.png","caption":"Personal Journey • At a floral Hampton Social venue backdrop.","width":150,"height":200},{"threadId":"1566577826906505467","messageId":"1566577830803013652","filename":"dd_03_spx_tiktok_visit.png","caption":"Creator Journey • At a creator studio with an SPX T-shirt beside TikTok signage.","width":150,"height":200},{"threadId":"1566577826906505467","messageId":"1566577836968648796","filename":"dd_07_creator_ringlight.png","caption":"Creator Journey • At a ring light with a smartphone in a creator-studio setting.","width":199,"height":133}]},{"label":"Photos","text":"### 🖼️ Dawn Dotta Photo Collection\n\nBrowse the 19 photographs already present in the community's owner-gallery threads, including portraits, running milestones, creator experiences and personal-life images. The original gallery posts remain intact.","photos":[{"threadId":"1566577814055157770","messageId":"1566577817561333800","filename":"dd_01_hero_red.png","caption":"Introduction • Main hero portrait against a vibrant red background.","width":200,"height":200},{"threadId":"1566577814055157770","messageId":"1566577823001477246","filename":"dd_02_headshot_curly.png","caption":"Professional headshot on a neutral background.","width":200,"height":198},{"threadId":"1566577826906505467","messageId":"1566577830803013652","filename":"dd_03_spx_tiktok_visit.png","caption":"Creator Journey • At a creator studio with an SPX T-shirt beside TikTok signage.","width":150,"height":200},{"threadId":"1566577826906505467","messageId":"1566577836968648796","filename":"dd_07_creator_ringlight.png","caption":"Creator Journey • At a ring light with a smartphone in a creator-studio setting.","width":199,"height":133},{"threadId":"1566577842160930987","messageId":"1566577845407322222","filename":"dd_08_2017_tunnel_vision.png","caption":"Running • 2017 Tunnel Vision Marathon medal photo and 26.37-mile fitness-app metrics.","width":196,"height":200},{"threadId":"1566577842160930987","messageId":"1566577937325494365","filename":"dd_10_marathon_strava.png","caption":"Running • Marathon medal photo with Strava activity overlay of 26.4 miles.","width":143,"height":199},{"threadId":"1566577842160930987","messageId":"1566577942497202379","filename":"dd_12_river_strava.png","caption":"Running • Medal portrait beside a river and bridge; Strava activity displays 6.2 miles.","width":150,"height":199},{"threadId":"1566577842160930987","messageId":"1566577948117569628","filename":"dd_14_running_road.png","caption":"Running • Action photograph of running a road race, bib number 2025.","width":137,"height":200},{"threadId":"1566577842160930987","messageId":"1566577952689487976","filename":"dd_15_rock_n_roll_race.png","caption":"Running • Rock 'n' Roll Virginia Beach Half Marathon race bib photograph.","width":105,"height":199},{"threadId":"1566577863086575778","messageId":"1566577958603329729","filename":"dd_05_green_gown.png","caption":"Professional Portraits • Seated formal portrait in an emerald green gown.","width":199,"height":133},{"threadId":"1566577863086575778","messageId":"1566577997517951157","filename":"dd_09_peach_dress_steps.png","caption":"Professional Portraits • Peach-colored dress portrait on outdoor stone steps.","width":199,"height":133},{"threadId":"1566577863086575778","messageId":"1566578001922105486","filename":"dd_11_peach_dress_garden.png","caption":"Professional Portraits • Seated peach dress portrait among flowers.","width":199,"height":133},{"threadId":"1566577863086575778","messageId":"1566578008993562674","filename":"dd_16_pink_dress.png","caption":"Professional Portraits • Pink dress portrait surrounded by hydrangeas.","width":200,"height":200},{"threadId":"1566577863086575778","messageId":"1566578014224126033","filename":"dd_17_pink_studio_gown.png","caption":"Professional Portraits • Coral-pink studio gown with a long train.","width":160,"height":200},{"threadId":"1566577871261278248","messageId":"1566578019605155920","filename":"dd_04_selfie.png","caption":"Personal Journey • Smiling close-up portrait taken in a vehicle.","width":200,"height":200},{"threadId":"1566577871261278248","messageId":"1566578067491651744","filename":"dd_06_white_gown_mirror.png","caption":"Personal Journey • White formal gown with a mirror-view portrait.","width":200,"height":200},{"threadId":"1566577871261278248","messageId":"1566578072411578508","filename":"dd_13_black_dress.png","caption":"Personal Journey • Full-length black dress portrait outside a warmly lit building.","width":150,"height":200},{"threadId":"1566577871261278248","messageId":"1566578078036000800","filename":"dd_19_vineyard_actual.png","caption":"Personal Journey • Lifestyle portrait standing among vineyard vines.","width":133,"height":199},{"threadId":"1566577871261278248","messageId":"1566578083782336732","filename":"dd_20_hampton_social.png","caption":"Personal Journey • At a floral Hampton Social venue backdrop.","width":150,"height":200}]}],"social":[{"label":"TikTok • @the_dawndotta","value":"tiktok","description":"Dawn Dotta's TikTok creator profile."},{"label":"Instagram • @shameka_dawn_","value":"instagram","description":"Instagram profile included in the existing Momentum Movement social directory."},{"label":"Facebook • Shameka Carey Dowell","value":"facebook","description":"Facebook profile included in the existing Momentum Movement social directory."},{"label":"Threads • @shameka_dawn_","value":"threads","description":"Threads profile included in the existing Momentum Movement social directory."}],"refs":[{"label":"Vanderbilt Heart Institute • 2013","value":"vumc","description":"Vanderbilt's 2013 heart-institute article names Shameka Dowell as a VAD team member."},{"label":"FitStars Nashville • Biography","value":"fitstars","description":"Historical biography addressing her medical career, education and family."},{"label":"Tunnel Vision • 2017 race results","value":"race","description":"Official results page for the 2017 Tunnel Vision Marathon."},{"label":"Tunnel Marathon • results archive","value":"tunnel","description":"Organizer's race archive and historical result index."},{"label":"StreampreneurX • Creator feature","value":"spx","description":"SPX lists @the_dawndotta as an Education & Entertainment creator and includes an interview feature."}],"socialURLs":{"tiktok":"https://www.tiktok.com/@the_dawndotta","instagram":"https://www.instagram.com/shameka_dawn_/","facebook":"https://www.facebook.com/shameka.careydowell","threads":"https://www.threads.com/@shameka_dawn_"},"refURLs":{"vumc":"https://news.vumc.org/2013/08/22/heart-institute-hits-ventricular-assist-device-milestone/","fitstars":"https://fitstarsnashville.wordpress.com/kid-fit-kamp-committee/","race":"https://www.itsyourrace.com/Results.aspx?id=8084&y=2017","tunnel":"https://www.tunnelmarathon.com/pages/results-photos","spx":"https://streampreneurx.com/"}};
const dphSafe={parse:[],users:[],roles:[],repliedUser:false};
const dphButton=(label,id,on=false)=>({type:2,style:on?1:2,label,custom_id:id});
function dphBuild(page,index,media,selection){
 const p=DPH.pages[page],n=p.photos.length;
 const text=(selection?.label?("**Selected "+selection.kind+":** "+selection.label+(selection.url?"\n"+selection.url:selection.description?"\n"+selection.description:"")):"");
 const children=[
  {type:1,components:DPH.pages.slice(0,5).map((x,j)=>dphButton(x.label,"db10:s:"+j,page===j))},
  {type:1,components:[
    dphButton("Momentum","db10:s:5",page===5),dphButton("Photos","db10:s:6",page===6),
    dphButton("<","db10:photo:"+page+":"+((index+n-1)%n)+":previous"),
    dphButton(">","db10:photo:"+page+":"+((index+1)%n)+":next"),
    dphButton("Collapse","db10:s:closed",false)
  ]},
  {type:14},
  {type:10,content:"## 🌅 DAWN DOTTA\n**The Journey • Momentum Movement** | 06 Chapters · 19 Gallery Photos"},
  {type:14},
  {type:10,content:p.text},
  {type:14},
  {type:10,content:"**RELATED PHOTO · "+(index+1)+" / "+n+"**\n"+p.photos[index].filename.replace(/\.[^.]+$/,"")},
  {type:12,items:[{media:{url:media.url},description:p.photos[index].caption}]},
  {type:10,content:"*"+p.photos[index].caption+"*"},
  {type:14},
  {type:10,content:"### 🌐 Connect & Explore\nChoose an official social account or a documented reference below."},
  {type:1,components:[{type:3,custom_id:"db10:social",placeholder:"🌐 Social media & community profiles",min_values:1,max_values:1,options:DPH.social.map(x=>({label:x.label,value:x.value,description:x.description}))}]},
  {type:1,components:[{type:3,custom_id:"db10:source",placeholder:"📚 Source library & reference links",min_values:1,max_values:1,options:DPH.refs.map(x=>({label:x.label,value:x.value,description:x.description}))}]}
 ];
 if(text)children.push({type:10,content:text.slice(0,600)});
 children.push({type:10,content:"-# Momentum Movement • Official Biography · Existing gallery photographs and source posts retained."});
 const count=children.filter(x=>x.type===10).reduce((n,x)=>n+x.content.length,0);
 if(count>3900||children.length>30)throw Error("Discord dashboard display limit");
 return {flags:32768,content:null,embeds:[],allowedMentions:dphSafe,components:[{type:17,components:children}]};
}
async function dphPhoto(ref){
 const thread=await bot.channels.fetch(ref.threadId);
 if(!thread?.messages)throw Error("Gallery source thread unavailable");
 const message=await thread.messages.fetch(ref.messageId);
 if(message.author?.id!==DPH.app)throw Error("Gallery source author mismatch");
 const a=message.attachments.find(x=>x.name===ref.filename||x.filename===ref.filename);
 if(!a?.url||!a?.contentType?.startsWith("image/"))throw Error("Native gallery source image unavailable");
 return a;
}
bot.on(Events.InteractionCreate,async i=>{
 if(i.guildId!==DPH.guild||i.channelId!==DPH.channel||i.message?.id!==DPH.message||
   i.message?.author?.id!==DPH.app||!i.customId?.startsWith("db10:")||
   !(i.isButton?.()||i.isStringSelectMenu?.()))return;
 const action=i.customId;
 const pageMatch=action.match(/^db10:s:(\d|closed)$/);
 const photoMatch=action.match(/^db10:photo:(\d+):(\d+):(previous|next)$/);
 if(!pageMatch&&!photoMatch&&!["db10:social","db10:source"].includes(action))return;
 try{
  await i.deferUpdate();
  const container=i.message.components?.[0]?.toJSON?.();
  const primary=container?.components?.find(x=>x.type===1&&x.components?.[0]?.custom_id==="db10:s:0");
  let page=Math.max(0,primary?.components?.findIndex(x=>x.style===1)??0);
  const second=container?.components?.find(x=>x.type===1&&x.components?.[0]?.custom_id==="db10:s:5");
  if(second?.components?.[0]?.style===1)page=5;
  if(second?.components?.[1]?.style===1)page=6;
  if(page>=DPH.pages.length)page=0;
  let index=0,selected=null;
  const photoText=container?.components?.find(x=>x.type===10&&x.content?.includes("RELATED PHOTO"))?.content??"";
  const number=photoText.match(/RELATED PHOTO\s*·\s*(\d+)\s*\//);
  if(number)index=Math.max(0,Number(number[1])-1);
  if(pageMatch){page=pageMatch[1]==="closed"?0:Number(pageMatch[1]);index=0;}
  else if(photoMatch){page=Number(photoMatch[1]);index=Number(photoMatch[2]);}
  else if(i.isStringSelectMenu?.()){
   const kind=action==="db10:social"?"social":"reference";
   const options=kind==="social"?DPH.social:DPH.refs;
   const found=options.find(o=>o.value===i.values?.[0]);
   if(found)selected={kind,label:found.label,description:found.description,url:kind==="social"?DPH.socialURLs[found.value]:(DPH.refURLs?.[found.value]||null)};
  }
  page=Math.min(Math.max(page,0),DPH.pages.length-1);
  const pictures=DPH.pages[page].photos;
  index=((index%pictures.length)+pictures.length)%pictures.length;
  const photo=await dphPhoto(pictures[index]);
  await i.message.edit(dphBuild(page,index,photo,selected));
  console.log(JSON.stringify({event:"dawn_profile_in_place_updated",guild:DPH.guild,section:page,index,selected:selected?.kind||null}));
 }catch(e){
  console.log(JSON.stringify({event:"dawn_profile_control_failed",guild:DPH.guild,reason:String(e?.message||e).slice(0,150)}));
 }
});


/* MOMENTUM_BOOK_FASTACK_2026: persistent owner-authored birthday/anniversary books. */
const bookTargets={birthday:{ch:"1565643958665740288",id:"1566062901419180154"},anniversary:{ch:"1565643992178237474",id:"1566062910386479189"}};
const bookMonths=["January","February","March","April","May","June","July","August","September","October","November","December"];
const bookQueues={birthday:Promise.resolve(),anniversary:Promise.resolve()};
async function acquireBookQueue(kind){
 const previous=bookQueues[kind]||Promise.resolve();
 let release;
 const gate=new Promise(resolve=>{release=resolve});
 bookQueues[kind]=previous.then(()=>gate);
 await previous;
 return release;
}
function parseBookDate(raw,kind){
 raw=String(raw||"").trim();if(raw.toUpperCase()==="CLEAR")return {clear:true};
 const match=(kind==="birthday"?/^(\d{1,2})\/(\d{1,2})$/:/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/).exec(raw);
 if(!match)return null;
 const m=+match[1],d=+match[2],y=kind==="birthday"?2000:+match[3];
 if(m<1||m>12||y<2000||y>new Date().getUTCFullYear())return null;
 const check=new Date(Date.UTC(y,m-1,d));
 if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)return null;
 const pad=n=>String(n).padStart(2,"0");
 return {month:m-1,text:pad(m)+"/"+pad(d)+(kind==="anniversary"?"/"+y:"")};
}
bot.on(Events.InteractionCreate,async i=>{
 const custom=String(i.customId||"");if(i.guildId!==GUILD||i.applicationId!=="1565304619838742598"||!custom.startsWith("mompass:"))return;
 const action=custom.slice(8),kind=action==="birthday"||action==="save:birthday"?"birthday":action==="anniversary"||action==="save:anniversary"?"anniversary":null;
 if(!kind)return;
 const target=bookTargets[kind];
 if(i.channelId!==target.ch||i.message?.id!==target.id||i.message?.author?.id!=="1565304619838742598")return;
 try{
  if(i.isButton()&&action===kind){
   const modal=new ModalBuilder().setCustomId("mompass:save:"+kind).setTitle(kind==="birthday"?"Edit My Public Birthday":"Edit My Streaming Anniversary");
   const entry=new TextInputBuilder().setCustomId("date").setLabel(kind==="birthday"?"Birthday MM/DD or CLEAR":"Streaming MM/DD/YYYY or CLEAR").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(4).setMaxLength(10).setPlaceholder(kind==="birthday"?"05/25":"05/25/2023");
   return await i.showModal(modal.addComponents(new ActionRowBuilder().addComponents(entry)));
  }
  if(!i.isModalSubmit()||action!=="save:"+kind)return;
  await i.deferUpdate();
  const parsed=parseBookDate(i.fields.getTextInputValue("date"),kind);
  if(!parsed){await i.user.send({content:"Please enter "+(kind==="birthday"?"MM/DD":"MM/DD/YYYY")+" (or CLEAR to remove your public entry).",allowedMentions:noPing}).catch(()=>{});return}
  const release=await acquireBookQueue(kind);
  try{
   const ch=await bot.channels.fetch(target.ch),msg=await ch.messages.fetch(target.id);
   if(msg.author?.id!==bot.user?.id)throw Error("Book ownership mismatch");
   const flags=Number(msg.flags?.bitfield??msg.flags??0);
   const container=msg.components?.[0]?.toJSON?.()||msg.components?.[0];
   const componentV2=!!(flags&32768)&&container?.type===17&&Array.isArray(container.components);
   let old=null,fields=[];
   if(componentV2){
    const monthValue=name=>{
     const marker="**"+name+"**\n";
     for(const child of container.components||[]){
      if(child.type!==10||typeof child.content!=="string")continue;
      const at=child.content.indexOf(marker);
      if(at<0)continue;
      const from=at+marker.length,until=child.content.indexOf("\n\n**",from);
      return child.content.slice(from,until<0?undefined:until).trim()||"—";
     }
     return null;
    };
    fields=bookMonths.map(name=>({name,value:monthValue(name)}));
    if(fields.some(f=>f.value===null))throw Error("Book month list incomplete in component-v2 container");
   }else{
    if(msg.embeds.length!==1)throw Error("Book layout mismatch");
    old=msg.embeds[0].toJSON();
    fields=(old.fields||[]).map(f=>({...f}));
    if(!bookMonths.every(n=>fields.some(f=>f.name===n)))throw Error("Book month list incomplete");
   }
   const mention="<@"+i.user.id+">";
   for(const field of fields){
    if(!bookMonths.includes(field.name))continue;
    const kept=String(field.value||"").split("\n").filter(x=>x.trim()&&x.trim()!=="—"&&!x.includes(mention));
    field.value=kept.length?kept.join("\n"):"—";
   }
   if(!parsed.clear){
    const month=fields.find(f=>f.name===bookMonths[parsed.month]),entries=month.value==="—"?[]:month.value.split("\n");
    entries.push((kind==="birthday"?"🎂 ":"🎉 ")+parsed.text+" — "+mention);
    month.value=entries.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).join("\n");
   }
   if(fields.some(f=>f.value.length>1024)||fields.reduce((n,f)=>n+f.name.length+f.value.length,0)>5600)throw Error("Book display limit reached");
   if(componentV2){
    const header=container.components.find(c=>c.type===10&&String(c.content||"").startsWith("## "));
    const footer=[...(container.components||[])].reverse().find(c=>c.type===10&&String(c.content||"").startsWith("-# "));
    const rows=(container.components||[]).filter(c=>c.type===1);
    const children=[];
    if(header)children.push(header);
    children.push({type:14,divider:true,spacing:1});
    for(let n=0;n<fields.length;n+=3){
     children.push({type:10,content:fields.slice(n,n+3).map(f=>"**"+f.name+"**\n"+f.value).join("\n\n")});
     if(n+3<fields.length)children.push({type:14,divider:true,spacing:1});
    }
    if(footer){children.push({type:14,divider:true,spacing:1});children.push(footer);}
    children.push(...rows);
    await msg.edit({content:"",embeds:[],flags:32768,components:[{...container,components:children}],allowedMentions:noPing});
   }else{
    await msg.edit({embeds:[{...old,fields}],allowedMentions:noPing});
   }
   console.log(JSON.stringify({event:"momentum_book_updated",kind,member:i.user.id,removed:!!parsed.clear,componentV2}));
    await syncProfileDates(i.user.id).catch(error=>log("profile_date_sync_warning",{member:i.user.id,reason:String(error?.message||error).slice(0,110)}));

  }finally{release()}
 }catch(err){console.error(JSON.stringify({event:"momentum_book_failed",kind,error:String(err?.message||err).slice(0,150)}));try{if(!i.deferred&&!i.replied)await i.reply({content:"The date could not be updated. Nothing has been confirmed.",allowedMentions:noPing});else await i.user.send({content:"Your date update could not be confirmed. The existing entry is unchanged where possible.",allowedMentions:noPing})}catch{}}
});


/* MOMENTUM_MEMBER_PROFILE_ACTIONS_V1 — member-owned public profile controls and calendar sync. */
const PROFILE_CHANNEL="1565643954811052057";
const PROFILE_DIRECTORY="1566063315191595019";
const PROFILE_APP="1565304619838742598";
const PROFILE_LIMIT=520;
const profileCardIds=new Map();
const componentTree=(items,out=[])=>{for(const item of items||[]){out.push(item);if(Array.isArray(item.components))componentTree(item.components,out);}return out;};
function packProfileMessage(channel,message,uid){
 if(message?.author?.id!==PROFILE_APP)return null;
 const json=message.components.map(c=>c.toJSON()),marker="mompass:card:"+uid+":";
 if(!componentTree(json).some(c=>typeof c.custom_id==="string"&&c.custom_id.startsWith(marker)))return null;
 profileCardIds.set(uid,message.id);
 return {channel,message,components:json,container:json.find(c=>c.type===17)};
}
async function profileMessage(uid){
 if(!/^\d{17,20}$/.test(String(uid||"")))return null;
 const channel=await bot.channels.fetch(PROFILE_CHANNEL);
 if(!channel?.isTextBased())throw Error("Member profiles channel unavailable");
 const cachedId=profileCardIds.get(uid);
 if(cachedId){
  const cached=await channel.messages.fetch(cachedId).catch(()=>null);
  const packed=packProfileMessage(channel,cached,uid);
  if(packed)return packed;
  profileCardIds.delete(uid);
 }
 const batch=await channel.messages.fetch({limit:100});
 for(const message of batch.values()){
  const packed=packProfileMessage(channel,message,uid);
  if(packed)return packed;
 }
 return null;
}
function aboutValue(container){
 const text=(container?.components||[]).find(c=>c.type===10&&String(c.content||"").includes("**💬 About Me**"))?.content||"";
 const match=text.match(/\*\*💬 About Me\*\*\n([\s\S]*?)(?=\n\n\*\*🎂 Birthday\*\*)/);
 const value=match?.[1]?.trim()||"";
 return value==="_Not shared yet_"?"":value;
}
function profileTextDate(content,kind,value){
 const pattern=kind==="birthday"?/(\*\*🎂 Birthday\*\* · )[^\r\n]*/:/(\*\*🎉 Streaming Anniversary\*\* · )[^\r\n]*/;
 return content.replace(pattern,"$1"+(value||"Not shared"));
}
async function bookDateFor(uid,kind){
 const target=bookTargets[kind],ch=await bot.channels.fetch(target.ch),msg=await ch.messages.fetch(target.id);
 if(msg.author?.id!==PROFILE_APP)throw Error("Calendar book ownership mismatch");
 const container=msg.components?.[0]?.toJSON?.()||msg.components?.[0];
 if(container?.type!==17)throw Error("Calendar book container missing");
 const marker="<@"+uid+">";
 for(const child of container.components||[]){
  if(child.type!==10||typeof child.content!=="string")continue;
  for(const month of bookMonths){
   const key="**"+month+"**\n",at=child.content.indexOf(key);
   if(at<0)continue;
   const from=at+key.length,next=child.content.indexOf("\n\n**",from);
   const group=child.content.slice(from,next<0?undefined:next);
   const row=group.split("\n").find(line=>line.includes(marker));
   if(row){const match=row.match(/(\d{2}\/\d{2}(?:\/\d{4})?)/);if(match)return match[1];}
  }
 }
 return null;
}
async function syncProfileDates(uid){
 const found=await profileMessage(uid);
 if(!found?.container)return false;
 const birthday=await bookDateFor(uid,"birthday"),anniversary=await bookDateFor(uid,"anniversary");
 const next=JSON.parse(JSON.stringify(found.components)),box=next.find(c=>c.type===17);
 const body=box.components.find(c=>c.type===10&&String(c.content||"").includes("**💬 About Me**"));
 if(!body)return false;
 body.content=profileTextDate(profileTextDate(body.content,"birthday",birthday),"anniversary",anniversary);
 await found.message.edit({content:"",embeds:[],flags:32768,components:next,allowedMentions:noPing});
 return true;
}
async function syncAllProfileDates(){
 const channel=await bot.channels.fetch(PROFILE_CHANNEL),history=await channel.messages.fetch({limit:100}),users=new Set();
 for(const m of history.values()){
  if(m.author?.id!==PROFILE_APP)continue;
  for(const c of componentTree(m.components.map(c=>c.toJSON()))){
   const match=/^mompass:card:(\d{17,20}):\d+$/.exec(String(c.custom_id||""));
   if(match)users.add(match[1]);
  }
 }
 let updated=0;
 for(const uid of users){try{if(await syncProfileDates(uid))updated++;}catch(error){log("profile_date_sync_warning",{member:uid,reason:String(error?.message||error).slice(0,110)});}}
 log("profile_calendar_reconciled",{cards:users.size,updated});
}
async function updateDirectoryNotice(uid,mode){
 const found=await profileMessage(uid);
 if(!found)return {found:null};
 const directoryChannel=await bot.channels.fetch(PROFILE_CHANNEL),directory=await directoryChannel.messages.fetch(PROFILE_DIRECTORY);
 if(directory.author?.id!==PROFILE_APP)throw Error("Member directory ownership mismatch");
 const components=directory.components.map(c=>c.toJSON()),box=components.find(c=>c.type===17);
 if(!box)throw Error("Member directory container missing");
 box.components=box.components.filter(c=>!(c.type===10&&String(c.content||"").startsWith("### MEMBER PROFILE")));
 const about=aboutValue(found.container);
 const dates=(found.container?.components||[]).find(c=>c.type===10&&String(c.content||"").includes("**💬 About Me**"))?.content||"";
 const birthday=(dates.match(/\*\*🎂 Birthday\*\* · ([^\r\n]+)/)||[])[1]||"Not shared";
 const anniversary=(dates.match(/\*\*🎉 Streaming Anniversary\*\* · ([^\r\n]+)/)||[])[1]||"Not shared";
 const url="https://discord.com/channels/"+GUILD+"/"+PROFILE_CHANNEL+"/"+found.message.id;
 let content="### MEMBER PROFILE\n**"+(mode==="preview"?"Public preview":"Your member card")+"**\n"+(about?"**About Me:** "+about:"**About Me:** Not shared")+"\n**Birthday:** "+birthday+"\n**Streaming Anniversary:** "+anniversary+"\n[Open your member card]("+url+")";
 if(mode==="privacy")content="### MEMBER PROFILE\n**Privacy controls**\nYour card shows public information only. About Me is optional; use Privacy or Edit Profile and enter 'CLEAR' to remove it. Birthdays and streaming anniversaries are optional public book entries; edit or clear them through their own dashboards. No private profile notes are stored in public channels.";
 if(mode==="help")content="### MEMBER PROFILE\n**How your card works**\nEdit Profile changes only your public About Me text. Preview shows the information currently visible to other members. Privacy lets you replace or clear About Me. Birthday and streaming anniversary entries are managed separately in their books. No other member’s card can be edited by you.";
 box.components.push({type:10,content:content.slice(0,1800)});
 return {found,directory,components};
}
function modalForProfile(uid,title,current){
 const modal=new ModalBuilder().setCustomId("mompass:profile-save:"+uid).setTitle(title);
 const input=new TextInputBuilder().setCustomId("about").setLabel("Public About Me (or CLEAR to hide)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(PROFILE_LIMIT).setPlaceholder("Share only what you want other members to see.");
 if(current)input.setValue(String(current).slice(0,PROFILE_LIMIT));
 return modal.addComponents(new ActionRowBuilder().addComponents(input));
}
bot.on(Events.InteractionCreate,async i=>{
 const custom=String(i.customId||"");
 if(i.guildId!==GUILD||i.applicationId!==PROFILE_APP||!custom.startsWith("mompass:"))return;
 if(["mompass:birthday","mompass:anniversary","mompass:save:birthday","mompass:save:anniversary"].includes(custom))return;
 try{
  if(i.isModalSubmit()&&custom.startsWith("mompass:profile-save:")){
   const uid=custom.slice("mompass:profile-save:".length);
   if(uid!==i.user.id||!/^\d{17,20}$/.test(uid)){await i.reply({content:"You can edit only your own public member card.",allowedMentions:noPing});return;}
   await i.deferUpdate();
   const found=await profileMessage(uid);
   if(!found?.container)throw Error("Your member card could not be found");
   const raw=String(i.fields.getTextInputValue("about")||"").replace(/\r/g,"").trim();
   const value=raw.toUpperCase()==="CLEAR"?"_Not shared yet_":raw.replace(/@/g,"＠").slice(0,PROFILE_LIMIT)||"_Not shared yet_";
   const next=JSON.parse(JSON.stringify(found.components)),box=next.find(c=>c.type===17);
   const body=box.components.find(c=>c.type===10&&String(c.content||"").includes("**💬 About Me**"));
   if(!body)throw Error("Member card public profile section missing");
   const marker="**💬 About Me**\n",at=body.content.indexOf(marker),dateMarker="\n\n**🎂 Birthday** ·";
   const end=body.content.indexOf(dateMarker,at+marker.length);
   if(at<0||end<0)throw Error("Member card fields changed; no edit saved");
   body.content=body.content.slice(0,at)+marker+value+body.content.slice(end);
   await found.message.edit({content:"",embeds:[],flags:32768,components:next,allowedMentions:noPing});
   log("member_profile_public_about_updated",{member:uid,cleared:value==="_Not shared yet_"});
   return;
  }
  if(!i.isButton())return;
  const cardMatch=/^mompass:card:(\d{17,20}):(\d+)$/.exec(custom);
  const detailsMatch=/^mompass:details:(\d{17,20}):(open|closed)$/.exec(custom);
  const action=cardMatch?"card":detailsMatch?"details":custom.slice("mompass:".length);
  const uid=cardMatch?.[1]||detailsMatch?.[1]||i.user.id;
  const isDirectory=i.channelId===PROFILE_CHANNEL&&i.message?.id===PROFILE_DIRECTORY&&i.message?.author?.id===PROFILE_APP;
  const isCard=i.channelId===PROFILE_CHANNEL&&i.message?.author?.id===PROFILE_APP&&!!(cardMatch||detailsMatch);
  if(!isDirectory&&!isCard)return;
  if(uid!==i.user.id){await i.reply({content:"Member profile controls are restricted to the owner of that card.",allowedMentions:noPing});return;}
  if(["edit","privacy"].includes(action)){
   const found=await profileMessage(uid);
   if(!found?.container){await i.reply({content:"No published member card was found for your account.",allowedMentions:noPing});return;}
   return await i.showModal(modalForProfile(uid,action==="privacy"?"Public Profile Privacy":"Edit Public Member Profile",aboutValue(found.container)));
  }
  const mode=action==="preview"?"preview":action==="privacy"?"privacy":action==="help"||action==="details"?"help":"my";
  if(!["my","preview","privacy","help","card","details","toggle:open","toggle:closed"].includes(action))return;
  await i.deferUpdate();
  const result=await updateDirectoryNotice(uid,mode);
  if(result.directory&&result.components)await result.directory.edit({content:"",embeds:[],flags:32768,components:result.components,allowedMentions:noPing});
  log("member_profile_action",{member:uid,action,cardFound:!!result.found});
 }catch(error){
  log("member_profile_action_failed",{action:custom.slice(0,60),reason:String(error?.message||error).slice(0,150)});
  if(i.isRepliable()&&!i.deferred&&!i.replied)await i.reply({content:"The profile action could not be completed. No other member’s information was changed.",allowedMentions:noPing}).catch(()=>{});
 }
});

bot.once(Events.ClientReady,()=>{ensure().catch(e=>log("social_admin_startup_failure",{reason:String(e?.message||e).slice(0,160)}));syncAllProfileDates().catch(e=>log("profile_calendar_startup_sync_failed",{reason:String(e?.message||e).slice(0,140)}));});
bot.on(Events.Error,e=>log("social_admin_gateway_error",{kind:e?.name||"Error"}));
Bun.serve({port:Number(Bun.env.PORT||3000),fetch(req){const p=new URL(req.url).pathname;if(p==="/healthz")return Response.json({status:bot.isReady()&&!!boardId?"ready":"starting",creator:CREATOR,configured:!!boardId},{status:bot.isReady()&&!!boardId?200:503});return new Response("Not found",{status:404});}});
if(!Bun.env.DISCORD_BOT_TOKEN||Bun.env.AUTHORIZED_GUILD_ID!==GUILD)throw Error("Creator token or authorized guild not configured");
await bot.login(Bun.env.DISCORD_BOT_TOKEN);
