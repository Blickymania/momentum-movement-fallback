import {Client,Events,GatewayIntentBits,ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder} from "discord.js@14.27.0";
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
const SAFE={parse:[],users:[],roles:[],replied_user:false};
const bot=new Client({intents:[GatewayIntentBits.Guilds],allowedMentions:SAFE});
let ready=false,lastError="";
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
async function dm(id,content,components=[]){
 const ch=await rest("POST","/users/@me/channels",{recipient_id:id});
 return rest("POST","/channels/"+ch.id+"/messages",{content:clean(content,1850),...(components.length?{components}:{}),allowed_mentions:SAFE});
}
function input(id,label,style,required,max){return new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max))}
function requestModal(){return new ModalBuilder().setCustomId("gift:submit").setTitle("Gift Assist Request").addComponents(
 input("creator","Creator / TikTok handle",TextInputStyle.Short,true,80),
 input("target","Target LIVE date / time",TextInputStyle.Short,true,120),
 input("goal","Gift idea or support goal",TextInputStyle.Paragraph,true,450),
 input("budget","Optional maximum budget (USD)",TextInputStyle.Short,false,50),
 input("deadline","Deadline / special timing (optional)",TextInputStyle.Short,false,120))}
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
 if(status==="Awaiting Member Approval")return [{type:1,components:[btn("Resend Member Approval","gift:staff:resend:"+ref,1),btn("Withdraw","gift:staff:withdraw:"+ref,4)]}];
 if(status==="Awaiting Payment"||status==="Payment Failed"||status==="Payment Cancelled")return [{type:1,components:[btn("Resend Payment Link","gift:staff:resend-payment:"+ref,1),btn("Withdraw","gift:staff:withdraw:"+ref,4)]}];
 if(status==="Payment Received — Awaiting Fulfillment")return [{type:1,components:[btn("Mark Completed","gift:staff:complete:"+ref,3)]}];
 if(status==="Member Approved — Payments Off")return [{type:1,components:[btn("Complete (No Payment)","gift:staff:complete:"+ref,3),btn("Withdraw","gift:staff:withdraw:"+ref,4)]}];
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
 const s=String(m?.content||"");if(!s.startsWith("🎁 **MOMENTUM MOVEMENT GIFT ASSIST — STAFF CASE**"))return null;
 function get(label){const p="**"+label+":** ";const line=s.split("\n").find(x=>x.startsWith(p));return line?line.slice(p.length):""}
 const d={ref:get("Case Ref"),requesterId:get("Requester ID"),creator:get("Creator"),target:get("Target LIVE / Date"),goal:get("Gift Idea / Goal"),budget:get("Maximum Budget (member supplied)"),deadline:get("Deadline"),status:get("Status"),amount:get("Proposed Amount"),plan:get("Proposed Plan"),paymentStatus:get("Payment Status"),paymentProvider:get("Payment Provider"),providerReference:get("Payment Reference"),paymentEvents:get("Payment Events"),note:get("Staff Note"),messageId:m.id};
 if(!/^GA-[A-Z0-9-]{8,40}$/.test(d.ref)||!/^\d{17,22}$/.test(d.requesterId))return null;return d;
}
async function queueMessages(){return rest("GET","/channels/"+C.queue+"/messages?limit=100")}
async function findCase(ref){const messages=await queueMessages();const m=messages.find(x=>parseCase(x)?.ref===ref);if(!m)throw Error("Gift Assist case not found in private queue");return {message:m,data:parseCase(m)}}
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
async function saveCase(m,d){return rest("PATCH","/channels/"+C.queue+"/messages/"+m.id,{content:renderCase(d),components:caseButtons(d.ref,d.status),allowed_mentions:SAFE})}
function staff(i){
 if(i.user?.id===C.owner)return true;
 const roles=i.member?.roles?.cache?[...i.member.roles.cache.keys()]:Array.isArray(i.member?.roles)?i.member.roles:[];
 if(roles.includes(C.mod)||roles.includes(C.admin))return true;
 try{return Boolean(i.member?.permissions&&(BigInt(i.member.permissions)&8n)===8n)}catch{return false}
}
function cents(v){const raw=String(v||"").replace(/[$,\s]/g,"");if(!/^\d{1,5}(?:\.\d{1,2})?$/.test(raw))return null;const n=Math.round(Number(raw)*100);return Number.isSafeInteger(n)&&n>=50&&n<=1000000?n:null}
function money(n){return "$"+(n/100).toFixed(2)}
function memberButtons(ref){return [{type:1,components:[btn("Withdraw Request","gift:member:withdraw:"+ref,4)]}]}
function approvalButtons(ref){return [{type:1,components:[btn("Approve Plan","gift:member:approve:"+ref,3),btn("Decline Plan","gift:member:decline:"+ref,4)]}]}
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
 ready=true;log("scope-verified",{publicChannel:C.pub,staffQueue:C.queue,dashboard:C.dash,queuePrivate:true,paymentsEnabled:PAYMENTS_ENABLED});
}
async function submitRequest(i){
 const records=(await queueMessages()).map(parseCase).filter(Boolean);
 const duplicate=records.find(d=>d.requesterId===i.user.id&&["New","Reviewing","Need Info","Awaiting Member Approval","Member Approved — Payments Off","Awaiting Payment","Payment Failed","Payment Cancelled","Payment Received — Awaiting Fulfillment"].includes(d.status));
 if(duplicate){try{await dm(i.user.id,"You already have an open Gift Assist request: "+duplicate.ref+". Please use the private Help Desk for follow-up.",memberButtons(duplicate.ref))}catch{};return {ref:duplicate.ref,duplicate:true}}
 const creator=clean(i.fields.getTextInputValue("creator"),80),target=clean(i.fields.getTextInputValue("target"),120),goal=clean(i.fields.getTextInputValue("goal"),450),budget=clean(i.fields.getTextInputValue("budget"),50),deadline=clean(i.fields.getTextInputValue("deadline"),120);
 if(!creator||!target||!goal)throw Error("Creator, target LIVE/date, and gift idea are required");
 if(budget&&cents(budget)===null)throw Error("Maximum budget must be a positive USD amount, such as 25.00");
 const ref="GA-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,8).toUpperCase();
 const d={ref,requesterId:i.user.id,creator,target,goal,budget,deadline,status:"New",amount:"",plan:"",note:"Awaiting staff review"};
 const m=await rest("POST","/channels/"+C.queue+"/messages",{content:renderCase(d),components:caseButtons(ref,d.status),allowed_mentions:SAFE});
 if(!m.id)throw Error("Private Gift Assist case could not be created");
 log("request-created",{caseRef:ref,messageId:m.id});
 try{await dm(i.user.id,"🎁 Your Momentum Movement Gift Assist request "+ref+" has been received and is **New**. Staff will review it privately. No payment has been requested or collected. Payments are disabled until provider accounts, testing and owner approval are complete.",memberButtons(ref))}catch{log("requester-dm-unavailable",{caseRef:ref})}
 return {ref,duplicate:false};
}
async function staffAction(i,action,ref){
 if(!staff(i))throw Error("Authorized staff only");
 const {message,data}=await findCase(ref);
 if(i.message?.id!==message.id||i.channelId!==C.queue)throw Error("Control does not match its private case");
 if(action==="propose"){await i.showModal(planModal(ref));return}
 if(action==="need-info"){await i.showModal(infoModal(ref));return}
 if(action==="review"&&["New","Need Info"].includes(data.status)){
  data.status="Reviewing";data.note="Assigned staff review in progress";await i.deferUpdate();await saveCase(message,data);
  try{await dm(data.requesterId,"🎁 Gift Assist "+ref+" is now being reviewed by staff. No payment is being collected.")}catch{};return;
 }
 if(action==="resend-payment"&&["Awaiting Payment","Payment Failed","Payment Cancelled"].includes(data.status)&&PAYMENTS_ENABLED){await i.deferUpdate();await dm(data.requesterId,"🎁 Your secure Gift Assist checkout link for "+ref+" is ready: "+checkoutUrl(data));return;}
 if(action==="resend"&&data.status==="Awaiting Member Approval"){
  await i.deferUpdate();await dm(data.requesterId,"🎁 **Gift Assist plan for "+ref+"**\n**Proposed contribution:** "+data.amount+"\n**Purpose:** "+data.plan+"\n\nApprove or decline. Approval does not charge you or confirm a gift. Payments remain disabled.",approvalButtons(ref));return;
 }
 if(action==="decline"&&["New","Reviewing","Need Info","Awaiting Member Approval"].includes(data.status)){
  data.status="Declined";data.note="Declined by authorized staff";await i.deferUpdate();await saveCase(message,data);
  try{await dm(data.requesterId,"Your Gift Assist request "+ref+" was declined. No payment was collected.")}catch{};return;
 }
 if(action==="withdraw"&&!["Completed","Declined","Withdrawn","Expired","Member Declined","Payment Received — Awaiting Fulfillment","Refunded","Partially Refunded"].includes(data.status)){
  data.status="Withdrawn";data.note="Withdrawn by authorized staff";await i.deferUpdate();await saveCase(message,data);
  try{await dm(data.requesterId,"Your Gift Assist request "+ref+" was withdrawn by staff. No payment was collected.")}catch{};return;
 }
 if(action==="complete"&&["Member Approved — Payments Off","Payment Received — Awaiting Fulfillment"].includes(data.status)){
  data.status="Completed";data.note=data.paymentStatus==="Paid"?"Staff marked provider-confirmed gift coordination complete":"Staff marked no-payment coordination complete; no payment processed";await i.deferUpdate();await saveCase(message,data);
  try{await dm(data.requesterId,data.paymentStatus==="Paid"?"Your Gift Assist case "+ref+" is marked complete. The provider-confirmed contribution was recorded.":"Your Gift Assist case "+ref+" has been marked complete. No payment was collected or verified.")}catch{};return;
 }
 throw Error("Action is not valid for the current case status");
}
async function memberAction(i,action,ref){
 const {message,data}=await findCase(ref);if(i.user.id!==data.requesterId)throw Error("Only the original requester can decide this plan");
 if(action==="withdraw"&&!["Completed","Declined","Withdrawn","Expired","Member Declined","Payment Received — Awaiting Fulfillment","Refunded","Partially Refunded"].includes(data.status)){
  data.status="Withdrawn";data.note="Withdrawn by requester";await saveCase(message,data);
  await i.update({content:"Your Gift Assist request "+ref+" has been withdrawn. No payment was collected.",components:[],allowed_mentions:SAFE});return;
 }
 if(action==="approve"&&data.status==="Awaiting Member Approval"){
  if(PAYMENTS_ENABLED){
   data.status="Awaiting Payment";data.paymentStatus="Awaiting Payment";data.paymentProvider="Not selected";data.providerReference="Not assigned";data.paymentEvents="";data.note="Member approved plan; secure provider checkout link issued";
   await saveCase(message,data);
   const link=checkoutUrl(data);
   const controls=[{type:1,components:[{type:2,style:5,label:"Open Secure Checkout",url:link},{type:2,style:4,label:"Withdraw Request",custom_id:"gift:member:withdraw:"+ref}]}];
   try{await dm(data.requesterId,"🎁 **Gift Assist checkout for "+ref+"**\\n**Amount:** "+data.amount+"\\n**Purpose:** "+data.plan+"\\n**Recipient:** "+RECEIVER_LABEL+"\\nUse the secure checkout link below. Payment status is confirmed only by the provider. You may withdraw before payment.",controls)}catch{}
   await i.update({content:"You approved the plan. A secure checkout link has been sent to your direct messages.",components:[],allowed_mentions:SAFE});return;
  }
  data.status="Member Approved — Payments Off";data.paymentStatus="Disabled";data.note="Member approved plan; payment remains disabled";await saveCase(message,data);
  await i.update({content:"Your plan approval for "+ref+" is recorded. **This does not charge you or confirm a gift.** Payment collection remains disabled while provider accounts and verification are pending. Staff can only coordinate a no-payment alternative until activation.",components:[],allowed_mentions:SAFE});return;
 }
 if(action==="decline"&&data.status==="Awaiting Member Approval"){
  data.status="Member Declined";data.note="Member declined the proposed plan";await saveCase(message,data);
  await i.update({content:"You declined the proposed plan for "+ref+". No payment was collected.",components:[],allowed_mentions:SAFE});return;
 }
 throw Error("Your Gift Assist decision is no longer available");
}
async function submitStaffModal(i){
 const info=i.customId.match(/^gift:staff:info-submit:(GA-[A-Z0-9-]{8,40})$/),plan=i.customId.match(/^gift:staff:plan-submit:(GA-[A-Z0-9-]{8,40})$/);
 if(!info&&!plan)return false;
 if(!staff(i)||i.channelId!==C.queue)throw Error("Staff-only Gift Assist case control");
 const ref=(info||plan)[1],{message,data}=await findCase(ref);
 if(info){
  const question=clean(i.fields.getTextInputValue("question"),700);if(!question)throw Error("Enter the information needed");
  data.status="Need Info";data.note="Staff asked requester: "+question;await i.deferReply();await saveCase(message,data);
  try{await dm(data.requesterId,"🎁 Gift Assist "+ref+" needs a clarification:\n"+question+"\n\nPlease reply through the private Help Desk. Do not post budgets or personal details publicly.")}catch{};await i.editReply({content:"Clarification request sent privately to the member for case "+ref+"."});return true;
 }
 const n=cents(i.fields.getTextInputValue("amount")),planText=clean(i.fields.getTextInputValue("plan"),650);
 if(n===null||!planText)throw Error("Enter a valid contribution amount and purpose");
 const max=data.budget?cents(data.budget):null;if(max!==null&&n>max)throw Error("Proposed amount exceeds the member's stated maximum budget");
 data.amount=money(n);data.plan=planText;data.status="Awaiting Member Approval";data.note="Plan proposed by staff; awaiting requester decision";
 await i.deferReply();await saveCase(message,data);
 try{await dm(data.requesterId,"🎁 **Gift Assist plan for "+ref+"**\n**Proposed contribution:** "+data.amount+"\n**Purpose:** "+data.plan+"\n\nApprove or decline. Approval does not charge you, guarantee a gift, or authorize payment outside this system. Payment collection is disabled.",approvalButtons(ref))}catch{log("plan-dm-unavailable",{caseRef:ref})}
 await i.editReply({content:"Plan proposal sent privately to the member for case "+ref+". Payments remain disabled."});
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
 const {base,access}=await paypalToken(),value=(amountFor(data)/100).toFixed(2);
 const response=await fetch(base+"/v2/checkout/orders",{method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json","PayPal-Request-Id":data.ref+"-"+crypto.randomUUID()},body:JSON.stringify({intent:"CAPTURE",purchase_units:[{reference_id:data.ref,custom_id:data.ref,invoice_id:data.ref,description:"Momentum Movement Gift Assist "+data.ref,amount:{currency_code:CURRENCY,value}}]}),signal:AbortSignal.timeout(20000)});
 const order=await response.json().catch(()=>({}));if(!response.ok||!order.id)throw Error("PayPal could not create this checkout");
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
 const amount=amountFor(data),params=new URLSearchParams();
 params.set("mode","payment");params.set("client_reference_id",data.ref);
 params.set("success_url",CHECKOUT_BASE+"/checkout/return?token="+encodeURIComponent(token)+"&provider=stripe&session_id={CHECKOUT_SESSION_ID}");
 params.set("cancel_url",CHECKOUT_BASE+"/checkout/"+encodeURIComponent(token)+"?cancelled=1");
 params.set("line_items[0][quantity]","1");params.set("line_items[0][price_data][currency]","usd");
 params.set("line_items[0][price_data][unit_amount]",String(amount));
 params.set("line_items[0][price_data][product_data][name]","Momentum Movement Gift Assist Contribution");
 params.set("line_items[0][price_data][product_data][description]","Approved contribution for "+data.ref);
 params.set("payment_method_types[0]","card");if(STRIPE_CASHAPP_ON)params.set("payment_method_types[1]","cashapp");
 params.set("metadata[case_ref]",data.ref);params.set("metadata[requester_id]",data.requesterId);params.set("payment_intent_data[metadata][case_ref]",data.ref);
 const response=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:"Bearer "+Bun.env.GIFT_ASSIST_STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},body:params.toString(),signal:AbortSignal.timeout(20000)});
 const session=await response.json().catch(()=>({}));if(!response.ok||!session.id||!session.url)throw Error("Stripe could not create this checkout");
 data.status="Awaiting Payment";data.status="Awaiting Payment";data.paymentStatus="Awaiting Payment";data.paymentProvider="Stripe";data.providerReference=session.id;data.note="Stripe Checkout Session created; awaiting provider confirmation";
 await saveCase(message,data);return {url:session.url,id:session.id};
}
async function recordPayment(ref,provider,status,providerReference,eventId){
 const {message,data}=await findCase(ref),eventIds=String(data.paymentEvents||"").split(",").filter(Boolean);
 if(eventId&&eventIds.includes(eventId))return {duplicate:true};
 if(status==="Paid"&&data.paymentStatus==="Paid"&&String(data.providerReference||"")===String(providerReference||""))return {duplicate:true};
 if(eventId)data.paymentEvents=[...eventIds,eventId].slice(-12).join(",");
 data.paymentProvider=provider;data.providerReference=providerReference||data.providerReference||"";data.paymentStatus=status;
 if(status==="Paid"){data.status="Payment Received — Awaiting Fulfillment";data.note=provider+" verified the exact approved contribution"}
 else if(status==="Refunded"){data.status="Refunded";data.note=provider+" confirmed a full refund"}
 else if(status==="Partially Refunded"){data.status="Partially Refunded";data.note=provider+" confirmed a partial refund"}
 else if(status==="Failed"){data.status="Payment Failed";data.note=provider+" reported a failed payment"}
 else if(status==="Cancelled"){data.status="Payment Cancelled";data.note=provider+" checkout expired or was cancelled"}
 await saveCase(message,data);
 if(status==="Paid"){try{await dm(data.requesterId,"✅ Your Gift Assist contribution for "+ref+" was confirmed by "+provider+". Amount: "+data.amount+". Staff will coordinate the approved plan privately.")}catch{}}
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
async function stripeWebhook(req){
 const raw=await req.text();if(raw.length>1000000)return Response.json({error:"payload too large"},{status:413});
 if(!await verifyStripeSignature(raw,req.headers.get("stripe-signature")))return Response.json({error:"signature verification failed"},{status:401});
 let event;try{event=JSON.parse(raw)}catch{return Response.json({error:"invalid payload"},{status:400})}
 const obj=event.data?.object||{};let ref=obj.metadata?.case_ref||obj.client_reference_id||"",status="";
 if(event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded"){
  if(obj.payment_status==="paid"||event.type==="checkout.session.async_payment_succeeded"){
   if(!ref||obj.mode!=="payment"||String(obj.currency||"").toLowerCase()!=="usd")return Response.json({error:"Stripe payment metadata or currency mismatch"},{status:400});
   const {data}=await findCase(ref);
   if(Number(obj.amount_total)!==amountFor(data))return Response.json({error:"Stripe paid amount does not match approved Gift Assist amount"},{status:400});
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
 if(status&&ref)await recordPayment(ref,"Stripe",status,obj.id||event.id,event.id);
 return Response.json({received:true});
}
async function paypalWebhook(req){
 if(!PAYPAL_ON||!Bun.env.GIFT_ASSIST_PAYPAL_WEBHOOK_ID)return Response.json({error:"PayPal webhook is disabled"},{status:503});
 const raw=await req.text();if(raw.length>1000000)return Response.json({error:"payload too large"},{status:413});
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
  try{found=direct?await findCase(direct):await findCaseByProviderReference("PayPal",[providerRef,order])}
  catch{return Response.json({error:"PayPal event does not match a Gift Assist payment"},{status:400})}
  const amount=resource.amount;
  if(!amount||String(amount.currency_code||"").toUpperCase()!=="USD"||Math.round(Number(amount.value)*100)!==amountFor(found.data))return Response.json({error:"PayPal amount does not match approved Gift Assist amount"},{status:400});
  if(type==="PAYMENT.CAPTURE.COMPLETED")status="Paid";
  else if(type==="PAYMENT.CAPTURE.DENIED")status="Failed";
  else status="Refunded";
  await recordPayment(found.data.ref,"PayPal",status,providerRef,event.id);
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
  }catch{return new Response("Checkout status unavailable. Check your Gift Assist direct message or contact Help Desk.",{status:404})}
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
 const how="🎁 **Momentum Movement Gift Assist — How It Works**\n\n1. Select Start Request and privately submit the creator, target LIVE/date, gift idea, and optional maximum budget.\n2. Authorized staff review your request in the private queue.\n3. Staff may request clarification or propose an amount and purpose.\n4. You privately approve or decline the proposal.\n5. No payment is collected. PayPal Checkout and Stripe Checkout are prepared for later account connection; Venmo, Cash App Pay and eligible wallets appear only if the linked provider/account supports them.";
 const policy="⏱️ **Gift Assist — 48-Hour Planning & Payment Policy**\n\nSubmit at least 48 hours before the target LIVE when possible. Late requests are best-effort and not guaranteed.\n\nContributions are voluntary. Never borrow, feel pressured, or raise your budget. Plan approval is not payment, booking, or a gift guarantee. Payment collection is OFF until provider accounts, request-specific checkout, refund/unused-fund rules, provider verification, and owner approval are complete. Never send money to a moderator's personal account or share financial credentials in Discord.";
 try{await dm(i.user.id,kind==="how"?how:policy)}catch{log("guide-dm-unavailable",{userId:i.user.id,kind})}
}
bot.on(Events.InteractionCreate,async i=>{
 try{
  if(!ready)throw Error("Gift Assist is still starting; try again shortly");
  if(i.isButton()&&i.guildId===C.guild&&i.channelId===C.pub&&i.message?.id===C.dash&&i.message?.author?.id===C.app){
   if(i.customId==="gift:start"){await i.showModal(requestModal());return}
   if(i.customId==="gift:how"){await guide(i,"how");return}
   if(i.customId==="gift:policy"){await guide(i,"policy");return}
  }
  if(i.isModalSubmit()&&i.guildId===C.guild&&i.channelId===C.pub&&i.customId==="gift:submit"){
   await i.deferReply();
   const result=await submitRequest(i);
   await i.editReply({content:result.duplicate?"You already have an open Gift Assist request. Please use the private Help Desk for follow-up.":"Your Gift Assist request was received. Staff will review it privately; check your direct messages for the case reference. No payment was collected."});
   return;
  }
  if(i.isButton()&&i.guildId===C.guild&&i.channelId===C.queue){
   const m=i.customId.match(/^gift:staff:(review|need-info|propose|decline|withdraw|resend|resend-payment|complete|closed):(GA-[A-Z0-9-]{8,40})$/);
   if(m){await staffAction(i,m[1],m[2]);return}
  }
  if(i.isModalSubmit()&&i.guildId===C.guild&&i.channelId===C.queue&&i.customId.startsWith("gift:staff:")){
   if(await submitStaffModal(i))return;
  }
  if(i.isButton()&&!i.guildId){
   const m=i.customId.match(/^gift:member:(approve|decline|withdraw):(GA-[A-Z0-9-]{8,40})$/);
   if(m){await memberAction(i,m[1],m[2]);return}
  }
 }catch(e){
  lastError=clean(e?.message||"unknown error",140);log("interaction-failed",{error:lastError,interaction:i.id});
  try{
   const message="Gift Assist could not complete that action. Please use the private Help Desk and include your case reference if you have one.";
   if(i.isModalSubmit()){if(i.deferred)await i.editReply({content:message});else if(!i.replied)await i.reply({content:message})}
   else if(i.isButton()){if(!i.deferred&&!i.replied)await i.reply({content:message});else if(i.deferred&&!i.replied)await i.followUp({content:message})}
  }catch{}
 }
});
bot.once(Events.ClientReady,async()=>{
 try{await verify();log("ready",{botId:bot.user.id,paymentsEnabled:PAYMENTS_ENABLED})}
 catch(e){ready=false;lastError=clean(e?.message||"scope verification failed",140);log("startup-held",{error:lastError})}
});
bot.login(TOKEN).catch(e=>{lastError=clean(e?.message||"Discord login failed",140);log("login-failed",{error:lastError})});
Bun.serve({port:Number(Bun.env.PORT||3000),async fetch(req){
 const url=new URL(req.url),path=url.pathname;
 if(req.method==="GET"&&path==="/health")return Response.json({service:"Momentum Movement Gift Assist",status:"ok",discordReady:ready,paymentsEnabled:PAYMENTS_ENABLED,paypalReady:PAYPAL_ON,stripeReady:STRIPE_ON});
 if(req.method==="GET"&&path==="/ready")return Response.json({service:"Momentum Movement Gift Assist",ready,discordReady:ready,paymentsEnabled:PAYMENTS_ENABLED,paypalReady:PAYPAL_ON,stripeReady:STRIPE_ON,lastError:ready?"":lastError},{status:ready?200:503});
 try{const result=await paymentRoute(req,url);if(result)return result}
 catch(error){log("payment-route-failed",{path,reason:clean(error?.message||"request failed",120)});return Response.json({error:"Payment request could not be completed."},{status:500})}
 return new Response("Not Found",{status:404});
}});
log("http-listener-started",{port:Number(Bun.env.PORT||3000),paymentsEnabled:PAYMENTS_ENABLED});
