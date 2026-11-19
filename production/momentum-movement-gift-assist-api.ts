// Independent internal-only Gift Assist API.
import postgres from "postgres";
import {randomUUID,timingSafeEqual} from "node:crypto";
const env=Bun.env;
const INTERNAL_SECRET=String(env.GIFT_ASSIST_INTERNAL_SECRET||"");
const CHECKOUT_BASE=String(env.GIFT_ASSIST_CHECKOUT_BASE_URL||"").replace(/[/]+$/,"");
const DATA_KEY=String(env.GIFT_ASSIST_DATA_ENCRYPTION_KEY||"");
if(!env.DATABASE_URL)throw new Error("Gift Assist database is not configured");
if(!INTERNAL_SECRET)throw new Error("Gift Assist internal authentication is not configured");
const sql=postgres(env.DATABASE_URL,{max:5,idle_timeout:20,connect_timeout:15});
const json=(data,status=200)=>Response.json(data,{status,headers:{"cache-control":"no-store","access-control-allow-origin":"*","vary":"Origin"}});
async function readLimitedBody(req,limit){
 if(Number(req.headers.get("content-length")||0)>limit)throw Error("too_large");
 const reader=req.body?.getReader();if(!reader)return new Uint8Array();
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error("too_large");}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
const bodyOf=async req=>{const body=JSON.parse(new TextDecoder().decode(await readLimitedBody(req,1000000)));if(!body||typeof body!=="object"||Array.isArray(body))throw Error("invalid_json");return body;};
function giftInternalAuthorized(req){const supplied=Buffer.from(req.headers.get("x-gift-assist-sync")||"");const expected=Buffer.from(INTERNAL_SECRET);return expected.length>0&&supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
const giftClean=(v,n=300)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,n);
const giftCents=(v,minimum=50)=>{const raw=String(v??"").replace(/[$,\s]/g,"");if(!/^\d{1,5}(?:\.\d{1,2})?$/.test(raw))return null;const n=Math.round(Number(raw)*100);return Number.isSafeInteger(n)&&n>=minimum&&n<=1000000?n:null;};
const giftHttps=v=>{try{return new URL(String(v)).protocol==="https:";}catch{return false;}};
const giftAudit=async(actor,action,type,id,details={},connection=sql)=>connection.unsafe("INSERT INTO gift_assist.audit_events(id,actor_id,action,entity_type,entity_id,details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",[randomUUID(),String(actor||"system"),action,type,id||"",JSON.stringify(details)]);
const giftGetSetting=async key=>{const r=await sql.unsafe("SELECT value FROM gift_assist.settings WHERE key=$1",[key]);return r.length?r[0].value:null;};
const giftSetSetting=async(key,value,actor)=>sql.unsafe("INSERT INTO gift_assist.settings(key,value,updated_by,updated_at) VALUES ($1,$2::jsonb,$3,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()",[key,JSON.stringify(value),actor]);
const giftProfileReady=p=>!!(p&&giftClean(p.recipientLabel,100)&&giftClean(p.legalEntity,160)&&giftClean(p.businessType,100)&&giftHttps(p.termsUrl)&&giftHttps(p.refundPolicyUrl)&&giftHttps(p.unusedFundsPolicyUrl)&&p.policyAcknowledged===true);
const giftManualReady=async()=>{if(!/^[0-9a-f]{64}$/i.test(DATA_KEY))return false;const [enabled,profile,dests]=await Promise.all([giftGetSetting("manual_payments_enabled"),giftGetSetting("financial_profile"),sql.unsafe("SELECT COUNT(*)::int AS count FROM gift_assist.manual_destinations WHERE is_verified=true AND is_enabled=true")]);return enabled===true&&giftProfileReady(profile)&&Number(dests[0]?.count||0)>0;};
const giftCase=async ref=>{const r=await sql.unsafe("SELECT * FROM gift_assist.cases WHERE case_ref=$1 LIMIT 1",[ref]);return r[0]||null;};
const giftQueueNotification=(body,connection=sql)=>connection.unsafe("INSERT INTO gift_assist.notification_outbox(id,case_ref,payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING",[body.notificationId,body.caseRef,JSON.stringify(body)]);
async function giftNotifyBot(body){
 if(!CHECKOUT_BASE||!INTERNAL_SECRET)return false;
 try{const response=await fetch(CHECKOUT_BASE+"/internal/manual-payment-update",{method:"POST",headers:{"content-type":"application/json","x-gift-assist-sync":INTERNAL_SECRET},body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});if(!response.ok)throw Error("Discord mirror returned "+response.status);await sql.unsafe("UPDATE gift_assist.notification_outbox SET delivered_at=now(),last_error='' WHERE id=$1",[body.notificationId]);return true;}
 catch(error){await sql.unsafe("UPDATE gift_assist.notification_outbox SET last_error=$1 WHERE id=$2",[giftClean(error.message,160),body.notificationId]);return false;}
}
const giftAssistDdl = [
"CREATE SCHEMA IF NOT EXISTS gift_assist",
"CREATE TABLE IF NOT EXISTS gift_assist.cases (case_ref text PRIMARY KEY,requester_id text NOT NULL,creator text NOT NULL DEFAULT '',target text NOT NULL DEFAULT '',goal text NOT NULL DEFAULT '',budget_cents integer,amount_cents integer,plan text NOT NULL DEFAULT '',status text NOT NULL,payment_status text NOT NULL DEFAULT 'Not Started',payment_provider text NOT NULL DEFAULT 'Not selected',provider_reference text NOT NULL DEFAULT '',payment_events jsonb NOT NULL DEFAULT '[]'::jsonb,staff_note text NOT NULL DEFAULT '',discord_message_id text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS gift_assist.case_cashapp_assignments (case_ref text PRIMARY KEY REFERENCES gift_assist.cases(case_ref),destination_id text NOT NULL REFERENCES gift_assist.manual_destinations(id),assigned_by text NOT NULL,assigned_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS gift_assist.manual_destinations (id text PRIMARY KEY,label text NOT NULL,method text NOT NULL,recipient_name text NOT NULL,instructions text NOT NULL,account_details_enc text NOT NULL DEFAULT '',payment_url text NOT NULL DEFAULT '',qr_url text NOT NULL DEFAULT '',is_verified boolean NOT NULL DEFAULT false,is_enabled boolean NOT NULL DEFAULT false,created_by text NOT NULL,verified_by text,verified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS gift_assist.manual_submissions (id text PRIMARY KEY,case_ref text NOT NULL REFERENCES gift_assist.cases(case_ref),requester_id text NOT NULL,destination_id text NOT NULL REFERENCES gift_assist.manual_destinations(id),amount_cents integer NOT NULL,transaction_reference text NOT NULL,paid_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'Submitted — Awaiting Verification',receipt_enc text,receipt_name text,receipt_type text,reviewed_by text,reviewed_at timestamptz,review_note text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE UNIQUE INDEX IF NOT EXISTS gift_assist_manual_tx_unique ON gift_assist.manual_submissions(destination_id,LOWER(transaction_reference))",
"CREATE TABLE IF NOT EXISTS gift_assist.ledger (id text PRIMARY KEY,case_ref text NOT NULL,requester_id text NOT NULL,direction text NOT NULL CHECK(direction IN ('inflow','outflow')),method text NOT NULL,provider text,amount_cents integer NOT NULL,fee_cents integer,net_cents integer,currency text NOT NULL DEFAULT 'USD',status text NOT NULL,transaction_reference text,provider_event_id text UNIQUE,recorded_by text NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS gift_assist.refund_requests (id text PRIMARY KEY,case_ref text NOT NULL,requester_id text NOT NULL,amount_cents integer NOT NULL,reason text NOT NULL,status text NOT NULL DEFAULT 'Requested',reviewed_by text,reviewed_at timestamptz,review_note text,processed_reference text,processed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS gift_assist.provider_payments (provider text NOT NULL,payment_key text NOT NULL,case_ref text NOT NULL REFERENCES gift_assist.cases(case_ref),amount_cents integer NOT NULL CHECK(amount_cents>0),refunded_cents integer NOT NULL DEFAULT 0 CHECK(refunded_cents>=0 AND refunded_cents<=amount_cents),PRIMARY KEY(provider,payment_key))",
"CREATE TABLE IF NOT EXISTS gift_assist.notification_outbox (id text PRIMARY KEY,case_ref text NOT NULL REFERENCES gift_assist.cases(case_ref),payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,last_error text NOT NULL DEFAULT '')",
"CREATE TABLE IF NOT EXISTS gift_assist.checkout_attempts (case_ref text PRIMARY KEY REFERENCES gift_assist.cases(case_ref),provider text NOT NULL,attempt_key text NOT NULL,provider_reference text NOT NULL DEFAULT '',checkout_url text NOT NULL DEFAULT '',return_token text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'pending',updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS gift_assist.settings (key text PRIMARY KEY,value jsonb NOT NULL,updated_by text,updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS gift_assist.audit_events (id text PRIMARY KEY,actor_id text NOT NULL,action text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL DEFAULT '',details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now())",
"CREATE INDEX IF NOT EXISTS gift_assist_cases_requester_idx ON gift_assist.cases(requester_id,updated_at DESC)",
"CREATE INDEX IF NOT EXISTS gift_assist_ledger_case_idx ON gift_assist.ledger(case_ref,created_at DESC)",
"CREATE INDEX IF NOT EXISTS gift_assist_manual_status_idx ON gift_assist.manual_submissions(status,created_at DESC)",
"CREATE INDEX IF NOT EXISTS gift_assist_refunds_status_idx ON gift_assist.refund_requests(status,created_at DESC)",
"INSERT INTO gift_assist.settings(key,value) VALUES ('manual_payments_enabled','false'::jsonb) ON CONFLICT DO NOTHING",
"INSERT INTO gift_assist.settings(key,value) VALUES ('financial_profile','{}'::jsonb) ON CONFLICT DO NOTHING"
];
await sql.begin(async tx=>{for(const statement of giftAssistDdl)await tx.unsafe(statement);});

