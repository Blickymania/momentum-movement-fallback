# Candidate 1-on-1 Coaching Interaction Relay — HTTPS workflow endpoint

- Candidate only. This is not deployed or connected to a Discord Gateway.
- Based on the read-only recovered live relay source.
- The recovered production relay remains untouched on Railway.
- Requires COACHING_WORKFLOW_URL, COACHING_WORKFLOW_SOURCE=coaching-relay and a unique COACHING_WORKFLOW_AUTH_SECRET. Its secret must differ from Bot 005's secret.
- The relay retains its own raw Discord Gateway session and is outside the Bot 005 lease scope.
- Its separate Gateway failover/ownership plan must be designed independently if desired.
- The Interaction Relay continues to filter by application ID, guild ID, and coach: interaction custom IDs.
- It continues to forward the original INTERACTION_CREATE payload once, without retries.
- Its readiness probe uses the workflow's /readyz endpoint.

---
const G="1565048205970767992",APP="1565304619838742598",token=()=>Bun.env.DISCORD_BOT_TOKEN||"";
const { createCoachingWorkflowClientFromEnv } = await import("../../implementation/coaching-workflow-client.mjs");
const coachingWorkflow = createCoachingWorkflowClientFromEnv({
  env: Bun.env,
  timeoutMs: 5000,
  maxPayloadBytes: 262144
});
let ws=null,heartbeat=null,reconnectTimer=null,seq=null,sessionId=null,resumeUrl=null,retry=0,ready=false,lastError=null,lastForward=null,heartbeatAck=true,backendReady=false;
const log=(event,fields={})=>console.log(JSON.stringify({event,server:"Dawn Dotta",...fields}));
async function checkBackend(){try{const result=await coachingWorkflow.checkReady();backendReady=result.ready;log("COACHING_BACKEND_LINK",{ready:backendReady,status:result.status})}catch(e){backendReady=false;lastError="backend_link_"+String(e?.message||"failed").replace(/[^a-z0-9_]/gi,"_").slice(0,80);log("COACHING_BACKEND_LINK_FAILED",{kind:lastError})}}
function send(p){if(ws&&ws.readyState===1)ws.send(JSON.stringify(p))}
async function forward(i){
 const id=String(i?.data?.custom_id||"");
 if(i?.application_id!==APP||!id.startsWith("coach:"))return;
 if(i.guild_id&&i.guild_id!==G)return;
 if(!i.guild_id&&!id.startsWith("coach:dm:")&&!id.startsWith("coach:dmrespond:")&&!id.startsWith("coach:dmdetails:"))return;
 try{await coachingWorkflow.forward(i);lastError=null;lastForward=new Date().toISOString()}
 catch(e){lastError=String(e?.message||"network").replace(/[^a-z0-9_]/gi,"_").slice(0,80);log("COACHING_RELAY_FORWARD_FAILED",{kind:lastError})}
}
function scheduleReconnect(){if(reconnectTimer)return;const delay=Math.min(30000,1000*2**Math.min(retry++,5));reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect()},delay)}
function connect(){
 if(!token()||Bun.env.AUTHORIZED_GUILD_ID!==G||Bun.env.APPLICATION_ID!==APP){lastError="credential_scope_mismatch";ready=false;log("COACHING_RELAY_CONFIG_BLOCKED");return}
 const base=resumeUrl||"wss://gateway.discord.gg",url=base+(base.includes("?")?"&":"?")+"v=10&encoding=json";
 try{ws=new WebSocket(url)}catch(e){lastError=String(e?.name||"socket_create_failed");scheduleReconnect();return}
 ws.onmessage=event=>{
  let p;try{p=JSON.parse(String(event.data))}catch{return}
  if(p.s!==null&&p.s!==undefined)seq=p.s;
  if(p.op===10){
   if(heartbeat)clearInterval(heartbeat);heartbeatAck=true;
   heartbeat=setInterval(()=>{if(!heartbeatAck){try{ws?.close(4000,"heartbeat timeout")}catch{};return}heartbeatAck=false;send({op:1,d:seq})},p.d?.heartbeat_interval||45000);
   if(sessionId&&seq!==null)send({op:6,d:{token:token(),session_id:sessionId,seq}});
   else send({op:2,d:{token:token(),intents:4097,properties:{os:"linux",browser:"coaching-interaction-relay",device:"coaching-interaction-relay"}}});
   return;
  }
  if(p.op===11){heartbeatAck=true;return}
  if(p.op===1){send({op:1,d:seq});return}
  if(p.op===0&&p.t==="READY"){
   if(p.d?.user?.id!==APP){ready=false;lastError="bot_identity_mismatch";log("COACHING_RELAY_IDENTITY_FAILED");try{ws.close(4001,"identity mismatch")}catch{};return}
   sessionId=p.d.session_id;resumeUrl=p.d.resume_gateway_url||resumeUrl;ready=true;retry=0;lastError=null;log("COACHING_RELAY_READY",{app:APP,guild:G,intents:4097});return;
  }
  if(p.op===0&&p.t==="RESUMED"){ready=true;retry=0;log("COACHING_RELAY_RESUMED");return}
  if(p.op===0&&p.t==="INTERACTION_CREATE")void forward(p.d);
  if(p.op===7){ready=false;try{ws.close(4000,"gateway reconnect")}catch{}}
  if(p.op===9){ready=false;if(!p.d){sessionId=null;seq=null;resumeUrl=null}try{ws.close(4001,"invalid session")}catch{}}
 };
 ws.onclose=()=>{ready=false;if(heartbeat){clearInterval(heartbeat);heartbeat=null}scheduleReconnect()};
 ws.onerror=()=>{lastError="gateway_socket_error";log("COACHING_RELAY_GATEWAY_ERROR")};
}
Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||3000),fetch(req){const path=new URL(req.url).pathname;if(path==="/healthz")return Response.json({status:"ok",ready,backendReady,application:APP,guild:G,lastError,lastForward});if(path==="/readyz"){const healthy=ready&&backendReady;return Response.json({ready,backendReady,lastError},{status:healthy?200:503})}return Response.json({error:"not-found"},{status:404})}});
connect();
void checkBackend();
