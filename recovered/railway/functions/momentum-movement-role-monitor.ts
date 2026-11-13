// Momentum Movement Role Monitor. Read-only; cannot change any role, permission, name, or channel.
const GUILD="1565048205970767992", APP="1565304619838742598";
const TOKEN=Bun.env.DISCORD_BOT_TOKEN||"";
if(Bun.env.AUTHORIZED_GUILD_ID!==GUILD||Bun.env.APPLICATION_ID!==APP||!TOKEN)throw Error("Wrong guild/application credentials for Momentum Movement");
async function get(path){
 for(let n=0;n<3;n++){
  const r=await fetch("https://discord.com/api/v10"+path,{method:"GET",headers:{Authorization:"Bot "+TOKEN},signal:AbortSignal.timeout(15000)});
  const body=await r.json().catch(()=>({}));
  if(r.status===429){
   if(n===2)throw Error("Discord rate limit: audit deferred");
   await Bun.sleep(Math.min(30000,Math.max(1300,Math.ceil(Number(body.retry_after||2)*1000)+300)));
   continue;
  }
  if(!r.ok)throw Error("Discord read returned "+r.status);
  return body;
 }
 throw Error("Discord read retry budget exhausted");
}
const normalize=s=>String(s||"").normalize("NFKC").replace(/^[^A-Za-z]+/,"").trim().toLowerCase();
try{
 const [me,guild,roles,channels]=await Promise.all([
  get("/users/@me"),get("/guilds/"+GUILD),get("/guilds/"+GUILD+"/roles"),get("/guilds/"+GUILD+"/channels")
 ]);
 if(me.id!==APP||guild.id!==GUILD||!Array.isArray(roles)||!Array.isArray(channels))throw Error("Verified Discord identity or role data invalid");
 const expected=[
  {key:"moderator",label:"Moderators",matcher:x=>x==="moderators"||x==="moderator"},
  {key:"super_fan_access",label:"Super Fan Lounge Access",matcher:x=>x==="super fan lounge access"},
  {key:"level_50_access",label:"Level 50 Lounge Access",matcher:x=>x==="level 50 lounge access"}
 ];
 const checks=expected.map(rule=>{
  const found=roles.filter(r=>rule.matcher(normalize(r.name)));
  return {key:rule.key,name:rule.label,found:found.length===1,duplicates:found.length>1,roleId:found.length===1?found[0].id:null,position:found.length===1?found[0].position:null};
 });
 const categories=["super fan lounge"].map(name=>{
  const found=channels.filter(c=>c.type===4&&normalize(c.name)===name);
  const role=checks.find(x=>name.startsWith("super")?x.key==="super_fan_access":x.key==="level_50_access");
  return {category:name,found:found.length===1,duplicates:found.length>1,
   accessRoleExists:!!role?.found,
   roleOverwritePresent:found.length===1&&!!role?.roleId&&Array.isArray(found[0].permission_overwrites)&&found[0].permission_overwrites.some(o=>o.id===role.roleId)};
 });
 const retiredLevel50Channels=channels.filter(c=>/level[\s_-]*50/i.test(String(c.name||"").normalize("NFKC")) && !(c.id==="1569452177129214003" && c.type===2 && c.parent_id==="1566030078964539432"));
 const adminRoles=roles.filter(r=>r.id!==GUILD&&((BigInt(r.permissions||"0")&8n)===8n)&&!r.managed).map(r=>({id:r.id,name:r.name,position:r.position}));
 const moderator=checks.find(x=>x.key==="moderator");
 const warnings=[
  ...checks.filter(x=>!x.found).map(x=>"Missing or ambiguous role: "+x.name),
  ...categories.filter(x=>!x.found).map(x=>"Missing or ambiguous category: "+x.category),
  ...retiredLevel50Channels.map(x=>"Retired Level 50 channel still exists: "+x.id)
 ];
 console.log(JSON.stringify({event:"momentum_role_monitor_audit",readOnly:true,guild:GUILD,
  roleCount:roles.length,categoryCount:channels.filter(c=>c.type===4).length,
  expectedRoles:checks,accessCategories:categories,retiredLevel50Channels:retiredLevel50Channels.map(c=>({id:c.id,name:c.name})),
  moderatorBelowAdminRoles:!!moderator?.found&&adminRoles.length>0?adminRoles.every(x=>x.position>moderator.position):null,
  warnings,writesPerformed:0}));
}catch(error){
 console.error(JSON.stringify({event:"momentum_role_monitor_deferred",readOnly:true,reason:error instanceof Error?error.message.slice(0,130):"unknown"}));
}