function normalizeCashTag(raw){
 const body=String(raw??"").normalize("NFKC").trim().replace(/^\$/,"");
 if(!/^[A-Za-z0-9]{1,20}$/.test(body)||!/[A-Za-z]/.test(body))throw Error("invalid_cashtag");
 return "$"+body;
}
async function seedOwnerCashApp(){
 const tag="$ShamekaDDowell";
 const found=await sql.unsafe("SELECT id FROM gift_assist.manual_destinations WHERE lower(method) IN ('cash app','cashapp','cash_app','cash-app') AND lower(ltrim(recipient_name,'$'))=lower($1) LIMIT 1",[tag.slice(1)]);
 if(found.length)return {seeded:false};
 const id=randomUUID();
 await sql.unsafe("INSERT INTO gift_assist.manual_destinations(id,label,method,recipient_name,instructions,created_by,is_verified,is_enabled) VALUES($1,$2,'Cash App',$3,$4,$5,false,false)",[id,tag,tag,"Configuration only; ownership not verified, collection OFF.","owner-authorized-2026-11-19"]);
 await giftAudit("owner-authorized-2026-11-19","cashapp_recipient_added","manual_destination",id,{cashtag:tag,verified:false,collectionEnabled:false});
 return {seeded:true};
}
async function cashAppRecipients(){
 const rows=await sql.unsafe("SELECT id,label,recipient_name,is_verified,is_enabled FROM gift_assist.manual_destinations WHERE lower(method) IN ('cash app','cashapp','cash_app','cash-app') ORDER BY created_at ASC,id ASC");
 const selected=await giftGetSetting("cashapp_selected_destination_id");
 return {recipients:rows.map(r=>({id:r.id,label:r.label,cashtag:r.recipient_name.startsWith("$")?r.recipient_name:"$"+r.recipient_name,verified:r.is_verified,enabled:r.is_enabled})),selectedId:typeof selected==="string"?selected:"",collectionEnabled:false};
}

