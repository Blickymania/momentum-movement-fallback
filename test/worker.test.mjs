import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
import { OAuthD1Store } from "../src/oauth-d1-store.mjs";
import { createMomentumManagerWorker } from "../src/worker.mjs";

const GUILD="1565048205970767992",APP="1565304619838742598";
const INTERNAL="manager-internal-test-key-with-32-or-more-characters";
const RESOURCE="https://momentum.example/mcp";
const baseEnv={AUTHORIZED_GUILD_ID:GUILD,APPLICATION_ID:APP,DISCORD_BOT_TOKEN:"test-bot-token",WRITES_ENABLED:"false",MCP_OAUTH_ENABLED:"false",OAUTH_ISSUER_URL:"https://momentum.example",OAUTH_RESOURCE_URL:RESOURCE,DISCORD_OAUTH_REDIRECT_URI:"https://momentum.example/oauth/callback",DISCORD_OAUTH_CLIENT_ID:"discord-client",DISCORD_OAUTH_CLIENT_SECRET:"discord-secret"};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});

class Statement{
 constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.db,this.sql,args);}
 async all(){const results=this.db.prepare(this.sql).all(...this.args);return {success:true,results,meta:{changes:results.length}};}
 async first(){return this.db.prepare(this.sql).get(...this.args)??null;}
 async run(){const r=this.db.prepare(this.sql).run(...this.args);return {success:true,results:[],meta:{changes:Number(r.changes??0)}};}
}
class D1Memory{
 constructor(){this.raw=new DatabaseSync(":memory:");this.pending=Promise.resolve();}
 prepare(sql){return new Statement(this.raw,sql);}
 batch(statements){const execute=async()=>{this.raw.exec("BEGIN");try{const out=[];for(const s of statements)out.push(s.sql.includes("RETURNING")?await s.all():await s.run());this.raw.exec("COMMIT");return out;}catch(e){this.raw.exec("ROLLBACK");throw e;}};const p=this.pending.then(execute,execute);this.pending=p.catch(()=>{});return p;}
 close(){this.raw.close();}
}
function harness({env={},fetchImpl}={}){
 const db=new D1Memory(),calls=[];
 const discordFetch=fetchImpl || (async(url,options={})=>{
  const parsed=new URL(url);calls.push({url:parsed.toString(),method:options.method||"GET",body:options.body});
  if(parsed.pathname==="/api/v10/users/@me")return response({id:APP,bot:true,username:"MomentumBot"});
  if(parsed.pathname==="/api/v10/guilds/"+GUILD)return response({id:GUILD,name:"Momentum Movement"});
  return response({id:"ok",status:"ok"});
 });
 const worker=createMomentumManagerWorker({fetchImpl:discordFetch,cryptoImpl:webcrypto,now:()=>1800000000000});
 const completeEnv={...baseEnv,...env,OAUTH_DB:db,...env};
 return {worker,env:completeEnv,db,calls};
}
const request=(method,body,authorization)=>new Request("https://momentum.example/mcp",{method,headers:{...(authorization?{authorization}:{}),...(body!==undefined?{"content-type":"application/json"}:{})},body:body===undefined?undefined:JSON.stringify(body)});
async function hash(value){const digest=await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");}
async function pkceChallenge(value){const digest=new Uint8Array(await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));return btoa(String.fromCharCode(...digest)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");}
const oauthRequest=(path,method="GET",body)=>new Request("https://momentum.example"+path,{method,headers:{...(body!==undefined?{"content-type":body instanceof URLSearchParams?"application/x-www-form-urlencoded":"application/json"}:{})},body:body===undefined?undefined:body instanceof URLSearchParams?body.toString():JSON.stringify(body)});

test("serves process health before readiness configuration is available",async()=>{
 const healthOnly=await createMomentumManagerWorker().fetch(new Request("https://momentum.example/healthz"),{...baseEnv});
 assert.equal(healthOnly.status,200);assert.equal((await healthOnly.json()).status,"ok");
 const noDb=await createMomentumManagerWorker().fetch(new Request("https://momentum.example/readyz"),{...baseEnv});
 assert.equal(noDb.status,503);assert.equal((await noDb.json()).reason,"d1_binding_missing");
 const h=harness({env:{AUTHORIZED_GUILD_ID:"999999999999999999"}});
 const health=await h.worker.fetch(new Request("https://momentum.example/healthz"),h.env);
 assert.equal(health.status,200);assert.equal((await health.json()).status,"ok");
 const ready=await h.worker.fetch(new Request("https://momentum.example/readyz"),h.env);
 assert.equal(ready.status,503);assert.equal((await ready.json()).reason,"identity_configuration_mismatch");h.db.close();
});
test("serves health and readiness with D1 schema and verified Discord identity",async()=>{
 const h=harness();await new OAuthD1Store(h.db).ensureSchema();
 const health=await h.worker.fetch(new Request("https://momentum.example/healthz"),h.env);
 assert.equal(health.status,200);assert.equal((await health.json()).runtime,"workers");
 const ready=await h.worker.fetch(new Request("https://momentum.example/readyz"),h.env);
 assert.equal(ready.status,200);assert.equal((await ready.json()).status,"ready");assert.equal(h.calls.length,2);h.db.close();
});
test("does not claim readiness when Discord bot or guild identity is unavailable",async()=>{
 const h=harness({fetchImpl:async()=>response({error:"unauthorized"},401)});
 const ready=await h.worker.fetch(new Request("https://momentum.example/readyz"),h.env);
 assert.equal(ready.status,503);assert.equal((await ready.json()).status,"not_ready");h.db.close();
});
test("requires bearer authentication on the MCP endpoint",async()=>{
 const h=harness();await new OAuthD1Store(h.db).ensureSchema();
 const result=await h.worker.fetch(request("POST",{jsonrpc:"2.0",id:1,method:"initialize",params:{}}),h.env);
 assert.equal(result.status,401);assert.ok(result.headers.get("www-authenticate").includes("oauth-protected-resource"));h.db.close();
});
test("rejects weak static internal bearer secrets and accepts a configured strong secret",async()=>{
 const h=harness({env:{MCP_INTERNAL_BEARER_TOKEN:"too-short"}});await new OAuthD1Store(h.db).ensureSchema();
 const weak=await h.worker.fetch(request("POST",{jsonrpc:"2.0",id:1,method:"initialize",params:{}},"Bearer too-short"),h.env);
 assert.equal(weak.status,401);h.env.MCP_INTERNAL_BEARER_TOKEN=INTERNAL;
 const strong=await h.worker.fetch(request("POST",{jsonrpc:"2.0",id:1,method:"initialize",params:{}},"Bearer "+INTERNAL),h.env);
 assert.equal(strong.status,200);assert.equal((await strong.json()).result.serverInfo.name,"Dawn Dotta Discord Manager");h.db.close();
});
test("implements MCP discovery, initialize, tool listing and initialized notification",async()=>{
 const h=harness({env:{MCP_INTERNAL_BEARER_TOKEN:INTERNAL}});await new OAuthD1Store(h.db).ensureSchema();
 const discover=await h.worker.fetch(request("POST",{jsonrpc:"2.0",id:1,method:"server/discover"},"Bearer "+INTERNAL),h.env);
 assert.deepEqual((await discover.json()).result.supportedVersions,["2026-07-28"]);
 const list=await h.worker.fetch(request("POST",{jsonrpc:"2.0",id:2,method:"tools/list"},"Bearer "+INTERNAL),h.env);
 assert.deepEqual((await list.json()).result.tools.map(x=>x.name),["discord_manager_status","discord_guild_request","discord_manager_audit"]);
 const initialized=await h.worker.fetch(request("POST",{jsonrpc:"2.0",method:"notifications/initialized"},"Bearer "+INTERNAL),h.env);
 assert.equal(initialized.status,202);h.db.close();
});
test("routes an authenticated status tool call through the preserved manager core",async()=>{
 const h=harness({env:{MCP_INTERNAL_BEARER_TOKEN:INTERNAL}});await new OAuthD1Store(h.db).ensureSchema();
 const result=await h.worker.fetch(request("POST",{jsonrpc:"2.0",id:8,method:"tools/call",params:{name:"discord_manager_status",arguments:{}}},"Bearer "+INTERNAL),h.env);
 assert.equal(result.status,200);const payload=await result.json();assert.equal(payload.id,8);
 assert.equal(JSON.parse(payload.result.content[0].text).state,"connected");h.db.close();
});
test("enforces mcp:write scope on OAuth-authenticated mutations",async()=>{
 const h=harness({env:{MCP_OAUTH_ENABLED:"true"}});const store=new OAuthD1Store(h.db,{now:()=>1800000000000});await store.ensureSchema();
 const token="read-only-bearer-token",tokenHash=await hash(token);
 await h.db.prepare("INSERT INTO mcp_oauth_access_tokens (token_hash,client_id,user_id,guild_id,scope,resource,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)")
  .bind(tokenHash,"client","owner-user",GUILD,"mcp:read",RESOURCE,1800000000000,1900000000000).run();
 const body={jsonrpc:"2.0",id:9,method:"tools/call",params:{name:"discord_guild_request",arguments:{method:"POST",route:"/guilds/"+GUILD+"/channels",body:{name:"not-allowed"}}}};
 const result=await h.worker.fetch(request("POST",body,"Bearer "+token),h.env);
 assert.equal(result.status,403);assert.equal((await result.json()).error.message,"OAuth token lacks mcp:write scope");assert.equal(h.calls.length,0);h.db.close();
});
test("allows read-only OAuth scope to run a GET manager operation",async()=>{
 const h=harness({env:{MCP_OAUTH_ENABLED:"true"}});const store=new OAuthD1Store(h.db,{now:()=>1800000000000});await store.ensureSchema();
 const token="read-only-bearer-token",tokenHash=await hash(token);
 await h.db.prepare("INSERT INTO mcp_oauth_access_tokens (token_hash,client_id,user_id,guild_id,scope,resource,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)")
  .bind(tokenHash,"client","owner-user",GUILD,"mcp:read",RESOURCE,1800000000000,1900000000000).run();
 const body={jsonrpc:"2.0",id:10,method:"tools/call",params:{name:"discord_manager_status",arguments:{}}};
 const result=await h.worker.fetch(request("POST",body,"Bearer "+token),h.env);
 assert.equal(result.status,200);assert.equal(JSON.parse((await result.json()).result.content[0].text).state,"connected");h.db.close();
});
test("completes OAuth authorization and manager status through the Worker HTTP surface",async()=>{
 const discordCalls=[];
 const h=harness({env:{MCP_OAUTH_ENABLED:"true"},fetchImpl:async(url,options={})=>{
  const parsed=new URL(url),headers=new Headers(options.headers||{}),authorization=headers.get("authorization");
  discordCalls.push({url:parsed.toString(),method:options.method||"GET",authorization});
  if(parsed.pathname==="/api/v10/oauth2/token")return response({access_token:"discord-access-token"});
  if(parsed.pathname==="/api/v10/users/@me"&&authorization==="Bot test-bot-token")return response({id:APP,bot:true});
  if(parsed.pathname==="/api/v10/users/@me")return response({id:"discord-user-123"});
  if(parsed.pathname==="/api/v10/users/@me/guilds")return response([{id:GUILD,owner:false,permissions:"8"}]);
  if(parsed.pathname==="/api/v10/guilds/"+GUILD)return response({id:GUILD,name:"Momentum Movement"});
  throw new Error("Unexpected Discord URL: "+parsed);
 }});
 await new OAuthD1Store(h.db,{now:()=>1800000000000}).ensureSchema();
 const redirectUri="https://client.example/oauth/callback";
 const registration=await h.worker.fetch(oauthRequest("/register","POST",{client_name:"Worker OAuth test",redirect_uris:[redirectUri]}),h.env);
 assert.equal(registration.status,201);const client=await registration.json();
 const verifier="v".repeat(64),challenge=await pkceChallenge(verifier),authorize=new URL("https://momentum.example/oauth/authorize");
 authorize.searchParams.set("client_id",client.client_id);authorize.searchParams.set("redirect_uri",redirectUri);
 authorize.searchParams.set("response_type","code");authorize.searchParams.set("code_challenge",challenge);
 authorize.searchParams.set("code_challenge_method","S256");authorize.searchParams.set("resource",RESOURCE);
 authorize.searchParams.set("scope","mcp:read");authorize.searchParams.set("state","worker-client-state");
 const start=await h.worker.fetch(new Request(authorize),h.env);assert.equal(start.status,302);
 const state=new URL(start.headers.get("location")).searchParams.get("state");assert.ok(state);
 const callback=await h.worker.fetch(new Request("https://momentum.example/oauth/callback?code=discord-code&state="+encodeURIComponent(state)),h.env);
 assert.equal(callback.status,302);const redirect=new URL(callback.headers.get("location"));const code=redirect.searchParams.get("code");assert.ok(code);
 const tokenForm=new URLSearchParams({grant_type:"authorization_code",client_id:client.client_id,code,redirect_uri:redirectUri,code_verifier:verifier,resource:RESOURCE});
 const token=await h.worker.fetch(oauthRequest("/oauth/token","POST",tokenForm),h.env);assert.equal(token.status,200);
 const tokens=await token.json();assert.equal(tokens.scope,"mcp:read");
 const status=await h.worker.fetch(new Request("https://momentum.example/mcp",{method:"POST",headers:{authorization:"Bearer "+tokens.access_token,"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:901,method:"tools/call",params:{name:"discord_manager_status",arguments:{}}})}),h.env);
 assert.equal(status.status,200);assert.equal(JSON.parse((await status.json()).result.content[0].text).state,"connected");
 assert.equal(discordCalls.filter(x=>x.url==="https://discord.com/api/v10/oauth2/token").length,1);
 assert.equal(discordCalls.filter(x=>x.authorization==="Bot test-bot-token").length,2);h.db.close();
});

test("keeps OAuth disabled until explicitly enabled and schema migrated",async()=>{
 const h=harness();const result=await h.worker.fetch(new Request("https://momentum.example/oauth/health"),h.env);
 assert.equal(result.status,404);assert.equal((await result.json()).error,"oauth_not_enabled");h.db.close();
});

test("internal Gateway controls require the configured bearer and call one named coordinator", async () => {
  const h=harness({env:{MCP_INTERNAL_BEARER_TOKEN:INTERNAL}});
  const calls=[];
  h.env.GATEWAY_COORDINATOR={
    idFromName(name){calls.push({type:"idFromName",name});return "coordinator-id";},
    get(id){
      calls.push({type:"get",id});
      return {fetch:async request=>{
        const url=new URL(request.url);
        calls.push({type:"fetch",path:url.pathname,method:request.method,authorization:request.headers.get("authorization")});
        return response({coordinator:"momentum",status:url.pathname.slice(1)});
      }};
    },
  };
  const unauthorized=await h.worker.fetch(new Request("https://momentum.example/internal/gateway/start",{method:"POST"}),h.env);
  assert.equal(unauthorized.status,401);

  const start=await h.worker.fetch(new Request("https://momentum.example/internal/gateway/start",{
    method:"POST",headers:{authorization:"Bearer "+INTERNAL},
  }),h.env);
  assert.equal(start.status,200);
  assert.equal((await start.json()).status,"start");
  assert.deepEqual(calls.map(x=>x.type),["idFromName","get","fetch"]);
  assert.equal(calls[0].name,"momentum-movement");
  assert.equal(calls[2].path,"/start");
  assert.equal(calls[2].method,"POST");
  assert.equal(calls[2].authorization,"Bearer "+INTERNAL);
  h.db.close();
});

test("internal Gateway controls fail closed when no Durable Object binding exists", async () => {
  const h=harness({env:{MCP_INTERNAL_BEARER_TOKEN:INTERNAL}});
  const result=await h.worker.fetch(new Request("https://momentum.example/internal/gateway/status",{
    headers:{authorization:"Bearer "+INTERNAL},
  }),h.env);
  assert.equal(result.status,503);
  assert.equal((await result.json()).error,"Gateway coordinator binding is unavailable");
  h.db.close();
});

test("internal Gateway reset-fatal endpoint enforces bounded JSON and method", async () => {
  const h=harness({env:{MCP_INTERNAL_BEARER_TOKEN:INTERNAL}});
  const calls=[];
  h.env.GATEWAY_COORDINATOR={
    idFromName:()=> "id",
    get:()=>({fetch:async req=>{
      calls.push({path:new URL(req.url).pathname,method:req.method,body:await req.text()});
      return response({reset:true});
    }}),
  };
  const wrongMethod=await h.worker.fetch(new Request("https://momentum.example/internal/gateway/reset-fatal",{
    headers:{authorization:"Bearer "+INTERNAL},
  }),h.env);
  assert.equal(wrongMethod.status,405);
  const oversized=await h.worker.fetch(new Request("https://momentum.example/internal/gateway/reset-fatal",{
    method:"POST",headers:{authorization:"Bearer "+INTERNAL,"content-length":"5000"},body:"{}",
  }),h.env);
  assert.equal(oversized.status,413);
  const valid=await h.worker.fetch(new Request("https://momentum.example/internal/gateway/reset-fatal",{
    method:"POST",headers:{authorization:"Bearer "+INTERNAL,"content-type":"application/json"},
    body:JSON.stringify({clientId:"bot-alpha"}),
  }),h.env);
  assert.equal(valid.status,200);
  assert.deepEqual(calls,[{path:"/reset-fatal",method:"POST",body:'{"clientId":"bot-alpha"}'}]);
  h.db.close();
});
