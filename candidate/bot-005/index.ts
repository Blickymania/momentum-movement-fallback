import { Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits } from "discord.js";

const G="1565048205970767992",A="1565304619838742598";
const token=Bun.env.DISCORD_BOT_TOKEN||"";
const coachingAuthSecret=Bun.env.COACHING_WORKFLOW_AUTH_SECRET||"";
if(Bun.env.COACHING_WORKFLOW_SOURCE!=="bot005"||coachingAuthSecret.length<32||coachingAuthSecret.length>512||coachingAuthSecret===token)
throw Error("Bot 005 coaching sender identity and secret must be unique");
if(Bun.env.AUTHORIZED_GUILD_ID!==G||Bun.env.APPLICATION_ID!==A||!token)
throw Error("Bot 005: guild/application credentials do not match Momentum Movement");

const { createCoachingWorkflowClientFromEnv } = await import("../../implementation/coaching-workflow-client.mjs");
const { createRulesAcceptanceHandler, addRulesAcceptanceButton, RULES_ACCEPTANCE_TARGET, decodeEncryptedMemberVaultPage } = await import("../../implementation/rules-acceptance.mjs");
const coachingWorkflow = createCoachingWorkflowClientFromEnv({
  env: Bun.env,
  timeoutMs: 5000,
  maxPayloadBytes: 262144
});

const presenceIntentGranted=await(async()=>{
try{
const response=await fetch("https://discord.com/api/v10/applications/@me",{headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(8000)});
if(!response.ok)return false;
const app=await response.json();
const flags=Number(app.flags||0);
return String(app.id)===A&&Number.isSafeInteger(flags)&&(flags&((1<<12)|(1<<13)))!==0;
}catch{return false;}
})();
console.log(JSON.stringify({event:"momentum_bot005_presence_intent",enabled:presenceIntentGranted}));
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.DirectMessages,...(presenceIntentGranted?[GatewayIntentBits.GuildPresences]:[])],partials:[Partials.Channel],allowedMentions:{parse:[]}});
const { prepareFencedDiscordGatewayOwner } = await import("../../implementation/fenced-discord-gateway-owner.mjs");
const preparedGatewayOwner = prepareFencedDiscordGatewayOwner({
  client,
  botToken: token,
  deploymentId: Bun.env.BOT005_DEPLOYMENT_ID,
  leaseCoordinatorUrl: Bun.env.GATEWAY_LEASE_URL,
  leaseServiceToken: Bun.env.LEASE_SERVICE_TOKEN,
  fenceRequestToken: Bun.env.FENCE_REQUEST_TOKEN,
  heartbeatIntervalMs: 10000,
  renewTimeoutMs: 5000
});
process.on("SIGTERM", () => { void preparedGatewayOwner.shutdown("sigterm"); });
process.on("SIGINT", () => { void preparedGatewayOwner.shutdown("sigint"); });