let ready=false,lastError="";
const server=Bun.serve({port:Number(env.PORT||3000),async fetch(req){
 const url=new URL(req.url),path=url.pathname;
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":"*","access-control-allow-headers":"content-type,x-gift-assist-sync","access-control-allow-methods":"GET,POST,OPTIONS"}});
 if(req.method==="GET"&&path==="/health")return json({service:"Momentum Movement Gift Assist API",status:ready?"ok":"starting",database:"gift-assist-dedicated",ready,paymentsEnabled:false});
 if(req.method==="GET"&&path==="/ready")return json({service:"Momentum Movement Gift Assist API",ready,database:"gift-assist-dedicated",lastError:ready?"":lastError},ready?200:503);
 if(!ready)return json({error:"not_ready"},503);
 if(req.method==="GET"&&path==="/gift-assist/health"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  try{const rows=await sql.unsafe("SELECT (SELECT count(*)::int FROM gift_assist.cases) AS cases,(SELECT count(*)::int FROM gift_assist.manual_destinations) AS destinations,(SELECT count(*)::int FROM gift_assist.ledger) AS entries");return json({ok:true,schema:3,apiAuth:"internal-hmac",...rows[0]});}catch{return json({ok:false},503);}
 }


 if(req.method==="GET"&&path==="/internal/gift-assist/manual-review-overview"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  const [counts,refundCounts,destinations,latest,manualEnabled,profile]=await Promise.all([
   sql.unsafe("SELECT status,COUNT(*)::int AS count FROM gift_assist.manual_submissions GROUP BY status ORDER BY status"),
   sql.unsafe("SELECT status,COUNT(*)::int AS count FROM gift_assist.refund_requests GROUP BY status ORDER BY status"),
   sql.unsafe("SELECT COUNT(*)::int AS registered,COUNT(*) FILTER(WHERE is_verified=true AND is_enabled=true)::int AS approved,COUNT(*) FILTER(WHERE is_verified=false)::int AS unverified FROM gift_assist.manual_destinations"),
   sql.unsafe("SELECT m.id,m.case_ref,m.status,m.amount_cents,m.created_at,d.method,d.label FROM gift_assist.manual_submissions m JOIN gift_assist.manual_destinations d ON d.id=m.destination_id ORDER BY m.created_at DESC,m.id DESC LIMIT 15"),
   giftGetSetting("manual_payments_enabled"),
   giftGetSetting("financial_profile")
  ]);
  const pendingStatus=["Submitted — Awaiting Verification","Needs Information","Under Review"];
  const countFor=status=>Number(counts.find(x=>x.status===status)?.count||0);
  const pending=pendingStatus.reduce((sum,status)=>sum+countFor(status),0);
  const isEncryptionReady=/^[0-9a-f]{64}$/i.test(DATA_KEY);
  const profileReady=giftProfileReady(profile);
  const approved=Number(destinations[0]?.approved||0);
  const enabled=manualEnabled===true;
  return json({
   ok:true,collectionEnabled:false,manualPaymentsEnabled:enabled,readyToCollect:false,
   gates:{ownershipVerified:approved>0,financialProfileComplete:profileReady,encryptionKeyConfigured:isEncryptionReady,manualSettingEnabled:enabled,ownerActivationApproved:false},
   recipients:{registered:Number(destinations[0]?.registered||0),approved,unverified:Number(destinations[0]?.unverified||0)},
   submissions:{pending,total:counts.reduce((sum,x)=>sum+Number(x.count||0),0),byStatus:counts.map(x=>({status:x.status,count:Number(x.count)}))},
   refunds:{total:refundCounts.reduce((sum,x)=>sum+Number(x.count||0),0),byStatus:refundCounts.map(x=>({status:x.status,count:Number(x.count)}))},
   latest:latest.map(x=>({id:x.id,caseRef:x.case_ref,status:x.status,amountCents:Number(x.amount_cents),method:x.method,methodLabel:x.label,createdAt:x.created_at}))
  });
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/manual-review-decide"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let b;try{b=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const id=giftClean(b.submissionId,60),actor=giftClean(b.actorId,30),decision=giftClean(b.decision,40),note=giftClean(b.note,500);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!/^\d{17,22}$/.test(actor)||!["Needs Information","Rejected"].includes(decision)||note.length<10)return json({error:"invalid_review_decision"},400);
  return sql.begin(async db=>{
   const [record]=await db.unsafe("SELECT m.id,m.case_ref,m.status,c.payment_status FROM gift_assist.manual_submissions m JOIN gift_assist.cases c ON c.case_ref=m.case_ref WHERE m.id=$1 FOR UPDATE OF m",[id]);
   if(!record)return json({error:"submission_not_found"},404);
   if(!["Submitted — Awaiting Verification","Under Review","Needs Information"].includes(record.status))return json({error:"submission_not_reviewable"},409);
   if(record.payment_status==="Paid"||record.payment_status==="Refunded")return json({error:"case_payment_finalized"},409);
   await db.unsafe("UPDATE gift_assist.manual_submissions SET status=$1,reviewed_by=$2,reviewed_at=now(),review_note=$3,updated_at=now() WHERE id=$4",[decision,actor,note,id]);
   await giftAudit(actor,"manual_submission_reviewed","manual_submission",id,{caseRef:record.case_ref,decision,note,financialTransfer:false},db);
   return json({ok:true,submissionId:id,caseRef:record.case_ref,status:decision,collectionEnabled:false,ledgerChanged:false});
  });
 }
 if(req.method==="GET"&&path==="/internal/gift-assist/cashapp-recipients"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  return json(await cashAppRecipients());
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/cashapp-add"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  let tag;try{tag=normalizeCashTag(body.cashtag)}catch{return json({error:"invalid_cashtag"},400)}
  const actor=giftClean(body.actorId,30);
  if(!/^\d{17,22}$/.test(actor))return json({error:"invalid_actor"},400);
  return sql.begin(async tx=>{
   await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))",["giftassist-cashtag:"+tag.toLowerCase()]);
   const found=await tx.unsafe("SELECT id,recipient_name FROM gift_assist.manual_destinations WHERE lower(method) IN ('cash app','cashapp','cash_app','cash-app') AND lower(ltrim(recipient_name,'$'))=lower($1) ORDER BY created_at ASC LIMIT 1",[tag.slice(1)]);
   if(found.length)return json({ok:true,duplicate:true,id:found[0].id,cashtag:found[0].recipient_name.startsWith("$")?found[0].recipient_name:"$"+found[0].recipient_name});
   const id=randomUUID();
   await tx.unsafe("INSERT INTO gift_assist.manual_destinations(id,label,method,recipient_name,instructions,created_by,is_verified,is_enabled) VALUES($1,$2,'Cash App',$3,$4,$5,false,false)",[id,tag,tag,"Pending verification; planning only. No payment collection.",actor]);
   await giftAudit(actor,"cashapp_recipient_added","manual_destination",id,{cashtag:tag,verified:false,collectionEnabled:false},tx);
   return json({ok:true,duplicate:false,id,cashtag:tag});
  });
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/cashapp-select"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const actor=giftClean(body.actorId,30),id=giftClean(body.destinationId,60);
  if(!/^\d{17,22}$/.test(actor)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return json({error:"invalid_selection"},400);
  const rows=await sql.unsafe("SELECT id,recipient_name FROM gift_assist.manual_destinations WHERE id=$1 AND lower(method) IN ('cash app','cashapp','cash_app','cash-app')",[id]);
  if(!rows.length)return json({error:"cashapp_recipient_not_found"},404);
  await sql.begin(async db=>{
   await db.unsafe("INSERT INTO gift_assist.settings(key,value,updated_by,updated_at) VALUES('cashapp_selected_destination_id',$1::jsonb,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()",[JSON.stringify(id),actor]);
   await giftAudit(actor,"cashapp_recipient_selected","manual_destination",id,{cashtag:rows[0].recipient_name,collectionEnabled:false},db);
  });
  return json({ok:true,selectedId:id,cashtag:rows[0].recipient_name.startsWith("$")?rows[0].recipient_name:"$"+rows[0].recipient_name,collectionEnabled:false});
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/cashapp-case-get"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const ref=giftClean(body.caseRef,60);
  if(!/^GA-[A-Z0-9-]{8,40}$/.test(ref))return json({error:"invalid_case_ref"},400);
  const [record]=await sql.unsafe("SELECT c.case_ref,c.status,c.payment_status,a.destination_id,d.recipient_name,d.is_verified FROM gift_assist.cases c LEFT JOIN gift_assist.case_cashapp_assignments a ON a.case_ref=c.case_ref LEFT JOIN gift_assist.manual_destinations d ON d.id=a.destination_id WHERE c.case_ref=$1",[ref]);
  if(!record)return json({error:"case_not_found"},404);
  return json({caseRef:ref,assignedId:record.destination_id||"",cashtag:record.recipient_name?normalizeCashTag(record.recipient_name):"",verified:record.is_verified===true,collectionEnabled:false});
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/cashapp-case-assign"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const ref=giftClean(body.caseRef,60),actor=giftClean(body.actorId,30),id=giftClean(body.destinationId,60);
  if(!/^GA-[A-Z0-9-]{8,40}$/.test(ref)||!/^\d{17,22}$/.test(actor)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return json({error:"invalid_case_assignment"},400);
  return sql.begin(async db=>{
   const [record]=await db.unsafe("SELECT case_ref,status,payment_status FROM gift_assist.cases WHERE case_ref=$1 FOR UPDATE",[ref]);
   if(!record)return json({error:"case_not_found"},404);
   if(!["New","Reviewing","Need Info","Awaiting Member Approval","Member Approved — Payments Off"].includes(record.status)||record.payment_status!=="Not Started")return json({error:"case_not_eligible_for_recipient_assignment"},409);
   const [recipient]=await db.unsafe("SELECT id,recipient_name,is_verified FROM gift_assist.manual_destinations WHERE id=$1 AND lower(method) IN ('cash app','cashapp','cash_app','cash-app')",[id]);
   if(!recipient)return json({error:"cashapp_recipient_not_found"},404);
   await db.unsafe("INSERT INTO gift_assist.case_cashapp_assignments(case_ref,destination_id,assigned_by,assigned_at) VALUES($1,$2,$3,now()) ON CONFLICT(case_ref) DO UPDATE SET destination_id=EXCLUDED.destination_id,assigned_by=EXCLUDED.assigned_by,assigned_at=now()",[ref,id,actor]);
   await giftAudit(actor,"cashapp_case_recipient_assigned","case",ref,{destinationId:id,cashtag:normalizeCashTag(recipient.recipient_name),verified:recipient.is_verified===true,collectionEnabled:false},db);
   return json({ok:true,caseRef:ref,selectedId:id,cashtag:normalizeCashTag(recipient.recipient_name),verified:recipient.is_verified===true,collectionEnabled:false});
  });
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/checkout-claim"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  if(!["PayPal","Stripe"].includes(body.provider))return json({error:"invalid_provider"},400);
  return sql.begin(async db=>{
   const [row]=await db.unsafe("SELECT * FROM gift_assist.cases WHERE case_ref=$1 FOR UPDATE",[giftClean(body.caseRef,60)]);
   if(!row||row.requester_id!==body.requesterId)return json({error:"case_not_found"},404);
   if(!["Awaiting Payment","Payment Failed","Payment Cancelled"].includes(row.status))return json({error:"case_not_awaiting_payment"},409);
   const [balance]=await db.unsafe("SELECT COUNT(*)::int AS count FROM gift_assist.ledger WHERE case_ref=$1",[row.case_ref]);
   const pending=await db.unsafe("SELECT id FROM gift_assist.manual_submissions WHERE case_ref=$1 AND status='Submitted — Awaiting Verification'",[row.case_ref]);
   if(balance.count>0||pending.length)return json({error:"payment_already_recorded_or_pending"},409);
   let [attempt]=await db.unsafe("SELECT * FROM gift_assist.checkout_attempts WHERE case_ref=$1",[row.case_ref]);
   if(attempt&&attempt.status!=="closed"){
    if(!attempt.provider_reference&&Date.now()-new Date(attempt.updated_at).getTime()>6*3600000)return json({error:"unresolved_checkout_requires_reconciliation"},409);
    if(attempt.provider!==body.provider)return json({error:"another_provider_checkout_is_active"},409);
   }else{
    [attempt]=await db.unsafe("INSERT INTO gift_assist.checkout_attempts(case_ref,provider,attempt_key,return_token) VALUES ($1,$2,$3,$4) ON CONFLICT(case_ref) DO UPDATE SET provider=EXCLUDED.provider,attempt_key=EXCLUDED.attempt_key,provider_reference='',checkout_url='',return_token=EXCLUDED.return_token,status='pending',updated_at=now() RETURNING *",[row.case_ref,body.provider,randomUUID(),giftClean(body.returnToken,3000)]);
   }
   return json({attemptKey:attempt.attempt_key,providerReference:attempt.provider_reference,url:attempt.checkout_url,returnToken:attempt.return_token});
  });
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/checkout-ready"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const reference=giftClean(body.providerReference,180),url=String(body.url||"");
  if(!reference||(url&&!giftHttps(url)))return json({error:"invalid_checkout"},400);
  const rows=await sql.unsafe("UPDATE gift_assist.checkout_attempts SET provider_reference=$1,checkout_url=$2,status='ready',updated_at=now() WHERE case_ref=$3 AND attempt_key=$4 AND status IN ('pending','ready') AND (provider_reference='' OR provider_reference=$1) RETURNING case_ref",[reference,url,giftClean(body.caseRef,60),giftClean(body.attemptKey,50)]);
  return rows.length?json({ok:true}):json({error:"checkout_attempt_changed"},409);
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/checkout-close"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  await sql.unsafe("UPDATE gift_assist.checkout_attempts SET status='closed',updated_at=now() WHERE case_ref=$1 AND provider=$2 AND provider_reference=$3",[giftClean(body.caseRef,60),giftClean(body.provider,20),giftClean(body.providerReference,180)]);
  return json({ok:true});
 }
 if(req.method==="GET"&&path==="/internal/gift-assist/payment-readiness"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  return json({manualReady:await giftManualReady()});
 }
 if(req.method==="GET"&&path==="/internal/gift-assist/case-summary"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  const rows=await sql.unsafe("SELECT case_ref,status,discord_message_id,created_at,updated_at FROM gift_assist.cases ORDER BY updated_at DESC LIMIT 200");
  return json(rows.map(r=>({caseRef:r.case_ref,status:r.status,messageId:r.discord_message_id||"",createdAt:r.created_at,updatedAt:r.updated_at})));
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/case-location"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const row=await giftCase(giftClean(body.caseRef,60));
  return row?json({messageId:row.discord_message_id}):json({error:"case_not_found"},404);
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/case-state"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const row=await giftCase(giftClean(body.caseRef,60));
  if(!row||row.requester_id!==body.requesterId)return json({error:"case_not_found"},404);
  return json({status:row.status,paymentStatus:row.payment_status,paymentProvider:row.payment_provider,providerReference:row.provider_reference,note:row.staff_note});
 }
 if(req.method==="GET"&&path==="/internal/gift-assist/notifications"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  return json(await sql.unsafe("SELECT id FROM gift_assist.notification_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 50"));
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/notifications/deliver"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let body;try{body=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const [row]=await sql.unsafe("SELECT payload FROM gift_assist.notification_outbox WHERE id=$1 AND delivered_at IS NULL",[giftClean(body.id,100)]);
  return json({ok:row?await giftNotifyBot(row.payload):true});
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/case-sync"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let b;try{b=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const ref=giftClean(b.caseRef,60),uid=String(b.requesterId||"");
  if(!/^GA-[A-Z0-9-]{8,40}$/.test(ref)||! /^\d{17,22}$/.test(uid))return json({error:"invalid_case"},400);
  const events=Array.isArray(b.paymentEvents)?b.paymentEvents:(typeof b.paymentEvents==="string"?b.paymentEvents.split(",").filter(Boolean):[]);
  const budget=giftCents(b.budget),amount=giftCents(b.amount);
  await sql.unsafe("INSERT INTO gift_assist.cases(case_ref,requester_id,creator,target,goal,budget_cents,amount_cents,plan,status,payment_status,payment_provider,provider_reference,payment_events,staff_note,discord_message_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) ON CONFLICT(case_ref) DO UPDATE SET requester_id=EXCLUDED.requester_id,creator=EXCLUDED.creator,target=EXCLUDED.target,goal=EXCLUDED.goal,budget_cents=EXCLUDED.budget_cents,amount_cents=CASE WHEN gift_assist.cases.payment_status IN ('Paid','Partially Paid','Refunded','Partially Refunded','Manual Verification Pending') THEN gift_assist.cases.amount_cents ELSE EXCLUDED.amount_cents END,plan=CASE WHEN gift_assist.cases.payment_status IN ('Paid','Partially Paid','Refunded','Partially Refunded','Manual Verification Pending') THEN gift_assist.cases.plan ELSE EXCLUDED.plan END,status=CASE WHEN gift_assist.cases.payment_status IN ('Paid','Partially Paid','Refunded','Partially Refunded','Manual Verification Pending') THEN CASE WHEN EXCLUDED.status='Completed' AND gift_assist.cases.payment_status='Paid' THEN 'Completed' ELSE gift_assist.cases.status END ELSE EXCLUDED.status END,payment_status=CASE WHEN gift_assist.cases.payment_status IN ('Paid','Partially Paid','Refunded','Partially Refunded','Manual Verification Pending') THEN gift_assist.cases.payment_status ELSE EXCLUDED.payment_status END,payment_provider=CASE WHEN gift_assist.cases.payment_status IN ('Paid','Partially Paid','Refunded','Partially Refunded','Manual Verification Pending') THEN gift_assist.cases.payment_provider ELSE EXCLUDED.payment_provider END,provider_reference=CASE WHEN gift_assist.cases.payment_status IN ('Paid','Partially Paid','Refunded','Partially Refunded','Manual Verification Pending') THEN gift_assist.cases.provider_reference ELSE EXCLUDED.provider_reference END,payment_events=EXCLUDED.payment_events,staff_note=CASE WHEN gift_assist.cases.payment_status IN ('Paid','Partially Paid','Refunded','Partially Refunded','Manual Verification Pending') THEN gift_assist.cases.staff_note ELSE EXCLUDED.staff_note END,discord_message_id=EXCLUDED.discord_message_id,updated_at=now() WHERE gift_assist.cases.requester_id=EXCLUDED.requester_id AND gift_assist.cases.discord_message_id=EXCLUDED.discord_message_id AND NOT $16::boolean",
   [ref,uid,giftClean(b.creator,100),giftClean(b.target,160),giftClean(b.goal,500),budget,amount,giftClean(b.plan,700),giftClean(b.status,80)||"New",giftClean(b.paymentStatus,80)||"Not Started",giftClean(b.paymentProvider,80)||"Not selected",giftClean(b.providerReference,180),JSON.stringify(events),giftClean(b.note,1000),giftClean(b.messageId,30),b.historical===true]);
  return json({ok:true,caseRef:ref});
 }
 if(req.method==="POST"&&path==="/internal/gift-assist/payment-sync"){
  if(!giftInternalAuthorized(req))return json({error:"forbidden"},403);
  let b;try{b=await bodyOf(req)}catch{return json({error:"invalid_json"},400)}
  const ref=giftClean(b.caseRef,60),uid=String(b.requesterId||""),amount=Number(b.amountCents),status=giftClean(b.status,50),eventId=giftClean(b.eventId,180),provider=giftClean(b.provider,20),key=giftClean(b.paymentKey,180);
  if(!/^GA-[A-Z0-9-]{8,40}$/.test(ref)||!/^\d{17,22}$/.test(uid)||!Number.isSafeInteger(amount)||amount<1||!eventId||!key||!["Stripe","PayPal"].includes(provider)||!["Paid","Refunded","Partially Refunded"].includes(status))return json({error:"invalid_payment_event"},400);
  return sql.begin(async db=>{
   const [row]=await db.unsafe("SELECT * FROM gift_assist.cases WHERE case_ref=$1 FOR UPDATE",[ref]);
   if(!row||row.requester_id!==uid)return json({error:"case_not_found"},404);
   const [payment]=await db.unsafe("SELECT * FROM gift_assist.provider_payments WHERE provider=$1 AND payment_key=$2",[provider,key]);
   const stableId=status==="Paid"?provider+":paid:"+key:provider+":refund:"+eventId;
   const duplicate=await db.unsafe("SELECT id FROM gift_assist.ledger WHERE provider_event_id=$1",[stableId]);
   const ledgerBalance=async()=>{const [x]=await db.unsafe("SELECT COALESCE(SUM(CASE WHEN direction='inflow' THEN amount_cents ELSE -amount_cents END),0) AS net FROM gift_assist.ledger WHERE case_ref=$1",[ref]);return Number(x.net)};
   if(payment&&payment.case_ref!==ref)return json({error:"provider_payment_case_mismatch"},409);
   if(duplicate.length)return json({ok:true,duplicate:true,status:row.payment_status,caseStatus:row.status});
   let delta=amount,nextStatus="Paid",caseStatus="Payment Received — Awaiting Fulfillment";
   if(status==="Paid"){
    if(payment)return json({error:"payment_already_recorded"},409);
    if(!["Awaiting Payment","Payment Failed","Payment Cancelled"].includes(row.status)||amount!==Number(row.amount_cents)||await ledgerBalance()!==0)return json({error:"payment_amount_or_case_state_mismatch"},409);
    await db.unsafe("INSERT INTO gift_assist.provider_payments(provider,payment_key,case_ref,amount_cents) VALUES ($1,$2,$3,$4)",[provider,key,ref,amount]);
   }else{
    if(!payment)return json({error:"original_payment_not_recorded"},409);
    const cumulative=b.cumulativeRefundCents===undefined?Number(payment.refunded_cents)+amount:Number(b.cumulativeRefundCents);
    if(!Number.isSafeInteger(cumulative)||cumulative<0||cumulative>Number(payment.amount_cents))return json({error:"refund_amount_invalid"},409);
    delta=Math.max(0,cumulative-Number(payment.refunded_cents));
    if(delta===0)return json({ok:true,duplicate:true,status:row.payment_status,caseStatus:row.status});
    if(delta>await ledgerBalance())return json({error:"refund_exceeds_verified_balance"},409);
    nextStatus=cumulative===Number(payment.amount_cents)?"Refunded":"Partially Refunded";caseStatus=nextStatus;
    await db.unsafe("UPDATE gift_assist.provider_payments SET refunded_cents=$1 WHERE provider=$2 AND payment_key=$3",[cumulative,provider,key]);
   }
   const fee=b.feeCents===undefined?null:Number(b.feeCents);
   if(fee!==null&&(!Number.isSafeInteger(fee)||fee<0||fee>delta))throw Error("invalid_provider_fee");
   await db.unsafe("INSERT INTO gift_assist.ledger(id,case_ref,requester_id,direction,method,provider,amount_cents,fee_cents,net_cents,currency,status,transaction_reference,provider_event_id,recorded_by,details) VALUES ($1,$2,$3,$4,'Online',$5,$6,$7,$8,'USD',$9,$10,$11,'verified-provider-webhook',$12::jsonb)",
    [randomUUID(),ref,uid,status==="Paid"?"inflow":"outflow",provider,delta,fee,fee===null?null:status==="Paid"?delta-fee:-(delta+fee),nextStatus,giftClean(b.providerReference,180),stableId,JSON.stringify({paymentKey:key,providerEventId:eventId})]);
   await db.unsafe("UPDATE gift_assist.cases SET status=$1,payment_status=$2,payment_provider=$3,provider_reference=$4,updated_at=now() WHERE case_ref=$5",[caseStatus,nextStatus,provider,giftClean(b.providerReference,180),ref]);
   await giftAudit("verified-provider-webhook","provider_payment_recorded","case",ref,{provider,paymentKey:key,status:nextStatus,amountCents:delta},db);
   return json({ok:true,duplicate:false,status:nextStatus,caseStatus});
  });
 }
 return json({error:"not_found"},404);
}});
try{
 const seedResult=await seedOwnerCashApp();
 const [db]=await sql.unsafe("SELECT current_database() AS database,inet_server_addr()::text AS host,inet_server_port() AS port");
 if(db.database!=="giftassist")throw new Error("Gift Assist API must use its dedicated giftassist database");
 ready=true;
 console.log(JSON.stringify({event:"gift-assist-api-ready",service:"Momentum Movement Gift Assist API",database:db.database,host:db.host,port:db.port,cashAppSeeded:seedResult.seeded,paymentsEnabled:false}));
}catch(error){lastError=giftClean(error?.message||error,180);console.error(JSON.stringify({event:"gift-assist-api-startup-failed",reason:lastError}));}
console.log(JSON.stringify({event:"gift-assist-api-listener-started",port:Number(env.PORT||3000)}));
