import postgres from "postgres";

const env = Bun.env;
const community = env.COMMUNITY_KEY;
if (!community || !env.DATABASE_URL) throw new Error("COMMUNITY_KEY and DATABASE_URL are required");
const sql = postgres(env.DATABASE_URL, { max: 5, idle_timeout: 20, connect_timeout: 15 });

const ddl = [
`CREATE EXTENSION IF NOT EXISTS pgcrypto`,
`CREATE TABLE IF NOT EXISTS coaching_schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS discord_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_user_id text NOT NULL,
  guild_id text NOT NULL,
  display_name text,
  roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, discord_user_id)
)`,
`CREATE TABLE IF NOT EXISTS creator_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_member_id uuid NOT NULL REFERENCES discord_members(id) ON DELETE CASCADE,
  tiktok_username text,
  tiktok_profile_url text,
  tiktok_open_id text,
  display_name text,
  avatar_url text,
  bio text,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending_authorization','verified','mismatch','unavailable')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (discord_member_id)
)`,
`CREATE TABLE IF NOT EXISTS creator_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('tiktok_authorized_api','applicant_upload','manual_entry','other')),
  verification_label text NOT NULL CHECK (verification_label IN ('live_verified','cached','manual','unavailable')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  follower_count bigint,
  following_count bigint,
  total_likes bigint,
  video_count bigint,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_urls jsonb NOT NULL DEFAULT '[]'::jsonb
)`,
`CREATE TABLE IF NOT EXISTS coaching_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_member_id uuid NOT NULL REFERENCES discord_members(id),
  creator_profile_id uuid REFERENCES creator_profiles(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','needs_information','approved','declined','on_hold','withdrawn','completed')),
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_version text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS application_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES coaching_applications(id) ON DELETE CASCADE,
  reviewer_discord_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','decline','request_information','hold','reopen')),
  private_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS coach_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES coaching_applications(id) ON DELETE CASCADE,
  coach_discord_id text NOT NULL,
  assigned_by_discord_id text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
)`,
`CREATE TABLE IF NOT EXISTS coaching_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES coaching_applications(id) ON DELETE CASCADE,
  coach_discord_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','rescheduled','cancelled','completed','no_show')),
  voice_channel_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS coaching_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES coaching_appointments(id),
  application_id uuid NOT NULL REFERENCES coaching_applications(id) ON DELETE CASCADE,
  coach_discord_id text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  attendance text CHECK (attendance IN ('attended','no_show','cancelled')),
  private_notes text,
  session_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS coaching_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES coaching_applications(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  success_criteria text,
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','paused','abandoned')),
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS coaching_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid REFERENCES coaching_goals(id) ON DELETE CASCADE,
  session_id uuid REFERENCES coaching_sessions(id) ON DELETE SET NULL,
  application_id uuid NOT NULL REFERENCES coaching_applications(id) ON DELETE CASCADE,
  assigned_to_discord_id text NOT NULL,
  title text NOT NULL,
  details text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS coaching_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES coaching_applications(id) ON DELETE CASCADE,
  sender_discord_id text NOT NULL,
  recipient_discord_id text NOT NULL,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'member_visible' CHECK (visibility IN ('member_visible','staff_only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
)`,
`CREATE TABLE IF NOT EXISTS coaching_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_member_id uuid NOT NULL REFERENCES discord_members(id),
  consent_type text NOT NULL,
  consent_version text NOT NULL,
  granted boolean NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
)`,
`CREATE TABLE IF NOT EXISTS coaching_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_discord_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
`CREATE INDEX IF NOT EXISTS idx_applications_status_created ON coaching_applications(status, created_at DESC)`,
`CREATE INDEX IF NOT EXISTS idx_creator_snapshots_profile_date ON creator_metric_snapshots(creator_profile_id, captured_at DESC)`,
`CREATE INDEX IF NOT EXISTS idx_appointments_coach_start ON coaching_appointments(coach_discord_id, starts_at)`,
`CREATE INDEX IF NOT EXISTS idx_goals_application_status ON coaching_goals(application_id, status)`,
`CREATE INDEX IF NOT EXISTS idx_action_items_application_status ON coaching_action_items(application_id, status)`,
`CREATE INDEX IF NOT EXISTS idx_audit_entity_created ON coaching_audit_events(entity_type, entity_id, created_at DESC)`,
`INSERT INTO coaching_schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING`
];

await sql.begin(async tx => { for (const statement of ddl) await tx.unsafe(statement); });


const json = (data, status = 200) => Response.json(data, {status,headers:{"cache-control":"no-store"}});
const audit = async (actor,action,type,id,meta={}) => sql.unsafe("INSERT INTO coaching_audit_events(actor_discord_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)",[actor,action,type,id,JSON.stringify(meta)]);
const bodyOf = async req => { if(Number(req.headers.get("content-length")||0)>1000000) throw new Error("too_large"); return await req.json(); };
const identityOf = async req => {
 const h=req.headers.get("authorization")||"";
 if(!h.startsWith("Bearer ")) return null;
 const headers={authorization:h};
 const ur=await fetch("https://discord.com/api/v10/users/@me",{headers});
 if(!ur.ok) return null;
 const user=await ur.json();
 const mr=await fetch("https://discord.com/api/v10/users/@me/guilds/"+env.AUTHORIZED_GUILD_ID+"/member",{headers});
 if(!mr.ok) return null;
 const member=await mr.json(), roles=Array.isArray(member.roles)?member.roles:[];
 const admin=roles.includes(env.ADMIN_ROLE_ID), moderator=admin||roles.includes(env.MODERATOR_ROLE_ID);
 const display=member.nick||user.global_name||user.username;
 await sql.unsafe("INSERT INTO discord_members(discord_user_id,guild_id,display_name,roles,last_seen_at) VALUES ($1,$2,$3,$4::jsonb,now()) ON CONFLICT(guild_id,discord_user_id) DO UPDATE SET display_name=EXCLUDED.display_name,roles=EXCLUDED.roles,last_seen_at=now()",[user.id,env.AUTHORIZED_GUILD_ID,display,JSON.stringify(roles)]);
 const [db]=await sql.unsafe("SELECT id FROM discord_members WHERE guild_id=$1 AND discord_user_id=$2",[env.AUTHORIZED_GUILD_ID,user.id]);
 return {id:user.id,username:user.username,displayName:display,avatar:user.avatar,roles,isAdmin:admin,isModerator:moderator,memberId:db.id};
};
const server=Bun.serve({port:Number(env.PORT||3000),async fetch(req){
 const u=new URL(req.url),path=u.pathname;
 if(req.method==="OPTIONS") return new Response(null,{status:204,headers:{"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,POST,PATCH,OPTIONS"}});
 if(req.method==="GET"&&path==="/health"){try{const [d]=await sql.unsafe("SELECT current_timestamp AS db_time");return json({ok:true,service:"coaching-platform-api",community,database:"connected",databaseTime:d.db_time});}catch{return json({ok:false,database:"unavailable"},503);}}
 if(req.method==="POST"&&path==="/api/token"){
  if(!env.DISCORD_CLIENT_SECRET||!env.APPLICATION_ID)return json({error:"oauth_not_configured"},503);
  let b;try{b=await bodyOf(req);}catch{return json({error:"invalid_json"},400);}
  if(typeof b.code!=="string"||!b.code)return json({error:"missing_code"},400);
  const form=new URLSearchParams({client_id:env.APPLICATION_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code:b.code,redirect_uri:env.DISCORD_REDIRECT_URI||"https://127.0.0.1"});
  const r=await fetch("https://discord.com/api/v10/oauth2/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});
  const d=await r.json();if(!r.ok)return json({error:"oauth_exchange_failed",details:d.error||"discord_rejected_code"},401);
  return json({access_token:d.access_token,token_type:d.token_type,expires_in:d.expires_in,scope:d.scope});
 }
 if(!path.startsWith("/api/"))return json({error:"not_found"},404);
 let who;try{who=await identityOf(req);}catch{return json({error:"discord_auth_unavailable"},502);}
 if(!who)return json({error:"unauthorized"},401);
 if(req.method==="GET"&&path==="/api/me")return json({user:{id:who.id,username:who.username,displayName:who.displayName,avatar:who.avatar},community,permissions:{member:true,moderator:who.isModerator,admin:who.isAdmin}});
 if(req.method==="GET"&&path==="/api/applications"){
  const rows=await sql.unsafe("SELECT id,status,categories,submitted_at,created_at,updated_at FROM coaching_applications WHERE discord_member_id=$1 ORDER BY updated_at DESC LIMIT 50",[who.memberId]);
  return json({applications:rows});
 }
 if(req.method==="POST"&&path==="/api/applications"){
  let b;try{b=await bodyOf(req);}catch{return json({error:"invalid_json"},400);}
  const username=typeof b.tiktokUsername==="string"?b.tiktokUsername.trim().replace(/^@/,"").slice(0,100):"";
  const profile=typeof b.tiktokProfileUrl==="string"?b.tiktokProfileUrl.trim().slice(0,500):"";
  if(!username&&!profile)return json({error:"tiktok_identity_required"},400);
  if(username&&!/^[A-Za-z0-9._]{2,100}$/.test(username))return json({error:"invalid_tiktok_username"},400);
  if(profile&&!/^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/?$/i.test(profile))return json({error:"invalid_tiktok_url"},400);
  const cats=Array.isArray(b.categories)?b.categories.filter(x=>typeof x==="string").slice(0,20):[];
  const answers=b.answers&&typeof b.answers==="object"&&!Array.isArray(b.answers)?b.answers:{};
  const availability=b.availability&&typeof b.availability==="object"&&!Array.isArray(b.availability)?b.availability:{};
  const [p]=await sql.unsafe("INSERT INTO creator_profiles(discord_member_id,tiktok_username,tiktok_profile_url) VALUES ($1,$2,$3) ON CONFLICT(discord_member_id) DO UPDATE SET tiktok_username=EXCLUDED.tiktok_username,tiktok_profile_url=EXCLUDED.tiktok_profile_url,updated_at=now() RETURNING id",[who.memberId,username||null,profile||null]);
  const [a]=await sql.unsafe("INSERT INTO coaching_applications(discord_member_id,creator_profile_id,categories,answers,availability) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) RETURNING id,status,created_at,updated_at",[who.memberId,p.id,JSON.stringify(cats),JSON.stringify(answers),JSON.stringify(availability)]);
  await audit(who.id,"application_draft_created","application",a.id);return json({application:a},201);
 }
 const am=path.match(/^\/api\/applications\/([0-9a-f-]+)$/i);
 if(am&&req.method==="GET"){
  const q=who.isModerator?await sql.unsafe("SELECT a.*,p.tiktok_username,p.tiktok_profile_url,p.verification_status FROM coaching_applications a LEFT JOIN creator_profiles p ON p.id=a.creator_profile_id WHERE a.id=$1",[am[1]]):await sql.unsafe("SELECT a.*,p.tiktok_username,p.tiktok_profile_url,p.verification_status FROM coaching_applications a LEFT JOIN creator_profiles p ON p.id=a.creator_profile_id WHERE a.id=$1 AND a.discord_member_id=$2",[am[1],who.memberId]);
  if(!q.length)return json({error:"not_found"},404);const a=q[0];
  const [goals,appointments,messages]=await Promise.all([
   sql.unsafe("SELECT id,title,description,success_criteria,status,due_at,baseline,target FROM coaching_goals WHERE application_id=$1 ORDER BY created_at",[a.id]),
   sql.unsafe("SELECT id,starts_at,ends_at,timezone,status,voice_channel_id FROM coaching_appointments WHERE application_id=$1 ORDER BY starts_at DESC",[a.id]),
   sql.unsafe("SELECT id,sender_discord_id,body,created_at,read_at FROM coaching_messages WHERE application_id=$1 AND visibility='member_visible' ORDER BY created_at",[a.id])
  ]);return json({application:a,goals,appointments,messages});
 }
 if(am&&req.method==="PATCH"){
  const q=await sql.unsafe("SELECT a.*,p.tiktok_username,p.tiktok_profile_url FROM coaching_applications a LEFT JOIN creator_profiles p ON p.id=a.creator_profile_id WHERE a.id=$1 AND a.discord_member_id=$2",[am[1],who.memberId]);
  if(!q.length)return json({error:"not_found"},404);const a=q[0];if(!["draft","needs_information"].includes(a.status))return json({error:"application_locked"},409);
  let b;try{b=await bodyOf(req);}catch{return json({error:"invalid_json"},400);}
  const username=typeof b.tiktokUsername==="string"?b.tiktokUsername.trim().replace(/^@/,"").slice(0,100):(a.tiktok_username||"");
  const profile=typeof b.tiktokProfileUrl==="string"?b.tiktokProfileUrl.trim().slice(0,500):(a.tiktok_profile_url||"");
  if(!username&&!profile)return json({error:"tiktok_identity_required"},400);
  if(username&&!/^[A-Za-z0-9._]{2,100}$/.test(username))return json({error:"invalid_tiktok_username"},400);
  if(profile&&!/^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/?$/i.test(profile))return json({error:"invalid_tiktok_url"},400);
  const cats=Array.isArray(b.categories)?b.categories.filter(x=>typeof x==="string").slice(0,20):a.categories;
  const answers=b.answers&&typeof b.answers==="object"&&!Array.isArray(b.answers)?b.answers:a.answers;
  const availability=b.availability&&typeof b.availability==="object"&&!Array.isArray(b.availability)?b.availability:a.availability;
  await sql.unsafe("UPDATE creator_profiles SET tiktok_username=$1,tiktok_profile_url=$2,updated_at=now() WHERE discord_member_id=$3",[username||null,profile||null,who.memberId]);
  const [updated]=await sql.unsafe("UPDATE coaching_applications SET categories=$1::jsonb,answers=$2::jsonb,availability=$3::jsonb,updated_at=now() WHERE id=$4 RETURNING id,status,updated_at",[JSON.stringify(cats),JSON.stringify(answers),JSON.stringify(availability),a.id]);
  await audit(who.id,"application_draft_updated","application",a.id);return json({application:updated});
 }
 const sm=path.match(/^\/api\/applications\/([0-9a-f-]+)\/submit$/i);
 if(sm&&req.method==="POST"){
  const [a]=await sql.unsafe("SELECT id,status,categories,answers FROM coaching_applications WHERE id=$1 AND discord_member_id=$2",[sm[1],who.memberId]);
  if(!a)return json({error:"not_found"},404);if(!["draft","needs_information"].includes(a.status))return json({error:"invalid_status"},409);
  const ans=a.answers||{},cats=Array.isArray(a.categories)?a.categories:[];
  if(!cats.length||!ans.currentSituation||!ans.goals||!ans.challenges)return json({error:"application_incomplete",required:["categories","currentSituation","goals","challenges"]},400);
  const [updated]=await sql.unsafe("UPDATE coaching_applications SET status='submitted',submitted_at=now(),updated_at=now() WHERE id=$1 RETURNING id,status,submitted_at",[a.id]);
  await audit(who.id,"application_submitted","application",a.id);return json({application:updated});
 }
 if(req.method==="GET"&&path==="/api/staff/queue"){
  if(!who.isModerator)return json({error:"forbidden"},403);
  const status=u.searchParams.get("status");
  const rows=status?await sql.unsafe("SELECT a.id,a.status,a.categories,a.submitted_at,a.created_at,m.discord_user_id,m.display_name,p.tiktok_username,p.tiktok_profile_url FROM coaching_applications a JOIN discord_members m ON m.id=a.discord_member_id LEFT JOIN creator_profiles p ON p.id=a.creator_profile_id WHERE m.guild_id=$1 AND a.status=$2 ORDER BY a.submitted_at NULLS LAST,a.created_at DESC LIMIT 100",[env.AUTHORIZED_GUILD_ID,status]):await sql.unsafe("SELECT a.id,a.status,a.categories,a.submitted_at,a.created_at,m.discord_user_id,m.display_name,p.tiktok_username,p.tiktok_profile_url FROM coaching_applications a JOIN discord_members m ON m.id=a.discord_member_id LEFT JOIN creator_profiles p ON p.id=a.creator_profile_id WHERE m.guild_id=$1 AND a.status IN ('submitted','under_review','needs_information','on_hold') ORDER BY a.submitted_at NULLS LAST,a.created_at DESC LIMIT 100",[env.AUTHORIZED_GUILD_ID]);
  return json({applications:rows});
 }
 const act=path.match(/^\/api\/staff\/applications\/([0-9a-f-]+)\/action$/i);
 if(act&&req.method==="POST"){
  if(!who.isModerator)return json({error:"forbidden"},403);let b;try{b=await bodyOf(req);}catch{return json({error:"invalid_json"},400);}
  const states={approve:"approved",decline:"declined",request_information:"needs_information",hold:"on_hold",reopen:"under_review"};
  if(!states[b.action])return json({error:"invalid_action"},400);if(b.action==="reopen"&&!who.isAdmin)return json({error:"admin_required"},403);
  const [a]=await sql.unsafe("SELECT id FROM coaching_applications WHERE id=$1",[act[1]]);if(!a)return json({error:"not_found"},404);
  const notes=typeof b.privateNotes==="string"?b.privateNotes.slice(0,10000):null;
  await sql.unsafe("INSERT INTO application_reviews(application_id,reviewer_discord_id,decision,private_notes) VALUES ($1,$2,$3,$4)",[a.id,who.id,b.action,notes]);
  const [updated]=await sql.unsafe("UPDATE coaching_applications SET status=$1,reviewed_at=now(),updated_at=now() WHERE id=$2 RETURNING id,status,reviewed_at",[states[b.action],a.id]);
  await audit(who.id,"staff_application_action","application",a.id,{decision:b.action});return json({application:updated});
 }
 return json({error:"not_found"},404);
}});
console.log("Coaching platform API routes ready for "+community+" on "+server.port);
