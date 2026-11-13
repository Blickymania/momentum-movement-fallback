// Read-only social link verification; never edits socials or Discord messages.
const urls=Object.entries(Bun.env).filter(([key,value])=>key.startsWith("SOCIAL_")&&key.endsWith("_URL")&&typeof value==="string"&&value.trim());
const result=[];
for(const [key,raw] of urls){let status="invalid_configuration",code=null;
 try{const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password)throw Error("unsafe URL");
  const r=await fetch(u.toString(),{method:"HEAD",redirect:"manual",signal:AbortSignal.timeout(7000)});
  code=r.status;status=code>=200&&code<400?"reachable_or_redirect":code===429||code===403?"access_restricted":"review";if(r.body)await r.body.cancel().catch(()=>{});
 }catch{status="request_failed_or_invalid"}
 result.push({variable:key,status,httpStatus:code});
}
console.log(JSON.stringify({event:"social_link_health_audit",community:"Momentum Movement",readOnly:true,total:result.length,results:result}));