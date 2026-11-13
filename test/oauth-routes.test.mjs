import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
import { OAuthD1Store } from "../src/oauth-d1-store.mjs";
import { createOAuthRoutes } from "../src/oauth-routes.mjs";

class Statement {
  constructor(db, sql, args = []) { this.db=db; this.sql=sql; this.args=args; }
  bind(...args) { return new Statement(this.db,this.sql,args); }
  async all() { const results=this.db.prepare(this.sql).all(...this.args); return {success:true,results,meta:{changes:results.length}}; }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async run() { const r=this.db.prepare(this.sql).run(...this.args); return {success:true,results:[],meta:{changes:Number(r.changes??0)}}; }
}
class D1Memory {
  constructor(){this.raw=new DatabaseSync(":memory:");this.pending=Promise.resolve();}
  prepare(sql){return new Statement(this.raw,sql);}
  batch(statements){
    const run=async()=>{this.raw.exec("BEGIN");try{const out=[];for(const s of statements)out.push(s.sql.includes("RETURNING")?await s.all():await s.run());this.raw.exec("COMMIT");return out;}catch(e){this.raw.exec("ROLLBACK");throw e;}};
    const p=this.pending.then(run,run);this.pending=p.catch(()=>{});return p;
  }
  close(){this.raw.close();}
}

const guildId="1565048205970767992";
const redirectUri="https://client.example/oauth/callback";
const resource="https://momentum.example/mcp";
const env={
  MCP_OAUTH_ENABLED:"true", AUTHORIZED_GUILD_ID:guildId,
  OAUTH_ISSUER_URL:"https://momentum.example", OAUTH_RESOURCE_URL:resource,
  DISCORD_OAUTH_REDIRECT_URI:"https://momentum.example/oauth/callback",
  DISCORD_OAUTH_CLIENT_ID:"discord-client-id",
  DISCORD_OAUTH_CLIENT_SECRET:"discord-client-secret",
};
function b64url(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");}
async function challenge(verifier){return b64url(new Uint8Array(await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))));}
function response(value,status=200){return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});}
function createHarness({admin=true,enabled=true}={}){
  const db=new D1Memory();let clock=1_800_000_000_000,randomCounter=0;
  const store=new OAuthD1Store(db,{now:()=>clock,randomId:()=>"nonce-"+(++randomCounter)});
  const fetchCalls=[];
  const fetchImpl=async(url,options={})=>{
    fetchCalls.push({url:String(url),method:options.method||"GET"});
    if(String(url)==="https://discord.com/api/v10/oauth2/token")return response({access_token:"discord-access-token"});
    if(String(url)==="https://discord.com/api/v10/users/@me")return response({id:"discord-user-123"});
    if(String(url)==="https://discord.com/api/v10/users/@me/guilds")return response([{id:guildId,owner:false,permissions:admin?"8":"0"}]);
    throw new Error("Unexpected Discord API URL: "+url);
  };
  let bytesCounter=0;
  const routes=createOAuthRoutes({
    store,env:{...env,MCP_OAUTH_ENABLED:enabled?"true":"false"},fetchImpl,cryptoImpl:webcrypto,now:()=>clock,
    randomBytes:(length)=>Uint8Array.from({length},(_,i)=>((++bytesCounter+i*13)&255)),
  });
  return {db,store,routes,fetchCalls,setClock:(value)=>{clock=value;}};
}
async function registerClient(routes){
  const result=await routes.dispatch(new Request("https://momentum.example/register",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({client_name:"Momentum test client",redirect_uris:[redirectUri,redirectUri]}),
  }));
  assert.equal(result.status,201);
  const value=await result.json();
  assert.equal(value.redirect_uris.length,1);
  return value.client_id;
}
async function beginAuthorization(routes,clientId){
  const verifier="v".repeat(64),pkce=await challenge(verifier);
  const u=new URL("https://momentum.example/oauth/authorize");
  u.searchParams.set("client_id",clientId);u.searchParams.set("redirect_uri",redirectUri);
  u.searchParams.set("response_type","code");u.searchParams.set("code_challenge",pkce);
  u.searchParams.set("code_challenge_method","S256");u.searchParams.set("resource",resource);
  u.searchParams.set("scope","mcp:read mcp:write");u.searchParams.set("state","client-state-123");
  const response=await routes.dispatch(new Request(u));
  assert.equal(response.status,302);
  const discordUrl=new URL(response.headers.get("location"));
  assert.equal(discordUrl.hostname,"discord.com");
  assert.equal(discordUrl.searchParams.get("scope"),"identify guilds");
  assert.equal(discordUrl.searchParams.get("prompt"),"consent");
  return {state:discordUrl.searchParams.get("state"),verifier};
}

