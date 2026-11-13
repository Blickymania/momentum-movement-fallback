import { SQL } from "bun";
const required=["OAUTH_DB_HOST","OAUTH_DB_NAME","OAUTH_DB_USER","OAUTH_DB_PASSWORD"];
const missing=required.filter(k=>!Bun.env[k]);
const sql=missing.length?null:new SQL({hostname:Bun.env.OAUTH_DB_HOST,port:Number(Bun.env.OAUTH_DB_PORT||5432),database:Bun.env.OAUTH_DB_NAME,username:Bun.env.OAUTH_DB_USER,password:Bun.env.OAUTH_DB_PASSWORD,max:2,connectionTimeout:8});
Bun.serve({port:Number(Bun.env.PORT||3000),async fetch(){if(missing.length)return Response.json({ok:false,missing},{status:503});try{const rows=await sql`SELECT current_database() AS db,1 AS ok`;return Response.json({ok:true,result:rows[0]?.ok,database:rows[0]?.db});}catch(error){return Response.json({ok:false,error:error?.name||"DatabaseError",code:error?.code||null},{status:503});}}});