/* ROLE_EFFECTIVE_READONLY_AUDIT_V2 — observational only; no Discord writes. */
await (async function roleEffectiveReadOnlyAuditV2() {
  try {
    const guildId=Bun.env.AUTHORIZED_GUILD_ID;
    const token=Bun.env.DISCORD_BOT_TOKEN;
    if(!guildId||!token){console.warn("ROLE_EFFECTIVE_READONLY_AUDIT_V2 SKIPPED missing guild/token");return;}
    async function read(path){
      let r=await fetch("https://discord.com/api/v10"+path,{method:"GET",headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw Error("Discord GET failed "+r.status+" "+path.replace(/[0-9]{16,}/g,"<id>"));
      return r.json();
    }
    const [guild,roles,channels,members]=await Promise.all([
      read("/guilds/"+guildId),read("/guilds/"+guildId+"/roles"),
      read("/guilds/"+guildId+"/channels"),read("/guilds/"+guildId+"/members?limit=1000")
    ]);
    if(guild.id!==guildId||!Array.isArray(roles)||!Array.isArray(channels)||!Array.isArray(members))throw Error("Identity or inventory validation failed");
    const roleMap=new Map(roles.map(r=>[r.id,r]));
    const catMap=new Map(channels.filter(c=>c.type===4).map(c=>[c.id,c]));
    const B={ADMIN:8n,VIEW:1024n,SEND:2048n,READ:65536n,MENTION:131072n,CONNECT:1048576n,SPEAK:2097152n,CREATE_THREADS:34359738368n,SEND_THREADS:274877906944n};
    function effective(roleIds,channel,memberId){
      let p=BigInt(roleMap.get(guildId)?.permissions||0);
      const held=new Set(roleIds);
      for(const id of held)p|=BigInt(roleMap.get(id)?.permissions||0);
      if(memberId===guild.owner_id||(p&B.ADMIN)!==0n)return (1n<<60n)-1n;
      const ow=channel.permission_overwrites||[];
      const e=ow.find(x=>x.type===0&&x.id===guildId);
      if(e){p&=~BigInt(e.deny);p|=BigInt(e.allow);}
      let deny=0n,allow=0n;
      for(const x of ow)if(x.type===0&&held.has(x.id)){deny|=BigInt(x.deny);allow|=BigInt(x.allow);}
      p&=~deny;p|=allow;
      const user=ow.find(x=>x.type===1&&x.id===memberId);
      if(user){p&=~BigInt(user.deny);p|=BigInt(user.allow);}
      return p;
    }
    const normalize=s=>String(s||"").normalize("NFKC").toLowerCase();
    const mod=roles.find(r=>normalize(r.name).includes("moderators")&&!r.managed);
    const expected=[
      ["meeting room","conference room access"],
      ["conference rooms","conference room access"],
      ["super fan lounge","super fan lounge access"]
    ];
    const accessProblems=[];
    const protectedPublic=[];
    for(const cat of catMap.values()){
      const name=normalize(cat.name);
      const expectation=expected.find(x=>name.includes(x[0]));
      const children=channels.filter(c=>c.parent_id===cat.id);
      const privateZone=expectation||["moderator only","recruiting ops","empress team","protected legacy"].some(k=>name.includes(k));
      if(privateZone)for(const ch of children)if((effective([],ch)&B.VIEW)!==0n)protectedPublic.push(ch.name);
      if(!expectation)continue;
      const role=roles.find(r=>normalize(r.name).includes(expectation[1])&&!r.managed);
      if(!role){accessProblems.push({category:cat.name,problem:"missing access role"});continue;}
      for(const ch of children){
        const bits=effective([role.id],ch),type=ch.type;
        const accessible=!!(bits&B.VIEW);
        const usable=type===2?!!(bits&B.CONNECT)&&!!(bits&B.SPEAK):
          type===15?!!(bits&B.CREATE_THREADS)&&!!(bits&B.SEND_THREADS):
          type===0?!!(bits&B.SEND)&&!!(bits&B.READ):true;
        if(!accessible||!usable)accessProblems.push({category:cat.name,channel:ch.name,view:accessible,usable});
      }
    }
    const mentionIssues=[];
    if(mod)for(const ch of channels.filter(c=>c.type===0||c.type===15)){
      const bits=effective([mod.id],ch);
      if((bits&B.MENTION)!==0n&&(bits&B.VIEW)!==0n&&(bits&B.SEND)!==0n)mentionIssues.push(ch.name);
    }
    const memberOverrides=channels.reduce((n,c)=>n+(c.permission_overwrites||[]).filter(o=>o.type===1).length,0);
    console.log("ROLE_EFFECTIVE_READONLY_AUDIT_V2 "+JSON.stringify({
      readOnly:true,guildVerified:true,roles:roles.length,channels:channels.length,
      membersFetched:members.length,memberListPossiblyPartial:members.length>=1000,
      protectedPublicChannels:protectedPublic,accessProblems:accessProblems,
      moderatorMentionChannelCount:mentionIssues.length,moderatorMentionChannels:mentionIssues.slice(0,12),
      individualMemberOverwrites:memberOverrides,
      status:(protectedPublic.length||accessProblems.length||mentionIssues.length)?"REVIEW":"PASS"
    }));
  } catch(err){console.warn("ROLE_EFFECTIVE_READONLY_AUDIT_V2 ERROR "+String(err?.message||err).slice(0,220));}
})();
