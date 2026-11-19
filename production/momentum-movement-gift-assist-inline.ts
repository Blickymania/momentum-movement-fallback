// Production source snapshot for Railway deployment 292d6528-60f5-4ca9-9e97-6d0714689114
// Scope: Dawn Dotta / Momentum Movement Gift Assist only.
// Keep this file synchronized with the Railway production service.
import {ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder,LabelBuilder,StringSelectMenuBuilder} from "discord.js@14.27.0";
import {createHmac,timingSafeEqual} from "node:crypto";
const C={guild:"1565048205970767992",app:"1565304619838742598",owner:"1276370255152812045",pub:"1566526253220110517",dash:"1566526255623446558",queue:"1566526251571617976",mod:"1565407676580499616",admin:"1565547110944735272"};
const TOKEN=String(Bun.env.DISCORD_BOT_TOKEN||"").trim();
const LINK_SECRET=String(Bun.env.GIFT_ASSIST_LINK_SIGNING_SECRET||"");
const RECEIVER_LABEL=String(Bun.env.GIFT_ASSIST_RECEIVER_LABEL||"").trim();
const RECEIVER_ENTITY=String(Bun.env.GIFT_ASSIST_RECEIVER_LEGAL_ENTITY||"").trim();
const PAYPAL_READY=Bun.env.GIFT_ASSIST_PAYPAL_CHECKOUT_ENABLED==="true"&&!!Bun.env.GIFT_ASSIST_PAYPAL_CLIENT_ID&&!!Bun.env.GIFT_ASSIST_PAYPAL_CLIENT_SECRET&&!!Bun.env.GIFT_ASSIST_PAYPAL_WEBHOOK_ID;
const STRIPE_READY=Bun.env.GIFT_ASSIST_STRIPE_ENABLED==="true"&&Bun.env.GIFT_ASSIST_STRIPE_CARD_ENABLED==="true"&&!!Bun.env.GIFT_ASSIST_STRIPE_SECRET_KEY&&!!Bun.env.GIFT_ASSIST_STRIPE_PUBLISHABLE_KEY&&!!Bun.env.GIFT_ASSIST_STRIPE_WEBHOOK_SECRET;
const POLICY_READY=!!RECEIVER_LABEL&&!!RECEIVER_ENTITY&&!!Bun.env.GIFT_ASSIST_RECEIVER_BUSINESS_TYPE&&!!Bun.env.GIFT_ASSIST_TERMS_URL&&!!Bun.env.GIFT_ASSIST_REFUND_POLICY_URL&&!!Bun.env.GIFT_ASSIST_UNUSED_FUNDS_POLICY_URL;
const PAYMENTS_ENABLED=Bun.env.GIFT_ASSIST_PAYMENTS_ENABLED==="true"&&Bun.env.GIFT_ASSIST_WEBHOOKS_ENABLED==="true"&&!!LINK_SECRET&&POLICY_READY&&(PAYPAL_READY||STRIPE_READY);
const PAYPAL_ON=PAYMENTS_ENABLED&&PAYPAL_READY;
const STRIPE_ON=PAYMENTS_ENABLED&&STRIPE_READY;
const VENMO_ON=PAYPAL_ON&&Bun.env.GIFT_ASSIST_PAYPAL_VENMO_ENABLED==="true";
const STRIPE_CASHAPP_ON=STRIPE_ON&&Bun.env.GIFT_ASSIST_STRIPE_CASHPAY_ENABLED==="true";
const CHECKOUT_BASE=String(Bun.env.GIFT_ASSIST_CHECKOUT_BASE_URL||"https://momentum-movement-gift-assist-production.up.railway.app").replace(/\/$/,"");
const CURRENCY="USD";
const SYNC_SECRET=String(Bun.env.GIFT_ASSIST_INTERNAL_SECRET||"");
const GIFT_API=String(Bun.env.GIFT_ASSIST_API_BASE_URL||"").replace(/[/]+$/,"");if(!GIFT_API.startsWith("http://gift-assist-api.railway.internal:"))throw new Error("Gift Assist API must use its dedicated private endpoint");
async function syncApi(path,body){
 if(!SYNC_SECRET)throw Error("Gift Assist sync is not configured");
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetch(GIFT_API+path,{method:body?"POST":"GET",headers:{"content-type":"application/json","x-gift-assist-sync":SYNC_SECRET},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
   if(response.ok)return response.json();
   if(response.status<500||attempt===2)throw Error("Gift Assist API "+response.status+" "+path);
  }catch(error){if(attempt===2||/API 4\d\d /.test(String(error.message)))throw error}
  await Bun.sleep(500*(attempt+1));
 }
 throw Error("Gift Assist API retry exhausted");
}
function syncCase(messageId,data,historical=false){
 return syncApi("/internal/gift-assist/case-sync",{...data,caseRef:data.ref,messageId,historical});
}
async function importCases(){
 let before="", count=0;
 while(true){
  const messages=await rest("GET","/channels/"+C.queue+"/messages?limit=100"+(before?"&before="+before:""));
  for(const message of messages){
   if(message.author?.id!==C.app)continue;
   const data=parseCase(message);
   if(data){await syncCase(message.id,data);count++}
  }
  if(messages.length<100)break;
  before=messages.at(-1).id;
 }
 const health=await syncApi("/gift-assist/health");
 log("case-import-verified",{scannedCases:count,schema:health.schema,databaseCases:health.cases,ledgerEntries:health.entries,manualDestinations:health.destinations,apiAuth:health.apiAuth});
}
async function resumePendingNotifications(){
 const rows=await syncApi("/internal/gift-assist/notifications");
 for(const row of rows){
  const result=await syncApi("/internal/gift-assist/notifications/deliver",{id:row.id});
  if(!result.ok)break;
 }
}
const caseUpdates=new Map();
async function applyCaseNotification(payload){
 const previous=caseUpdates.get(payload.caseRef)||Promise.resolve();
 const update=previous.catch(()=>{}).then(async()=>{
  const current=await syncApi("/internal/gift-assist/case-state",{caseRef:payload.caseRef,requesterId:payload.requesterId});
  const {message,data}=await findCase(payload.caseRef);
  if(data.requesterId!==payload.requesterId)throw Error("Case requester mismatch");
  Object.assign(data,current);
  await saveCase(message,data,false);
 });
 caseUpdates.set(payload.caseRef,update);
 try{await update}finally{if(caseUpdates.get(payload.caseRef)===update)caseUpdates.delete(payload.caseRef)}
}
const SAFE={parse:[],users:[],roles:[],replied_user:false};
let ready=false,lastError="";
const requestDrafts=new Map();
const requestTimezones=[
 {label:"Eastern Time — New York",value:"America/New_York"},{label:"Central Time — Chicago",value:"America/Chicago"},{label:"Mountain Time — Denver",value:"America/Denver"},{label:"Pacific Time — Los Angeles",value:"America/Los_Angeles"},{label:"Arizona — Phoenix",value:"America/Phoenix"},{label:"Alaska — Anchorage",value:"America/Anchorage"},{label:"Hawaii — Honolulu",value:"Pacific/Honolulu"},{label:"UTC",value:"Etc/UTC"},{label:"Toronto",value:"America/Toronto"},{label:"Vancouver",value:"America/Vancouver"},{label:"Winnipeg",value:"America/Winnipeg"},{label:"Mexico City",value:"America/Mexico_City"},{label:"São Paulo",value:"America/Sao_Paulo"},{label:"London",value:"Europe/London"},{label:"Paris",value:"Europe/Paris"},{label:"Berlin",value:"Europe/Berlin"},{label:"Athens",value:"Europe/Athens"},{label:"Istanbul",value:"Europe/Istanbul"},{label:"Moscow",value:"Europe/Moscow"},{label:"Dubai",value:"Asia/Dubai"},{label:"Kolkata",value:"Asia/Kolkata"},{label:"Bangkok",value:"Asia/Bangkok"},{label:"Singapore",value:"Asia/Singapore"},{label:"Tokyo",value:"Asia/Tokyo"},{label:"Sydney",value:"Australia/Sydney"}
];
const requestGoals=["TikTok LIVE gift support","LIVE goal or milestone","Battle or event support","Creator celebration or special occasion","Creator equipment or production support","Community appreciation","Other — add details"];
const budgetTiers=[{key:"low",label:"$25–$500 ($25 steps)"},{key:"mid",label:"$600–$1,000 ($100 steps)"},{key:"high",label:"$1,500–$5,000 ($500 steps)"}];
let minimumBudgetCents=2500,minimumBudgetMessageId="";
function clean(v,max=500){return String(v??"").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g," ").replace(/@(everyone|here)/gi,"@\u200b$1").replace(/\s+/g," ").trim().slice(0,max)}
function log(event,details={}){console.log(JSON.stringify({event:"gift-assist-"+event,guild:C.guild,...details}))}
async function rest(method,path,body){
 for(let n=0;n<3;n++){
  const r=await fetch("https://discord.com/api/v10"+path,{method,headers:{Authorization:"Bot "+TOKEN,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  const d=r.status===204?{}:await r.json().catch(()=>({}));
  if(r.status===429){if(n===2)throw Error("Discord rate limited");await Bun.sleep(Math.min(18000,Math.ceil(Number(d.retry_after||2)*1000)+300));continue}
  if(!r.ok)throw Error("Discord "+method+" "+r.status+" "+path.split("?")[0]);
  return d;
 }
 throw Error("Discord retry exhausted");
}
function input(id,label,style,required,max){return new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max))}
function selectLabel(id,label,placeholder,options){
 const menu=new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1).setRequired(true).addOptions(options);
 return new LabelBuilder().setLabel(label).setStringSelectMenuComponent(menu);
}
function textLabel(id,label,style,required,max,placeholder){
 const field=new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
 if(placeholder)field.setPlaceholder(placeholder);
 return new LabelBuilder().setLabel(label).setTextInputComponent(field);
}
function todayIso(){const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`}
function isoDateOptions(){const start=new Date(todayIso()+"T12:00:00Z"),out=[];for(let n=0;n<24;n++){const d=new Date(start);d.setUTCDate(d.getUTCDate()+n);const value=d.toISOString().slice(0,10),label=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"short",month:"short",day:"numeric",year:"numeric"}).format(d);out.push({label,value})}out.push({label:"Other date — enter date with year",value:"custom-date"});return out}
function timeOptions(){const out=[];for(let h=0;h<24;h++){const value=String(h).padStart(2,"0")+":00",date=new Date(`2000-01-01T${value}:00Z`);out.push({label:new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"numeric",minute:"2-digit"}).format(date),value})}out.push({label:"Other time — enter exact time",value:"custom-time"});return out}
function scheduleModal(){return new ModalBuilder().setCustomId("gift:schedule-submit").setTitle("Gift Assist Request").addLabelComponents(
 selectLabel("schedule-day","Day","Choose the weekday",["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map(x=>({label:x,value:x.toLowerCase()}))),
 selectLabel("schedule-date","Date (including year)","Choose the date",isoDateOptions()),
 selectLabel("schedule-time","Time","Choose the time",timeOptions()),
 selectLabel("schedule-zone","Timezone","Choose a timezone",requestTimezones))}
function detailsModal(draft,token){
 const fields=[];
 fields.push(draft.creatorMode==="other"?textLabel("creator-other","Creator name and @TikTok handle",TextInputStyle.Short,true,120,"Example: Creator Name @creatorhandle"):textLabel("creator-handle","Creator @TikTok handle (if known)",TextInputStyle.Short,false,80,"Example: @creatorhandle"));
 fields.push(textLabel("goal-details","Gift idea / support details",TextInputStyle.Paragraph,draft.goal==="Other — add details",450,"Add helpful context or the specific gift idea"));
 fields.push(textLabel("custom-timing","Custom date/time (if selected above)",TextInputStyle.Short,draft.date==="custom-date"||draft.time==="custom-time",40,"YYYY-MM-DD HH:MM, using the selected timezone"));
 fields.push(textLabel("budget-manual","Manual budget (if selected)",TextInputStyle.Short,draft.budgetTier==="manual",30,"USD, for example 75.00"));
 fields.push(textLabel("deadline","Deadline or other timing notes (optional)",TextInputStyle.Short,false,120,"Optional; avoid sharing private financial details"));
 return new ModalBuilder().setCustomId("gift:details-submit:"+token).setTitle("Gift Assist — Final Details").addLabelComponents(...fields);
}
function creatorOtherModal(token){return new ModalBuilder().setCustomId("gift:creator-other-submit:"+token).setTitle("Other Creator").addLabelComponents(textLabel("creator-other","Creator name and @TikTok handle",TextInputStyle.Short,true,120,"Example: Creator Name @creatorhandle"))}
function budgetSettingsModal(messageId){return new ModalBuilder().setCustomId("gift:staff:budget-setting-submit:"+messageId).setTitle("Set Minimum Gift Budget").addLabelComponents(textLabel("minimum-budget","Minimum budget in USD",TextInputStyle.Short,true,12,"25.00 to 5,000.00"))}
function moneyLabel(value){return "$"+(value/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
function budgetValues(tier){let out=[];if(tier==="low")for(let n=2500;n<=50000;n+=2500)out.push(n);if(tier==="mid")for(let n=60000;n<=100000;n+=10000)out.push(n);if(tier==="high")for(let n=150000;n<=500000;n+=50000)out.push(n);return out.filter(n=>n>=minimumBudgetCents)}
function requestPanel(draft,token){
 const rows=[{type:1,components:[{type:5,custom_id:"gift:request:creator:"+token,min_values:1,max_values:1,placeholder:"Select a Discord member as the creator"}]}];
 rows.push({type:1,components:[{type:3,custom_id:"gift:request:goal:"+token,placeholder:"Choose a gift idea or support goal",min_values:1,max_values:1,options:requestGoals.map(x=>({label:x,value:x}))}]});
 rows.push({type:1,components:[{type:3,custom_id:"gift:request:tier:"+token,placeholder:"Choose a budget range",min_values:1,max_values:1,options:[{label:"No maximum budget (optional)",value:"none"},...budgetTiers.filter(t=>budgetValues(t.key).length).map(t=>({label:t.label,value:t.key})),{label:"Enter a different amount",value:"manual"}]}]});
 if(["low","mid","high"].includes(draft.budgetTier)){const values=budgetValues(draft.budgetTier);if(values.length)rows.push({type:1,components:[{type:3,custom_id:"gift:request:amount:"+token,placeholder:"Choose the maximum budget",min_values:1,max_values:1,options:values.map(n=>({label:moneyLabel(n),value:String(n)}))}]})}
 rows.push({type:1,components:[btn("Other Creator","gift:request:other:"+token),btn("Continue Request","gift:request:continue:"+token,1)]});
 const creator=draft.creatorMode==="other"?"Other creator entered":draft.creatorId?"Discord creator selected":"Choose a creator or use Other Creator";
 const goal=draft.goal?"Gift goal selected":"Choose a gift idea or support goal";
 const budget=draft.budgetTier==="none"?"No maximum budget selected":draft.budgetCents?"Budget selected":draft.budgetTier==="manual"?"Manual budget selected; enter it in the final form":"Choose an optional maximum budget";
 const summary="**Creator:** "+creator+"\n**Gift goal:** "+goal+"\n**Budget:** "+budget;
 return {content:"",embeds:[],flags:36864,components:[{type:17,accent_color:0x18C7A5,components:[
  {type:10,content:"## 🎁 Gift Assist · Request Details\n**NATIVE DISCORD FORM · CREATOR & SUPPORT**\nChoose the creator, gift goal and budget below. The completed request is sent to the private Moderator Queue."},
  {type:14,divider:true,spacing:1},
  {type:10,content:summary},
  ...rows,
  {type:14,divider:true,spacing:1},
  {type:10,content:"-# This form stays inside Discord. No website or direct messages are used. Never enter card, bank or account credentials."}
 ]}],allowed_mentions:SAFE};
}
function requestPanelResultPayload(result){
 const duplicate=Boolean(result?.duplicate);
 const message=duplicate
  ?"## ⚠️ Existing request found\nYou already have an open Gift Assist case. Your existing request remains in the private Moderator Queue."
  :"## ✅ Gift Assist request submitted\nYour request is now in the private Moderator Queue. Any Moderator or Administrator can review it. No payment was collected.";
 return {content:"",embeds:[],flags:36864,components:[{type:17,accent_color:duplicate?0xF2B84B:0x18C7A5,components:[{type:10,content:message},{type:14,divider:true,spacing:1},{type:10,content:"-# This confirmation stays in the Gift Assist channel. No DMs or external command-center website are used."}]}],allowed_mentions:SAFE};
}
function infoModal(ref){return new ModalBuilder().setCustomId("gift:staff:info-submit:"+ref).setTitle("Request More Information").addComponents(input("question","What does the member need to clarify?",TextInputStyle.Paragraph,true,700))}
function planModal(ref){return new ModalBuilder().setCustomId("gift:staff:plan-submit:"+ref).setTitle("Propose Gift Assist Plan").addComponents(
 input("amount","Proposed contribution amount (USD)",TextInputStyle.Short,true,30),
 input("plan","What the contribution is for",TextInputStyle.Paragraph,true,650))}
function btn(label,id,style=2,disabled=false){return {type:2,style,label,custom_id:id,disabled}}
function caseButtons(ref,status){
 if(["New","Reviewing","Need Info"].includes(status)){
  const b=[];if(status!=="Reviewing")b.push(btn("Start Review","gift:staff:review:"+ref,1));
  b.push(btn("Request Info","gift:staff:need-info:"+ref),btn("Propose Plan","gift:staff:propose:"+ref,3),btn("Decline","gift:staff:decline:"+ref,4));
  return [{type:1,components:b}];
 }
 if(status==="Awaiting Member Approval")return [{type:1,components:[btn("Record Approved","gift:staff:member-approved:"+ref,3),btn("Record Declined","gift:staff:member-declined:"+ref,4),btn("Withdraw","gift:staff:withdraw:"+ref,2)]}];
 if(status==="Awaiting Payment"||status==="Payment Failed"||status==="Payment Cancelled")return [{type:1,components:[btn("Withdraw","gift:staff:withdraw:"+ref,4)]}];
 if(status==="Payment Received — Awaiting Fulfillment")return [{type:1,components:[btn("Mark Completed","gift:staff:complete:"+ref,3)]}];
 if(status==="Member Approved — Payments Off")return [{type:1,components:[btn("Complete (No Payment)","gift:staff:complete:"+ref,3),btn("Withdraw","gift:staff:withdraw:"+ref,4)]}];
 if(["Manual Verification Pending","Partially Paid"].includes(status))return [{type:1,components:[btn("Finance Review Pending","gift:staff:closed:"+ref,2,true)]}];
 return [{type:1,components:[btn("Case Closed","gift:staff:closed:"+ref,2,true)]}];
}
function renderCase(d){return [
 "🎁 **MOMENTUM MOVEMENT GIFT ASSIST — STAFF CASE**",
 "**Case Ref:** "+d.ref,"**Requester ID:** "+d.requesterId,"**Requester:** <@"+d.requesterId+">",
 "**Creator:** "+d.creator,"**Target LIVE / Date:** "+d.target,"**Gift Idea / Goal:** "+d.goal,
 "**Maximum Budget (member supplied):** "+(d.budget||"Not provided"),"**Deadline:** "+(d.deadline||"Not provided"),
 "**Status:** "+d.status,"**Proposed Amount:** "+(d.amount||"Not proposed"),"**Proposed Plan:** "+(d.plan||"Not proposed"),
 "**Payment Status:** "+(d.paymentStatus||"Not Started"),"**Payment Provider:** "+(d.paymentProvider||"Not selected"),
 "**Payment Reference:** "+(d.providerReference||"Not assigned"),"**Payment Events:** "+(d.paymentEvents||"None"),
 "**Staff Note:** "+(d.note||"None"),
 "**Payments:** "+(PAYMENTS_ENABLED?"Enabled — provider checks and owner gates passed":"OFF — no checkout links or payments; do not collect money"),
 "-# Private staff record. Never store card details, bank details, passwords, or provider credentials here."
].join("\n")}
function parseCase(m){
 const s=String(m?.content||(m?.embeds||[]).map(e=>e.description||"").join("\n"));if(!s.startsWith("🎁 **MOMENTUM MOVEMENT GIFT ASSIST — STAFF CASE**"))return null;
 function get(label){const p="**"+label+":** ";const line=s.split("\n").find(x=>x.startsWith(p));return line?line.slice(p.length):""}
 const d={ref:get("Case Ref"),requesterId:get("Requester ID"),creator:get("Creator"),target:get("Target LIVE / Date"),goal:get("Gift Idea / Goal"),budget:get("Maximum Budget (member supplied)"),deadline:get("Deadline"),status:get("Status"),amount:get("Proposed Amount"),plan:get("Proposed Plan"),paymentStatus:get("Payment Status"),paymentProvider:get("Payment Provider"),providerReference:get("Payment Reference"),paymentEvents:get("Payment Events"),note:get("Staff Note"),messageId:m.id};
 if(!/^GA-[A-Z0-9-]{8,40}$/.test(d.ref)||!/^\d{17,22}$/.test(d.requesterId))return null;return d;
}
async function queueMessages(){
 const messages=[];
 let before="";
 while(true){
  const page=await rest("GET","/channels/"+C.queue+"/messages?limit=100"+(before?"&before="+before:""));
  messages.push(...page.filter(message=>message.author?.id===C.app));
  if(page.length<100)return messages;
  before=page.at(-1).id;
 }
}
function casePayload(data){
 const text=renderCase(data);
 if(text.length>6000)throw Error("Case exceeds Discord embed limits");
 const lines=text.split("\n"),descriptions=[];
 let description="";
 for(const line of lines){
  if(description.length+line.length+1>3900){
   descriptions.push(description);
   description="";
  }
  description+=(description?"\n":"")+line;
 }
 if(description)descriptions.push(description);
 return {content:"",embeds:descriptions.map(description=>({description,color:3636720})),components:caseButtons(data.ref,data.status),allowed_mentions:SAFE};
}
async function findCase(ref){
 try{
  const location=await syncApi("/internal/gift-assist/case-location",{caseRef:ref});
  if(location.messageId){
   const message=await rest("GET","/channels/"+C.queue+"/messages/"+location.messageId),data=parseCase(message);
   if(message.author?.id===C.app&&data?.ref===ref)return {message,data};
  }
 }catch(error){log("case-location-fallback",{caseRef:ref,reason:clean(error.message,140)})}
 const messages=await queueMessages();
 const message=messages.find(item=>parseCase(item)?.ref===ref);
 if(!message)throw Error("Gift Assist case not found in private queue");
 return {message,data:parseCase(message)};
}
async function findCaseByProviderReference(provider,references){
 const values=new Set((references||[]).filter(Boolean).map(String));
 if(!values.size)throw Error("No provider reference supplied");
 const messages=await queueMessages();
 for(const m of messages){
  const d=parseCase(m);
  if(d&&d.paymentProvider===provider&&values.has(String(d.providerReference)))return {message:m,data:d};
 }
 throw Error("Provider reference does not match a Gift Assist case");
}
async function saveCase(m,d,updateDatabase=true){
 const message=await rest("PATCH","/channels/"+C.queue+"/messages/"+m.id,casePayload(d));
 if(updateDatabase)await syncCase(m.id,d).catch(e=>log("case-sync-failed",{caseRef:d.ref,reason:clean(e.message,140)}));
 return message;
}
function staff(i){
 if(i.user?.id===C.owner)return true;
 const roles=i.member?.roles?.cache?[...i.member.roles.cache.keys()]:Array.isArray(i.member?.roles)?i.member.roles:[];
 if(roles.includes(C.mod)||roles.includes(C.admin))return true;
 try{return Boolean(i.member?.permissions&&(BigInt(i.member.permissions)&8n)===8n)}catch{return false}
}
function admin(i){
 if(i.user?.id===C.owner)return true;
 const roles=i.member?.roles?.cache?[...i.member.roles.cache.keys()]:Array.isArray(i.member?.roles)?i.member.roles:[];
 if(roles.includes(C.admin))return true;
 try{return Boolean(i.member?.permissions&&(BigInt(i.member.permissions)&8n)===8n)}catch{return false}
}
function normalizeCashtag(value){
 const raw=String(value??"").normalize("NFKC").trim().replace(/^\$/,"");
 if(!/^[A-Za-z0-9]{1,20}$/.test(raw)||!/[A-Za-z]/.test(raw))throw Error("Cash App $Cashtag must contain letters/numbers and start with $");
 return "$"+raw;
}
function cashAppAddModal(messageId){
 return new ModalBuilder().setCustomId("gift:staff:cashapp:add-submit:"+messageId).setTitle("Add Cash App Recipient")
  .addLabelComponents(textLabel("cashapp-tag","Cash App $Cashtag (Admin only)",TextInputStyle.Short,true,24,"$ShamekaDDowell"));
}
function cents(v){const raw=String(v||"").replace(/[$,\s]/g,"");if(!/^\d{1,5}(?:\.\d{1,2})?$/.test(raw))return null;const n=Math.round(Number(raw)*100);return Number.isSafeInteger(n)&&n>=50&&n<=1000000?n:null}
function money(n){return "$"+(n/100).toFixed(2)}
async function verify(){
 if(!TOKEN)throw Error("DISCORD_BOT_TOKEN reference missing");
 const [me,guild,pub,q,dash]=await Promise.all([rest("GET","/users/@me"),rest("GET","/guilds/"+C.guild),rest("GET","/channels/"+C.pub),rest("GET","/channels/"+C.queue),rest("GET","/channels/"+C.pub+"/messages/"+C.dash)]);
 if(me.id!==C.app||guild.id!==C.guild||guild.owner_id!==C.owner)throw Error("Bot, guild or owner identity mismatch");
 if(pub.guild_id!==C.guild||pub.type!==0||q.guild_id!==C.guild||q.type!==0)throw Error("Gift Assist channels are not the expected text channels");
 const everyone=(q.permission_overwrites||[]).find(x=>x.id===C.guild&&Number(x.type)===0);
 const mod=(q.permission_overwrites||[]).find(x=>x.id===C.mod&&Number(x.type)===0);
 const admin=(q.permission_overwrites||[]).find(x=>x.id===C.admin&&Number(x.type)===0);
 if(!everyone||(BigInt(everyone.deny||"0")&1024n)===0n||!mod||(BigInt(mod.allow||"0")&1024n)===0n||!admin||(BigInt(admin.allow||"0")&1024n)===0n)throw Error("Queue privacy or staff visibility not verified");
 if(dash.author?.id!==C.app||dash.id!==C.dash||!JSON.stringify(dash.components||[]).includes("gift:start"))throw Error("Dashboard ownership or Start Request control not verified");
 await ensurePublicDashboard();
 await ensureBudgetManagerCard();
 ready=true;log("scope-verified",{publicChannel:C.pub,staffQueue:C.queue,dashboard:C.dash,queuePrivate:true,paymentsEnabled:PAYMENTS_ENABLED});
}
function publicDashboardPayload(view="overview"){
 const nav={type:1,components:[btn("Start Request","gift:start",3),btn("Refresh Dashboard","gift:refresh",1),btn("How It Works","gift:how",2),btn("48-Hour Policy","gift:policy",2)]};
 const overview="### Start a request\n1. Select **Start Request**. A native Discord form opens in this channel.\n2. Choose the weekday, full date (including year), time and timezone.\n3. Choose a Discord member or **Other**, then select a gift idea or support goal and an optional budget.\n4. Submit. Your completed case is routed to the private **Gift Assist Queue** for Moderator or Administrator review.\n\n**No direct messages are used.**";
 const how="### How Gift Assist works\n1. Start Request opens a native Discord form; the request stays inside this server.\n2. Choose the creator, target date/time, timezone, gift goal and optional budget.\n3. Your completed request is routed to the private Gift Assist Queue. Any Moderator or Administrator can handle it.\n4. If staff requests clarification or proposes a plan, reply in the Gift Assist channel. A moderator records the member's decision in the private case.\n\n**No DMs and no external command-center website are used.**";
 const policy="### 48-Hour Planning & Safety Policy\nSubmit at least 48 hours before the target LIVE when possible. Late requests are best-effort and are not guaranteed.\n\nSupport is voluntary. Do not borrow, feel pressured or increase your budget. A proposed plan is not a payment, booking or gift guarantee.\n\nPayment collection is OFF. Never send money to a moderator or personal account. Keep payment credentials and private account details out of Discord.";
 const detail=view==="how"?how:view==="policy"?policy:overview;
 const safeguards="### Budget & safeguards\n**Minimum optional budget:** "+moneyLabel(minimumBudgetCents)+" (moderator adjustable)\n**Budget choices:** $25 steps through $500 · $100 steps through $1,000 · $500 steps through $5,000 · custom amount.\n\n### Payment status\n**Payment collection: OFF**\nNo checkout is active. Approval does not charge you or guarantee a gift.";
 return {content:"",embeds:[],flags:36864,components:[
  {type:17,accent_color:0x18C7A5,components:[{type:10,content:"## 🎁 Momentum Movement · Gift Assist\n**NATIVE DISCORD DASHBOARD · COMPONENTS V2**\nA voluntary, moderator-reviewed way to coordinate creator support. All requests and controls stay inside Discord; no external command-center website is used."},nav,{type:14,divider:true,spacing:1}]},
  {type:17,accent_color:view==="policy"?0xF2B84B:0x9B7AFF,components:[{type:10,content:detail}]},
  {type:17,accent_color:0xF2B84B,components:[{type:10,content:safeguards}]}
 ],allowed_mentions:SAFE};
}
async function ensurePublicDashboard(){
 const message=await rest("GET","/channels/"+C.pub+"/messages/"+C.dash);
 if(message.author?.id!==C.app||message.id!==C.dash)throw Error("Gift Assist public dashboard ownership could not be verified");
 await rest("PATCH","/channels/"+C.pub+"/messages/"+C.dash,publicDashboardPayload("overview"));
}
async function managerCardPayload(view="overview",cashPage=0){
 const [messages,health,caseSummary]=await Promise.all([queueMessages(),syncApi("/gift-assist/health").catch(()=>null),syncApi("/internal/gift-assist/case-summary").catch(()=>null)]);
 const cases=messages.map(parseCase).filter(Boolean);
 const cashApp=view==="payments"?await syncApi("/internal/gift-assist/cashapp-recipients").catch(()=>null):null;
 const recipients=Array.isArray(cashApp?.recipients)?cashApp.recipients:[];
 const selectedRecipient=recipients.find(r=>r.id===cashApp?.selectedId);
 const pageCount=Math.max(1,Math.ceil(recipients.length/25));
 const page=Math.min(Math.max(0,Number(cashPage)||0),pageCount-1);
 const recipientOptions=recipients.slice(page*25,(page+1)*25).map(r=>({label:String(r.cashtag||r.label).slice(0,100),value:r.id,description:r.verified?"Ownership verified":"Unverified · setup only",default:r.id===cashApp?.selectedId}));
 const cashControls=[];
 if(recipientOptions.length)cashControls.push({type:1,components:[{type:3,custom_id:"gift:staff:cashapp:select",placeholder:"Select Cash App recipient · planning only",min_values:1,max_values:1,options:recipientOptions}]});
 if(pageCount>1)cashControls.push({type:1,components:[btn("Previous","gift:staff:cashapp:page:"+Math.max(0,page-1),2,page===0),btn("Next","gift:staff:cashapp:page:"+Math.min(pageCount-1,page+1),2,page>=pageCount-1)]});
 cashControls.push({type:1,components:[btn("Add Cash App (Admin)","gift:staff:cashapp:add",3)]});
 const cashSummary="### Cash App recipients · configuration only\n**Selected recipient:** "+(selectedRecipient?selectedRecipient.cashtag:"None selected")+"\n**Saved Cash App names:** "+recipients.length+(pageCount>1?" · page "+(page+1)+"/"+pageCount:"")+"\n**Verification:** "+(selectedRecipient?(selectedRecipient.verified?"Verified":"Pending ownership verification"):"No recipient selected")+"\n\nModerators and Administrators can choose an existing recipient below. Only Administrators or the server owner can enter a new $Cashtag. This setting does not send money or activate payment collection. Other payment methods remain available.";
 const rows=Array.isArray(caseSummary)?caseSummary:[];
 const terminal=new Set(["Declined","Withdrawn","Expired","Member Declined","Completed","Refunded","Partially Refunded"]);
 const activeRows=rows.filter(x=>!terminal.has(String(x.status||"")));
 const activeCards=cases.filter(x=>!terminal.has(String(x.status||"")));
 const locationMismatch=activeRows.filter(row=>{const card=cases.find(x=>x.ref===row.caseRef);return !card||(row.messageId&&card.messageId!==row.messageId)}).length;
 const count=statuses=>cases.filter(x=>statuses.includes(x.status)).length;
 const newCount=count(["New"]);
 const reviewCount=count(["Reviewing","Need Info"]);
 const awaitingCount=count(["Awaiting Member Approval"]);
 const activeCount=count(["Member Approved — Payments Off","Awaiting Payment","Payment Failed","Payment Cancelled","Payment Received — Awaiting Fulfillment","Manual Verification Pending","Partially Paid"]);
 const closedCount=count(["Declined","Withdrawn","Expired","Member Declined","Completed","Refunded","Partially Refunded"]);
 const dbSummary=health
  ?"**Database:** Connected · schema v"+String(health.schema||"?")+"\n**Stored case records:** "+String(health.cases??"?")+"\n**Active database cases:** "+(Array.isArray(caseSummary)?String(activeRows.length):"Not checked")+"\n**Visible queue cards:** "+cases.length+"\n**Ledger entries:** "+String(health.entries??"?")+"\n**Manual destinations:** "+String(health.destinations??"?")+"\n**Discord authorization:** Native Discord interactions · Owner/Moderator/Administrator role checks"
  :"**Backend health:** Unavailable — refresh to retry.";
 const mismatch=Array.isArray(caseSummary)&&(activeRows.length!==activeCards.length||locationMismatch>0)
  ?"\n\n⚠️ **Reconciliation check:** "+activeRows.length+" active database case(s), "+activeCards.length+" active queue card(s), "+locationMismatch+" case-location mismatch(es). Review the affected record before closing or deleting it."
  :"";
 const overview="### Live queue snapshot\n**Visible case cards:** "+cases.length+"\n- New: "+newCount+"\n- Reviewing / Need Info: "+reviewCount+"\n- Awaiting member decision: "+awaitingCount+"\n- Approved / fulfillment stages: "+activeCount+"\n- Closed: "+closedCount+"\n\n### Backend health\n"+dbSummary+mismatch;
 const payments="### Payment readiness\n**Collection status: "+(PAYMENTS_ENABLED?"ENABLED":"OFF")+"**\n- PayPal Checkout: "+(PAYPAL_READY?"Provider credentials detected — still subject to global approval":"Not connected")+"\n- Stripe Checkout: "+(STRIPE_READY?"Provider credentials detected — still subject to global approval":"Not connected")+"\n- Manual destinations: "+String(health?.destinations??"Unavailable")+"\n- Ledger entries: "+String(health?.entries??"Unavailable")+"\n- Recipient and policy profile: "+(POLICY_READY?"Complete":"Incomplete")+"\n\n**Activation gate:** verify the legal recipient, payout ownership, provider terms, signed webhooks, test transactions, refund/unused-fund handling and reconciliation. Keep collection OFF until the owner explicitly approves activation.";
 const guide="### Moderator workflow\n1. Review new requests in this private queue.\n2. Use Request Info when details are missing; the member replies in the Gift Assist channel.\n3. Propose a specific plan and amount.\n4. When the member responds in the Gift Assist channel, use **Record Approved** or **Record Declined** on the private case card.\n5. Mark a case complete only after fulfillment is verified.\n\n### Staff safeguards\n- No direct-message workflow; use the public dashboard and private queue.\n- Never use a moderator's personal payment account.\n- Never store card/bank details, passwords or provider secrets in Discord.\n- Do not promise a gift or pressure members to increase a budget.\n- Payment collection remains OFF until all activation gates pass.";
 const detail=view==="payments"?payments:view==="guide"?guide:overview;
 const nav={type:1,components:[btn("Overview","gift:staff:dashboard:overview",1),btn("Refresh","gift:staff:dashboard:refresh",2),btn("Minimum Budget","gift:staff:budget-setting",3),btn("Payments","gift:staff:dashboard:payments",2),btn("Staff Guide","gift:staff:dashboard:guide",2)]};
 const footer="**Minimum member budget:** "+moneyLabel(minimumBudgetCents)+"\n**Payment collection:** "+(PAYMENTS_ENABLED?"Enabled":"OFF")+"\n-# Provider secrets remain in the secret manager. No payment method is activated by this dashboard.";
 return {content:"",embeds:[],flags:36864,components:[
  {type:17,accent_color:0x9B7AFF,components:[{type:10,content:"## 🧭 Gift Assist Command Center\n**PRIVATE MODERATOR WORKSPACE · NATIVE DISCORD COMPONENTS V2**\nAll staff controls stay in this private Discord queue; no external command-center website is used."},nav,{type:14,divider:true,spacing:1}]},
  {type:17,accent_color:view==="payments"?0xF2B84B:view==="guide"?0x18C7A5:0x9B7AFF,components:[{type:10,content:detail}]},
  ...(view==="payments"?[{type:17,accent_color:0x18C7A5,components:[{type:10,content:cashApp?cashSummary:"### Cash App recipients\nRecipient list temporarily unavailable. Collections remain OFF."},...(cashApp?cashControls:[])]}]:[]),
  {type:17,accent_color:0xF2B84B,components:[{type:10,content:footer}]}
 ],allowed_mentions:SAFE};
}
async function ensureBudgetManagerCard(){
 const messages=await queueMessages();
 const found=messages.find(m=>m.author?.id===C.app&&(String(m.content||"").includes("[gift-assist-config:v1]")||JSON.stringify(m.components||[]).includes("gift:staff:budget-setting")));
 if(found){
  minimumBudgetMessageId=found.id;
  const raw=String(found.content||"")+" "+JSON.stringify(found.embeds||[])+" "+JSON.stringify(found.components||[]);
  const match=raw.match(/Minimum(?: optional)? member budget:[^\$]*\$([\d,]+(?:\.\d{2})?)/i);
  if(match){const n=cents(match[1]);if(n!==null)minimumBudgetCents=n}
  await rest("PATCH","/channels/"+C.queue+"/messages/"+found.id,await managerCardPayload("payments"));
  return;
 }
 const message=await rest("POST","/channels/"+C.queue+"/messages",await managerCardPayload("payments"));
 if(!message.id)throw Error("Gift Assist moderator command center could not be created");
 minimumBudgetMessageId=message.id;
}
function getDraft(token,userId){const d=requestDrafts.get(token);if(!d||d.userId!==userId||d.expiresAt<Date.now()){if(d&&d.expiresAt<Date.now())requestDrafts.delete(token);throw Error("This Gift Assist form expired. Start a new request in the Gift Assist channel.")}return d}
async function refreshRequestPanel(draft){await rest("PATCH","/channels/"+C.pub+"/messages/"+draft.panelMessageId,requestPanel(draft,draft.token))}
function targetFromSchedule(draft,custom){
 let date=draft.date,time=draft.time;
 if(date==="custom-date"&&time==="custom-time"){const m=String(custom||"").trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);if(!m)throw Error("Enter the custom date and time as YYYY-MM-DD HH:MM");date=m[1];time=m[2]}
 else if(date==="custom-date"){date=String(custom||"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error("Enter the custom date as YYYY-MM-DD")}
 else if(time==="custom-time"){time=String(custom||"").trim();if(!/^\d{2}:\d{2}$/.test(time))throw Error("Enter the custom time as HH:MM")}
 const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date+"T00:00:00Z"))&&new Date(date+"T00:00:00Z").toISOString().slice(0,10)===date;
 if(!validDate||date<todayIso())throw Error("Choose a valid future date, including the year");
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error("Choose a valid time in 24-hour HH:MM format");
 const day=new Date(date+"T12:00:00Z").getUTCDay();if(["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][day]!==draft.day)throw Error("The selected weekday does not match the date");
 const zone=requestTimezones.find(x=>x.value===draft.timezone);if(!zone)throw Error("Choose a supported timezone");
 try{new Intl.DateTimeFormat("en-US",{timeZone:zone.value}).format(new Date())}catch{throw Error("Choose a valid timezone")}
 const when=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"long",month:"long",day:"numeric",year:"numeric"}).format(new Date(date+"T12:00:00Z"));
 const timeLabel=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"numeric",minute:"2-digit"}).format(new Date(`2000-01-01T${time}:00Z`));
 return clean(when+" at "+timeLabel+" "+zone.label+" ("+zone.value+")",120);
}
async function submitSchedule(i){
 await i.deferReply();
 const day=i.fields.getStringSelectValues("schedule-day")[0],date=i.fields.getStringSelectValues("schedule-date")[0],time=i.fields.getStringSelectValues("schedule-time")[0],timezone=i.fields.getStringSelectValues("schedule-zone")[0];
 const draft={token:crypto.randomUUID().replace(/-/g,"").slice(0,12),userId:i.user.id,day,date,time,timezone,creatorMode:"",creatorId:"",creatorManual:"",goal:"",budgetTier:"",budgetCents:0,expiresAt:Date.now()+45*60*1000,panelMessageId:""};
 if(!date||!time||!timezone||!day)throw Error("Choose the day, date, time and timezone");
 if(date!=="custom-date"){const dayIndex=new Date(date+"T12:00:00Z").getUTCDay();if(["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][dayIndex]!==day)throw Error("The selected weekday does not match the selected date");}
 const panel=await rest("POST","/channels/"+C.pub+"/messages",requestPanel(draft,draft.token));
 if(!panel.id)throw Error("Gift Assist request controls could not be started");
 draft.panelMessageId=panel.id;requestDrafts.set(draft.token,draft);
 await i.editReply({content:"Schedule selected. Finish your request with the controls in this Gift Assist channel; the completed case goes to the moderator-only Gift Assist queue."});
}
async function handleRequestControl(i,kind,token){
 const draft=getDraft(token,i.user.id);
 if(i.message?.id!==draft.panelMessageId||i.channelId!==C.pub)throw Error("This request control is not current");
 if(kind==="other"){await i.showModal(creatorOtherModal(token));return}
 if(kind==="continue"){
  if(!draft.creatorMode||(!draft.creatorId&&!draft.creatorManual)||!draft.goal||!draft.budgetTier)throw Error("Choose a creator, gift goal and budget option before continuing");
  if(["low","mid","high"].includes(draft.budgetTier)&&!draft.budgetCents)throw Error("Choose a budget amount from the dropdown");
  await i.showModal(detailsModal(draft,token));return;
 }
 if(kind==="creator"){
  const selected=i.values?.[0];if(!selected)throw Error("Select one Discord member");
  await rest("GET","/guilds/"+C.guild+"/members/"+selected);
  draft.creatorId=selected;draft.creatorMode="member";draft.creatorManual="";
 }else if(kind==="goal"){
  const selected=i.values?.[0];if(!requestGoals.includes(selected))throw Error("Choose a listed gift idea or support goal");draft.goal=selected;
 }else if(kind==="tier"){
  const selected=i.values?.[0];if(!["none","low","mid","high","manual"].includes(selected))throw Error("Choose a listed budget range");draft.budgetTier=selected;draft.budgetCents=0;
 }else if(kind==="amount"){
  const amount=Number(i.values?.[0]);if(!Number.isInteger(amount)||!budgetValues(draft.budgetTier).includes(amount)||amount<minimumBudgetCents)throw Error("That amount is no longer available; choose an amount meeting the current minimum");draft.budgetCents=amount;
 }
 await i.deferUpdate();await refreshRequestPanel(draft);
}
async function submitRequestDetails(i,token){
 await i.deferReply();
 const draft=getDraft(token,i.user.id);
 if(i.channelId!==C.pub||!draft.creatorMode||!draft.goal||!draft.budgetTier)throw Error("This Gift Assist form is incomplete or expired");
 const customTiming=i.fields.getTextInputValue("custom-timing"),target=targetFromSchedule(draft,customTiming);
 let creator="";
 if(draft.creatorMode==="other")creator=clean(i.fields.getTextInputValue("creator-other"),120);
 else {const member=await rest("GET","/guilds/"+C.guild+"/members/"+draft.creatorId),display=clean(member.user?.global_name||member.user?.username||"Discord member",45),handle=clean(i.fields.getTextInputValue("creator-handle"),70);creator=clean(display+" (<@"+draft.creatorId+">)"+(handle?" "+handle:""),120)}
 const notes=clean(i.fields.getTextInputValue("goal-details"),450),goal=clean(draft.goal+(notes?" — "+notes:""),450);
 let budget="";
 if(["low","mid","high"].includes(draft.budgetTier))budget=(draft.budgetCents/100).toFixed(2);
 else if(draft.budgetTier==="manual"){const amount=cents(i.fields.getTextInputValue("budget-manual"));if(amount===null||amount<minimumBudgetCents)throw Error("Enter a valid budget at or above "+moneyLabel(minimumBudgetCents));budget=(amount/100).toFixed(2)}
 const result=await submitRequest(i,target,creator,goal,budget,i.fields.getTextInputValue("deadline"));
 await rest("PATCH","/channels/"+C.pub+"/messages/"+draft.panelMessageId,requestPanelResultPayload(result));
 requestDrafts.delete(token);
 await i.editReply({content:result.duplicate?"You already have an open Gift Assist request. The existing case remains in the moderator-only queue.":"Your request has been submitted to the Gift Assist queue for Moderator or Administrator review. No payment was collected."});
}
async function submitRequest(i,targetOverride,creatorOverride,goalOverride,budgetOverride,deadlineOverride){
 const records=(await queueMessages()).map(parseCase).filter(Boolean);
 const duplicate=records.find(d=>d.requesterId===i.user.id&&["New","Reviewing","Need Info","Awaiting Member Approval","Member Approved — Payments Off","Awaiting Payment","Payment Failed","Payment Cancelled","Payment Received — Awaiting Fulfillment","Manual Verification Pending","Partially Paid"].includes(d.status));
 if(duplicate)return {ref:duplicate.ref,duplicate:true};
 const creator=clean(creatorOverride??i.fields.getTextInputValue("creator"),120),target=clean(targetOverride??i.fields.getTextInputValue("target"),120),goal=clean(goalOverride??i.fields.getTextInputValue("goal"),450),budget=clean(budgetOverride??i.fields.getTextInputValue("budget"),50),deadline=clean(deadlineOverride??i.fields.getTextInputValue("deadline"),120);
 if(!creator||!target||!goal)throw Error("Creator, target LIVE/date, and gift idea are required");
 if(budget&&(cents(budget)===null||cents(budget)<minimumBudgetCents))throw Error("Maximum budget must meet the current minimum of "+moneyLabel(minimumBudgetCents));
 const ref="GA-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,8).toUpperCase();
 const d={ref,requesterId:i.user.id,creator,target,goal,budget,deadline,status:"New",amount:"",plan:"",note:"Awaiting staff review"};
 const m=await rest("POST","/channels/"+C.queue+"/messages",casePayload(d));
 if(!m.id)throw Error("Private Gift Assist case could not be created");
 await syncCase(m.id,d).catch(e=>log("case-sync-failed",{caseRef:ref,reason:clean(e.message,140)}));
 log("request-created",{caseRef:ref,messageId:m.id});
 return {ref,duplicate:false};
}
async function staffAction(i,action,ref){
 if(!staff(i))throw Error("Authorized staff only");
 if(["propose","need-info"].includes(action)){
  const snapshot=parseCase(i.message);
  if(i.channelId!==C.queue||i.message?.author?.id!==C.app||snapshot?.ref!==ref||!["New","Reviewing","Need Info"].includes(snapshot.status))throw Error("Open the current case controls");
  await i.showModal(action==="propose"?planModal(ref):infoModal(ref));return;
 }
 await i.deferUpdate();
 const {message,data}=await findCase(ref);
 if(i.message?.id!==message.id||i.channelId!==C.queue)throw Error("Control does not match its private case");
 if(action==="review"&&["New","Need Info"].includes(data.status)){
  data.status="Reviewing";data.note="Staff review in progress; any follow-up is handled in the Gift Assist channel. No DMs are sent.";await saveCase(message,data);return;
 }
 if(action==="decline"&&["New","Reviewing","Need Info","Awaiting Member Approval"].includes(data.status)){
  data.status="Declined";data.note="Declined by authorized staff; case status is recorded in the private queue. No DMs are sent.";await saveCase(message,data);return;
 }
 if(action==="member-approved"&&data.status==="Awaiting Member Approval"){
  data.status="Member Approved — Payments Off";data.note="Member approval recorded by authorized staff from the Gift Assist channel. Payment collection remains OFF.";await saveCase(message,data);return;
 }
 if(action==="member-declined"&&data.status==="Awaiting Member Approval"){
  data.status="Member Declined";data.note="Member declined the proposed plan in the Gift Assist channel. No payment was collected.";await saveCase(message,data);return;
 }
 if(action==="withdraw"&&!["Completed","Declined","Withdrawn","Expired","Member Declined","Payment Received — Awaiting Fulfillment","Refunded","Partially Refunded","Manual Verification Pending","Partially Paid"].includes(data.status)){
  data.status="Withdrawn";data.note="Withdrawn by authorized staff; case status is recorded in the private queue. No DMs are sent.";await saveCase(message,data);return;
 }
 if(action==="complete"&&["Member Approved — Payments Off","Payment Received — Awaiting Fulfillment"].includes(data.status)){
  data.status="Completed";data.note=data.paymentStatus==="Paid"?"Staff marked provider-confirmed gift coordination complete":"Staff marked no-payment coordination complete; no payment processed";await saveCase(message,data);return;
 }
 throw Error("Action is not valid for the current case status");
}
async function submitStaffModal(i){
 const info=i.customId.match(/^gift:staff:info-submit:(GA-[A-Z0-9-]{8,40})$/),plan=i.customId.match(/^gift:staff:plan-submit:(GA-[A-Z0-9-]{8,40})$/);
 if(!info&&!plan)return false;
 if(!staff(i)||i.channelId!==C.queue)throw Error("Staff-only Gift Assist case control");
 await i.deferReply();
 const ref=(info||plan)[1],{message,data}=await findCase(ref);
 if(!["New","Reviewing","Need Info"].includes(data.status))throw Error("This form expired after the case changed. Open the current case controls.");
 if(info){
  const question=clean(i.fields.getTextInputValue("question"),700);if(!question)throw Error("Enter the information needed");
  data.status="Need Info";data.plan="Clarification requested: "+question;data.note="Staff needs clarification: "+question;await saveCase(message,data);
  await i.editReply({content:"Clarification request saved to case "+ref+". Ask the requester to reply in the Gift Assist channel; no direct message was sent."});return true;
 }
 const n=cents(i.fields.getTextInputValue("amount")),planText=clean(i.fields.getTextInputValue("plan"),650);
 if(n===null||!planText)throw Error("Enter a valid contribution amount and purpose");
 const max=data.budget?cents(data.budget):null;if(max!==null&&n>max)throw Error("Proposed amount exceeds the member's stated maximum budget");
 data.amount=money(n);data.plan=planText;data.status="Awaiting Member Approval";data.note="Plan proposed by staff; awaiting the member response in the Gift Assist channel. Staff records the decision in this private case."; 
 await saveCase(message,data);
 await i.editReply({content:"Plan proposal saved to case "+ref+". Share it with the requester in the Gift Assist channel. When they respond, record the decision using the private case controls. Payments remain disabled."});
 return true;
}

function html(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function signedCheckoutToken(d){
 const payload={ref:d.ref,uid:d.requesterId,exp:Math.floor(Date.now()/1000)+86400,nonce:crypto.randomUUID()};
 const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
 const sig=createHmac("sha256",LINK_SECRET).update(body).digest("base64url");
 return body+"."+sig;
}
function verifyCheckoutToken(token){
 if(!LINK_SECRET||typeof token!=="string")return null;
 const parts=token.split(".");if(parts.length!==2)return null;
 const expected=createHmac("sha256",LINK_SECRET).update(parts[0]).digest("base64url");
 const a=Buffer.from(parts[1]),b=Buffer.from(expected);
 if(a.length!==b.length||!timingSafeEqual(a,b))return null;
 let p;try{p=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"))}catch{return null}
 if(!/^GA-[A-Z0-9-]{8,40}$/.test(String(p.ref||""))||!/^\\d{17,22}$/.test(String(p.uid||""))||!Number.isFinite(p.exp)||p.exp<Math.floor(Date.now()/1000))return null;
 return p;
}
function checkoutUrl(d){return CHECKOUT_BASE+"/checkout/"+signedCheckoutToken(d)}
function amountFor(d){const n=cents(d.amount);if(!n||n<50)throw Error("The approved amount must be at least $0.50 USD");return n}
async function checkoutCase(token,allowPaid=false){
 if(!PAYMENTS_ENABLED)throw Error("Gift Assist checkout is not enabled");
 const p=verifyCheckoutToken(token);if(!p)throw Error("This payment link is invalid or expired");
 const found=await findCase(p.ref),d=found.data;
 if(d.requesterId!==p.uid)throw Error("This payment link does not match the requester");
 if(!["Awaiting Payment","Payment Failed","Payment Cancelled"].includes(d.status)&&!(allowPaid&&["Payment Received — Awaiting Fulfillment","Completed","Refunded","Partially Refunded"].includes(d.status)))throw Error("This case is not awaiting a payment");
 amountFor(d);return {p,message:found.message,data:d};
}
async function paypalToken(){
 if(!PAYPAL_ON)throw Error("PayPal Checkout is not enabled");
 const id=Bun.env.GIFT_ASSIST_PAYPAL_CLIENT_ID,secret=Bun.env.GIFT_ASSIST_PAYPAL_CLIENT_SECRET;
 const base=Bun.env.GIFT_ASSIST_PAYPAL_ENVIRONMENT==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
 const r=await fetch(base+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(id+":"+secret),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials",signal:AbortSignal.timeout(15000)});
 const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw Error("PayPal authentication failed");return {base,access:d.access_token};
}
async function createPayPalOrder(token){
 const {message,data}=await checkoutCase(token);if(!PAYPAL_ON)throw Error("PayPal is not currently available");
 const claim=await syncApi("/internal/gift-assist/checkout-claim",{caseRef:data.ref,requesterId:data.requesterId,provider:"PayPal",returnToken:token});
 const {base,access}=await paypalToken(),value=(amountFor(data)/100).toFixed(2);
 let order;
 if(claim.providerReference){order={id:claim.providerReference}}
 else{
 const response=await fetch(base+"/v2/checkout/orders",{method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json","PayPal-Request-Id":claim.attemptKey},body:JSON.stringify({intent:"CAPTURE",purchase_units:[{reference_id:data.ref,custom_id:data.ref,invoice_id:data.ref,description:"Momentum Movement Gift Assist "+data.ref,amount:{currency_code:CURRENCY,value}}]}),signal:AbortSignal.timeout(20000)});
 order=await response.json().catch(()=>({}));if(!response.ok||!order.id)throw Error("PayPal could not create this checkout");
 await syncApi("/internal/gift-assist/checkout-ready",{caseRef:data.ref,attemptKey:claim.attemptKey,providerReference:order.id});
 }
 data.status="Awaiting Payment";data.status="Awaiting Payment";data.paymentStatus="Awaiting Payment";data.paymentProvider="PayPal";data.providerReference=order.id;data.note="PayPal order created; awaiting provider-confirmed capture";
 await saveCase(message,data);return {id:order.id};
}
async function capturePayPalOrder(token,orderId){
 const {message,data}=await checkoutCase(token);if(!PAYPAL_ON||data.paymentProvider!=="PayPal"||data.providerReference!==orderId)throw Error("PayPal order does not match this case");
 const {base,access}=await paypalToken();
 const response=await fetch(base+"/v2/checkout/orders/"+encodeURIComponent(orderId)+"/capture",{method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json","PayPal-Request-Id":"capture-"+orderId},body:"{}",signal:AbortSignal.timeout(20000)});
 const capture=await response.json().catch(()=>({}));if(!response.ok)throw Error("PayPal capture could not be verified");
 const unit=capture.purchase_units?.[0],cap=unit?.payments?.captures?.[0];
 if(capture.status!=="COMPLETED"||cap?.status!=="COMPLETED"||unit?.custom_id!==data.ref||cap?.amount?.currency_code!==CURRENCY||Number(cap?.amount?.value)!==amountFor(data)/100)throw Error("PayPal did not confirm the exact approved Gift Assist amount");
 await recordPayment(data.ref,"PayPal","Paid",cap.id,"paypal-capture-"+cap.id);return {status:"paid",reference:cap.id};
}
async function createStripeSession(token){
 const {message,data}=await checkoutCase(token);if(!STRIPE_ON)throw Error("Stripe Checkout is not enabled");
 const claim=await syncApi("/internal/gift-assist/checkout-claim",{caseRef:data.ref,requesterId:data.requesterId,provider:"Stripe",returnToken:token});
 const returnToken=claim.returnToken||token;
 const amount=amountFor(data),params=new URLSearchParams();
 params.set("mode","payment");params.set("client_reference_id",data.ref);
 params.set("success_url",CHECKOUT_BASE+"/checkout/return?token="+encodeURIComponent(returnToken)+"&provider=stripe&session_id={CHECKOUT_SESSION_ID}");
 params.set("cancel_url",CHECKOUT_BASE+"/checkout/"+encodeURIComponent(returnToken)+"?cancelled=1");
 params.set("line_items[0][quantity]","1");params.set("line_items[0][price_data][currency]","usd");
 params.set("line_items[0][price_data][unit_amount]",String(amount));
 params.set("line_items[0][price_data][product_data][name]","Momentum Movement Gift Assist Contribution");
 params.set("line_items[0][price_data][product_data][description]","Approved contribution for "+data.ref);
 params.set("payment_method_types[0]","card");if(STRIPE_CASHAPP_ON)params.set("payment_method_types[1]","cashapp");
 params.set("metadata[case_ref]",data.ref);params.set("metadata[requester_id]",data.requesterId);params.set("payment_intent_data[metadata][case_ref]",data.ref);
 let session;
 if(claim.providerReference&&claim.url){session={id:claim.providerReference,url:claim.url}}
 else{
 const response=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:"Bearer "+Bun.env.GIFT_ASSIST_STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":claim.attemptKey},body:params.toString(),signal:AbortSignal.timeout(20000)});
 session=await response.json().catch(()=>({}));if(!response.ok||!session.id||!session.url)throw Error("Stripe could not create this checkout");
 await syncApi("/internal/gift-assist/checkout-ready",{caseRef:data.ref,attemptKey:claim.attemptKey,providerReference:session.id,url:session.url});
 }
 data.status="Awaiting Payment";data.status="Awaiting Payment";data.paymentStatus="Awaiting Payment";data.paymentProvider="Stripe";data.providerReference=session.id;data.note="Stripe Checkout Session created; awaiting provider confirmation";
 await saveCase(message,data);return {url:session.url,id:session.id};
}
async function recordPayment(ref,provider,status,providerReference,eventId,financial={}){
 const {message,data}=await findCase(ref),eventIds=String(data.paymentEvents||"").split(",").filter(Boolean);
 if(["Failed","Cancelled"].includes(status)){
  const current=await syncApi("/internal/gift-assist/case-state",{caseRef:ref,requesterId:data.requesterId});
  if(!["Awaiting Payment","Payment Failed","Payment Cancelled"].includes(current.status)||data.paymentProvider!==provider||data.providerReference!==(financial.expectedReference||providerReference))return {duplicate:true};
  await syncApi("/internal/gift-assist/checkout-close",{caseRef:ref,provider,providerReference:data.providerReference});
 }
 let ledgerResult=null;
 if(["Paid","Refunded","Partially Refunded"].includes(status)){
  ledgerResult=await syncApi("/internal/gift-assist/payment-sync",{caseRef:ref,requesterId:data.requesterId,amountCents:financial.amountCents||amountFor(data),provider,status,providerReference,eventId,paymentKey:financial.paymentKey||providerReference,...financial});
  status=ledgerResult.status;
  if(ledgerResult.duplicate){
   if(data.status!==ledgerResult.caseStatus||data.paymentStatus!==ledgerResult.status){
    data.status=ledgerResult.caseStatus;data.paymentStatus=ledgerResult.status;
    await saveCase(message,data,false);
   }
   return {duplicate:true};
  }
 }

 if(eventId&&eventIds.includes(eventId)&&ledgerResult?.duplicate)return {duplicate:true};
 if(status==="Paid"&&data.paymentStatus==="Paid"&&ledgerResult?.duplicate)return {duplicate:true};
 if(eventId)data.paymentEvents=[...eventIds,eventId].slice(-12).join(",");
 data.paymentProvider=provider;data.providerReference=financial.paymentKey||providerReference||data.providerReference||"";data.paymentStatus=status;
 if(status==="Paid"){data.status="Payment Received — Awaiting Fulfillment";data.note=provider+" verified the exact approved contribution"}
 else if(status==="Refunded"){data.status="Refunded";data.note=provider+" confirmed a full refund"}
 else if(status==="Partially Refunded"){data.status="Partially Refunded";data.note=provider+" confirmed a partial refund"}
 else if(status==="Failed"){data.status="Payment Failed";data.note=provider+" reported a failed payment"}
 else if(status==="Cancelled"){data.status="Payment Cancelled";data.note=provider+" checkout expired or was cancelled"}
 await saveCase(message,data);
 return {duplicate:false};
}
async function verifyStripeSignature(raw,header){
 if(!STRIPE_ON||!Bun.env.GIFT_ASSIST_STRIPE_WEBHOOK_SECRET)return false;
 const fields=String(header||"").split(",").map(x=>x.split("="));
 const timestamp=Number(fields.find(x=>x[0]==="t")?.[1]),signatures=fields.filter(x=>x[0]==="v1").map(x=>x[1]);
 if(!timestamp||Math.abs(Date.now()/1000-timestamp)>300||!signatures.length)return false;
 const expected=createHmac("sha256",Bun.env.GIFT_ASSIST_STRIPE_WEBHOOK_SECRET).update(timestamp+"."+raw).digest("hex"),ex=Buffer.from(expected,"hex");
 return signatures.some(v=>{try{const a=Buffer.from(v,"hex");return a.length===ex.length&&timingSafeEqual(a,ex)}catch{return false}});
}
async function webhookText(req){
 if(Number(req.headers.get("content-length")||0)>1000000)throw Error("payload_too_large");
 const reader=req.body?.getReader();
 if(!reader)return "";
 const chunks=[];
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>1000000){await reader.cancel();throw Error("payload_too_large")}
   chunks.push(Buffer.from(value));
  }
 }finally{reader.releaseLock()}
 return Buffer.concat(chunks).toString("utf8");
}
async function stripeWebhook(req){
 let raw;try{raw=await webhookText(req)}catch{return Response.json({error:"payload too large"},{status:413})}
 if(!await verifyStripeSignature(raw,req.headers.get("stripe-signature")))return Response.json({error:"signature verification failed"},{status:401});
 let event;try{event=JSON.parse(raw)}catch{return Response.json({error:"invalid payload"},{status:400})}
 const obj=event.data?.object||{};let ref=obj.metadata?.case_ref||obj.client_reference_id||"",status="";
 if(event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded"){
  if(obj.payment_status==="paid"||event.type==="checkout.session.async_payment_succeeded"){
   if(!ref||obj.mode!=="payment"||String(obj.currency||"").toLowerCase()!=="usd")return Response.json({error:"Stripe payment metadata or currency mismatch"},{status:400});
   const {data}=await findCase(ref);
   if(data.paymentProvider!=="Stripe"||![obj.id,obj.payment_intent].includes(data.providerReference)||obj.metadata?.requester_id!==data.requesterId||Number(obj.amount_total)!==amountFor(data))return Response.json({error:"Stripe paid amount does not match approved Gift Assist amount"},{status:400});
   status="Paid";
  }
 }else if(event.type==="checkout.session.async_payment_failed")status="Failed";
 else if(event.type==="checkout.session.expired")status="Cancelled";
 else if(event.type==="charge.refunded"){
  const charge=obj;
  let pi=null;
  if(charge.payment_intent&&Bun.env.GIFT_ASSIST_STRIPE_SECRET_KEY){
   const pr=await fetch("https://api.stripe.com/v1/payment_intents/"+encodeURIComponent(charge.payment_intent),{headers:{Authorization:"Bearer "+Bun.env.GIFT_ASSIST_STRIPE_SECRET_KEY},signal:AbortSignal.timeout(15000)});
   if(pr.ok)pi=await pr.json();
  }
  ref=ref||pi?.metadata?.case_ref||"";
  if(!ref)return Response.json({error:"Stripe refund lacks a Gift Assist reference"},{status:400});
  const {data}=await findCase(ref);
  if(String(charge.currency||"").toLowerCase()!=="usd"||Number(charge.amount)!==amountFor(data))return Response.json({error:"Stripe refund original amount does not match Gift Assist case"},{status:400});
  status=Number(charge.amount_refunded)>=Number(charge.amount)?"Refunded":"Partially Refunded";
 }
 if(status&&ref){
  if(["Paid","Refunded","Partially Refunded"].includes(status)&&typeof obj.payment_intent!=="string")return Response.json({error:"payment_intent_required"},{status:400});
  const financial={paymentKey:obj.payment_intent,amountCents:Number(obj.amount_total||obj.amount)};
  if(event.type==="charge.refunded")financial.cumulativeRefundCents=Number(obj.amount_refunded);
  await recordPayment(ref,"Stripe",status,obj.id||event.id,event.id,financial);
 }
 return Response.json({received:true});
}
async function paypalWebhook(req){
 if(!PAYPAL_ON||!Bun.env.GIFT_ASSIST_PAYPAL_WEBHOOK_ID)return Response.json({error:"PayPal webhook is disabled"},{status:503});
 let raw;try{raw=await webhookText(req)}catch{return Response.json({error:"payload too large"},{status:413})}
 let event;try{event=JSON.parse(raw)}catch{return Response.json({error:"invalid payload"},{status:400})}
 const {base,access}=await paypalToken(),h=req.headers;
 const verification={auth_algo:h.get("paypal-auth-algo"),cert_url:h.get("paypal-cert-url"),transmission_id:h.get("paypal-transmission-id"),transmission_sig:h.get("paypal-transmission-sig"),transmission_time:h.get("paypal-transmission-time"),webhook_id:Bun.env.GIFT_ASSIST_PAYPAL_WEBHOOK_ID,webhook_event:event};
 if(Object.values(verification).some(v=>!v))return Response.json({error:"missing PayPal signature fields"},{status:401});
 const vr=await fetch(base+"/v1/notifications/verify-webhook-signature",{method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json"},body:JSON.stringify(verification),signal:AbortSignal.timeout(20000)});
 const verified=await vr.json().catch(()=>({}));if(!vr.ok||verified.verification_status!=="SUCCESS")return Response.json({error:"PayPal signature verification failed"},{status:401});
 const resource=event.resource||{},type=event.event_type;
 let status="",found=null,providerRef=String(resource.id||"");
 if(["PAYMENT.CAPTURE.COMPLETED","PAYMENT.CAPTURE.DENIED","PAYMENT.CAPTURE.REFUNDED"].includes(type)){
  const direct=resource.custom_id||resource.invoice_id||resource.purchase_units?.[0]?.custom_id||"";
  const order=resource.supplementary_data?.related_ids?.order_id||resource.related_ids?.order_id||"";
  let captureId=providerRef;
  if(type==="PAYMENT.CAPTURE.REFUNDED"){
   const link=(resource.links||[]).find(x=>x.rel==="up")?.href||"";
   try{const path=new URL(link).pathname;captureId=path.match(/^\/v2\/payments\/captures\/([A-Za-z0-9]+)$/)?.[1]||""}catch{captureId=""}
   if(!captureId)return Response.json({error:"original_capture_required"},{status:400});
  }
  try{found=direct?await findCase(direct):await findCaseByProviderReference("PayPal",[captureId,order])}
  catch{return Response.json({error:"PayPal event does not match a Gift Assist payment"},{status:400})}
  if(found.data.paymentProvider!=="PayPal"||![providerRef,captureId,order].filter(Boolean).includes(found.data.providerReference))return Response.json({error:"PayPal payment binding mismatch"},{status:400});
  const amount=resource.amount;
  if(!amount||String(amount.currency_code||"").toUpperCase()!=="USD"||!Number.isSafeInteger(Math.round(Number(amount.value)*100))||Math.round(Number(amount.value)*100)<=0||(type!=="PAYMENT.CAPTURE.REFUNDED"&&Math.round(Number(amount.value)*100)!==amountFor(found.data)))return Response.json({error:"PayPal amount does not match approved Gift Assist amount"},{status:400});
  if(type==="PAYMENT.CAPTURE.COMPLETED")status="Paid";
  else if(type==="PAYMENT.CAPTURE.DENIED")status="Failed";
  else status="Refunded";
  const financial={expectedReference:found.data.providerReference,paymentKey:captureId,amountCents:Math.round(Number(amount.value)*100)};
  const cumulative=resource.seller_payable_breakdown?.total_refunded_amount;
  if(type==="PAYMENT.CAPTURE.REFUNDED"&&cumulative?.currency_code==="USD")financial.cumulativeRefundCents=Math.round(Number(cumulative.value)*100);
  if(type==="PAYMENT.CAPTURE.COMPLETED"&&resource.seller_receivable_breakdown?.paypal_fee?.currency_code==="USD")financial.feeCents=Math.round(Number(resource.seller_receivable_breakdown.paypal_fee.value)*100);
  await recordPayment(found.data.ref,"PayPal",status,providerRef,event.id,financial);
 }
 return Response.json({received:true});
}


function checkoutPage(token,data){
 const clientId=String(Bun.env.GIFT_ASSIST_PAYPAL_CLIENT_ID||"");
 const paypalScript=Bun.env.GIFT_ASSIST_PAYPAL_ENVIRONMENT==="live"?"https://www.paypal.com/web-sdk/v6/core":"https://www.sandbox.paypal.com/web-sdk/v6/core";
 const amount=html(data.amount),purpose=html(data.plan),recipient=html(RECEIVER_LABEL);
 const paypalControls=PAYPAL_ON?'<button id="paypal" hidden>Pay with PayPal</button>'+(VENMO_ON?'<button id="venmo" hidden>Pay with Venmo</button>':""):"";
 const stripeControls=STRIPE_ON?'<button id="stripe">Cards'+(STRIPE_CASHAPP_ON?' / Cash App Pay':"")+' / eligible wallets</button>':"";
 const sdk=PAYPAL_ON?'<script src="'+paypalScript+'"></script>':"";
 const js=[
  'const token='+JSON.stringify(token)+';',
  'const say=t=>document.getElementById("status").textContent=t;',
  'async function post(path,body){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Payment request failed");return d}',
  'if(document.getElementById("stripe"))document.getElementById("stripe").onclick=async()=>{try{say("Opening secure Stripe checkout…");const d=await post("/api/stripe/session",{token});location.href=d.url}catch(e){say(e.message)}};',
  'if(window.paypal){(async()=>{try{const sdk=await window.paypal.createInstance({clientId:'+JSON.stringify(clientId)+',components:'+JSON.stringify(VENMO_ON?["paypal-payments","venmo-payments"]:["paypal-payments"])+',pageType:"checkout",locale:"en-US"});const eligible=await sdk.findEligibleMethods({currencyCode:"USD"});const opts={async onApprove(d){say("Payment approved. Verifying with PayPal…");try{await post("/api/paypal/capture",{token,orderId:d.orderId});say("Payment confirmed. You may close this page.")}catch(e){say(e.message)}},onCancel(){say("Checkout cancelled. No payment was recorded.")},onError(){say("PayPal could not complete checkout. Please retry or contact Help Desk.")}};const createOrder=async()=>{const d=await post("/api/paypal/order",{token});return {orderId:d.id}};if(eligible.isEligible("paypal")){const session=sdk.createPayPalOneTimePaymentSession(opts),b=document.getElementById("paypal");b.hidden=false;b.onclick=async()=>{try{say("Opening PayPal…");await session.start({presentationMode:"auto"},createOrder())}catch(e){say("PayPal checkout could not start. Please retry.")}}}if('+JSON.stringify(VENMO_ON)+'&&eligible.isEligible("venmo")){const session=sdk.createVenmoOneTimePaymentSession(opts),b=document.getElementById("venmo");b.hidden=false;b.onclick=async()=>{try{say("Opening Venmo…");await session.start({presentationMode:"auto"},createOrder())}catch(e){say("Venmo checkout could not start. Please retry.")}}}}catch(e){say("PayPal checkout is not available in this browser or region.")}})()}'
 ].join("\n");
 const page=[
  "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Momentum Movement Gift Assist Checkout</title>",
  "<style>body{font-family:system-ui,sans-serif;background:#10141c;color:#f5f7fb;margin:0;padding:32px;max-width:620px;margin:auto}main{background:#1b2330;border-radius:18px;padding:28px}h1{font-size:24px}p{line-height:1.55;color:#d7dfeb}button{display:block;width:100%;padding:14px;margin:12px 0;border:0;border-radius:10px;font-size:16px;cursor:pointer;background:#dce9ff;color:#152033}small{color:#b9c4d3}#status{min-height:28px;margin-top:18px}</style>",
  "<main><h1>Momentum Movement Gift Assist</h1><p><strong>Approved contribution:</strong> "+amount+"</p><p><strong>Purpose:</strong> "+purpose+"</p><p><strong>Receiving account:</strong> "+recipient+"</p><p>Choose a secure provider checkout. Payment information is entered only on the provider-hosted checkout.</p>",
  paypalControls,stripeControls,
  "<p id='status' role='status'></p><small>Case reference: "+html(data.ref)+" · USD · Do not share this personal payment link.</small></main>",
  sdk,"<script>",js,"</script></html>"
 ].join("");
 return new Response(page,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});
}
async function paymentRoute(req,url){
 if(req.method==="GET"&&url.pathname.startsWith("/checkout/")&&url.pathname!=="/checkout/return"){
  if(!PAYMENTS_ENABLED)return new Response("Gift Assist checkout is not enabled.",{status:503});
  const token=decodeURIComponent(url.pathname.slice("/checkout/".length));
  try{
   const {data}=await checkoutCase(token,true);
   if(["Payment Received — Awaiting Fulfillment","Completed","Refunded","Partially Refunded"].includes(data.status))
    return new Response("<!doctype html><title>Payment confirmed</title><p>Provider-verified payment status: "+html(data.paymentStatus||data.status)+".</p>",{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
   return checkoutPage(token,data);
  }catch{return new Response("This Gift Assist checkout link is invalid, expired, or no longer payable.",{status:404,headers:{"cache-control":"no-store"}})}
 }
 if(req.method==="GET"&&url.pathname==="/checkout/return"){
  const token=url.searchParams.get("token")||"";
  try{
   const {data}=await checkoutCase(token,true);
   return new Response("<!doctype html><meta charset='utf-8'><title>Gift Assist payment status</title><h1>Payment status</h1><p>"+html(data.paymentStatus||"Awaiting provider confirmation")+"</p><p>Case "+html(data.ref)+"</p><p>Provider events, not the browser redirect, determine whether payment has been received. Gift Assist will message you when the provider confirms receipt.</p>",{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  }catch{return new Response("Checkout status unavailable. Use the Gift Assist channel or contact a moderator.",{status:404})}
 }
 if(req.method==="POST"&&url.pathname==="/api/paypal/order"){
  try{const body=await req.json();return Response.json(await createPayPalOrder(String(body.token||"")))}
  catch(e){return Response.json({error:clean(e?.message||"PayPal order failed",160)},{status:400})}
 }
 if(req.method==="POST"&&url.pathname==="/api/paypal/capture"){
  try{const body=await req.json();return Response.json(await capturePayPalOrder(String(body.token||""),String(body.orderId||"")))}
  catch(e){return Response.json({error:clean(e?.message||"PayPal capture failed",160)},{status:400})}
 }
 if(req.method==="POST"&&url.pathname==="/api/stripe/session"){
  try{const body=await req.json();return Response.json(await createStripeSession(String(body.token||"")))}
  catch(e){return Response.json({error:clean(e?.message||"Stripe checkout failed",160)},{status:400})}
 }
 if(req.method==="POST"&&url.pathname==="/webhooks/stripe")return stripeWebhook(req);
 if(req.method==="POST"&&url.pathname==="/webhooks/paypal")return paypalWebhook(req);
 return null;
}
async function guide(i,kind){
 await i.deferUpdate();
 await rest("PATCH","/channels/"+C.pub+"/messages/"+C.dash,publicDashboardPayload(kind));
}
async function giftInteractionCallback(payload,type,data){
 const response=await fetch("https://discord.com/api/v10/interactions/"+payload.id+"/"+payload.token+"/callback",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type,data}),signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error("Discord interaction callback failed: "+response.status);
 return response.json().catch(()=>({}));
}
function makeGiftInteraction(payload){
 const fieldValues=new Map();
 const collectFields=nodes=>{
  for(const node of nodes||[]){
   if(!node||typeof node!=="object")continue;
   if(node.custom_id){
    if(Array.isArray(node.values))fieldValues.set(node.custom_id,node.values.map(value=>String(value)));
    else if(node.value!==undefined)fieldValues.set(node.custom_id,String(node.value));
   }
   if(node.component)collectFields([node.component]);
   if(Array.isArray(node.components))collectFields(node.components);
  }
 };
 collectFields(payload.data?.components);
 const i={id:payload.id,token:payload.token,applicationId:payload.application_id,guildId:payload.guild_id||null,channelId:payload.channel_id||null,customId:payload.data?.custom_id||"",componentType:payload.data?.component_type,values:Array.isArray(payload.data?.values)?payload.data.values:[],user:payload.user||payload.member?.user||{id:""},member:payload.member||null,message:payload.message||null,deferred:Boolean(payload.__acknowledged),replied:false};
 i.isButton=()=>Number(payload.type)===3&&Number(payload.data?.component_type)===2;
 i.isModalSubmit=()=>Number(payload.type)===5;
 i.fields={
  getTextInputValue(id){if(!fieldValues.has(id))throw Error("Missing modal field: "+id);const value=fieldValues.get(id);return Array.isArray(value)?String(value[0]??""):String(value??"")},
  getStringSelectValues(id){if(!fieldValues.has(id))throw Error("Missing modal select: "+id);const value=fieldValues.get(id);return Array.isArray(value)?value.map(String):value==null?[]:[String(value)]}
 };
 i.deferUpdate=async()=>{if(i.deferred||i.replied)return;await giftInteractionCallback(payload,6);i.deferred=true};
 i.deferReply=async()=>{if(i.deferred||i.replied)return;await giftInteractionCallback(payload,5);i.deferred=true};
 i.reply=async body=>{if(i.deferred||i.replied)return i.followUp(body);await giftInteractionCallback(payload,4,body);i.replied=true;return body};
 i.update=async body=>{if(i.deferred||i.replied)return i.editReply(body);await giftInteractionCallback(payload,7,body);i.replied=true;return body};
 i.showModal=async modal=>{if(i.deferred||i.replied)throw Error("Cannot open a modal after acknowledging");await giftInteractionCallback(payload,9,modal?.toJSON?modal.toJSON():modal);i.replied=true;return modal};
 i.editReply=async body=>{const response=await fetch("https://discord.com/api/v10/webhooks/"+C.app+"/"+payload.token+"/messages/@original",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error("Interaction response edit failed: "+response.status);return response.json().catch(()=>({}))};
 i.followUp=async body=>{const response=await fetch("https://discord.com/api/v10/webhooks/"+C.app+"/"+payload.token+"?wait=true",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error("Interaction follow-up failed: "+response.status);return response.json().catch(()=>({}))};
 return i;
}
async function handleGiftAssistInteraction(i){
 if(!String(i.customId||"").startsWith("gift:"))return;
 try{
  if(i.isButton()&&i.guildId===C.guild&&i.channelId===C.pub&&i.message?.id===C.dash&&i.message?.author?.id===C.app){
   if(i.customId==="gift:refresh"){await i.deferUpdate();await rest("PATCH","/channels/"+C.pub+"/messages/"+C.dash,publicDashboardPayload("overview"));return}
   if(i.customId==="gift:start"){await i.showModal(scheduleModal());return}
   if(i.customId==="gift:how"){await guide(i,"how");return}
   if(i.customId==="gift:policy"){await guide(i,"policy");return}
  }
  if(i.isModalSubmit()&&i.guildId===C.guild&&i.channelId===C.pub&&i.customId==="gift:schedule-submit"){await submitSchedule(i);return}
  const control=String(i.customId||"").match(/^gift:request:(creator|goal|tier|amount|other|continue):([a-f0-9]{12})$/i);
  if(control&&i.guildId===C.guild&&i.channelId===C.pub){await handleRequestControl(i,control[1],control[2]);return}
  const otherCreator=String(i.customId||"").match(/^gift:creator-other-submit:([a-f0-9]{12})$/i);
  if(otherCreator&&i.isModalSubmit()&&i.guildId===C.guild&&i.channelId===C.pub){
   await i.deferReply();const draft=getDraft(otherCreator[1],i.user.id),value=clean(i.fields.getTextInputValue("creator-other"),120);
   if(!value||!/@[A-Za-z0-9._]{2,24}\b/.test(value))throw Error("Enter the creator's name and their @TikTok handle");
   draft.creatorMode="other";draft.creatorManual=value;draft.creatorId="";await refreshRequestPanel(draft);await i.editReply({content:"Creator added. Continue with the controls in this Gift Assist channel."});return;
  }
  const details=String(i.customId||"").match(/^gift:details-submit:([a-f0-9]{12})$/i);
  if(details&&i.isModalSubmit()&&i.guildId===C.guild&&i.channelId===C.pub){await submitRequestDetails(i,details[1]);return}
  if(i.isButton()&&i.guildId===C.guild&&i.channelId===C.queue&&i.message?.author?.id===C.app&&i.message?.id===minimumBudgetMessageId){
   const dashboard=String(i.customId||"").match(/^gift:staff:dashboard:(overview|refresh|payments|guide)$/);
   if(dashboard){if(!staff(i))throw Error("Moderator or Administrator access to the Gift Assist queue is required");await i.deferUpdate();const view=dashboard[1]==="refresh"?"overview":dashboard[1];await rest("PATCH","/channels/"+C.queue+"/messages/"+minimumBudgetMessageId,await managerCardPayload(view));return}
  }
  const cashContext=i.guildId===C.guild&&i.channelId===C.queue&&i.message?.author?.id===C.app&&i.message?.id===minimumBudgetMessageId;
  const cashPage=String(i.customId||"").match(/^gift:staff:cashapp:page:(\d{1,3})$/);
  if(i.isButton()&&cashContext&&cashPage){
   if(!staff(i))throw Error("Moderator or higher is required to choose a Cash App recipient");
   await i.deferUpdate();
   await rest("PATCH","/channels/"+C.queue+"/messages/"+minimumBudgetMessageId,await managerCardPayload("payments",Number(cashPage[1])));
   return;
  }
  if(i.componentType===3&&cashContext&&i.customId==="gift:staff:cashapp:select"){
   if(!staff(i))throw Error("Moderator or higher is required to select a Cash App recipient");
   const id=String(i.values?.[0]||"");
   if(!/^[0-9a-f-]{36}$/i.test(id))throw Error("Invalid Cash App recipient selection");
   await i.deferUpdate();
   const result=await syncApi("/internal/gift-assist/cashapp-select",{actorId:i.user.id,destinationId:id});
   if(!result.ok)throw Error("Recipient selection could not be saved");
   const list=await syncApi("/internal/gift-assist/cashapp-recipients");
   const index=Array.isArray(list.recipients)?list.recipients.findIndex(r=>r.id===id):-1;
   await rest("PATCH","/channels/"+C.queue+"/messages/"+minimumBudgetMessageId,await managerCardPayload("payments",Math.max(0,Math.floor(index/25))));
   log("cashapp-recipient-selected",{actor:i.user.id,destinationId:id,collectionEnabled:false});
   return;
  }
  if(i.isButton()&&cashContext&&i.customId==="gift:staff:cashapp:add"){
   if(!admin(i))throw Error("Only an Administrator or the server owner can enter a Cash App name");
   await i.showModal(cashAppAddModal(minimumBudgetMessageId));
   return;
  }
  const cashAdd=String(i.customId||"").match(/^gift:staff:cashapp:add-submit:(\d{17,22})$/);
  if(i.isModalSubmit()&&cashAdd&&i.guildId===C.guild&&i.channelId===C.queue){
   if(!admin(i)||cashAdd[1]!==minimumBudgetMessageId)throw Error("Only an Administrator or the server owner can register Cash App recipients");
   const tag=normalizeCashtag(i.fields.getTextInputValue("cashapp-tag"));
   await i.deferReply();
   const result=await syncApi("/internal/gift-assist/cashapp-add",{actorId:i.user.id,cashtag:tag});
   if(!result.ok)throw Error("Cash App name could not be saved");
   await rest("PATCH","/channels/"+C.queue+"/messages/"+minimumBudgetMessageId,await managerCardPayload("payments"));
   log("cashapp-recipient-added",{actor:i.user.id,duplicate:Boolean(result.duplicate),collectionEnabled:false});
   await i.editReply({content:result.duplicate?tag+" is already registered. Existing recipients were preserved.":tag+" registered for moderator selection. Account ownership is not yet verified. Payments remain OFF."});
   return;
  }
  if(i.isButton()&&i.guildId===C.guild&&i.channelId===C.queue&&i.customId==="gift:staff:budget-setting"){
   if(i.message?.author?.id!==C.app||i.message.id!==minimumBudgetMessageId||!staff(i))throw Error("Moderator or Administrator access to the Gift Assist queue is required");
   await i.showModal(budgetSettingsModal(minimumBudgetMessageId));return;
  }
  const budgetSetting=String(i.customId||"").match(/^gift:staff:budget-setting-submit:(\d{17,22})$/);
  if(budgetSetting&&i.isModalSubmit()&&i.guildId===C.guild&&i.channelId===C.queue){
   if(!staff(i)||budgetSetting[1]!==minimumBudgetMessageId)throw Error("Moderator or Administrator access to the Gift Assist queue is required");
   await i.deferReply();const next=cents(i.fields.getTextInputValue("minimum-budget"));
   if(next===null||next<2500||next>500000)throw Error("Minimum budget must be between $25.00 and $5,000.00");
   minimumBudgetCents=next;await rest("PATCH","/channels/"+C.queue+"/messages/"+minimumBudgetMessageId,await managerCardPayload("overview"));
   log("minimum-budget-updated",{actor:i.user.id,minimumBudget:money(minimumBudgetCents)});await i.editReply({content:"Gift Assist minimum optional budget updated to "+moneyLabel(minimumBudgetCents)+". New request forms will use this minimum."});return;
  }
  if(i.isButton()&&i.guildId===C.guild&&i.channelId===C.queue){
   const m=i.customId.match(/^gift:staff:(review|need-info|propose|decline|withdraw|resend|resend-payment|complete|closed|member-approved|member-declined):(GA-[A-Z0-9-]{8,40})$/);
   if(m){await staffAction(i,m[1],m[2]);return}
  }
  if(i.isModalSubmit()&&i.guildId===C.guild&&i.channelId===C.queue&&i.customId.startsWith("gift:staff:")){
   if(await submitStaffModal(i))return;
  }
 }catch(e){
  lastError=clean(e?.message||"unknown error",140);log("interaction-failed",{error:lastError,interaction:i.id});
  try{
   const message="Gift Assist could not complete that action. Use the inline dashboard in this channel or contact a moderator in the private Gift Assist Queue.";
   if(i.isModalSubmit()){if(i.deferred)await i.editReply({content:message});else if(!i.replied)await i.reply({content:message})}
   else if(i.isButton()||i.componentType){if(!i.deferred&&!i.replied)await i.reply({content:message});else if(i.deferred&&!i.replied)await i.followUp({content:message})}
  }catch{}
 }
}
Bun.serve({port:Number(Bun.env.PORT||3000),async fetch(req){
 const url=new URL(req.url),path=url.pathname;
if(req.method==="POST"&&path==="/interaction"){
  const raw=await req.text();
  if(raw.length>262144)return Response.json({error:"payload_too_large"},{status:413});
  const timestamp=req.headers.get("x-gift-assist-timestamp")||"",signature=req.headers.get("x-gift-assist-signature")||"";
  if(!TOKEN||!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>60000||!/^[a-f0-9]{64}$/i.test(signature))return Response.json({error:"forbidden"},{status:403});
  const expected=createHmac("sha256",TOKEN).update(timestamp+"."+raw).digest(),supplied=Buffer.from(signature,"hex");
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return Response.json({error:"forbidden"},{status:403});
  let payload;try{payload=JSON.parse(raw)}catch{return Response.json({error:"invalid_json"},{status:400})}
  if(!payload.id||!payload.token||!String(payload.data?.custom_id||"").startsWith("gift:"))return Response.json({error:"invalid_interaction"},{status:400});
  try{await handleGiftAssistInteraction(makeGiftInteraction(payload));return Response.json({ok:true})}
  catch(error){log("interaction-relay-failed",{customId:clean(payload.data?.custom_id||"",80),reason:clean(error?.message||error,140)});return Response.json({error:"interaction_failed"},{status:500})}
 }
 if(req.method==="POST"&&path==="/internal/manual-payment-update"){
  const incoming=Buffer.from(req.headers.get("x-gift-assist-sync")||""), expected=Buffer.from(SYNC_SECRET);
  if(!expected.length||incoming.length!==expected.length||!timingSafeEqual(incoming,expected))return Response.json({error:"forbidden"},{status:403});
  let payload;
  try{payload=await req.json()}catch{return Response.json({error:"invalid_json"},{status:400})}
  if(!/^GA-[A-Z0-9-]{8,40}$/.test(payload?.caseRef)||!["New","Reviewing","Need Info","Awaiting Member Approval","Member Approved — Payments Off","Awaiting Payment","Payment Failed","Payment Cancelled","Payment Received — Awaiting Fulfillment","Manual Verification Pending","Partially Paid","Declined","Withdrawn","Expired","Member Declined","Completed","Refunded","Partially Refunded"].includes(payload.status))return Response.json({error:"invalid_update"},{status:400});
  try{await applyCaseNotification(payload)}
  catch(error){log("notification-failed",{caseRef:payload.caseRef,reason:clean(error.message,140)});return Response.json({error:"case_update_failed"},{status:503})}
  return Response.json({ok:true});
 }
 if(req.method==="GET"&&path==="/health")return Response.json({service:"Momentum Movement Gift Assist",status:"ok",discordReady:ready,paymentsEnabled:PAYMENTS_ENABLED,paypalReady:PAYPAL_ON,stripeReady:STRIPE_ON,gatewayOwner:"Blickymania Bot 005",interactionTransport:"private-http-relay"});
 if(req.method==="GET"&&path==="/ready")return Response.json({service:"Momentum Movement Gift Assist",ready,discordReady:ready,paymentsEnabled:PAYMENTS_ENABLED,paypalReady:PAYPAL_ON,stripeReady:STRIPE_ON,gatewayOwner:"Blickymania Bot 005",interactionTransport:"private-http-relay",lastError:ready?"":lastError},{status:ready?200:503});
 try{const result=await paymentRoute(req,url);if(result)return result}
 catch(error){log("payment-route-failed",{path,reason:clean(error?.message||"request failed",120)});return Response.json({error:"Payment request could not be completed."},{status:500})}
 return new Response("Not Found",{status:404});
}});
log("http-listener-started",{port:Number(Bun.env.PORT||3000),paymentsEnabled:PAYMENTS_ENABLED,gatewayOwner:"Blickymania Bot 005",interactionTransport:"private-http-relay"});
verify().then(()=>{log("ready",{botId:C.app,paymentsEnabled:PAYMENTS_ENABLED,gatewayOwner:"Blickymania Bot 005"});importCases().then(resumePendingNotifications).catch(e=>log("case-import-failed",{reason:clean(e.message,140)}))}).catch(e=>{ready=false;lastError=clean(e?.message||"scope verification failed",140);log("startup-held",{error:lastError})});

// gift-assist-source-update-probe