const CORE_COMMANDS=new Set(["addtocase","announce","audit","automod","ban","bot-status","botconfig","botstatus","channelorder","channelposition","chatfirst","closecase","eventcreate","events","help","kick","lock","member","ping","poll","purge","report","role","rules","server","slowmode","statsset","statsstatus","support","tiktok","timeout","unban","warn","dashboard","bot-test","forum-admin"]);
const SAFE=new Set(["ping","bot-test","bot-status","botstatus","help","server","member","events","rules","tiktok","dashboard","botconfig","forum-admin","audit","statsstatus","automod","support","report","poll","announce","eventcreate","slowmode","closecase","warn","role","addtocase","statsset","channelorder","channelposition","chatfirst","ban","kick","timeout","unban","purge","lock"]);
const OWNER_ONLY=new Set(["botconfig"]);
const readOnly=false,started=Date.now();
let ready=false,guildVerified=false,lastError=null,commandsResponded=0;
const log=(event,meta={})=>console.log(JSON.stringify({event:"momentum_bot005_"+event,guild:G,...meta}));
function safeText(v,max=700){return String(v||"").replace(/@/g,"@\u200b").slice(0,max)}
function tiktok(){const v=Bun.env.SOCIAL_TIKTOK_URL||"";try{const u=new URL(v);if(u.protocol!=="https:"||!["tiktok.com","www.tiktok.com"].includes(u.hostname))return null;return u.href}catch{return null}}
const noPing={parse:[],users:[],roles:[],repliedUser:false};
function moderator(i){return i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)||i.user.id===i.guild?.ownerId}
const CASE_GUILD="1565048205970767992",CASE_CATEGORY="1565643251783049237";
const CASE_FORUM="1566227861747138641",CASE_MOD_ROLE="1565407676580499616";
const intakePending=new Set(),intakeRecent=new Map();
const quietMentions={parse:[],users:[],roles:[],replied_user:false};
function sanitized(v,max=700){
return String(v||"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/@/g,"@\u200b").trim().slice(0,max);
}
function caseForumSafe(channel){
if(!channel||!Array.isArray(channel.permission_overwrites))return false;
const os=channel.permission_overwrites;
const all=os.find(o=>o.id===CASE_GUILD&&Number(o.type)===0);
const mod=os.find(o=>o.id===CASE_MOD_ROLE&&Number(o.type)===0);
if(!all||!mod)return false;
const view=1024n;
return(BigInt(all.deny||"0")&view)===view
&&(BigInt(mod.allow||"0")&view)===view
&&!os.some(o=>o.id!==CASE_GUILD&&o.id!==CASE_MOD_ROLE&&(BigInt(o.allow||"0")&view)===view);
}
async function caseApi(method,path,body){
const fast=typeof MV!=="undefined"&&(path.includes(MV)||path.includes(MB)||path.includes(MA));
for(let n=0;n<(fast?1:3);n++){
const result=await fetch("https://discord.com/api/v10"+path,{
method,headers:{Authorization:"Bot "+token,"Content-Type":"application/json"},
...(body===undefined?{}:{body:JSON.stringify(body)}),
signal:AbortSignal.timeout(fast?5000:15000)
});
const data=result.status===204?{}:await result.json().catch(()=>({}));
if(result.status===429){
if(n===2)throw Error("Discord rate limit: private request deferred");
await Bun.sleep(Math.min(30000,Math.max(1500,Math.ceil(Number(data.retry_after||2)*1000)+450)));
continue;
}
if(!result.ok)throw Error("Discord "+method+" "+result.status+" on private intake endpoint");
return data;
}
throw Error("Discord private intake retry budget exhausted");
}
const MV=Bun.env.PROFILE_DATA_VAULT_CHANNEL_ID||"",MB=Bun.env.PROFILE_BIRTHDAY_CHANNEL_ID||"",MA=Bun.env.PROFILE_ANNIVERSARY_CHANNEL_ID||"";
let ml=null,mc=new Map(),mi=new Map(),mk=null;
const b64=b=>btoa(Array.from(b,x=>String.fromCharCode(x)).join("")),un64=s=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));
async function key(){if(!mk)mk=(async()=>{const h=Bun.env.PROFILE_DATA_ENCRYPTION_KEY||"";if(!/^[a-f0-9]{64}$/i.test(h))throw Error("profile_key");return crypto.subtle.importKey("raw",Uint8Array.from(h.match(/../g),x=>parseInt(x,16)),{name:"AES-GCM"},false,["encrypt","decrypt"])})();return mk}
async function seal(v){const iv=crypto.getRandomValues(new Uint8Array(12)),c=await crypto.subtle.encrypt({name:"AES-GCM",iv},await key(),new TextEncoder().encode(JSON.stringify(v)));return"MRV1."+b64(iv)+"."+b64(new Uint8Array(c))}
async function unseal(s){const p=s.split(".");return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(p[1])},await key(),un64(p[2]))))}
async function load(){if(ml)return ml;ml=(async()=>{
let before=null;
for(let page=0;page<=50;page++){
const route="/channels/"+MV+"/messages?limit=100"+(before?"&before="+before:"");
const messages=await caseApi("GET",route);
if(!Array.isArray(messages))throw Error("profile_vault_response_invalid");
const pageRecords=await decodeEncryptedMemberVaultPage(messages,A,unseal);
for(const [userId,value] of pageRecords)if(!mc.has(userId)){mc.set(userId,value.record);mi.set(userId,value.messageId)}
if(messages.length<100)return;
const oldest=String(messages[messages.length-1]?.id||"");
if(!oldest||oldest===before)throw Error("profile_vault_pagination_invalid");
if(page===50)throw Error("profile_vault_scan_limit");
before=oldest;
}
})();return ml}
function empty(id){return{userId:id,rulesAcceptance:null,profile:{about:"",tiktok:"",instagram:"",visibility:"private"},birthday:{date:"",year:"",visibility:"private",post:null},anniversary:{date:"",year:"",visibility:"private",post:null}}}
async function get(id){await load();return mc.get(id)||empty(id)}
async function save(v){await load();const c=await seal(v),old=mi.get(v.userId),x=old?await caseApi("PATCH","/channels/"+MV+"/messages/"+old,{content:c}):await caseApi("POST","/channels/"+MV+"/messages",{content:c});if(!x?.id)throw Error("profile_save");mc.set(v.userId,v);mi.set(v.userId,x.id)}
let rulesAcceptanceReady=false;
const handleRulesAcceptance=createRulesAcceptanceHandler({getMemberRecord:get,saveMemberRecord:save});
async function ensureRulesAcceptanceButton(guild){
if(MV!==RULES_ACCEPTANCE_TARGET.vaultChannelId)throw Error("member_vault_channel_mismatch");
if(!/^[a-f0-9]{64}$/i.test(Bun.env.PROFILE_DATA_ENCRYPTION_KEY||""))throw Error("member_vault_encryption_key_missing");
await key();
const me=await guild.members.fetchMe();
const vault=await guild.channels.fetch(MV);
if(!vault||vault.guildId!==G||Number(vault.type)!==0)throw Error("member_vault_not_found");
const vaultPermissions=vault.permissionsFor(me);
if(!vaultPermissions?.has(PermissionFlagsBits.ViewChannel)||!vaultPermissions.has(PermissionFlagsBits.SendMessages)||!vaultPermissions.has(PermissionFlagsBits.ReadMessageHistory))throw Error("member_vault_permissions_missing");
const rulesChannel=await guild.channels.fetch(RULES_ACCEPTANCE_TARGET.channelId);
if(!rulesChannel||rulesChannel.guildId!==G||Number(rulesChannel.type)!==0)throw Error("rules_channel_not_found");
const rulesPermissions=rulesChannel.permissionsFor(me);
if(!rulesPermissions?.has(PermissionFlagsBits.ViewChannel)||!rulesPermissions.has(PermissionFlagsBits.ReadMessageHistory))throw Error("rules_channel_permissions_missing");
const route="/channels/"+RULES_ACCEPTANCE_TARGET.channelId+"/messages/"+RULES_ACCEPTANCE_TARGET.messageId;
const current=await caseApi("GET",route);
if(String(current.id)!==RULES_ACCEPTANCE_TARGET.messageId||String(current.channel_id)!==RULES_ACCEPTANCE_TARGET.channelId||String(current.author?.id)!==A)throw Error("rules_dashboard_identity_mismatch");
const updated=addRulesAcceptanceButton(current.components||[]);
if(updated.changed)await caseApi("PATCH",route,{components:updated.components});
const verified=await caseApi("GET",route);
const container=(verified.components||[]).find(component=>component?.type===17);
const present=container?.components?.some(component=>component?.type===1&&component.components?.some(button=>button?.type===2&&button.custom_id===RULES_ACCEPTANCE_TARGET.customId));
if(!present||String(verified.author?.id)!==A)throw Error("rules_acceptance_button_verification_failed");
return true;
}
client.on(Events.InteractionCreate,async i=>{
if(!rulesAcceptanceReady)return;
try{
const result=await handleRulesAcceptance(i);
if(!result)return;
log("rules_acceptance_recorded",{persisted:result.persisted,changed:result.changed,receiptDmSent:result.notified===true});
}catch(e){log("rules_acceptance_failed",{kind:e instanceof Error?e.name:"unknown"});}
});
function date(s){const a=/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(String(s||""));if(!a)return null;const d=new Date(Date.UTC(2000,+a[1]-1,+a[2]));return d.getUTCMonth()===+a[1]-1&&d.getUTCDate()===+a[2]?a[1]+"-"+a[2]:null}
async function publish(v,k){const d=v[k],ch=k==="birthday"?MB:MA;if(!/^\d{17,22}$/.test(ch))throw Error("profile_channel");if(d.visibility==="public"&&d.date){const b={content:(k==="birthday"?"🎂 ":"🎉 ")+"<@"+v.userId+"> — "+d.date,allowed_mentions:noPin};if(d.post)await caseApi("PATCH","/channels/"+ch+"/messages/"+d.post,b).catch(()=>{d.post=null});if(!d.post){const x=await caseApi("POST","/channels/"+ch+"/messages",b);if(!x?.id)throw Error("public_post");d.post=x.id}}else if(d.post){await caseApi("DELETE","/channels/"+ch+"/messages/"+d.post);d.post=null}}
async function form(i,k,t,fs){const m={custom_id:"memberdata:"+k,title:t,components:fs.map(f=>({type:1,components:[{type:4,custom_id:f[0],label:f[1],style:f[2]?2:1,required:f[3],max_length:f[4],placeholder:f[5]}]}))},r=await fetch("https://discord.com/api/v10/interactions/"+i.id+"/"+i.token+"/callback",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:9,data:m}),signal:AbortSignal.timeout(2200)});if(!r.ok)throw Error("modal_ack")}
client.on(Events.InteractionCreate,async i=>{
 const customId=String(i.customId||"");
 if(!customId.startsWith("coach:"))return;
 const started=Date.now();
 const isModal=i.isModalSubmit?.()===true;
 const isMultiStepForm=isModal&&customId.startsWith("coach:form:");
 const opensModal=!isModal&&((!i.guildId&&customId==="coach:request")||/^coach:staff:(clarify|schedule|note):/.test(customId)||/^coach:dm:(respond|details):/.test(customId));
 try{
  if(isModal&&!isMultiStepForm)await i.deferReply();
  else if(!isModal&&!opensModal)await i.deferUpdate();
  const fields=isModal?[...i.fields.fields.values()].map(f=>({type:1,components:[{type:4,custom_id:f.customId,value:f.value}]})):undefined;
  const payload={id:i.id,application_id:i.applicationId,type:isModal?5:3,data:{custom_id:customId,...(isModal?{components:fields}:{})},guild_id:i.guildId||undefined,channel_id:i.channelId,token:i.token,version:1,user:{id:i.user.id},member:i.member?{user:{id:i.user.id},roles:Array.isArray(i.member.roles)?i.member.roles:[],permissions:String(i.memberPermissions?.bitfield||i.member.permissions||"0")}:undefined,message:i.message?{id:i.message.id,author:{id:i.message.author?.id}}:undefined,__acknowledged:Boolean(i.deferred||i.replied)};
  const forwarded = await coachingWorkflow.forward(payload);
  log("coaching_interaction_forwarded",{acknowledged:payload.__acknowledged,ackMs:payload.__acknowledged?Date.now()-started:null,kind:isModal?"modal":opensModal?"modal_open":"component",status:forwarded.status});
  log("coaching_interaction_forwarded",{acknowledged:payload.__acknowledged,ackMs:payload.__acknowledged?Date.now()-started:null,kind:isModal?"modal":opensModal?"modal_open":"component"});
 }catch(e){
  log("coaching_forward_failed",{kind:e?.name||"network"});
  try{const message="The coaching service is temporarily unavailable. Please try again.";if(i.deferred||i.replied)await i.followUp({content:message,allowedMentions:{parse:[]}});else await i.reply({content:message,allowedMentions:{parse:[]}})}catch{}
 }
});
client.on(Events.InteractionCreate,async i=>{
const id=String(i.customId||"");if(i.guildId!==G||!/^(membercard:|memberdir:|profilev7:|mp26:|mompass:|uniprof:|memberdata:)/.test(id))return;
try{
if(i.isModalSubmit?.()){await i.deferReply();const k=id.slice(11),v=await get(i.user.id),f=x=>i.fields.getTextInputValue(x)||"";
if(k==="profile")v.profile={about:f("about").slice(0,450),tiktok:f("tiktok").replace(/^@/,"").slice(0,32),instagram:f("instagram").replace(/^@/,"").slice(0,32),visibility:f("visibility")==="public"?"public":"private"};
else if(k==="birthday"||k==="anniversary"){const d=date(f("date")),y=f("year").trim();if(!d)throw Error("Use MM-DD, e.g. 04-23.");if(k==="anniversary"&&!/^(19|20)\d{2}$/.test(y))throw Error("Enter your streaming start year.");if(y&&!/^(19|20)\d{2}$/.test(y))throw Error("Enter a valid year.");v[k]={...v[k],date:d,year:y,visibility:f("visibility")==="public"?"public":"private"};await save(v);await publish(v,k)}else throw Error("Unknown form");
await save(v);await i.editReply("Saved. Years stay private; public date books show month and day only.");return}
if(["membercard:edit","mp26:edit","mompass:edit"].includes(id)){await form(i,"profile","Edit My Member Profile",[["about","About Me",true,false,450,"A short introduction"],["tiktok","TikTok Username",false,false,32,"Without @"],["instagram","Instagram Username",false,false,32,"Without @"],["visibility","Profile Visibility",false,true,7,"private or public"]]);return}
if(["mp26:date:b","mompass:birthday","profilev7:birthday","profilev7:milestone:birthday:mine"].includes(id)){await form(i,"birthday","My Birthday",[["date","Birthday (MM-DD)",false,true,5,"04-23"],["year","Birth Year (private)",false,false,4,"Optional"],["visibility","Visibility",false,true,7,"private or public"]]);return}
if(["mp26:date:a","mompass:anniversary","profilev7:anniversary","profilev7:milestone:anniversary:mine"].includes(id)){await form(i,"anniversary","My Streaming Anniversary",[["date","Streaming Start Date (MM-DD)",false,true,5,"08-15"],["year","Streaming Start Year",false,true,4,"2021"],["visibility","Visibility",false,true,7,"private or public"]]);return}
await i.deferUpdate();
}catch(e){try{if(i.deferred)await i.editReply("Could not save; check the form and retry.");else await i.reply("Could not open Member Passport.")}catch{}}
});
async function createPrivateIntake(i,type){
const uid=i.user.id,now=Date.now();
if(intakePending.has(uid))return"An earlier private request is still processing. No duplicate case was created.";
if(now-(intakeRecent.get(uid)||0)<120000)return"Please allow two minutes between private requests. No duplicate case was created.";
const target=type==="report"?i.options.getUser("user"):null;
const title=sanitized(i.options.getString(type==="report"?"reason":"subject"),type==="report"?750:110);
const details=type==="support"?sanitized(i.options.getString("details")||"No additional details supplied",850):"";
if(title.length<5||type==="report"&&(!target||target.id===uid))return"The request details are incomplete or invalid. Nothing was submitted.";
intakePending.add(uid);
try{
const[me,cat,forum]=await Promise.all([
caseApi("GET","/users/@me"),
caseApi("GET","/channels/"+CASE_CATEGORY),
caseApi("GET","/channels/"+CASE_FORUM)
]);
if(me.id!==A||cat.id!==CASE_CATEGORY||cat.guild_id!==CASE_GUILD||cat.type!==4||
forum.id!==CASE_FORUM||forum.guild_id!==CASE_GUILD||forum.parent_id!==CASE_CATEGORY||forum.type!==15||
!caseForumSafe(cat)||!caseForumSafe(forum))throw Error("Verified Case Review privacy requirements not met");
const id=i.id;
const date=new Date().toISOString().slice(0,10);
const name=(type==="report"?"Member Report":"Support Request")+" • "+date+" • "+id.slice(-6);
const heading=type==="report"?"🔒 Confidential Member Report":"🔒 Private Support Request";
const body="## "+heading+"\n"+
"**Requester:** <@"+uid+">\n"+
(type==="report"?"**Reported member:** <@"+target.id+">\n**Reason:** "+title:
"**Subject:** "+title+"\n**Details:** "+details)+
"\n\n**Case Reference:** "+id+
"\n-# Authorized staff only • No public or member-accessible case data";
const response=await caseApi("POST","/channels/"+CASE_FORUM+"/threads",{
name,auto_archive_duration:1440,
message:{content:body,allowed_mentions:quietMentions}
});
if(!/^\d{17,22}$/.test(String(response.id||""))||response.parent_id!==CASE_FORUM)throw Error("Private case creation not verified");
intakeRecent.set(uid,Date.now());
let dmSent=false;
try{
await i.user.send({content:"Your private "+(type==="report"?"member report":"support request")+
" was received by Momentum Movement staff.\nCase ID: "+response.id+
"\nYour details were not posted to public channels.",allowedMentions:noPing});
dmSent=true;
}catch{}
log("momentum_private_intake",{kind:type,created:true,staffOnly:true,dmDelivered:dmSent});
return dmSent?"Your private request was delivered to authorized staff. A receipt was sent by DM.":
"Your private request was delivered to authorized staff, but I couldn't send a DM receipt. Please enable DMs from this server.";
}finally{intakePending.delete(uid)}
}
const confirmationPlans=new Map(),dmProofPlans=new Map();
const PLAN_WINDOW_MS=120000;
function planChange(i,kind,payload,summary){
if(confirmationPlans.size>100){
for(const[key,val]of confirmationPlans)if(val.expiresAt<Date.now())confirmationPlans.delete(key);
if(confirmationPlans.size>100)throw Error("Too many pending confirmations");
}
return{kind,payload,summary,actorId:i.user.id,channelId:i.channelId,guildId:G,expiresAt:Date.now()+PLAN_WINDOW_MS};
}
function orderedCategoryChannels(collection,catId){
return[...collection.values()].filter(c=>c?.parentId===catId&&c.type!==4)
.sort((a,b)=>a.rawPosition-b.rawPosition||a.id.localeCompare(b.id));
}
function sameIds(actual,expected){return actual.length===expected.length&&actual.every((x,i)=>x===expected[i]);}
async function previewCategoryPlan(guild,groups){
const snapshot=await guild.channels.fetch();
if(!groups.length||groups.length>25)throw Error("Channel reorder exceeds safe limits");
let total=0,plans=[];
for(const item of groups){
const cat=snapshot.get(item.categoryId);
if(!cat||cat.type!==4)throw Error("Expected category no longer exists");
const existing=orderedCategoryChannels(snapshot,item.categoryId);
const before=existing.map(x=>x.id),after=item.ids;
if(!sameIds([...before].sort(),[...after].sort())||new Set(after).size!==after.length)throw Error("Category member set does not match exact proposed order");
total+=after.length;
plans.push({categoryId:item.categoryId,before,after});
}
if(total>200)throw Error("Too many channels for one confirmed reorder");
return plans;
}
async function confirmCategoryPlan(i,plan){
const guild=i.guild;
if(!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels))throw Error("Manage Channels permission required");
const botMember=await guild.members.fetchMe();
if(!botMember.permissions.has(PermissionFlagsBits.ManageChannels))throw Error("Bot requires Manage Channels permission");
const snapshot=await guild.channels.fetch();
for(const group of plan.groups){
const current=orderedCategoryChannels(snapshot,group.categoryId).map(c=>c.id);
if(!sameIds(current,group.before))throw Error("Category order drifted; command canceled safely");
if(!sameIds([...current].sort(),[...group.after].sort()))throw Error("Membership changed; command canceled safely");
}
let applied=0;
for(const group of plan.groups){
if(sameIds(group.before,group.after))continue;
await guild.channels.setPositions(group.after.map((channel,position)=>({channel,position})));
applied++;
}
const after=await guild.channels.fetch();
const verified=plan.groups.every(g=>sameIds(orderedCategoryChannels(after,g.categoryId).map(c=>c.id),g.after));
return"Channel ordering executed for "+applied+" categor"+(applied===1?"y":"ies")+
". "+(verified?"Discord readback verified every proposed order.":"Discord readback could not verify every position; staff should review before retrying.")+
" No channels were created, renamed, moved across categories, or deleted.";
}
async function requireStaffCaseCommand(i,permission){
if(!i.guild||i.guildId!==G||!i.memberPermissions?.has(permission))throw Error("Member lacks the required moderation permission");
const actor=await i.guild.members.fetch(i.user.id).catch(()=>null);
const me=await i.guild.members.fetchMe().catch(()=>null);
if(!actor||!me||(!actor.roles.cache.has(CASE_MOD_ROLE)&&i.user.id!==i.guild.ownerId))throw Error("Authorized moderator role required");
if(!me.permissions.has(permission))throw Error("Bot lacks the corresponding permission");
const forumThread=await i.guild.channels.fetch(i.channelId).catch(()=>null);
if(!forumThread||![11,12].includes(forumThread.type)||forumThread.parentId!==CASE_FORUM)throw Error("Sensitive actions require the private staff Case Review forum");
const[forum,parent]=await Promise.all([
caseApi("GET","/channels/"+CASE_FORUM),
caseApi("GET","/channels/"+CASE_CATEGORY)
]);
if(forum.id!==CASE_FORUM||forum.parent_id!==CASE_CATEGORY||forum.type!==15||
!caseForumSafe(forum)||!caseForumSafe(parent))throw Error("Staff forum privacy verification failed");
return{actor,me};
}
async function verifyModerationTarget(i,targetId,permission){
const{actor,me}=await requireStaffCaseCommand(i,permission);
const target=await i.guild.members.fetch({user:targetId,force:true}).catch(()=>null);
if(!target||target.id===i.guild.ownerId||target.id===i.user.id||
target.id===A||target.user?.bot)throw Error("Target unavailable or protected");
if(i.user.id!==i.guild.ownerId&&target.roles.highest.comparePositionTo(actor.roles.highest)>=0)
throw Error("Target does not fall below the issuing moderator");
if(target.roles.highest.comparePositionTo(me.roles.highest)>=0)
throw Error("Target does not fall below the bot's highest role");
return target;
}
async function verifyPublicWritableTextChannel(i,permission){
if(!i.guild||i.guildId!==G||!i.memberPermissions?.has(permission))throw Error("Manage permission required");
const me=await i.guild.members.fetchMe();
const ch=await i.guild.channels.fetch(i.channelId).catch(()=>null);
if(!ch||![0,5].includes(ch.type)||ch.guildId!==G||!me.permissions.has(permission)||
!ch.permissionsFor(me)?.has(permission))throw Error("Bot/member cannot manage this text channel");
const everyone=i.guild.roles.everyone;
const publicView=ch.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel);
const category=ch.parentId?await i.guild.channels.fetch(ch.parentId).catch(()=>null):null;
const categoryDenies=!!category?.permissionOverwrites?.cache?.get(G)?.deny?.has(PermissionFlagsBits.ViewChannel);
if(!publicView||categoryDenies||ch.parentId===CASE_CATEGORY||
ch.id===CASE_FORUM||ch.id===CASE_CATEGORY)
throw Error("Private, inherited restricted, or protected management channels are excluded");
return ch;
}
async function doDangerousConfirmedAction(i,plan){
const d=plan.payload;
const reason=sanitized(d.reason||"Authorized staff action",300);
if(["ban","kick","timeout"].includes(plan.kind)){
const perms={ban:PermissionFlagsBits.BanMembers,kick:PermissionFlagsBits.KickMembers,timeout:PermissionFlagsBits.ModerateMembers};
const target=await verifyModerationTarget(i,d.targetId,perms[plan.kind]);
if(plan.kind==="ban"){
if(!target.bannable)throw Error("Discord role hierarchy does not permit this ban");
await target.ban({reason,deleteMessageSeconds:0});
const ban=await i.guild.bans.fetch(d.targetId).catch(()=>null);
if(!ban?.user||ban.user.id!==d.targetId)throw Error("Ban was requested but final state could not be verified");
log("moderation_ban_confirmed",{manual:true,actorAuthorized:true});
return"Ban confirmed for "+sanitized(target.user.username,60)+". No historical messages were deleted.";
}
if(plan.kind==="kick"){
if(!target.kickable)throw Error("Discord role hierarchy does not permit this kick");
await target.kick(reason);
const remaining=await i.guild.members.fetch({user:d.targetId,force:true}).catch(()=>null);
if(remaining)throw Error("Kick was requested but member still appears in Discord");
log("moderation_kick_confirmed",{manual:true,actorAuthorized:true});
return"Kick confirmed for "+sanitized(target.user.username,60)+". No other member was changed.";
}
if(!Number.isInteger(d.minutes)||d.minutes<1||d.minutes>40320||!target.moderatable)throw Error("Timeout permission or duration invalid");
const desired=Date.now()+d.minutes*60000;
await target.timeout(d.minutes*60000,reason);
const check=await i.guild.members.fetch({user:d.targetId,force:true});
if(!check.communicationDisabledUntilTimestamp||
Math.abs(check.communicationDisabledUntilTimestamp-desired)>120000)throw Error("Timeout could not be fully verified");
log("moderation_timeout_confirmed",{manual:true,minutes:d.minutes});
return"Timeout applied for "+d.minutes+" minute(s) to "+sanitized(target.user.username,60)+".";
}
if(plan.kind==="unban"){
await requireStaffCaseCommand(i,PermissionFlagsBits.BanMembers);
const ban=await i.guild.bans.fetch(d.targetId).catch(()=>null);
if(!ban?.user||ban.user.id!==d.targetId)throw Error("User is no longer banned; no change made");
await i.guild.bans.remove(d.targetId,reason);
const exists=await i.guild.bans.fetch(d.targetId).catch(()=>null);
if(exists)throw Error("Unban requested but final state could not be verified");
log("moderation_unban_confirmed",{manual:true});
return"Unban confirmed for Discord user ID "+d.targetId+".";
}
if(plan.kind==="purge"){
const ch=await verifyPublicWritableTextChannel(i,PermissionFlagsBits.ManageMessages);
if(ch.id!==d.channelId)throw Error("Purge target channel changed");
const messages=await ch.messages.fetch({limit:100});
const now=Date.now();
const ids=d.messageIds;
if(!Array.isArray(ids)||!ids.length||ids.length>d.limit||ids.length>100||
new Set(ids).size!==ids.length||ids.some(id=>!/^[0-9]{17,22}$/.test(id)))
throw Error("Purge confirmation has an invalid message snapshot");
if(ids.includes(plan.messageId))throw Error("Confirmation message is protected from purge");
const all=new Map([...messages.values()].map(m=>[m.id,m]));
const candidates=ids.map(id=>all.get(id));
if(candidates.some(m=>!m||m.author?.id===A||m.author?.bot||
m.type!==0||m.pinned||m.attachments?.size||m.stickers?.size||
(m.embeds||[]).some(e=>e.image||e.thumbnail||e.video)||m.components?.length||
now-m.createdTimestamp>=13*86400000))
throw Error("Selected messages changed or are no longer eligible; no messages deleted");
const collection=await ch.bulkDelete(ids,true);
const removed=collection?.size||0;
log("messages_purged_confirmed",{manual:true,count:removed,protectedMedia:true});
return"Deleted "+removed+" eligible recent message(s) from this channel. Pinned posts, media, dashboards, private forums, and older messages were protected.";
}
if(plan.kind==="lock"){
const ch=await verifyPublicWritableTextChannel(i,PermissionFlagsBits.ManageChannels);
if(ch.id!==d.channelId||typeof d.enabled!=="boolean")throw Error("Lock target changed");
const current=ch.permissionOverwrites.cache.get(G);
const denied=!!current?.deny?.has(PermissionFlagsBits.SendMessages);
if(denied===d.enabled)return"Channel send-message permissions already match the requested state; nothing changed.";
await ch.permissionOverwrites.edit(G,{SendMessages:d.enabled?false:null},{reason:"Explicit /lock confirmation by "+i.user.id});
const updated=await i.guild.channels.fetch(ch.id);
const after=!!updated?.permissionOverwrites?.cache?.get(G)?.deny?.has(PermissionFlagsBits.SendMessages);
if(after!==d.enabled)throw Error("Channel permission change could not be verified");
log("channel_lock_confirmed",{manual:true,locked:d.enabled});
return d.enabled?"Channel locked for @everyone; no private forum or other channel was changed.":"Channel unlocked to inherited Send Messages permissions; other channel settings were preserved.";
}
throw Error("This confirmation action is not enabled");
}
async function confirmForumChange(i,plan){
const d=plan.payload;
if(!moderator(i)||!i.memberPermissions?.has(PermissionFlagsBits.ManageThreads))
throw Error("Authorized staff needs Manage Threads");
const botMember=await i.guild.members.fetchMe();
if(!botMember.permissions.has(PermissionFlagsBits.ManageThreads))throw Error("Bot needs Manage Threads");
const thread=await i.guild.channels.fetch(d.threadId).catch(()=>null);
if(!thread||thread.guildId!==G||![11,12].includes(thread.type)||thread.parentId!==d.forumId)throw Error("Thread scope changed");
const forum=await i.guild.channels.fetch(d.forumId).catch(()=>null);
if(!forum||forum.guildId!==G||forum.type!==15)throw Error("Parent forum changed");
const current=await caseApi("GET","/channels/"+d.threadId);
if(current.id!==d.threadId||current.parent_id!==d.forumId)throw Error("Forum post location drift");
if(d.action==="rename"){
if(thread.name!==d.before)throw Error("Thread title changed before confirmation");
const changed=await thread.setName(d.title,"Manual forum-admin rename by "+i.user.id);
if(changed.name!==d.title)throw Error("Rename unverified");
log("forum_thread_renamed",{manuallyConfirmed:true});
return"Forum thread renamed to "+sanitized(d.title,100)+"; no other channel changed.";
}
if(d.action==="tag"){
const before=[...(current.applied_tags||[])].sort();
if(!sameIds(before,[...d.beforeTags].sort()))throw Error("Thread tags changed before confirmation");
const match=(forum.availableTags||[]).find(t=>t.id===d.tagId);
if(!match||match.name!==d.tagName)throw Error("Original forum tag missing");
const next=d.mode==="add"?[...new Set([...before,d.tagId])]:before.filter(t=>t!==d.tagId);
if(next.length>5)throw Error("Maximum five tags reached");
await thread.setAppliedTags(next,"Manual forum-admin tag change by "+i.user.id);
const verified=await caseApi("GET","/channels/"+d.threadId);
if(!sameIds([...(verified.applied_tags||[])].sort(),[...next].sort()))throw Error("Tag change unverified");
log("forum_tag_changed",{manual:true,mode:d.mode});
return"Existing forum tag "+d.tagName+" "+(d.mode==="add"?"applied":"removed")+" on the selected thread.";
}
if(d.action==="pin"||d.action==="unpin"){
const old=Number(current.flags||0);
if(old!==d.beforeFlags)throw Error("Post flags changed before confirmation");
const desired=d.action==="pin"?(old|2):(old&~2);
if(desired===old)return"Pin state already correct; nothing changed.";
await caseApi("PATCH","/channels/"+d.threadId,{flags:desired});
const verified=await caseApi("GET","/channels/"+d.threadId);
if(Number(verified.flags||0)!==desired)throw Error("Post pin state unverified");
log("forum_pin_changed",{manual:true,action:d.action});
return"Selected forum post "+(d.action==="pin"?"pinned":"unpinned")+"; other content and settings preserved.";
}
throw Error("Unsupported forum operation");
}
async function confirmAutoModChange(i,plan){
const d=plan.payload;
if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))throw Error("Manage Server permission required");
const bot=await i.guild.members.fetchMe();
if(!bot.permissions.has(PermissionFlagsBits.ManageGuild))throw Error("Bot needs Manage Server permission");
const current=await i.guild.autoModerationRules.fetch();
const eligible=[...current.values()].filter(r=>/^(blickymania|momentum movement|dawn dotta)/i.test(r.name||""));
if(eligible.length!==d.rules.length||!sameIds(eligible.map(r=>r.id).sort(),d.rules.map(r=>r.id).sort()))
throw Error("Bot-managed AutoMod rules changed before confirmation");
for(const rule of eligible){
const expected=d.rules.find(x=>x.id===rule.id);
if(!expected||expected.name!==rule.name||expected.enabled!==rule.enabled)throw Error("AutoMod rule state drift");
}
let changed=0;
for(const rule of eligible){
if(rule.enabled===d.enabled)continue;
await i.guild.autoModerationRules.edit(rule.id,{enabled:d.enabled,reason:"Manual /automod by "+i.user.id});
changed++;
}
const final=await i.guild.autoModerationRules.fetch();
if(!d.rules.every(r=>final.get(r.id)?.enabled===d.enabled))throw Error("One or more AutoMod rule states unverified");
log("automod_rule_toggle",{manual:true,changed,enabled:d.enabled});
return"Updated "+changed+" existing, specifically labeled Momentum Movement/Blickymania AutoMod rule(s). No rules created or deleted.";
}
async function confirmedAction(i,plan){
if(plan.kind==="selftest")return"✅ Non-destructive confirmation completed. This message was updated in place. No member, role, channel, or permission was changed.";
if(plan.kind==="reorder")return confirmCategoryPlan(i,plan.payload);
if(["ban","kick","timeout","unban","purge","lock"].includes(plan.kind))return doDangerousConfirmedAction(i,plan);
if(plan.kind==="forum")return confirmForumChange(i,plan);
if(plan.kind==="automod")return confirmAutoModChange(i,plan);
throw Error("Unknown or disabled confirmation action");
}
const DCP_VIEWS={
staff:{channel:"1565643501243465799",message:"1566161955851472927",
title:"## 🛡️ Staff Directory",tabs:["Leadership","Staff Duties","Verification","Original"],
pages:[
"### 👑 Verified Leadership\n**Dawn Dotta** — Momentum Movement server owner <@1276370255152812045>.\nThe owner directs this community. Staff assignments, moderator responsibilities and restricted access must be verified from this server's actual Discord roles; do not assume someone is staff from a profile name or avatar.\n\nFor member assistance, use the Help Desk button above.",
"### 🛡️ Staff Duties\nFor access and general support, use <#1565643497388646411>. Staff responsibilities include content safety, case review, access verification, event moderation, forum upkeep and technical escalation.",
"### ✅ Verify Staff & Access\nCheck current server roles and trusted staff announcements before sharing information. Only authorized people can manage Conference Room and Super Fan access, and assign verified Level 50 roles. Report impersonation or access problems through the Help Desk. Never submit passwords, authentication codes or private identity documents.",
"### 📖 Original Directory Overview\nFor access and general support, use <#1565643497388646411>. Staff responsibilities include content safety, case review, access verification, event moderation, forum upkeep and technical escalation."
],
footer:"-# Momentum Movement · Original member and owner content preserved · No automatic access grants"},
tracker:{channel:"1565643996624199760",message:"1566161979645628522",
title:"## 🏆 Discord Engagement Tracker",tabs:["Daily","Weekly","Monthly","Yearly","All Time"],
pages:[
"### Daily Discord Engagement\nNo verified daily XP ledger is connected. Daily ranking unavailable, not zero. No fake retroactive awards. Exclude bot news and Safe Space.",
"### Weekly Discord Engagement\nNo verified seven-day XP baseline is available. Weekly rankings must use real Eastern Time timestamps and qualified human activity.",
"### Monthly Discord Engagement\nMonthly XP progress requires an independent durable Momentum Movement ledger. No verified current-season scores have been established.",
"### Yearly Discord Engagement\nYear-to-date rankings need dated XP history. Historical gaps remain unavailable and are never filled by guesses.",
"### All-Time Discord Engagement\nLifetime XP and achievements require verified durable records. Scores from TikTok or other servers never count as this server's Discord XP."
],
footer:"-# Momentum Movement · Five time periods · Verified data only · No layout automation"}
};
client.on(Events.InteractionCreate,async i=>{
if(!i.isButton?.()||i.guildId!==G||i.applicationId!==A)return;
const match=/^dcp:(staff|tracker):([0-4]):std26c$/.exec(i.customId||"");
if(!match)return;
const kind=match[1],index=Number(match[2]),def=DCP_VIEWS[kind];
if(!def||index>=def.tabs.length||i.channelId!==def.channel||i.message?.id!==def.message||i.message?.author?.id!==A)return;
const tabs=def.tabs.map((label,n)=>({type:2,style:n===index?1:2,label,custom_id:"dcp:"+kind+":"+n+":std26c"}));
if(kind==="staff")tabs.push({type:2,style:5,label:"Help Desk",url:"https://discord.com/channels/"+G+"/1565643497388646411"});
const panel={type:17,accent_color:6505126,components:[
{type:10,content:def.title},
{type:1,components:tabs},
{type:14,divider:true,spacing:1},
{type:10,content:def.pages[index]},
{type:14,divider:true,spacing:1},
{type:10,content:def.footer}]};
try{
await i.deferUpdate();await i.editReply({components:[panel],allowedMentions:noPing});
log("dashboard_section",{panel:kind,section:index,sharedMessage:true});
}catch(error){
log("dashboard_section_failed",{panel:kind,reason:String(error?.code||error?.message||"unknown").slice(0,100)});
}
});
const DCP_SHARED_PAGES={"rules":{"channel":"1566060632384602132","message":"1566161923404341290","title":"📜 Community Rules","tabs":["Guidelines","Participation","Safety","Original"],"pages":["**📜 Momentum Movement · Community Guidelines**\n**Welcome to Dawn Dotta’s Momentum Movement.** This community is for learning, encouragement, collaboration, and authentic conversation.\n\n**Respect & conduct**\n• Respect all members. No harassment, hate speech, threats, impersonation or targeted drama.\n• Disagree constructively; do not bring personal feuds into the community.\n• Keep posts, images, and links appropriate for a general audience.\n\n**Participation**\n• Use the correct channels and forum tags. No spam, unsolicited advertising or repeated mass mentions.\n• Treat Dawn Dotta, guests, creators, supporters and non-supporters equally.\n• Gifting, subscriptions and financial contributions are always voluntary—never pressure anyone.\n\n**Privacy & safety**\n• Do not expose someone’s private information, messages, images, recordings or screenshots without their permission.\n• No phishing, scams, harmful links, fraud or evading server bans.\n• In healthcare conversations, never post patient information or private medical records.\n\n**Moderation**\n• Follow authorized moderator guidance and Discord policies.\n• Report concerns or request an appeal through <#1565643497388646411>, not public disputes.\n• Serious or repeated violations may lead to moderation action.\n\n**By participating, you agree to these guidelines.**","Participation is voluntary. Welcome new members, credit original creators, share within the appropriate channel and avoid repeated promotion. Treat supporters and non-supporters equally; do not pressure anyone to gift or subscribe.","Do not share private photos, recordings, patient records, passwords or recovery codes. Avoid scams and impersonation. Request a private review through Help Desk rather than exposing another member.","**📜 Momentum Movement · Community Guidelines**\n**Welcome to Dawn Dotta’s Momentum Movement.** This community is for learning, encouragement, collaboration, and authentic conversation.\n\n**Respect & conduct**\n• Respect all members. No harassment, hate speech, threats, impersonation or targeted drama.\n• Disagree constructively; do not bring personal feuds into the community.\n• Keep posts, images, and links appropriate for a general audience.\n\n**Participation**\n• Use the correct channels and forum tags. No spam, unsolicited advertising or repeated mass mentions.\n• Treat Dawn Dotta, guests, creators, supporters and non-supporters equally.\n• Gifting, subscriptions and financial contributions are always voluntary—never pressure anyone.\n\n**Privacy & safety**\n• Do not expose someone’s private information, messages, images, recordings or screenshots without their permission.\n• No phishing, scams, harmful links, fraud or evading server bans.\n• In healthcare conversations, never post patient information or private medical records.\n\n**Moderation**\n• Follow authorized moderator guidance and Discord policies.\n• Report concerns or request an appeal through <#1565643497388646411>, not public disputes.\n• Serious or repeated violations may lead to moderation action.\n\n**By participating, you agree to these guidelines.**"]},"invite":{"channel":"1565643493651644426","message":"1566161935320490112","title":"🔗 Server Invitations","tabs":["Invitations","Link Help","Security","Original"],"pages":["**🔗 Official Momentum Movement Discord Invite**\n**Invite friends to Dawn Dotta's Momentum Movement.**\n\n**Permanent server invite:** https://discord.gg/ganxsX66Ef\n\n**Quick invitation:**\n“Join Dawn Dotta's Momentum Movement on Discord—community, TikTok LIVE support, the Momentum Academy, running, careers and genuine connection: https://discord.gg/ganxsX66Ef”\n\n**Before sharing:** Invite only people who will respect the community guidelines. This link does not expire and does not have a preset use limit; Discord staff can revoke it if needed. New members should start with <#1565048207178862763> and <#1566060632384602132>.","If a link does not open, ask an authorized moderator to verify or replace it. Copy the complete invite rather than screenshots or shortened unknown links. Start in Welcome, then read Rules and Server Guide.","Only approved invite links should represent the community. Be cautious with impersonation and phishing, and do not share private staff channels or grant member roles through an invitation.","**🔗 Official Momentum Movement Discord Invite**\n**Invite friends to Dawn Dotta's Momentum Movement.**\n\n**Permanent server invite:** https://discord.gg/ganxsX66Ef\n\n**Quick invitation:**\n“Join Dawn Dotta's Momentum Movement on Discord—community, TikTok LIVE support, the Momentum Academy, running, careers and genuine connection: https://discord.gg/ganxsX66Ef”\n\n**Before sharing:** Invite only people who will respect the community guidelines. This link does not expire and does not have a preset use limit; Discord staff can revoke it if needed. New members should start with <#1565048207178862763> and <#1566060632384602132>."]},"services":{"channel":"1565643505206824990","message":"1566161964051210351","title":"🛠️ Discord Community Services","tabs":["Services","How It Works","Eligibility","Original"],"pages":["Owner and member messages must not be bulk migrated, modified or erased. Back up existing records before any permitted destructive change; confirm rights to images and media.","Use the Help Desk for access, role or technical support. Describe the problem and the affected channel without including secrets. An authorized administrator verifies the request before changing the server.","Changes require verified permissions and owner or authorized staff approval. Protected member content, photo originals, private rooms and existing server history must be preserved.","Owner and member messages must not be bulk migrated, modified or erased. Back up existing records before any permitted destructive change; confirm rights to images and media."]},"highlights":{"channel":"1565644000562511972","message":"1566161983361908778","title":"✨ Community Highlights","tabs":["Highlights","How to Share","Credit & Consent","Original"],"pages":["Celebrate permissioned creator moments, learning wins, positive community contributions, collaborations and achievements.","Share what happened, when it happened, and who deserves credit. Add the original image or clip as a visible attachment when its owner permits. Avoid duplicate or unverified achievements.","Only post images or recordings you have permission to share. Attribute creators correctly; remove or correct inaccurate captions when authorized. Do not repost private conversations.","Celebrate permissioned creator moments, learning wins, positive community contributions, collaborations and achievements."]},"polls":{"channel":"1565644013846012074","message":"1566161988432953555","title":"🗳️ Community Polls","tabs":["Polls","How to Vote","Integrity","Original"],"pages":["Gather thoughtful feedback about community activities, training ideas, games, creative topics and member preferences.","Use Discord's native poll function where available. Read the full question, select the intended option, and respect the stated closing time. Polls help guide discussions; they do not change permissions.","Keep voting respectful, do not spam or manipulate results, and avoid collecting sensitive personal information. A community poll is advisory unless authorized staff explicitly approve an action.","Gather thoughtful feedback about community activities, training ideas, games, creative topics and member preferences."]},"safe":{"channel":"1565644017499377715","message":"1566161996154671217","title":"🫂 Safe Space","tabs":["Safe Space","Participation","Privacy","Original"],"pages":["A supportive space for voluntary, respectful community discussion. Members decide what they wish to share and may disengage at any time.","Listen without pressuring anyone to disclose personal details. Disagree respectfully. Do not diagnose, target, mock, or share another member's story elsewhere without permission.","Discord discussions may be visible to members with access. Do not post account credentials, identifying documents, patient information or someone else's private messages. Request moderator help through established private support.","A supportive space for voluntary, respectful community discussion. Members decide what they wish to share and may disengage at any time."]},"updates":{"channel":"1565643512068972598","message":"1566161972133634350","title":"📰 Dawn Dotta Updates","tabs":["Updates","Sources","Verification","Original"],"pages":["Official creator updates should reflect verified public statements, collaborations, achievements and approved announcements—not fan speculation.","Prefer Dawn Dotta's own confirmed announcements or staff-approved official sources. Include publication dates when relevant; distinguish an upcoming activity from an event that has already happened.","Do not present rumors as fact, invent attendance or statistics, or repost other creators' private posts. Correct outdated statements when the original source changes.","Official creator updates should reflect verified public statements, collaborations, achievements and approved announcements—not fan speculation."]},"labschedule":{"channel":"1565644034586705941","message":"1566162002005459106","title":"🗓️ Momentum Academy Schedule","tabs":["Academy Schedule","Sessions","Guidance","Original"],"pages":["Momentum Academy schedules only verified instructor-led sessions. Creator Practice is for lessons and challenges, not unconfirmed official appointments.","A session belongs on the schedule only when an authorized instructor or staff member confirms its date, time zone, format and venue. Do not imply registration or attendance is available until verified.","Use the official Academy channels for updates. Changes or cancellations should identify which session is affected. An undated workshop idea is not a scheduled lesson.","Momentum Academy schedules only verified instructor-led sessions. Creator Practice is for lessons and challenges, not unconfirmed official appointments."]},"schedule":{"channel":"1565643508776181850","message":"1566161968078000359","title":"🗓️ Dawn Dotta Weekly Schedule","tabs":["Weekly Schedule","Publishing","Accuracy","Original"],"pages":["Only dates and times confirmed by Dawn Dotta or authorized scheduling staff are official. The dashboard does not invent recurring LIVE sessions or unpublished events.","Authorized staff should confirm the session title, local date, time zone and platform before updating the weekly schedule. Corrections must identify the changed session.","Do not guess recurring livestream times from an old flyer. Label cancellations and reschedules clearly, and keep the latest verified schedule authoritative.","Only dates and times confirmed by Dawn Dotta or authorized scheduling staff are official. The dashboard does not invent recurring LIVE sessions or unpublished events."]},"milestones":{"channel":"1566029505540137081","message":"1566162043302707271","title":"🌟 Momentum Milestones","tabs":["Milestones","How to Submit","Verification","Original"],"pages":["Celebrate personal achievements, learning progress, running goals, professional wins and meaningful community support.","Members may share achievements in their own words with permissioned photos or clips. Give relevant context and avoid sharing private documents as proof.","Do not invent numerical achievements or rankings. Credit the person whose milestone is celebrated and confirm any public statistic before publishing it.","Celebrate personal achievements, learning progress, running goals, professional wins and meaningful community support."]},"modhandbook":{"channel":"1565644255878447124","message":"1566162011564408973","title":"📘 Moderator Handbook","tabs":["Handbook","Procedures","Ethics","Original"],"pages":["Process every report consistently: verify context, collect necessary evidence, identify the rule, choose the least disruptive response, and document actions.","Review the reported content and related context. Record the governing rule and why action is necessary. Escalate sensitive cases only to staff authorized to review them, then document the outcome.","Use the least intrusive necessary response. Do not share reporter identities or private case materials. Moderator access does not authorize changing owner content or unrelated server settings.","Process every report consistently: verify context, collect necessary evidence, identify the rule, choose the least disruptive response, and document actions."]},"modcenter":{"channel":"1565644265152057437","message":"1566162007244410912","title":"🛡️ Moderator Command Center","tabs":["Operations","Case Process","Staff Safety","Original"],"pages":["A private operational reference for verified staff: case intake, role verification, permissions, LIVE incidents and handoffs.","Use the protected Case Review workflow for sensitive reports. Verify permissions and relevant evidence, document the decision, and notify only authorized personnel. This dashboard is guidance, not an action-execution control.","Do not store tokens, passwords or private identity documents here. Confirm staff identity and authorization before any role or access change; preserve original member messages.","A private operational reference for verified staff: case intake, role verification, permissions, LIVE incidents and handoffs."]},"audit":{"channel":"1565644261087780874","message":"1566163281645670511","title":"📋 Moderator Audit Log","tabs":["Audit Log","Review Process","Privacy","Original"],"pages":["Keep reporter identities and sensitive evidence confidential. Do not publish credentials or raw personal records. No entry should imply an action occurred unless the bot or an authorized reviewer verified it.","Record the date, responsible authorized actor, scope, reason and verified outcome of a moderation action. Distinguish a request, an investigation and an action actually completed.","Use limited-access channels and minimum necessary details. Do not publish credentials, personal identity documents or private case attachments in general channels.","Keep reporter identities and sensitive evidence confidential. Do not publish credentials or raw personal records. No entry should imply an action occurred unless the bot or an authorized reviewer verified it."]},"news":{"channel":"1566160796109639831","message":"1566162021534142465","title":"📰 News Management","tabs":["Newsroom","Editorial Review","Publishing Rules","Original"],"pages":["A private editorial workspace to review news sources, relevance, duplicates and category settings before any publication.","Verify source, headline, publication date and the actual event date. Confirm the topic fits the community, check for duplicates and distinguish reported facts from commentary.","Do not publish unverified claims or privately sourced personal data. Respect member quiet periods and current owner-approved channel settings. This page does not activate a new news automation.","A private editorial workspace to review news sources, relevance, duplicates and category settings before any publication."]},"engagement":{"channel":"1566160801897783397","message":"1566162026214990027","title":"🎯 Discord Engagement Management","tabs":["Overview","Activity","Rankings","Scoring","Data Quality"],"pages":["Staff-only Momentum Movement engagement dashboard. No XP or member rank changes are made until a verified, server-specific ledger is available.","Use public-channel verified participation only; exclude bots, news, copied messages, and sensitive/private channels. Show coverage by daily, weekly, monthly, yearly, and lifetime windows.","Public tracker presents Daily, Weekly, Monthly, Yearly, and All Time navigation. Rankings are unavailable until the independent, durable XP source is confirmed; never invent missing history.","Authorized scoring requires transparent eligibility, anti-spam controls, cooldown, duplicated-message prevention and owner approval. This panel does not award or reset XP.","No verified persistent per-member XP ledger is connected. A missing value is unavailable, not zero. Preserve historical source posts, privacy, channel layouts and unrelated automation."]},"review":{"channel":"1565644250861936734","message":"1566162017549557812","title":"📥 Moderation Review Queue","tabs":["Overview","Full Details","Safety & Rules","Original"],"pages":["Track reports and role-access requests through Pending, Investigating, Awaiting Decision, Resolved or Closed.","A case moves through review only after a verified staff action. Confirm evidence, record who handled it, keep relevant permissions restricted and identify the outcome. This panel does not automatically open or resolve a case.","Protect reporter identities and private documents. Do not post raw case details in public channels. Apply the relevant community rule and escalate serious concerns to the appropriate authorized staff.","Track reports and role-access requests through Pending, Investigating, Awaiting Decision, Resolved or Closed."]}};
client.on(Events.InteractionCreate,async i=>{
if(!i.isButton?.()||i.guildId!==G||i.applicationId!==A)return;
const match=/^dcp:([a-z]+):([0-4])(?::std26c)?$/.exec(i.customId||"");
if(!match)return;
const key=match[1],index=Number(match[2]),def=DCP_SHARED_PAGES[key];
if(!def||index>=def.tabs.length)return;
const expected="dcp:"+key+":"+index+(key==="review"?"":":std26c");
if(i.customId!==expected||i.channelId!==def.channel||i.message?.id!==def.message||i.message?.author?.id!==A)return;
const buttons=def.tabs.map((label,n)=>({type:2,style:n===index?1:2,label,custom_id:"dcp:"+key+":"+n+(key==="review"?"":":std26c")}));
const components=[{type:17,accent_color:6505126,components:[
{type:10,content:"## "+def.title},
{type:1,components:buttons},
{type:14,divider:true,spacing:1},
{type:10,content:"### "+def.tabs[index]+"\n"+def.pages[index]},
{type:14,divider:true,spacing:1},
{type:10,content:"-# Momentum Movement · Verified guidance · Original member and owner content preserved · No automatic layout changes"}]}];
try{await i.deferUpdate();await i.editReply({components,allowedMentions:noPing});
log("shared_dashboard_section",{panel:key,section:index,messageEdit:true});
}catch(e){log("shared_dashboard_section_failed",{panel:key,reason:String(e?.code||e?.message||"unknown").slice(0,110)});}
});
client.on(Events.InteractionCreate,async i=>{
if(!i.isButton()||i.guildId!==G||!i.customId?.startsWith("mm005:"))return;
const match=i.customId.match(/^mm005:(confirm|cancel):([a-f0-9]{14})$/);
if(!match)return;
const[_,action,id]=match;
const plan=confirmationPlans.get(id);
try{
await i.deferUpdate();
if(!plan||plan.actorId!==i.user.id||plan.guildId!==G||
plan.channelId!==i.channelId||plan.messageId!==i.message?.id||
i.message?.author?.id!==A){
log("unauthorized_confirmation_attempt",{action,knownPlan:!!plan});
return;
}
confirmationPlans.delete(id);
if(action==="cancel"||plan.expiresAt<Date.now()){
await i.message.edit({content:action==="cancel"?"Operation cancelled. No changes were made.":"Confirmation expired after two minutes. No changes were made.",components:[],allowedMentions:noPing});return;
}
if(!ready||!guildVerified)throw Error("Bot Gateway not ready");
const summary=await confirmedAction(i,plan);
await i.message.edit({content:sanitized(summary,1900),components:[],allowedMentions:noPing});
log("confirmed_action_completed",{kind:plan.kind,actorAuthorized:true});
}catch(err){
log("confirmed_action_failed",{kind:plan?.kind||"unknown",reason:err instanceof Error?sanitized(err.message,100):"unknown"});
if(i.deferred)await i.message.edit({content:"Action stopped: "+sanitized(err instanceof Error?err.message:"Unknown verification failure",320)+". No further changes were attempted.",components:[],allowedMentions:noPing}).catch(()=>{});
}
});
client.on(Events.InteractionCreate,async i=>{
if(!i.isButton()||i.guildId||!i.customId?.startsWith("mm005:dmproof:"))return;
const key=i.customId.slice("mm005:dmproof:".length);
const item=dmProofPlans.get(key);
if(!/^[a-f0-9]{14}$/.test(key)||!item||item.userId!==i.user.id||
i.message?.author?.id!==A||item.messageId!==i.message?.id){
await i.deferUpdate().catch(()=>{});
return;
}
dmProofPlans.delete(key);
const valid=item.expiresAt>Date.now();
const message=(i.message?.content||"").slice(0,1650)+"\n\n"+
(valid?"✅ **DM receipt and private button interaction confirmed.**":
"⚠️ DM test expired. Run /bot-test again for a fresh confirmation.");
try{
await i.deferUpdate();await i.editReply({content:message,components:[],allowedMentions:noPing});
if(valid)log("dm_proof_confirmed",{staffInitiated:true,interactive:true,changedGuildData:false});
}catch(err){log("dm_proof_failed",{kind:err?.name||"unknown"})}
});
client.once(Events.ClientReady,async()=>{
try{
if(client.user?.id!==A)throw Error("Discord bot/application mismatch");
const guild=await client.guilds.fetch(G);
if(guild.id!==G)throw Error("Wrong authorized guild");
try{
rulesAcceptanceReady=await ensureRulesAcceptanceButton(guild);
log("rules_acceptance_ready",{messageId:RULES_ACCEPTANCE_TARGET.messageId,vaultConfigured:true,buttonVerified:rulesAcceptanceReady});
}catch(e){
rulesAcceptanceReady=false;
log("rules_acceptance_not_ready",{kind:e instanceof Error?e.message:"unknown"});
}
guildVerified=true;ready=true;preparedGatewayOwner.markApplicationReady();log("gateway_verified",{app:A,writeScope:"all_36_handlers_with_confirmations_including_forum_and_automod",handlerCount:SAFE.size,commandRegistryManagedElsewhere:true});
}catch(err){lastError=err instanceof Error?err.name:"identity_failed";ready=false;guildVerified=false;log("identity_failed",{kind:lastError});await preparedGatewayOwner.shutdown("identity_verification_failed");}
});
client.on(Events.ShardDisconnect,ev=>{ready=false;preparedGatewayOwner.markApplicationNotReady();log("disconnected",{code:ev.code})});
client.on(Events.ShardResume,()=>{ready=true;preparedGatewayOwner.markApplicationReady();log("resumed")});
client.on(Events.Error,err=>{lastError=err?.name||"gateway_error";log("error",{kind:lastError})});
client.on(Events.InteractionCreate,async i=>{
if(!i.isChatInputCommand()||i.guildId!==G||!CORE_COMMANDS.has(i.commandName))return;
if(!ready||!guildVerified)return;
const cmd=i.commandName;
try{
await i.deferReply();
let response="";
let pollEmojis=[];
let stagedConfirmation=null;
if(!SAFE.has(cmd)){
response="This command's original permission-controlled workflow has not yet been safely restored. No Discord content, roles, or settings were changed.";
}else if(OWNER_ONLY.has(cmd)&&!moderator(i)){
response="This configuration check is restricted to authorized staff.";
}else if(cmd==="ping"||cmd==="bot-status"||cmd==="botstatus"){
response="✅ Blickymania Bot 005 is connected to Momentum Movement.\nDiscord gateway: verified · Guild: verified · Command handlers: 36/36 installed.\nEnd-to-end command execution and exact historical feature parity are not yet verified.";
}else if(cmd==="bot-test"){
if(!moderator(i)){
response="✅ Blickymania Bot 005 is connected to Momentum Movement. Extended diagnostics require Manage Server permission.";
}else{
const channels=await i.guild.channels.fetch();
const counterIds=["1566030413842096241","1566030421635104768","1566030474034282537","1566030481135243335","1566030497098760313","1566030504635924600"];
const counters=counterIds.map(id=>channels.get(id)).filter(c=>!!c&&c.guildId===G&&c.type===2);
const staff=channels.get("1566227861747138641"),cat=channels.get("1565643251783049237");
const denies=channel=>{
const everyone=channel?.permissionOverwrites?.cache?.get(G);
const moderator=channel?.permissionOverwrites?.cache?.get("1565407676580499616");
const illegal=[...(channel?.permissionOverwrites?.cache?.values()||[])].some(o=>o.id!==G&&o.id!=="1565407676580499616"&&o.allow?.has(PermissionFlagsBits.ViewChannel));
return!!everyone?.deny?.has(PermissionFlagsBits.ViewChannel)&&!!moderator?.allow?.has(PermissionFlagsBits.ViewChannel)&&!illegal;
};
const privateCaseForum=staff?.type===15&&staff?.parentId==="1565643251783049237"&&denies(staff)&&denies(cat);
const registered=await i.guild.commands.fetch().catch(()=>null);
const commandNames=registered?[...registered.values()].filter(x=>x.type===1).map(x=>x.name):[];
const missing=[...CORE_COMMANDS].filter(x=>!commandNames.includes(x));
const extra=commandNames.filter(x=>!CORE_COMMANDS.has(x));
const commandsVerified=!!registered&&commandNames.length===36&&missing.length===0&&extra.length===0;
const checks=[
"36 registered Discord slash commands: "+(commandsVerified?"VERIFIED":registered?"NEEDS REVIEW ("+commandNames.length+"/36; missing "+missing.length+"; unexpected "+extra.length+")":"UNAVAILABLE"),
"Guild and application: VERIFIED",
"Discord Gateway: "+(ready&&guildVerified?"READY":"NOT READY"),
"Seven Community Stats displays: "+counters.length+"/7 located",
"Moderator Case Review privacy: "+(privateCaseForum?"VERIFIED":"NEEDS REVIEW"),
"High-impact commands: staff permission and confirmation required"
];
const summary="**Momentum Movement — Bot 005 Safety Diagnostics**\n"+checks.map(x=>"• "+x).join("\n")+"\n\nThis checks structural readiness only; no coaching cases, moderation actions, or channel settings were changed.";
try{
const proof=crypto.randomUUID().replace(/-/g,"").slice(0,14);
const dm=await i.user.send({
content:summary+"\n\nSelect **Confirm DM Receipt** to verify both delivery and the private button interaction.",
components:[{type:1,components:[{type:2,style:3,label:"Confirm DM Receipt",custom_id:"mm005:dmproof:"+proof}]}],
allowedMentions:noPing
});
dmProofPlans.set(proof,{userId:i.user.id,messageId:dm.id,expiresAt:Date.now()+15*60000});
response="Bot 005 diagnostics were accepted by Discord for DM delivery. Confirm receipt in your DM. Use the confirmation button below to test the safe server-side workflow.";
stagedConfirmation=planChange(i,"selftest",{},"Verify confirmation buttons without changing Discord data");
}catch{
response="I couldn't deliver the private Bot 005 report. Enable server DMs and retry. No Discord settings or member data were changed.";
}
log("safety_diagnostic",{registryVerified:commandsVerified,commandCount:commandNames.length,statsFound:counters.length,caseForumPrivate:privateCaseForum,dmDelivered:response.startsWith("Bot 005")});
}
}else if(cmd==="help"){
response="**Blickymania Bot 005 — recovered commands**\nAvailable now: /ping, /bot-test, /bot-status, /botstatus, /server, /member, /events, /rules, /tiktok, /dashboard, /forum-admin diagnose, /audit (staff), /automod status (staff), /report, /support, /poll, /announce (staff), /eventcreate (staff), /slowmode (staff), /closecase (staff), /warn (staff), /role (staff, access only), /statsset (staff), /addtocase (staff), /channelorder (staff), /channelposition (staff), /chatfirst (staff), /ban /kick /timeout /unban (staff), /purge (staff), /lock (staff), /statsstatus, /help.\nHigh-impact actions require staff permissions and explicit confirmation. Original historical feature parity still needs real Discord testing.";
}else if(["ban","kick","timeout","unban"].includes(cmd)){
const required={ban:PermissionFlagsBits.BanMembers,kick:PermissionFlagsBits.KickMembers,
timeout:PermissionFlagsBits.ModerateMembers,unban:PermissionFlagsBits.BanMembers};
try{
await requireStaffCaseCommand(i,required[cmd]);
const targetId=cmd==="unban"?String(i.options.getString("user_id")||""):
i.options.getUser("user")?.id;
const reason=sanitized(i.options.getString("reason"),300);
const minutes=cmd==="timeout"?i.options.getInteger("minutes"):null;
if(!targetId||!/^\d{17,22}$/.test(targetId)||reason.length<5||
(cmd==="timeout"&&(!Number.isInteger(minutes)||minutes<1||minutes>40320))){
response="Missing or invalid user, reason, or duration. No moderation action taken.";
}else{
if(cmd==="unban"){
const ban=await i.guild.bans.fetch(targetId).catch(()=>null);
if(!ban?.user||ban.user.id!==targetId)response="That account is not currently banned. Nothing was changed.";
}else await verifyModerationTarget(i,targetId,required[cmd]);
if(!response){
stagedConfirmation=planChange(i,cmd,{targetId,reason,minutes},"Confirm moderation action");
response="**Moderation action — requires confirmation**\n"+
"Action: "+cmd.toUpperCase()+"\nTarget Discord ID: "+targetId+
(cmd==="timeout"?"\nDuration: "+minutes+" minute(s)":"")+
"\nReason: "+reason+
"\n\nConfirm within two minutes or Cancel. Nothing has been changed yet.";
}
}
}catch(err){
response="Moderation operation blocked: "+sanitized(err instanceof Error?err.message:"Permission verification failed",240)+". No changes made.";
}
}else if(cmd==="purge"){
const limit=i.options.getInteger("count");
if(!Number.isInteger(limit)||limit<1||limit>100){
response="Purge count must be between 1 and 100. No messages were deleted.";
}else{
try{
const ch=await verifyPublicWritableTextChannel(i,PermissionFlagsBits.ManageMessages);
const msgs=await ch.messages.fetch({limit:100});
const now=Date.now();
const eligible=[...msgs.values()].filter(m=>m.author?.id!==A&&!m.author?.bot&&
m.type===0&&!m.pinned&&!m.attachments?.size&&!m.stickers?.size&&
!(m.embeds||[]).some(x=>x.image||x.thumbnail||x.video)&&!m.components?.length&&
now-m.createdTimestamp<13*86400000)
.sort((a,b)=>b.createdTimestamp-a.createdTimestamp).slice(0,limit);
if(!eligible.length)response="No eligible recent, unpinned, non-media member messages are available for purging. Nothing changed.";
else{
stagedConfirmation=planChange(i,"purge",{channelId:ch.id,limit,messageIds:eligible.map(m=>m.id)},"Confirm exact message purge");
response="**Message purge — confirmation required**\n"+
"Channel: <#"+ch.id+">\n"+
"Maximum requested: "+limit+" messages\n"+
"Exact eligible messages selected: "+eligible.length+"\n"+
"Pinned messages, media, dashboard messages, and older content are excluded."+
"\n\nConfirm within two minutes or Cancel. Nothing has been deleted.";
}
}catch(err){response="Purge blocked: "+sanitized(err instanceof Error?err.message:"Permission verification failed",240)+". No messages deleted.";}
}
}else if(cmd==="lock"){
try{
const enabled=i.options.getBoolean("enabled");
const ch=await verifyPublicWritableTextChannel(i,PermissionFlagsBits.ManageChannels);
const before=!!ch.permissionOverwrites.cache.get(G)?.deny?.has(PermissionFlagsBits.SendMessages);
if(typeof enabled!=="boolean")response="Choose true to lock or false to unlock. No changes made.";
else if(before===enabled)response="This channel is already "+(enabled?"locked":"unlocked")+" for @everyone. No change made.";
else{
stagedConfirmation=planChange(i,"lock",{channelId:ch.id,enabled},"Confirm channel lock");
response="**Channel send-permission change — confirmation required**\n"+
"Target: <#"+ch.id+">\nRequested: "+(enabled?"LOCK @everyone sending":"UNLOCK to inherited sending permissions")+
"\nNo private category or unrelated channel will be modified."+
"\n\nConfirm within two minutes or Cancel. No permissions have changed.";
}
}catch(err){response="Channel permission change blocked: "+sanitized(err instanceof Error?err.message:"Permission verification failed",230)+". No changes made.";}
}else if(cmd==="addtocase"){
const member=i.options.getUser("user");
const thread=await i.guild.channels.fetch(i.channelId).catch(()=>null);
const actor=await i.guild.members.fetch(i.user.id).catch(()=>null);
const targetMember=member?await i.guild.members.fetch(member.id).catch(()=>null):null;
if(!i.memberPermissions?.has(PermissionFlagsBits.ManageThreads)||!actor?.roles.cache.has(CASE_MOD_ROLE)){
response="Only verified moderators with Manage Threads permission can add case collaborators.";
}else if(!thread||![11,12].includes(thread.type)||thread.parentId!==CASE_FORUM||
!targetMember?.roles.cache.has(CASE_MOD_ROLE)||member.bot){
response="This command adds only another verified moderator to a private Case Review thread. No change made.";
}else{
const[forum,parent]=await Promise.all([caseApi("GET","/channels/"+CASE_FORUM),caseApi("GET","/channels/"+CASE_CATEGORY)]);
if(forum.parent_id!==CASE_CATEGORY||!caseForumSafe(forum)||!caseForumSafe(parent))throw Error("Case Review privacy drift");
const starter=await thread.fetchStarterMessage().catch(()=>null);
const own=starter?.author?.id===A&&/^(## 🔒 Private Support Request|## 🔒 Confidential Member Report|## 🔒 Confidential Moderation Warning)/.test(starter.content||"");
if(!own){
response="This is not a verified Bot 005 staff case. No member was added.";
}else{
await thread.members.add(member.id);
const join=await thread.members.fetch(member.id).catch(()=>null);
if(!join)throw Error("Staff thread membership could not be verified");
response="✅ Authorized moderator added to this staff-only case. No channel or role permissions were changed.";
log("case_staff_member_added",{manual:true,staffRoleVerified:true});
}
}
}else if(cmd==="statsset"){
const sf=i.options.getInteger("super_fans"),lv=i.options.getInteger("level_50s");
if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){
response="Only authorized creator/management staff can confirm TikTok statistics.";
}else if(!Number.isSafeInteger(sf)||!Number.isSafeInteger(lv)||sf<0||lv<0||sf>100000000||lv>100000000){
response="Enter two valid non-negative totals. No statistics were saved.";
}else{
const[forum,parent]=await Promise.all([caseApi("GET","/channels/"+CASE_FORUM),caseApi("GET","/channels/"+CASE_CATEGORY)]);
if(forum.parent_id!==CASE_CATEGORY||forum.type!==15||!caseForumSafe(forum)||!caseForumSafe(parent))throw Error("Private stats ledger not secure");
const staff=await i.guild.members.fetchMe();
if(!staff.permissions.has(PermissionFlagsBits.SendMessagesInThreads)||!staff.permissions.has(PermissionFlagsBits.CreatePublicThreads)){
response="The bot lacks staff-forum posting permissions. No statistics were saved.";
}else{
const timestamp=new Date().toISOString();
const record="## 📊 Staff-Recorded TikTok Stats\n"+
"**Super Fans:** "+sf.toLocaleString("en-US")+"\n"+
"**Level 50s:** "+lv.toLocaleString("en-US")+"\n"+
"**Recorded by:** <@"+i.user.id+">\n"+
"**Recorded at:** "+timestamp+"\n"+
"**Discord interaction:** "+i.id+
"\n\n-# Staff-entered figures; not independently verified with TikTok; Discord access counters are unchanged";
const existing=await caseApi("GET","/channels/"+CASE_FORUM+"/threads/archived/public?limit=50").catch(()=>({threads:[]}));
const active=await caseApi("GET","/guilds/"+G+"/threads/active").catch(()=>({threads:[]}));
const pool=[...(active.threads||[]),...(existing.threads||[])].filter(x=>x.parent_id===CASE_FORUM&&x.name==="Creator TikTok Stats Ledger");
let channelId=null;
if(pool.length===1){
channelId=pool[0].id;
const thread=await caseApi("GET","/channels/"+channelId);
if(thread.thread_metadata?.archived)await caseApi("PATCH","/channels/"+channelId,{archived:false});
await caseApi("POST","/channels/"+channelId+"/messages",{content:record,allowed_mentions:quietMentions});
}else if(pool.length===0){
const created=await caseApi("POST","/channels/"+CASE_FORUM+"/threads",{
name:"Creator TikTok Stats Ledger",auto_archive_duration:1440,
message:{content:record,allowed_mentions:quietMentions}
});
if(created.parent_id!==CASE_FORUM)throw Error("Stats ledger creation could not be verified");
channelId=created.id;
}else throw Error("Ambiguous existing Creator Stats Ledger threads; no new record written");
response="✅ Staff-entered TikTok statistics saved in the private ledger (not independently verified)."+
"\nSuper Fans: "+sf.toLocaleString("en-US")+
" · Level 50s: "+lv.toLocaleString("en-US")+
"\nLedger: <#"+channelId+">"+
"\nDiscord role-access counts and LIVE totals were not overwritten.";
log("creator_stats_saved",{staffRecorded:true,independentlyVerified:false,userInitiated:true,privateLedger:true});
}
}
}else if(cmd==="channelorder"||cmd==="channelposition"||cmd==="chatfirst"){
if(!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels)){
response="Channel reordering requires Manage Channels permission. No channels were changed.";
}else{
const snapshot=await i.guild.channels.fetch();
const groups=[];
if(cmd==="channelorder"){
const category=i.options.getChannel("category"),csv=String(i.options.getString("channels")||"");
const ids=csv.split(",").map(x=>x.trim()).filter(Boolean);
if(!category||category.type!==4||ids.length<2||ids.length>80||ids.some(x=>!/^\d{17,22}$/.test(x))){
response="Provide a category and the complete comma-separated list of channel IDs (2–80). No channels changed.";
}else groups.push({categoryId:category.id,ids});
}else if(cmd==="channelposition"){
const subject=i.options.getChannel("channel"),index=i.options.getInteger("position");
if(!subject||!subject.parentId||!Number.isInteger(index)){
response="Select an existing child channel and a valid sibling position. No channels changed.";
}else{
const original=orderedCategoryChannels(snapshot,subject.parentId).map(c=>c.id);
if(!original.includes(subject.id)||index<0||index>=original.length)response="Position is outside this category. No channels moved.";
else{const desired=original.filter(id=>id!==subject.id);desired.splice(index,0,subject.id);groups.push({categoryId:subject.parentId,ids:desired});}
}
}else{
const categories=[...snapshot.values()].filter(c=>c?.type===4);
for(const cat of categories){
const original=orderedCategoryChannels(snapshot,cat.id);
if(original.length<2)continue;
const prioritized=[...original].sort((a,b)=>{
const ah=/chat/i.test(a.name)?0:1,bh=/chat/i.test(b.name)?0:1;
return ah-bh||a.rawPosition-b.rawPosition;
});
if(!sameIds(original.map(x=>x.id),prioritized.map(x=>x.id)))groups.push({categoryId:cat.id,ids:prioritized.map(c=>c.id)});
}
if(groups.length>20)throw Error("More than 20 categories need ordering; use /channelorder per category instead");
}
if(groups.length){
const full=await previewCategoryPlan(i.guild,groups);
const modified=full.filter(g=>!sameIds(g.before,g.after));
if(!modified.length)response="The requested category order already matches Discord. No changes are necessary.";
else{
stagedConfirmation=planChange(i,"reorder",{groups:modified},"Channel order confirmation");
response="**Review pending channel reordering**\n"+
"Command: /"+cmd+"\n"+
"Categories affected: "+modified.length+"\n"+
"Channels in affected categories: "+modified.reduce((n,g)=>n+g.after.length,0)+
"\nNo channels will be created, renamed, deleted, or moved across categories."+
"\n\n**Confirm within 2 minutes** to apply the exact order, or Cancel. No changes have occurred yet.";
}
}else if(!response)response="No category needed reordering. No changes were made.";
}
}else if(cmd==="role"){
const user=i.options.getUser("user"),givenRole=i.options.getRole("role"),action=i.options.getString("action");
const allowedAccessRoles=new Map([
["1565571008822386788","super fan lounge access"],
["1565571007190794340","level 50 lounge access"]
]);
if(!i.memberPermissions?.has(PermissionFlagsBits.ManageRoles)){
response="Changing lounge-access roles requires Manage Roles permission. No roles were changed.";
}else if(!user||!givenRole||!["add","remove"].includes(action)||!allowedAccessRoles.has(givenRole.id)){
response="Only the verified Super Fan Lounge Access and Level 50 Lounge Access roles can be managed through this recovered command. No change was made.";
}else if(user.bot||user.id===i.guild.ownerId||user.id===A){
response="That account cannot be changed through this limited access-role command.";
}else{
const current=await i.guild.channels.fetch(i.channelId).catch(()=>null);
if(!current||![11,12].includes(current.type)||current.parentId!==CASE_FORUM){
response="For access-control security, use /role inside a moderator-only Case Review thread. No change was made.";
}else{
const[staff,category,role,moderatorMember,subject,botMember]=await Promise.all([
caseApi("GET","/channels/"+CASE_FORUM),
caseApi("GET","/channels/"+CASE_CATEGORY),
i.guild.roles.fetch(givenRole.id).catch(()=>null),
i.guild.members.fetch(i.user.id).catch(()=>null),
i.guild.members.fetch(user.id).catch(()=>null),
i.guild.members.fetchMe().catch(()=>null)
]);
const restricted=staff?.id===CASE_FORUM&&staff.parent_id===CASE_CATEGORY&&staff.type===15&&
caseForumSafe(staff)&&caseForumSafe(category);
const privileged=[PermissionFlagsBits.Administrator,PermissionFlagsBits.ManageGuild,
PermissionFlagsBits.ManageRoles,PermissionFlagsBits.ManageChannels,
PermissionFlagsBits.BanMembers,PermissionFlagsBits.KickMembers,PermissionFlagsBits.ModerateMembers];
const expected=allowedAccessRoles.get(givenRole.id);
if(!restricted||!role||role.managed||!role.name?.normalize("NFKC").toLowerCase().includes(expected)||
privileged.some(p=>role.permissions.has(p))||
!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)||!moderatorMember||
role.position>=botMember?.roles?.highest?.position||
(!i.guild.ownerId||i.user.id!==i.guild.ownerId)&&role.position>=moderatorMember?.roles?.highest?.position||
!subject||subject.id===i.guild.ownerId){
response="The role, target member, hierarchy, or staff privacy could not be verified. No role was changed.";
}else{
const present=subject.roles.cache.has(role.id);
if((action==="add"&&present)||(action==="remove"&&!present)){
response="That access role is already "+(present?"assigned":"absent")+". No change was needed.";
}else{
const reason="Authorized /role "+action+" by "+i.user.id;
if(action==="add")await subject.roles.add(role,reason);
else await subject.roles.remove(role,reason);
const verified=await i.guild.members.fetch({user:user.id,force:true});
if(verified.roles.cache.has(role.id)!==(action==="add"))throw Error("Access-role update could not be confirmed");
response="✅ Access role "+(action==="add"?"assigned":"removed")+
" for "+sanitized(user.username,60)+": "+sanitized(role.name,80)+
". No other roles or permissions were changed.";
log("lounge_access_role_changed",{action,manual:true,restrictedRole:true});
}
}
}
}
}else if(cmd==="warn"){
const target=i.options.getUser("user");
const reason=sanitized(i.options.getString("reason"),800);
if(!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)){
response="Issuing a warning requires Moderate Members permission. No warning was created.";
}else if(!target||target.bot||target.id===i.user.id||target.id===i.guild.ownerId||reason.length<5){
response="The warning target or reason is invalid. No warning was created.";
}else{
const current=await i.guild.channels.fetch(i.channelId).catch(()=>null);
const inStaffForum=!!current&&[11,12].includes(current.type)&&current.parentId===CASE_FORUM;
if(!inStaffForum){
response="For privacy, use /warn inside a staff-only Case Review thread. No warning was created.";
}else{
const[moderatorMember,targetMember,me]=await Promise.all([
i.guild.members.fetch(i.user.id).catch(()=>null),
i.guild.members.fetch(target.id).catch(()=>null),
i.guild.members.fetchMe().catch(()=>null)
]);
if(!moderatorMember||!targetMember||!me||
targetMember.id===i.guild.ownerId||
targetMember.roles.highest.comparePositionTo(moderatorMember.roles.highest)>=0||
targetMember.roles.highest.comparePositionTo(me.roles.highest)>=0){
response="The target is unavailable or is not below both the moderator and bot in role hierarchy. No warning was created.";
}else{
const[forum,cat]=await Promise.all([
caseApi("GET","/channels/"+CASE_FORUM),
caseApi("GET","/channels/"+CASE_CATEGORY)
]);
if(forum.id!==CASE_FORUM||forum.parent_id!==CASE_CATEGORY||forum.type!==15||
!caseForumSafe(forum)||!caseForumSafe(cat))throw Error("Case Review privacy verification failed");
const content="## 🔒 Confidential Moderation Warning\n"+
"**Warning subject:** <@"+target.id+">\n"+
"**Issued by:** <@"+i.user.id+">\n"+
"**Reason:** "+reason+"\n"+
"**Interaction Reference:** "+i.id+
"\n\n-# Staff-only warning record • No automatic punishment or escalation";
const created=await caseApi("POST","/channels/"+CASE_FORUM+"/threads",{
name:"Moderation Warning • "+new Date().toISOString().slice(0,10)+" • "+i.id.slice(-6),
auto_archive_duration:1440,
message:{content,allowed_mentions:quietMentions}
});
if(!/^\d{17,22}$/.test(String(created.id||""))||created.parent_id!==CASE_FORUM)throw Error("Warning case creation could not be verified");
let dmSent=false;
try{
await target.send({content:"You received a moderation warning in **Momentum Movement**.\nReason: "+
reason+"\nThis notice does not automatically impose a timeout, kick, or ban. Contact the moderation team if you have questions.",
allowedMentions:noPing});
dmSent=true;
}catch{}
response="A private staff warning record was created for the selected member."+
(dmSent?" The member was notified by DM.":" The member could not be notified by DM; the staff record remains available.")+
" No timeout, kick, or ban occurred.";
log("moderation_warning_logged",{userInitiated:true,staffForum:true,dmDelivered:dmSent});
}
}
}
}else if(cmd==="closecase"){
const thread=await i.guild.channels.fetch(i.channelId).catch(()=>null);
const isStaff=i.memberPermissions?.has(PermissionFlagsBits.ManageThreads)||
i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
if(!isStaff){
response="Only authorized staff can close Case Review threads. Nothing was archived.";
}else if(!thread||![11,12].includes(thread.type)||thread.parentId!==CASE_FORUM||thread.guildId!==G){
response="This command closes only bot-created support/report threads inside the private Case Review forum. Nothing was archived.";
}else{
const me=await i.guild.members.fetchMe().catch(()=>null);
if(!me||!thread.permissionsFor(me)?.has(PermissionFlagsBits.ManageThreads)){
response="The bot cannot safely archive this thread with its current permissions. Nothing was changed.";
}else{
const[forum,parent]=await Promise.all([
caseApi("GET","/channels/"+CASE_FORUM),
caseApi("GET","/channels/"+CASE_CATEGORY)
]);
if(forum.id!==CASE_FORUM||forum.parent_id!==CASE_CATEGORY||forum.type!==15||
!caseForumSafe(forum)||!caseForumSafe(parent))throw Error("Case Review privacy settings changed; refusing archive");
const first=await thread.fetchStarterMessage().catch(()=>null);
const content=String(first?.content||"");
const known=(content.startsWith("## 🔒 Private Support Request")||
content.startsWith("## 🔒 Confidential Member Report"))&&
/\*\*Case Reference:\*\* \d{17,22}/.test(content);
if(first?.author?.id!==A||!known){
response="This thread is not a verified Bot 005 support/report case. Nothing was archived.";
}else if(thread.archived){
response="This private case is already archived. No change was needed.";
}else{
const note=sanitized(i.options.getString("reason")||"Case reviewed by authorized staff",120);
const updated=await thread.setArchived(true,"Authorized /closecase by "+i.user.id+" · "+note);
if(updated.id!==thread.id||!updated.archived)throw Error("Case archive could not be verified");
response="✅ Verified private case archived: "+thread.name+
"\nCase ID: "+thread.id+
"\nNo member content, other threads, or permissions were changed.";
log("private_case_archived",{userInitiated:true,verifiedOwner:true,privateForum:true});
}
}
}
}else if(cmd==="eventcreate"){
const isManager=i.memberPermissions?.has(PermissionFlagsBits.ManageEvents);
if(!isManager){
response="Creating events requires Manage Events permission. Nothing was scheduled.";
}else{
const name=sanitized(i.options.getString("title"),100);
const rawDate=String(i.options.getString("starts")||"").trim();
const duration=i.options.getInteger("minutes");
const location=sanitized(i.options.getString("location"),100);
const validDate=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i.test(rawDate);
const startMs=validDate?Date.parse(rawDate):NaN;
const validStart=Number.isFinite(startMs)&&startMs>=Date.now()+60000&&startMs<=Date.now()+366*86400000;
if(!name||name.length<3||!location||!Number.isInteger(duration)||duration<5||duration>1440||!validStart){
response="Event not created. Provide a title, explicit ISO date/time with a UTC offset, duration (5–1440 minutes), and location. Start must be 1 minute to 366 days ahead.";
}else{
const me=await i.guild.members.fetchMe().catch(()=>null);
if(!me?.permissions?.has(PermissionFlagsBits.ManageEvents)){
response="The bot does not currently have Manage Events permission. Nothing was scheduled.";
}else{
const current=await i.guild.scheduledEvents.fetch();
const duplicate=[...current.values()].find(x=>
(x.status===1||x.status===2)&&
x.name?.toLowerCase()===name.toLowerCase()&&
Math.abs((x.scheduledStartTimestamp||0)-startMs)<60000
);
if(duplicate){
response="An event with this title and start time already exists (ID: "+duplicate.id+"). Nothing new was created.";
}else{
const entry=await i.guild.scheduledEvents.create({
name,scheduledStartTime:new Date(startMs),scheduledEndTime:new Date(startMs+duration*60000),
privacyLevel:GuildScheduledEventPrivacyLevel.GuildOnly,
entityType:GuildScheduledEventEntityType.External,
entityMetadata:{location},
reason:"Authorized /eventcreate by "+i.user.id
});
if(!entry||entry.guildId!==G||entry.name!==name)throw Error("Event creation readback was inconsistent");
response="✅ Server event created: "+entry.name+
"\nStarts: <t:"+Math.floor(startMs/1000)+":F> (your local time)"+
"\nDuration: "+duration+" minutes"+
"\nLocation: "+location+
"\nEvent ID: "+entry.id+
"\nNo @everyone or role mentions were sent.";
log("scheduled_event_created",{userInitiated:true,verifiedGuild:true});
}
}
}
}
}else if(cmd==="slowmode"){
const seconds=i.options.getInteger("seconds");
if(!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels)){
response="Slowmode changes require Manage Channels permission. No settings were changed.";
}else if(!Number.isInteger(seconds)||seconds<0||seconds>21600){
response="Slowmode must be a whole number from 0 through 21600 seconds. No change was made.";
}else{
const channel=await i.guild.channels.fetch(i.channelId).catch(()=>null);
const me=await i.guild.members.fetchMe().catch(()=>null);
if(!channel||channel.guildId!==G||![0,5].includes(channel.type)||typeof channel.setRateLimitPerUser!=="function"||
!me||!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)){
response="This command only changes slowmode in its current text/announcement channel when the bot has Manage Channels permission. No changes were made.";
}else if(channel.rateLimitPerUser===seconds){
response="Slowmode is already "+seconds+" seconds in <#"+channel.id+">. No change was necessary.";
}else{
const before=channel.rateLimitPerUser??0;
const updated=await channel.setRateLimitPerUser(seconds,"Explicit /slowmode requested by "+i.user.id);
if(updated.id!==channel.id||updated.rateLimitPerUser!==seconds)throw Error("Slowmode update could not be verified");
response="✅ Slowmode updated in <#"+channel.id+">: "+before+" → "+seconds+" seconds. No other channel or permission settings changed.";
log("slowmode_changed",{userInitiated:true,previous:before,next:seconds});
}
}
}else if(cmd==="announce"){
if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){
response="Announcements require Manage Server permission. Nothing was posted.";
}else{
const raw=i.options.getChannel("channel");
const title=sanitized(i.options.getString("title"),220);
const description=sanitized(i.options.getString("message"),3500);
if(!raw||!raw.id||!title||!description){
response="A destination, title and announcement message are required. Nothing was posted.";
}else{
const target=await i.guild.channels.fetch(raw.id).catch(()=>null);
const self=await i.guild.members.fetchMe().catch(()=>null);
if(!target||target.guildId!==G||![0,5].includes(target.type)||
!target.permissionsFor?.(self)?.has(PermissionFlagsBits.SendMessages)||
!target.permissionsFor?.(self)?.has(PermissionFlagsBits.EmbedLinks)){
response="The selected text channel is unavailable or the bot lacks Send Messages/Embed Links permission. Nothing was posted.";
}else{
const announcement={embeds:[{title,description,color:0x4070A0}],allowedMentions:noPing,...(Bun.env.SILENT_BUILD_MODE==="true"?{flags:4096}:{})};
if(target.id===i.channelId){
await i.editReply(announcement);
commandsResponded++;
log("announcement_published",{sameChannel:true,memberInitiated:true});
return;
}
await target.send(announcement);
response="The announcement was posted in <#"+target.id+">. No role-wide or everyone mentions were sent.";
log("announcement_published",{sameChannel:false,memberInitiated:true});
}
}
}
}else if(cmd==="poll"){
const question=sanitized(i.options.getString("question"),240);
const choices=["first","second","third","fourth"].map(n=>sanitized(i.options.getString(n),140)).filter(Boolean);
const normalized=new Set(choices.map(x=>x.toLowerCase()));
if(!question||choices.length<2||normalized.size!==choices.length){
response="The poll needs a question and at least two distinct answers. Nothing was published.";
}else if(!i.appPermissions?.has(PermissionFlagsBits.AddReactions)||
!i.appPermissions?.has(PermissionFlagsBits.ReadMessageHistory)){
response="The bot needs Add Reactions and Read Message History permissions in this channel before creating a poll. Nothing was published.";
}else{
pollEmojis=["1️⃣","2️⃣","3️⃣","4️⃣"].slice(0,choices.length);
response="**📊 "+question+"**\n\n"+
choices.map((x,n)=>pollEmojis[n]+" "+x).join("\n")+
"\n\nReact with the number of your preferred answer. No @everyone or role mentions.";
}
}else if(cmd==="report"||cmd==="support"){
try{response=await createPrivateIntake(i,cmd)}
catch(error){
log("private_intake_failed",{kind:cmd,reason:error instanceof Error?sanitized(error.message,90):"unknown"});
response="Your private request could not be delivered. No public details were posted; please contact a moderator.";
}
}else if(cmd==="automod"){
const action=i.options.getString("action");
if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){
response="AutoMod checks require Manage Server permission. No changes were made.";
}else if(action==="enable"||action==="disable"){
const bot=await i.guild.members.fetchMe().catch(()=>null);
if(!bot?.permissions.has(PermissionFlagsBits.ManageGuild)){
response="Bot lacks Manage Server permission. No AutoMod rules changed.";
}else{
const desired=action==="enable";
const rules=await i.guild.autoModerationRules.fetch();
const managed=[...rules.values()].filter(r=>/^(blickymania|momentum movement|dawn dotta)/i.test(r.name||""));
const different=managed.filter(r=>r.enabled!==desired);
if(!managed.length){
response="No explicitly labeled Momentum Movement/Blickymania AutoMod rules found. Other rules will not be changed.";
}else if(!different.length){
response="All "+managed.length+" managed rules already match this setting. Nothing changed.";
}else{
stagedConfirmation=planChange(i,"automod",{
rules:managed.map(r=>({id:r.id,name:r.name,enabled:r.enabled})),enabled:desired
},"Confirm managed AutoMod rules");
response="**AutoMod changes — confirmation required**\n"+
"Managed rules found: "+managed.length+"\n"+
"Rules to change: "+different.length+"\n"+
"Desired state: "+(desired?"Enabled":"Disabled")+
"\nOther administrator-created rules will be preserved."+
"\n\nConfirm within two minutes or Cancel. No rules have changed.";
}
}
}else{
try{
const rules=await i.guild.autoModerationRules.fetch();
const current=[...rules.values()];
const report="**Momentum Movement — AutoMod Status (read only)**\n"+
"Rules found: "+current.length+"\nEnabled: "+current.filter(x=>x.enabled).length+"\nDisabled: "+current.filter(x=>!x.enabled).length+"\n"+
current.slice(0,10).map(x=>"• "+safeText(x.name,70)+" — "+(x.enabled?"Enabled":"Disabled")).join("\n")+
"\n\nNo AutoMod rules or Discord settings were changed.";
try{
await i.user.send({content:report.slice(0,1900),allowedMentions:noPing});
response="AutoMod status was sent privately to your DMs. No rules were changed.";
}catch{
response="I couldn't send the private AutoMod status to your DMs. No rules were changed.";
}
}catch{
response="AutoMod status could not be retrieved using current bot permissions. No rules were changed.";
}
}
}else if(cmd==="audit"){
if(!i.memberPermissions?.has(PermissionFlagsBits.ViewAuditLog)){
response="This audit command requires the Discord View Audit Log permission. Nothing was disclosed.";
}else{
try{
const record=await i.guild.fetchAuditLogs({limit:8});
const rows=[...record.entries.values()].map(x=>{
const time=x.createdAt?.toISOString().replace("T"," ").slice(0,19)+" UTC";
return"• "+safeText(time,40)+" · Action "+safeText(x.action,40)+" · Actor "+safeText(x.executor?.username||"unknown",60);
});
if(!rows.length)response="No recent audit-log entries were returned.";
else{
try{
await i.user.send({content:"**Momentum Movement — Recent Discord Audit Log (Staff Only)**\n"+rows.join("\n"),allowedMentions:noPing});
response="The latest "+rows.length+" audit-log entries were delivered to your Discord DMs. No details were posted publicly.";
}catch{
response="I couldn't deliver the private audit report to your DMs. Enable DMs for this server, then retry. No audit details were posted publicly.";
}
}
}catch{response="Audit entries could not be retrieved with the current bot permissions. No changes were made.";}
}
}else if(cmd==="statsstatus"){
try{
const channel=await i.guild.channels.fetch("1566030504635924600");
if(!channel||channel.guild.id!==G||channel.type!==2)throw Error("Invalid stats target");
response="**Momentum Movement — Verified Statistics**\n"+
"LIVE display: "+safeText(channel.name,120)+"\n"+
"Member and role counts update through the independent Community Stats Sync.\n"+
"TikTok coin and diamond totals are withheld until creator-confirmed values are available.";
}catch{response="The verified statistics display is temporarily unavailable. No values were invented.";}
}else if(cmd==="server"||cmd==="dashboard"){
const g=i.guild;
response="**Momentum Movement**\nMembers: "+(g?.memberCount??"unavailable")+"\nOwner's server: verified.\nCommunity Stats and LIVE services operate independently.";
}else if(cmd==="member"){
const u=i.options.getUser("user")||i.user;const m=await i.guild.members.fetch(u.id).catch(()=>null);
response="**Member**: "+safeText(u.username,120)+"\nJoined: "+(m?.joinedAt?.toISOString().slice(0,10)||"not available")+"\nBot account: "+(u.bot?"Yes":"No");
}else if(cmd==="events"){
const list=await i.guild.scheduledEvents.fetch().catch(()=>null);
const events=list?[...list.values()].filter(x=>[1,2].includes(Number(x.status))).slice(0,8):[];
response=events.length?"**Server events**\n"+events.map(x=>"• "+safeText(x.name,70)+" — "+(x.scheduledStartAt?.toISOString()||"TBD")).join("\n"):"No scheduled server events were returned.";
}else if(cmd==="rules"){
const chans=await i.guild.channels.fetch();const match=[...chans.values()].find(c=>c&&c.type===0&&/rules|guidelines/.test(c.name?.normalize("NFKC").toLowerCase()));
response=match?"Community rules: <#"+match.id+">":"The rules channel was not found automatically. No channel was created.";
}else if(cmd==="tiktok"){
const url=tiktok();
response=url?"Official TikTok profile: "+url:"Official TikTok URL is not configured in Momentum Movement's Railway variables.";
}else if(cmd==="botconfig"){
response="**Readiness**\nGuild and application verified · Gateway connected · 36 command handlers installed.\nSensitive operations have permission and confirmation controls. End-to-end member interactions are not yet fully tested.\nNo secrets, tokens, or other communities are exposed.";
}else if(cmd==="forum-admin"){
const sub=i.options.getSubcommand(false);
if(!moderator(i))response="Forum administration checks require Manage Server permission.";
else if(sub==="diagnose"){
const chans=await i.guild.channels.fetch();const count=[...chans.values()].filter(c=>c?.type===15).length;
response="**Read-only forum diagnosis**\nForums found: "+count+". No settings or threads changed.";
}else if(sub==="inspect"){
const ch=i.options.getChannel("forum");
response=ch?.type===15?"Forum: "+safeText(ch.name)+"\nAvailable tags: "+(ch.availableTags||[]).map(t=>safeText(t.name,65)).join(", ").slice(0,700):"Selected channel is not a forum.";
}else if(sub==="thread"){
const id=i.options.getString("thread_id");
const ch=id&&/^\d{17,22}$/.test(id)?await i.guild.channels.fetch(id).catch(()=>null):null;
response=ch?"Thread: "+safeText(ch.name)+"\nArchived: "+(ch.archived?"Yes":"No"):"No matching thread found.";
}else if(["rename","tag","pin","unpin"].includes(sub)){
const id=i.options.getString("thread_id");
const thread=id&&/^\d{17,22}$/.test(id)?await i.guild.channels.fetch(id).catch(()=>null):null;
if(!thread||thread.guildId!==G||![11,12].includes(thread.type)){
response="Select an existing forum discussion in Momentum Movement. No changes were made.";
}else{
const forum=await i.guild.channels.fetch(thread.parentId).catch(()=>null);
const bot=await i.guild.members.fetchMe().catch(()=>null);
if(!forum||forum.type!==15||!i.memberPermissions?.has(PermissionFlagsBits.ManageThreads)||
!bot?.permissions.has(PermissionFlagsBits.ManageThreads)){
response="Both staff member and bot need Manage Threads permission. Nothing was changed.";
}else{
const raw=await caseApi("GET","/channels/"+thread.id);
const payload={action:sub,threadId:thread.id,forumId:forum.id,before:thread.name,
beforeTags:raw.applied_tags||[],beforeFlags:Number(raw.flags||0)};
if(sub==="rename"){
const title=sanitized(i.options.getString("title"),100);
if(title.length<3||title===thread.name){
response="Enter a different title of at least three characters. Nothing changed.";
}else payload.title=title;
}else if(sub==="tag"){
const mode=i.options.getString("action");
const requested=i.options.getString("tag_name")||"";
const matches=(forum.availableTags||[]).filter(t=>t.name.toLowerCase()===requested.toLowerCase());
if(!["add","remove"].includes(mode)||matches.length!==1){
response="Choose one existing forum tag and a valid add/remove action. Nothing changed.";
}else{
payload.mode=mode;payload.tagId=matches[0].id;payload.tagName=matches[0].name;
const assigned=payload.beforeTags.includes(payload.tagId);
if((mode==="add"&&assigned)||(mode==="remove"&&!assigned)){
response="The existing tag already matches the requested state. Nothing changed.";
}
}
}else if((sub==="pin"&&!!(payload.beforeFlags&2))||
(sub==="unpin"&&!(payload.beforeFlags&2))){
response="The pinned state is already correct. Nothing changed.";
}
if(!response){
stagedConfirmation=planChange(i,"forum",payload,"Confirm forum action");
response="**Forum change — confirmation required**\n"+
"Forum: "+sanitized(forum.name,100)+"\n"+
"Thread: "+sanitized(thread.name,100)+"\n"+
"Action: "+sub+
(sub==="rename"?"\nNew title: "+payload.title:"")+
(sub==="tag"?"\nExisting tag: "+payload.tagName+" ("+payload.mode+")":"")+
"\nNo forum or member content will be deleted."+
"\n\nConfirm within two minutes or Cancel.";
}
}
}
}else response="Unknown forum operation. No changes were made.";
}
if(!response)response="This command is being reconstructed safely. No changes were made.";
const token=stagedConfirmation?crypto.randomUUID().replace(/-/g,"").slice(0,14):null;
const components=stagedConfirmation?[{type:1,components:[
{type:2,style:3,label:"Confirm",custom_id:"mm005:confirm:"+token},
{type:2,style:4,label:"Cancel",custom_id:"mm005:cancel:"+token}
]}]:[];
const sent=await i.editReply({content:response.slice(0,1900),components,allowedMentions:noPing});
if(stagedConfirmation)confirmationPlans.set(token,{...stagedConfirmation,messageId:sent.id});
if(pollEmojis.length){
let added=0;
for(const emoji of pollEmojis){
try{await sent.react(emoji);added++}catch{break}
}
if(added!==pollEmojis.length){
await i.editReply({content:(response+"\n\n⚠️ Reaction setup was incomplete; contact a moderator before treating the results as valid.").slice(0,1900),allowedMentions:noPing}).catch(()=>{});
log("poll_reactions_incomplete",{expected:pollEmojis.length,added});
}else log("poll_published",{optionCount:pollEmojis.length,memberInitiated:true});
}
commandsResponded++;
}catch(err){
lastError=err instanceof Error?err.name:"interaction_error";
log("interaction_error",{command:cmd,kind:lastError});
if(i.deferred&&!i.replied)await i.editReply({content:"This request encountered an error. Its final outcome may need staff review; please do not retry an action that changes Discord until its current state has been checked.",allowedMentions:noPing}).catch(()=>{});
else if(!i.replied)await i.reply({content:"This request encountered an error. Its final outcome may need staff review; please do not retry an action that changes Discord until its current state has been checked.",allowedMentions:noPing}).catch(()=>{});
}
});
const momentumHttpHandler=(req)=>{
const path=new URL(req.url).pathname;
if(path==="/_internal/stats-presences"){
if(req.method!=="GET"||req.headers.get("authorization")!=="Bot "+token||req.headers.get("x-guild-id")!==G)
return Response.json({error:"forbidden"},{status:403});
const g=client.guilds.cache.get(G);
if(!presenceIntentGranted||!ready||!guildVerified||!g)
return Response.json({guild:G,verified:false,reason:!presenceIntentGranted?"intent-disabled":"gateway-not-ready"},{status:503});
const values={online:0,idle:0,dnd:0};let unexpected=0;
for(const presence of g.presences.cache.values()){
if(presence.status==="online")values.online++;
else if(presence.status==="idle")values.idle++;
else if(presence.status==="dnd")values.dnd++;
else if(presence.status==="offline"||presence.status==="invisible"){}
else unexpected++;
}
return Response.json({guild:G,verified:unexpected===0,asOf:new Date().toISOString(),...values,unexpected,presences:[...g.presences.cache.values()].filter(x=>["online","idle","dnd"].includes(x.status)).map(x=>({id:x.userId,status:x.status}))},{headers:{"cache-control":"no-store"}});
}
if(path==="/healthz")return Response.json({service:"Blickymania Bot 005",community:"Momentum Movement",gatewayReady:ready,guildVerified,readOnly,writeScope:"all_36_handlers_with_confirmations_including_forum_and_automod",commandRegistryExecutor:true,rulesAcceptanceReady,supportedRecoveredCommands:SAFE.size,originalFeatureParity:false,commandsResponded,uptimeSeconds:Math.floor((Date.now()-started)/1000),errorKind:lastError},{status:ready&&guildVerified?200:503});
return Response.json({error:"not-found"},{status:404});
};
Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||8080),fetch:momentumHttpHandler});
Bun.serve({hostname:"::",port:8081,fetch:momentumHttpHandler});
const gatewayStart = await preparedGatewayOwner.start();
if(!gatewayStart?.ok)throw Error("Bot 005 lease unavailable; Gateway login was not attempted");
try {
  await preparedGatewayOwner.waitUntilReady(30000);
} catch (error) {
  await preparedGatewayOwner.shutdown("application_readiness_failed");
  throw error;
}