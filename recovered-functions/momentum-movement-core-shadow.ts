// Momentum Movement Core Shadow — isolated read-only foundation.
// This service never opens a Discord gateway, creates commands, or writes Discord data.
// Production cutover requires a separate, explicitly reviewed change.
const SERVICE = "Momentum Movement Core Shadow";
const EXPECTED_GUILD = "1565048205970767992";
const EXPECTED_APP = "1565304619838742598";
const DISCORD_API = "https://discord.com/api/v10";
const startedAt = Date.now();
type Readiness = { checkedAt: string; ok: boolean; state: string; appMatches: boolean; guildReachable: boolean; identityReachable: boolean; rateLimited: boolean };
let cached: Readiness | null = null;
let cacheTime = 0;
let inFlight: Promise<Readiness> | null = null;
function json(data: unknown, status=200) {
  return Response.json(data, {status, headers: {"cache-control":"no-store", "x-content-type-options":"nosniff"}});
}
async function probeDiscord(): Promise<Readiness> {
  const t = Bun.env.DISCORD_BOT_TOKEN || "";
  const app = Bun.env.APPLICATION_ID || "";
  const guild = Bun.env.AUTHORIZED_GUILD_ID || "";
  const valid = app===EXPECTED_APP && guild===EXPECTED_GUILD;
  if (!valid || !t) return {checkedAt:new Date().toISOString(),ok:false,state:"configuration_missing_or_mismatch",appMatches:false,guildReachable:false,identityReachable:false,rateLimited:false};
  try {
    const headers = {authorization:"Bot "+t, "user-agent":"MomentumMovementCoreShadow-ReadOnly/1.0"};
    // At most one probe every 120s. No retry loops and no parallel fan-out.
    const idResponse = await fetch(DISCORD_API+"/users/@me",{headers,signal:AbortSignal.timeout(8000)});
    if (idResponse.status===429) return {checkedAt:new Date().toISOString(),ok:false,state:"rate_limited",appMatches:false,guildReachable:false,identityReachable:false,rateLimited:true};
    if (!idResponse.ok) return {checkedAt:new Date().toISOString(),ok:false,state:"bot_auth_failed_"+idResponse.status,appMatches:false,guildReachable:false,identityReachable:false,rateLimited:false};
    const identity = await idResponse.json() as {id?:string};
    const matches = identity.id===EXPECTED_APP;
    if (!matches) return {checkedAt:new Date().toISOString(),ok:false,state:"bot_application_mismatch",appMatches:false,guildReachable:false,identityReachable:true,rateLimited:false};
    const gResponse=await fetch(DISCORD_API+"/guilds/"+EXPECTED_GUILD,{headers,signal:AbortSignal.timeout(8000)});
    return {checkedAt:new Date().toISOString(),ok:gResponse.ok,state:gResponse.ok?"ready":"guild_http_"+gResponse.status,appMatches:matches,guildReachable:gResponse.ok,identityReachable:true,rateLimited:gResponse.status===429};
  } catch(e) {
    console.error(JSON.stringify({event:"readiness_probe_failure",error:e instanceof Error?e.name:"unknown"}));
    return {checkedAt:new Date().toISOString(),ok:false,state:"discord_network_unavailable",appMatches:false,guildReachable:false,identityReachable:false,rateLimited:false};
  }
}
async function readiness() {
  if (cached && Date.now()-cacheTime<120000) return cached;
  if (!inFlight) inFlight=probeDiscord().then(value=>{cached=value;cacheTime=Date.now();return value;}).finally(()=>{inFlight=null;});
  return inFlight;
}
Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||3000),async fetch(req){
  const path=new URL(req.url).pathname;
  if(req.method!=="GET") return json({error:"read_only_shadow"},405);
  if(path==="/healthz") return json({status:"ok",service:SERVICE,mode:"shadow",writesEnabled:false,gatewayEnabled:false,uptimeSeconds:Math.floor((Date.now()-startedAt)/1000)});
  if(path==="/readyz") {const state=await readiness();return json({service:SERVICE,mode:"shadow",...state},state.ok?200:503);}
  return json({error:"not_found"},404);
}});
console.log(JSON.stringify({event:"team_momentum_core_v2_shadow_started",guild:EXPECTED_GUILD,app:EXPECTED_APP,writesEnabled:false,gatewayEnabled:false}));

void readiness().then(result=>{
  console.log(JSON.stringify({event:"team_momentum_core_v2_shadow_startup_probe",ok:result.ok,state:result.state,appMatches:result.appMatches,guildReachable:result.guildReachable,identityReachable:result.identityReachable,rateLimited:result.rateLimited,checkedAt:result.checkedAt}));
}).catch(error=>console.error(JSON.stringify({event:"team_momentum_core_v2_probe_error",kind:error instanceof Error?error.name:"unknown"})));
