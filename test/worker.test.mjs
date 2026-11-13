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

test("rejects missing, incorrect, or mismatched deployment identity before serving",async()=>{
 const noDb=await createMomentumManagerWorker().fetch(new Request("https://momentum.example/healthz"),{...baseEnv});
 assert.equal(noDb.status,503);assert.equal((await noDb.json()).reason,"d1_binding_missing");
 const h=harness({env:{AUTHORIZED_GUILD_ID:"999999999999999999"}});
 const result=await h.worker.fetch(new Request("https://momentum.example/healthz"),h.env);
 assert.equal(result.status,503);assert.equal((await result.json()).reason,"identity_configuration_mismatch");h.db.close();
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
test("keeps OAuth disabled until explicitly enabled and schema migrated",async()=>{
 const h=harness();const result=await h.worker.fetch(new Request("https://momentum.example/oauth/health"),h.env);
 assert.equal(result.status,404);assert.equal((await result.json()).error,"oauth_not_enabled");h.db.close();
});