test("publishes protected-resource and authorization-server metadata",async()=>{
  const h=createHarness();await h.store.ensureSchema();
  const protectedResponse=await h.routes.dispatch(new Request("https://momentum.example/.well-known/oauth-protected-resource"));
  assert.equal(protectedResponse.status,200);
  assert.equal((await protectedResponse.json()).resource,resource);
  const metadata=await h.routes.dispatch(new Request("https://momentum.example/.well-known/oauth-authorization-server"));
  const data=await metadata.json();
  assert.equal(data.authorization_endpoint,"https://momentum.example/oauth/authorize");
  assert.deepEqual(data.scopes_supported,["mcp:read","mcp:write"]);
  h.db.close();
});

test("rejects unsafe dynamic client redirect URIs",async()=>{
  const h=createHarness();await h.store.ensureSchema();
  const result=await h.routes.dispatch(new Request("https://momentum.example/register",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({redirect_uris:["http://evil.example/callback"]}),
  }));
  assert.equal(result.status,400);
  assert.equal((await result.json()).error,"invalid_redirect_uri");
  h.db.close();
});

test("runs Discord admin PKCE OAuth, token exchange, refresh rotation, auth and revocation",async()=>{
  const h=createHarness();await h.store.ensureSchema();
  const clientId=await registerClient(h.routes);
  const {state,verifier}=await beginAuthorization(h.routes,clientId);
  const callback=await h.routes.dispatch(new Request("https://momentum.example/oauth/callback?code=discord-code&state="+encodeURIComponent(state)));
  assert.equal(callback.status,302);
  const clientRedirect=new URL(callback.headers.get("location"));
  assert.equal(clientRedirect.origin+clientRedirect.pathname,redirectUri);
  assert.equal(clientRedirect.searchParams.get("state"),"client-state-123");
  const authorizationCode=clientRedirect.searchParams.get("code");
  assert.ok(authorizationCode);

  const tokenForm=new URLSearchParams({grant_type:"authorization_code",client_id:clientId,code:authorizationCode,redirect_uri:redirectUri,code_verifier:verifier,resource});
  const tokenResponse=await h.routes.dispatch(new Request("https://momentum.example/oauth/token",{method:"POST",body:tokenForm}));
  assert.equal(tokenResponse.status,200);
  const tokens=await tokenResponse.json();
  assert.equal(tokens.scope,"mcp:read mcp:write");assert.equal(tokens.resource,resource);
  const auth=await h.routes.authenticate(tokens.access_token);
  assert.equal(auth.user_id,"discord-user-123");assert.equal(auth.guild_id,guildId);

  const refreshForm=new URLSearchParams({grant_type:"refresh_token",client_id:clientId,refresh_token:tokens.refresh_token,resource});
  const refreshResponse=await h.routes.dispatch(new Request("https://momentum.example/oauth/token",{method:"POST",body:refreshForm}));
  assert.equal(refreshResponse.status,200);
  const rotated=await refreshResponse.json();
  assert.ok(rotated.access_token);assert.notEqual(rotated.refresh_token,tokens.refresh_token);
  assert.ok(await h.routes.authenticate(rotated.access_token));

  const replay=await h.routes.dispatch(new Request("https://momentum.example/oauth/token",{method:"POST",body:refreshForm}));
  assert.equal(replay.status,400);assert.equal((await replay.json()).error,"invalid_grant");

  const revokeForm=new URLSearchParams({token:rotated.access_token,client_id:clientId});
  const revoked=await h.routes.dispatch(new Request("https://momentum.example/oauth/revoke",{method:"POST",body:revokeForm}));
  assert.equal(revoked.status,200);assert.equal(await h.routes.authenticate(rotated.access_token),null);
  assert.equal(h.fetchCalls.length,3);h.db.close();
});

test("rejects a Discord user who is not an owner or administrator and burns the state",async()=>{
  const h=createHarness({admin:false});await h.store.ensureSchema();
  const clientId=await registerClient(h.routes),{state}=await beginAuthorization(h.routes,clientId);
  const callback=await h.routes.dispatch(new Request("https://momentum.example/oauth/callback?code=discord-code&state="+encodeURIComponent(state)));
  assert.equal(callback.status,302);
  const redirect=new URL(callback.headers.get("location"));
  assert.equal(redirect.searchParams.get("error"),"access_denied");
  assert.equal(redirect.searchParams.get("state"),"client-state-123");
  const replay=await h.routes.dispatch(new Request("https://momentum.example/oauth/callback?code=discord-code&state="+encodeURIComponent(state)));
  assert.equal(replay.status,400);assert.equal((await replay.json()).error,"invalid_state");
  h.db.close();
});

test("OAuth routes remain unavailable when the OAuth feature flag is off",async()=>{
  const h=createHarness({enabled:false});
  const result=await h.routes.dispatch(new Request("https://momentum.example/oauth/health"));
  assert.equal(result.status,404);assert.equal((await result.json()).error,"oauth_not_enabled");
  h.db.close();
});
