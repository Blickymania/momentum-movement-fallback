import { OAuthD1Store } from "./oauth-d1-store.mjs";
import { createOAuthRoutes } from "./oauth-routes.mjs";
import { createManagerCore } from "./manager-core.mjs";
import { GatewayCoordinatorDurableObject } from "./gateway-coordinator-do.mjs";

export { GatewayCoordinatorDurableObject };

const NAME = "Dawn Dotta Discord Manager";
const GUILD_ID = "1565048205970767992";
const APPLICATION_ID = "1565304619838742598";
const json = (value,status=200,headers={}) => new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers},
});
const noContent = status => new Response(null,{status,headers:{"cache-control":"no-store"}});

function unauthorized(env) {
  let metadata="";
  try {
    const issuer = new URL(env.OAUTH_ISSUER_URL || env.DISCORD_OAUTH_REDIRECT_URI || "https://invalid.invalid");
    metadata=issuer.origin+"/.well-known/oauth-protected-resource";
  } catch {}
  return json({error:"Unauthorized"},401,{
    "www-authenticate":'Bearer resource_metadata="'+metadata+'", scope="mcp:read"',
  });
}

function textError(message) {
  return {content:[{type:"text",text:JSON.stringify({error:message})}],isError:true};
}

export function createMomentumManagerWorker({fetchImpl=fetch,cryptoImpl=globalThis.crypto,now=()=>Date.now(),timeoutSignal=(ms)=>AbortSignal.timeout(ms)}={}) {
  if(typeof fetchImpl!=="function"||!cryptoImpl?.subtle)throw new TypeError("Worker fetch and Web Crypto are required");

  return {
    async fetch(request,env) {
      if(!env||typeof env!=="object")return json({error:"Worker environment is unavailable"},503);
      if(env.AUTHORIZED_GUILD_ID!==GUILD_ID||env.APPLICATION_ID!==APPLICATION_ID) {
        return json({status:"not_ready",reason:"identity_configuration_mismatch"},503);
      }
      if(!env.OAUTH_DB||typeof env.OAUTH_DB.prepare!=="function") {
        return json({status:"not_ready",reason:"d1_binding_missing"},503);
      }

      const store=new OAuthD1Store(env.OAUTH_DB,{now,randomId:()=>cryptoImpl.randomUUID()});
      const oauth=createOAuthRoutes({store,env,fetchImpl,cryptoImpl,now,randomBytes:length=>{
        const bytes=new Uint8Array(length);cryptoImpl.getRandomValues(bytes);return bytes;
      }});
      const manager=createManagerCore({env,fetchImpl,now:()=>new Date(now()).toISOString(),timeoutSignal});
      const url=new URL(request.url);
      const oauthResponse=await oauth.dispatch(request);
      if(oauthResponse)return oauthResponse;

      if(url.pathname==="/healthz"&&request.method==="GET") {
        return json({status:"ok",manager:NAME,runtime:"workers"});
      }

      if(url.pathname==="/readyz"&&request.method==="GET") {
        try {
          const dbHealth=await store.health();
          if(!dbHealth.ready&&env.MCP_OAUTH_ENABLED==="true") {
            return json({status:"not_ready",reason:"oauth_storage_schema_unavailable",storage:"d1"},503);
          }
          const status=await manager.invoke("discord_manager_status",{});
          const payload=JSON.parse(status?.content?.[0]?.text||"{}");
          if(payload.state!=="connected") {
            return json({status:"not_ready",reason:payload.state||"discord_identity_unverified",discord:payload,storage:"d1"},503);
          }
          return json({status:"ready",manager:NAME,discordVerified:true,storage:"d1",oauthEnabled:env.MCP_OAUTH_ENABLED==="true"});
        } catch(error) {
          return json({status:"not_ready",reason:"readiness_check_failed",errorType:error?.name||"unknown"},503);
        }
      }

      const gatewayControlRoutes = {
        "/internal/gateway/status": { path: "/status", method: "GET" },
        "/internal/gateway/start": { path: "/start", method: "POST" },
        "/internal/gateway/stop": { path: "/stop", method: "POST" },
        "/internal/gateway/reset-fatal": { path: "/reset-fatal", method: "POST" },
      };
      const gatewayControl = gatewayControlRoutes[url.pathname];
      if (gatewayControl) {
        const secret = env.MCP_INTERNAL_BEARER_TOKEN;
        if (typeof secret !== "string" || secret.length < 32 ||
            request.headers.get("authorization") !== "Bearer " + secret) {
          return json({ error: "Unauthorized" }, 401);
        }
        if (request.method !== gatewayControl.method) return json({ error: "Method not allowed" }, 405);
        if (!env.GATEWAY_COORDINATOR ||
            typeof env.GATEWAY_COORDINATOR.idFromName !== "function" ||
            typeof env.GATEWAY_COORDINATOR.get !== "function") {
          return json({ error: "Gateway coordinator binding is unavailable" }, 503);
        }
        let body;
        if (gatewayControl.method === "POST" && url.pathname.endsWith("/reset-fatal")) {
          const length = Number(request.headers.get("content-length") || "0");
          if (Number.isFinite(length) && length > 4096) return json({ error: "Request body too large" }, 413);
          body = await request.text();
          if (body.length > 4096) return json({ error: "Request body too large" }, 413);
        }
        const id = env.GATEWAY_COORDINATOR.idFromName("momentum-movement");
        const stub = env.GATEWAY_COORDINATOR.get(id);
        return stub.fetch(new Request("https://gateway.internal" + gatewayControl.path, {
          method: gatewayControl.method,
          headers: {
            authorization: "Bearer " + secret,
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body } : {}),
        }));
      }

      if(url.pathname!=="/mcp"||request.method!=="POST") {
        return json({error:"Not found"},404);
      }

      const contentLength=Number(request.headers.get("content-length")||"0");
      if(Number.isFinite(contentLength)&&contentLength>1024*1024) {
        return json({error:"Request body too large"},413);
      }
      const authorization=request.headers.get("authorization")||"";
      const staticSecret=env.MCP_INTERNAL_BEARER_TOKEN;
      const staticAuth=typeof staticSecret==="string"&&staticSecret.length>=32&&authorization==="Bearer "+staticSecret;
      let oauthAuth=null;
      if(!staticAuth&&authorization.startsWith("Bearer ")) {
        try {
          oauthAuth=await oauth.authenticate(authorization.slice(7));
        } catch {
          return json({error:"OAuth authentication backend unavailable"},503);
        }
      }
      if(!staticAuth&&!oauthAuth)return unauthorized(env);

      let rpc;
      try { rpc=await request.json(); }
      catch { return json({error:"Invalid JSON"},400); }
      if(!rpc||typeof rpc!=="object"||Array.isArray(rpc)||rpc.jsonrpc!=="2.0"||typeof rpc.method!=="string") {
        return json({error:"Invalid JSON-RPC request"},400);
      }
      const id=rpc.id??null;
      const result=value=>json({jsonrpc:"2.0",id,result:value});

      if(oauthAuth&&rpc.method==="tools/call"&&rpc.params?.name==="discord_guild_request") {
        const method=String(rpc.params?.arguments?.method||"GET").toUpperCase();
        if(method!=="GET"&&!String(oauthAuth.scope||"").split(/\s+/).includes("mcp:write")) {
          return json({jsonrpc:"2.0",id,error:{code:-32003,message:"OAuth token lacks mcp:write scope"}},403);
        }
      }

      if(rpc.method==="server/discover") {
        return result({supportedVersions:["2026-07-28"],capabilities:{tools:{}},serverInfo:{name:NAME,version:"1.0.0"}});
      }
      if(rpc.method==="initialize") {
        return result({protocolVersion:rpc.params?.protocolVersion||"2026-07-28",capabilities:{tools:{}},serverInfo:{name:NAME,version:"1.0.0"}});
      }
      if(rpc.method==="notifications/initialized")return noContent(202);
      if(rpc.method==="tools/list")return result({tools:manager.tools});
      if(rpc.method==="tools/call") {
        try {
          const name=rpc.params?.name;
          const args=rpc.params?.arguments||{};
          const value=await manager.invoke(name,args);
          return result(value);
        } catch(error) {
          return result(textError("Manager request failed; no Discord modification was confirmed."));
        }
      }
      return json({jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}});
    },
  };
}

export default {
  fetch(request,env,ctx) {
    return createMomentumManagerWorker().fetch(request,env,ctx);
  },
};
