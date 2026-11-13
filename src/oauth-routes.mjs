import { OAuthStoreError } from "./oauth-d1-store.mjs";

const JSON_HEADERS = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","pragma":"no-cache"};
const json = (value, status=200) => new Response(JSON.stringify(value), {status, headers:JSON_HEADERS});
const error = (code, status=400) => json({error:code}, status);
const b64url = bytes => { let s=""; for (const b of bytes) s+=String.fromCharCode(b); return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_"); };
const validRedirect = value => {
  try { const u=new URL(value); if(u.username||u.password||u.hash)return false; return u.protocol==="https:" || (u.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(u.hostname)); }
  catch { return false; }
};
const parseScopes = value => {
  const requested=String(value||"mcp:read mcp:write").trim().split(/\s+/).filter(Boolean);
  const expanded=requested.includes("mcp")?["mcp:read","mcp:write",...requested.filter(x=>x!=="mcp")]:requested;
  const unique=[...new Set(expanded)];
  if(!unique.includes("mcp:read")||unique.some(x=>!["mcp:read","mcp:write"].includes(x)))throw Error("invalid_scope");
  return unique.sort().join(" ");
};
const issuerFor = env => {
  const u=new URL(env.OAUTH_ISSUER_URL||env.DISCORD_OAUTH_REDIRECT_URI||"https://invalid.invalid");
  if(u.protocol!=="https:"||u.username||u.password)throw Error("invalid_issuer"); return u.origin;
};
const resourceFor = env => {
  const issuer=issuerFor(env),u=new URL(env.OAUTH_RESOURCE_URL||issuer+"/mcp");
  if(u.protocol!=="https:"||u.search||u.hash||u.username||u.password)throw Error("invalid_resource");
  return u.origin+(u.pathname==="/" ? "/mcp" : u.pathname.replace(/\/+$/,""));
};
const discordRedirectFor = env => {
  const u=new URL(env.DISCORD_OAUTH_REDIRECT_URI||issuerFor(env)+"/oauth/callback");
  if(u.protocol!=="https:"||u.username||u.password||u.hash)throw Error("invalid_discord_redirect"); return u.toString();
};

export function createOAuthRoutes({store,env,fetchImpl=fetch,cryptoImpl=globalThis.crypto,now=()=>Date.now(),randomBytes}={}) {
  if(!store||typeof store.health!=="function"||typeof store.registerClient!=="function"||
     typeof store.getClient!=="function"||typeof store.createLoginRequest!=="function"||
     typeof store.findLoginRequest!=="function"||typeof store.consumeLoginRequestFailure!=="function"||
     typeof store.consumeLoginRequestAndCreateCode!=="function"||typeof store.exchangeAuthorizationCode!=="function"||
     typeof store.rotateRefreshToken!=="function"||typeof store.authenticateAccessToken!=="function"||typeof store.revokeToken!=="function")
    throw new TypeError("A compatible OAuthD1Store instance is required");
  if(!env||typeof env!=="object"||!cryptoImpl?.subtle||typeof fetchImpl!=="function"||typeof now!=="function")
    throw new TypeError("Worker environment, Web Crypto, fetch and clock are required");
  const bytes = randomBytes || (n=>{const out=new Uint8Array(n);cryptoImpl.getRandomValues(out);return out;});
  const random = (n=32)=>b64url(bytes(n));
  const hash = async value => {
    const digest=await cryptoImpl.subtle.digest("SHA-256",new TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  };
  const pkce = async verifier=>b64url(new Uint8Array(await cryptoImpl.subtle.digest("SHA-256",new TextEncoder().encode(verifier))));
  const enabled=()=>env.MCP_OAUTH_ENABLED==="true";
  const deny=async(pending,stateHash,reason)=>{
    let consumed;
    try { consumed=await store.consumeLoginRequestFailure(stateHash); }
    catch { return error("server_error",503); }
    if(!consumed)return error("invalid_state");
    const target=new URL(pending.redirect_uri);target.searchParams.set("error","access_denied");target.searchParams.set("error_description",reason);
    if(pending.client_state!=null)target.searchParams.set("state",String(pending.client_state));
    return new Response(null,{status:302,headers:{location:target.toString(),"cache-control":"no-store"}});
  };
  const register=async request=>{
    let body;
    try { body=await request.json(); }
    catch { return error("invalid_client_metadata"); }
    const uris=body?.redirect_uris;
    if(!Array.isArray(uris)||uris.length<1||uris.length>10||uris.some(x=>typeof x!=="string"||!validRedirect(x)))return error("invalid_redirect_uri");
    const clientId="mcp_"+random(24),clientName=typeof body.client_name==="string"&&body.client_name.trim()?body.client_name.trim().slice(0,100):"MCP client";
    const redirectUris=[...new Set(uris)];
    try { await store.registerClient({clientId,clientName,redirectUris}); }
    catch { return error("server_error",503); }
    return json({client_id:clientId,client_id_issued_at:Math.floor(now()/1000),client_name:clientName,redirect_uris:redirectUris,grant_types:["authorization_code","refresh_token"],response_types:["code"],token_endpoint_auth_method:"none"},201);
  };
  const authorize=async url=>{
    try {
      const clientId=url.searchParams.get("client_id")||"",redirectUri=url.searchParams.get("redirect_uri")||"",challenge=url.searchParams.get("code_challenge")||"";
      const client=await store.getClient(clientId);if(!client)return error("invalid_client");
      if(url.searchParams.get("response_type")!=="code"||!JSON.parse(client.redirect_uris).includes(redirectUri)||!validRedirect(redirectUri))return error("invalid_request");
      if(url.searchParams.get("code_challenge_method")!=="S256"||challenge.length<43||challenge.length>128||!/^[A-Za-z0-9_-]+$/.test(challenge))return error("invalid_request");
      const target=url.searchParams.get("resource")||"";if(target!==resourceFor(env))return error("invalid_target");
      const scope=parseScopes(url.searchParams.get("scope"));if(!env.DISCORD_OAUTH_CLIENT_ID||!env.DISCORD_OAUTH_CLIENT_SECRET)return error("oauth_provider_not_configured",503);
      const discordRedirect=discordRedirectFor(env),state=random(32);
      await store.createLoginRequest({stateHash:await hash(state),clientId,redirectUri,clientState:url.searchParams.get("state"),codeChallenge:challenge,scope,resource:target});
      const dest=new URL("https://discord.com/oauth2/authorize");dest.searchParams.set("client_id",env.DISCORD_OAUTH_CLIENT_ID);dest.searchParams.set("redirect_uri",discordRedirect);dest.searchParams.set("response_type","code");dest.searchParams.set("scope","identify guilds");dest.searchParams.set("state",state);dest.searchParams.set("prompt","consent");
      return new Response(null,{status:302,headers:{location:dest.toString(),"cache-control":"no-store"}});
    } catch(e) {const c=String(e?.message||"");return error(c.startsWith("invalid_")?c:"invalid_request");}
  };
  const callback=async url=>{
    const state=url.searchParams.get("state")||"",stateHash=await hash(state),pending=await store.findLoginRequest(stateHash);
    if(!pending)return error("invalid_state");
    if(url.searchParams.has("error"))return deny(pending,stateHash,"Discord authorization was not completed");
    const code=url.searchParams.get("code")||"";
    if(!code||!env.DISCORD_OAUTH_CLIENT_ID||!env.DISCORD_OAUTH_CLIENT_SECRET)return deny(pending,stateHash,"Discord OAuth provider is not configured");
    try {
      const form=new URLSearchParams({client_id:env.DISCORD_OAUTH_CLIENT_ID,client_secret:env.DISCORD_OAUTH_CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:discordRedirectFor(env)});
      const tokenResponse=await fetchImpl("https://discord.com/api/v10/oauth2/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});
      const discordToken=await tokenResponse.json().catch(()=>({}));
      if(!tokenResponse.ok||!discordToken.access_token)return deny(pending,stateHash,"Discord token exchange failed");
      const authHeaders={authorization:"Bearer "+discordToken.access_token,"user-agent":"MomentumMovementOAuth/1.0"};
      const [userResponse,guildResponse]=await Promise.all([
        fetchImpl("https://discord.com/api/v10/users/@me",{headers:authHeaders}),
        fetchImpl("https://discord.com/api/v10/users/@me/guilds",{headers:authHeaders}),
      ]);
      if(!userResponse.ok||!guildResponse.ok)return deny(pending,stateHash,"Discord identity verification failed");
      const user=await userResponse.json(),guilds=await guildResponse.json(),guildId=env.AUTHORIZED_GUILD_ID||"";
      const member=Array.isArray(guilds)?guilds.find(x=>String(x.id)===String(guildId)):null;
      let admin=member?.owner===true;try{admin||=(BigInt(member?.permissions??"0")&8n)===8n;}catch{}
      if(!user?.id||! /^\d{15,22}$/.test(guildId)||!admin)return deny(pending,stateHash,"Discord account must be an owner or administrator of this server");
      const authorizationCode=random(32);
      await store.consumeLoginRequestAndCreateCode({stateHash,authorizationCodeHash:await hash(authorizationCode),userId:String(user.id),guildId:String(guildId)});
      const dest=new URL(pending.redirect_uri);dest.searchParams.set("code",authorizationCode);if(pending.client_state!=null)dest.searchParams.set("state",String(pending.client_state));
      return new Response(null,{status:302,headers:{location:dest.toString(),"cache-control":"no-store"}});
    } catch(e) {
      if(e instanceof OAuthStoreError&&e.code==="invalid_state")return error("invalid_state");
      return deny(pending,stateHash,"OAuth callback failed");
    }
  };
  const token=async request=>{
    try {
      const form=new URLSearchParams(await request.text()),grant=form.get("grant_type")||"",clientId=form.get("client_id")||"";
      if(grant==="authorization_code") {
        const code=form.get("code")||"",redirectUri=form.get("redirect_uri")||"",verifier=form.get("code_verifier")||"";
        if(!code||!clientId||!redirectUri||verifier.length<43||verifier.length>128)return error("invalid_grant");
        const accessToken=random(32),refreshToken=random(48);
        const context=await store.exchangeAuthorizationCode({codeHash:await hash(code),clientId,redirectUri,codeChallenge:await pkce(verifier),resource:form.get("resource")||"",accessTokenHash:await hash(accessToken),refreshTokenHash:await hash(refreshToken)});
        return json({access_token:accessToken,token_type:"Bearer",expires_in:Math.max(0,Math.floor((context.accessExpiresAt-now())/1000)),refresh_token:refreshToken,scope:context.scope,resource:context.resource});
      }
      if(grant==="refresh_token") {
        const oldRefresh=form.get("refresh_token")||"";if(!oldRefresh||!clientId)return error("invalid_grant");
        const accessToken=random(32),refreshToken=random(48);
        const context=await store.rotateRefreshToken({oldRefreshTokenHash:await hash(oldRefresh),clientId,resource:form.get("resource")||"",accessTokenHash:await hash(accessToken),newRefreshTokenHash:await hash(refreshToken)});
        return json({access_token:accessToken,token_type:"Bearer",expires_in:Math.max(0,Math.floor((context.accessExpiresAt-now())/1000)),refresh_token:refreshToken,scope:context.scope,resource:context.resource});
      }
      return error("unsupported_grant_type");
    } catch(e) {
      if(e instanceof OAuthStoreError&&["invalid_grant","invalid_target"].includes(e.code))return error(e.code);
      return error("server_error",503);
    }
  };
  const revoke=async request=>{
    try {const form=new URLSearchParams(await request.text()),value=form.get("token")||"";if(value)await store.revokeToken(await hash(value),form.get("client_id")||"");return new Response(null,{status:200,headers:{"cache-control":"no-store"}});}
    catch{return error("server_error",503);}
  };
  const dispatch=async request=>{
    const url=new URL(request.url),path=url.pathname;
    if(!(path.startsWith("/.well-known/")||path==="/register"||path.startsWith("/oauth/")))return null;
    if(!enabled())return error("oauth_not_enabled",404);
    if(path==="/oauth/health"&&request.method==="GET") {
      try {const health=await store.health(),ready=health.ready===true;return json({status:ready?"ready":"degraded",storage:"d1",tablesReady:ready,tables:health.tables,discordProviderConfigured:!!env.DISCORD_OAUTH_CLIENT_ID&&!!env.DISCORD_OAUTH_CLIENT_SECRET,discordRedirectConfigured:!!env.DISCORD_OAUTH_REDIRECT_URI,authorizedGuildConfigured:/^\d{15,22}$/.test(env.AUTHORIZED_GUILD_ID||""),resource:resourceFor(env)},ready?200:503);}
      catch{return json({status:"degraded",storage:"d1",tablesReady:false,reason:"storage_unavailable"},503);}
    }
    if(path==="/.well-known/oauth-protected-resource"&&request.method==="GET") {
      try{return json({resource:resourceFor(env),authorization_servers:[issuerFor(env)],bearer_methods_supported:["header"],scopes_supported:["mcp:read","mcp:write"]});}
      catch{return error("oauth_configuration_error",503);}
    }
    if(path==="/.well-known/oauth-authorization-server"&&request.method==="GET") {
      try {const issuer=issuerFor(env);return json({issuer,authorization_endpoint:issuer+"/oauth/authorize",token_endpoint:issuer+"/oauth/token",registration_endpoint:issuer+"/register",revocation_endpoint:issuer+"/oauth/revoke",response_types_supported:["code"],response_modes_supported:["query"],grant_types_supported:["authorization_code","refresh_token"],token_endpoint_auth_methods_supported:["none"],code_challenge_methods_supported:["S256"],scopes_supported:["mcp:read","mcp:write"],resource_parameter_supported:true,client_id_metadata_document_supported:false});}
      catch{return error("oauth_configuration_error",503);}
    }
    if(path==="/register"&&request.method==="POST")return register(request);
    if(path==="/oauth/authorize"&&request.method==="GET")return authorize(url);
    if(path==="/oauth/callback"&&request.method==="GET")return callback(url);
    if(path==="/oauth/token"&&request.method==="POST")return token(request);
    if(path==="/oauth/revoke"&&request.method==="POST")return revoke(request);
    return error("not_found",404);
  };
  const authenticate=async value=>{
    if(!enabled()||!value)return null;
    return store.authenticateAccessToken(await hash(value),resourceFor(env),env.AUTHORIZED_GUILD_ID||"");
  };
  return {dispatch,authenticate};
}
