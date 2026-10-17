import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_SIZE || 10),
  connectionTimeoutMillis: 10000
});
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const PROD = process.env.NODE_ENV === 'production';
const webRoot = path.resolve(__dirname, '..');

if (PROD && (!JWT_SECRET || JWT_SECRET.length < 32)) {
  throw new Error('Set JWT_SECRET to a random secret with at least 32 characters.');
}
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_ORIGIN ? process.env.APP_ORIGIN.split(',').map(x=>x.trim()) : false, credentials: true }));
app.use(express.json({limit:'2mb'}));
app.use(cookieParser());
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');next();});

const q = (sql, args=[]) => pool.query(sql,args);
const hash = s => createHash('sha256').update(s).digest('hex');
const tokenCookie = { httpOnly:true, secure:PROD, sameSite:'lax', path:'/', maxAge:7*24*60*60*1000 };
const tokenFor = id => jwt.sign({sub:id}, JWT_SECRET || 'development-only-secret-change-me', {expiresIn:'7d',issuer:'sciop'});
const publicProfile = p => p && ({
  id:p.id, email:p.email, full_name:p.full_name, username:p.username, role:p.role,
  account_type:p.account_type, avatar_url:p.avatar_url, cover_url:p.cover_url, bio:p.bio,
  location:p.location, domains:p.domains||[], skills:p.skills||[], interests:p.interests||[],
  experience:p.experience, education:p.education, portfolio_url:p.portfolio_url,
  can_offer:p.can_offer, needs:p.needs, verified:p.verified, created_at:p.created_at
});
const asyncRoute = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const auth = asyncRoute(async(req,res,next)=>{
  const raw=req.cookies.sciop_session || (req.headers.authorization||'').replace(/^Bearer\s+/,'');
  if(!raw)return res.status(401).json({error:'Sign in required.'});
  let decoded;try{decoded=jwt.verify(raw,JWT_SECRET||'development-only-secret-change-me',{issuer:'sciop'});}catch{return res.status(401).json({error:'Session expired. Sign in again.'});}
  const s=await q('SELECT id FROM sessions WHERE user_id=$1 AND token_hash=$2 AND expires_at>now()',[decoded.sub,hash(raw)]);
  if(!s.rowCount)return res.status(401).json({error:'Session expired. Sign in again.'});
  const p=await q('SELECT * FROM profiles WHERE id=$1 AND suspended=false',[decoded.sub]);
  if(!p.rowCount)return res.status(401).json({error:'This account is unavailable.'});
  req.user=p.rows[0];next();
});
const admin = (req,res,next)=>['admin','moderator'].includes(req.user.role)?next():res.status(403).json({error:'Moderator access required.'});
const validate = schema => (req,res,next)=>{const r=schema.safeParse(req.body);if(!r.success)return res.status(400).json({error:r.error.issues.map(x=>x.message).join(' ')});req.body=r.data;next();};
const text=(max=2000)=>z.string().trim().min(1).max(max);
const uuid=z.string().uuid();
const arrayText=z.array(z.string().trim().min(1).max(100)).max(40).optional().default([]);
const emitNotification=async(userId,actorId,kind,entityType,entityId,message)=>{
 if(userId&&userId!==actorId)await q('INSERT INTO notifications(user_id,actor_id,kind,entity_type,entity_id,message) VALUES($1,$2,$3,$4,$5,$6)',[userId,actorId,kind,entityType,entityId,message]);
};
const publicSelect='id,full_name,username,role,account_type,avatar_url,bio,location,domains,skills,interests,experience,education,portfolio_url,can_offer,needs,verified,created_at';

app.get('/api/health',asyncRoute(async(req,res)=>{await q('SELECT 1');res.json({ok:true,service:'SCIOP API',database:'connected',version:'0.1.0'});}));
app.post('/api/auth/signup',validate(z.object({
 email:z.string().trim().email().max(254).transform(s=>s.toLowerCase()),
 password:z.string().min(10).max(128),
 full_name:text(100), username:z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/),
 role:z.enum(['member','professional','organization']).default('member'),
 account_type:z.enum(['individual','organization']).default('individual')
})),asyncRoute(async(req,res)=>{
 const {email,password,full_name,username,role,account_type}=req.body;
 const existing=await q('SELECT 1 FROM profiles WHERE lower(email)=lower($1) OR lower(username)=lower($2)',[email,username]);
 if(existing.rowCount)return res.status(409).json({error:'That email or username is already registered.'});
 const password_hash=await bcrypt.hash(password,12);
 const assignedRole=(process.env.SCIOP_ADMIN_EMAIL && email===process.env.SCIOP_ADMIN_EMAIL.toLowerCase())?'admin':role;
 const p=await q(`INSERT INTO profiles(email,password_hash,full_name,username,role,account_type) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[email,password_hash,full_name,username,assignedRole,account_type]);
 const raw=tokenFor(p.rows[0].id);await q('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'7 days\')',[p.rows[0].id,hash(raw)]);
 res.cookie('sciop_session',raw,tokenCookie).status(201).json({user:publicProfile(p.rows[0]),message:'Account created. Complete your profile to improve matches.'});
}));
app.post('/api/auth/login',validate(z.object({email:z.string().email().transform(s=>s.toLowerCase()),password:z.string().min(1).max(128)})),asyncRoute(async(req,res)=>{
 const r=await q('SELECT * FROM profiles WHERE lower(email)=lower($1) AND suspended=false',[req.body.email]);
 if(!r.rowCount||!await bcrypt.compare(req.body.password,r.rows[0].password_hash))return res.status(401).json({error:'Email or password is incorrect.'});
 const raw=tokenFor(r.rows[0].id);await q('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'7 days\')',[r.rows[0].id,hash(raw)]);
 res.cookie('sciop_session',raw,tokenCookie).json({user:publicProfile(r.rows[0])});
}));
app.post('/api/auth/logout',asyncRoute(async(req,res)=>{const raw=req.cookies.sciop_session;if(raw)await q('DELETE FROM sessions WHERE token_hash=$1',[hash(raw)]);res.clearCookie('sciop_session',{path:'/'}).json({ok:true});}));
app.get('/api/auth/me',auth,asyncRoute(async(req,res)=>res.json({user:publicProfile(req.user)})));
app.post('/api/auth/forgot',validate(z.object({email:z.string().trim().email().max(254).transform(s=>s.toLowerCase())})),asyncRoute(async(req,res)=>{
 const generic={message:'If that email belongs to an active account, recovery instructions will be sent.'};
 const user=await q('SELECT id,email FROM profiles WHERE lower(email)=lower($1) AND suspended=false',[req.body.email]);if(!user.rowCount)return res.json(generic);
 const token=randomBytes(32).toString('base64url'),tokenHash=hash(token);
 await q('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[user.rows[0].id]);
 await q("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes')",[user.rows[0].id,tokenHash]);
 const origin=(process.env.APP_ORIGIN||'').split(',')[0].trim()||'';
 if(!process.env.RESEND_API_KEY||!process.env.RESEND_FROM_EMAIL||!origin){console.warn('SCIOP recovery token created, but email delivery is not configured. Set RESEND_API_KEY, RESEND_FROM_EMAIL and APP_ORIGIN.');return res.json(generic)}
 const url=origin.replace(/\/$/,'')+'/app.html?reset_token='+encodeURIComponent(token);
 const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[user.rows[0].email],subject:'Reset your SCIOP password',html:'<p>A password reset was requested for your SCIOP account.</p><p><a href="'+url+'">Reset password</a></p><p>This link expires in 30 minutes. If you did not request it, ignore this email.</p>'})});
 if(!sent.ok){console.error('SCIOP recovery email provider returned HTTP '+sent.status);return res.status(502).json({error:'The recovery email could not be sent. Please try again later.'})}
 res.json(generic);
}));
app.post('/api/auth/reset',validate(z.object({token:z.string().min(32).max(200),password:z.string().min(10).max(128)})),asyncRoute(async(req,res)=>{
 const tokenHash=hash(req.body.token);const r=await q('SELECT id,user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()',[tokenHash]);if(!r.rowCount)return res.status(400).json({error:'This recovery link is invalid or expired. Request a new one.'});
 const password_hash=await bcrypt.hash(req.body.password,12);const client=await pool.connect();try{await client.query('BEGIN');await client.query('UPDATE profiles SET password_hash=$2,updated_at=now() WHERE id=$1',[r.rows[0].user_id,password_hash]);await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE id=$1',[r.rows[0].id]);await client.query('DELETE FROM sessions WHERE user_id=$1',[r.rows[0].user_id]);await client.query('COMMIT')}catch(err){await client.query('ROLLBACK');throw err}finally{client.release()}
 res.json({message:'Password updated. Sign in with your new password.'});
}));
app.patch('/api/profile',auth,validate(z.object({
 full_name:text(100).optional(),bio:z.string().max(1600).optional(),location:z.string().max(160).optional(),
 domains:arrayText,skills:arrayText,interests:arrayText,experience:z.string().max(4000).optional(),
 education:z.string().max(4000).optional(),portfolio_url:z.string().max(500).optional(),
 can_offer:z.string().max(2000).optional(),needs:z.string().max(2000).optional(),
 avatar_url:z.string().url().max(1000).or(z.literal('')).optional(),cover_url:z.string().url().max(1000).or(z.literal('')).optional()
})),asyncRoute(async(req,res)=>{
 const entries=Object.entries(req.body).filter(([,v])=>v!==undefined);if(!entries.length)return res.status(400).json({error:'No profile changes supplied.'});
 const sqlSet=entries.map(([k],i)=>`${k}=$${i+2}`).join(', ');
 const vals=entries.map(([,v])=>v);
 const r=await q(`UPDATE profiles SET ${sqlSet},updated_at=now() WHERE id=$1 RETURNING *`,[req.user.id,...vals]);res.json({user:publicProfile(r.rows[0])});
}));
app.get('/api/profiles',auth,asyncRoute(async(req,res)=>{
 const term=String(req.query.q||'').slice(0,100),domain=String(req.query.domain||'').slice(0,100);
 const r=await q(`SELECT ${publicSelect}, (SELECT count(*) FROM follows f WHERE f.followed_id=p.id) AS follower_count,
 EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.followed_id=p.id) AS is_following
 FROM profiles p WHERE p.id<>$1 AND p.suspended=false
 AND ($2='' OR p.full_name ILIKE '%'||$2||'%' OR p.username ILIKE '%'||$2||'%' OR p.bio ILIKE '%'||$2||'%' OR $2=ANY(p.skills) OR $2=ANY(p.domains))
 AND ($3='' OR $3=ANY(p.domains)) ORDER BY p.verified DESC,p.created_at DESC LIMIT 60`,[req.user.id,term,domain]);
 res.json({items:r.rows.map((p)=>({...p,match:matchScore(req.user,p)}))});
}));
app.get('/api/profiles/:id',auth,asyncRoute(async(req,res)=>{
 const r=await q(`SELECT ${publicSelect} FROM profiles WHERE id=$1 AND suspended=false',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Profile not found.'});
 if(req.user.id!==req.params.id)await q('INSERT INTO profile_views(viewer_id,profile_id) VALUES($1,$2) ON CONFLICT(viewer_id,profile_id) DO UPDATE SET viewed_at=now()',[req.user.id,req.params.id]);
 const c=await q(`SELECT id,requester_id,recipient_id,status FROM connections WHERE (requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1) ORDER BY created_at DESC LIMIT 1',[req.user.id,req.params.id]);
 const followers=await q('SELECT count(*)::int AS n FROM follows WHERE followed_id=$1',[req.params.id]);const following=await q('SELECT count(*)::int AS n FROM follows WHERE follower_id=$1',[req.params.id]);
 res.json({profile:{...r.rows[0],match:matchScore(req.user,r.rows[0])},connection:c.rows[0]||null,followers:followers.rows[0].n,following:following.rows[0].n});
}));
app.post('/api/profiles/:id/follow',auth,asyncRoute(async(req,res)=>{
 const target=req.params.id;if(target===req.user.id)return res.status(400).json({error:'You cannot follow yourself.'});
 const exists=await q('SELECT 1 FROM follows WHERE follower_id=$1 AND followed_id=$2',[req.user.id,target]);
 if(exists.rowCount){await q('DELETE FROM follows WHERE follower_id=$1 AND followed_id=$2',[req.user.id,target]);return res.json({following:false});}
 await q('INSERT INTO follows(follower_id,followed_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.id,target]);await emitNotification(target,req.user.id,'follow','profile',req.user.id,`${req.user.full_name} followed you`);res.json({following:true});
}));
app.post('/api/profiles/:id/connect',auth,validate(z.object({message:z.string().max(500).optional().default('')})),asyncRoute(async(req,res)=>{
 if(req.params.id===req.user.id)return res.status(400).json({error:'You cannot connect to your own account.'});
 const old=await q('SELECT * FROM connections WHERE (requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1) ORDER BY created_at DESC LIMIT 1',[req.user.id,req.params.id]);
 if(old.rows[0]?.status==='accepted')return res.json({connection:old.rows[0]});
 if(old.rows[0]?.status==='pending')return res.status(409).json({error:'A connection request is already pending.'});
 const r=await q(`INSERT INTO connections(requester_id,recipient_id,message,status) VALUES($1,$2,$3,'pending') ON CONFLICT(requester_id,recipient_id) DO UPDATE SET status='pending',message=EXCLUDED.message,updated_at=now() RETURNING *`,[req.user.id,req.params.id,req.body.message]);
 await emitNotification(req.params.id,req.user.id,'connection','connection',r.rows[0].id,`${req.user.full_name} sent a connection request`);res.status(201).json({connection:r.rows[0]});
}));
app.get('/api/connections',auth,asyncRoute(async(req,res)=>{
 const r=await q(`SELECT c.*,p.full_name,p.username,p.avatar_url,p.verified FROM connections c JOIN profiles p ON p.id=CASE WHEN c.requester_id=$1 THEN c.recipient_id ELSE c.requester_id END WHERE c.requester_id=$1 OR c.recipient_id=$1 ORDER BY c.created_at DESC',[req.user.id]);res.json({items:r.rows});
}));
app.patch('/api/connections/:id',auth,validate(z.object({status:z.enum(['accepted','declined','blocked'])})),asyncRoute(async(req,res)=>{
 const r=await q(`UPDATE connections SET status=$3,updated_at=now() WHERE id=$1 AND recipient_id=$2 AND status='pending' RETURNING *',[req.params.id,req.user.id,req.body.status]);if(!r.rowCount)return res.status(404).json({error:'Pending request not found.'});
 await emitNotification(r.rows[0].requester_id,req.user.id,'connection_status','connection',r.rows[0].id,`Your connection request was ${req.body.status}`);res.json({connection:r.rows[0]});
}));

const postSchema=z.object({post_type:z.enum(['text','image','video','link','question','poll','idea','project','opportunity','request']).default('text'),body:text(5000),title:z.string().max(240).optional().default(''),media_url:z.string().url().optional().or(z.literal('')),link_url:z.string().url().optional().or(z.literal('')),poll_options:z.array(z.string().trim().min(1).max(160)).min(2).max(8).optional(),visibility:z.enum(['public','connections','community']).optional().default('public'),community_id:uuid.optional()});
app.get('/api/feed',auth,asyncRoute(async(req,res)=>{
 const take=Math.min(Math.max(Number(req.query.limit)||30,1),60),before=req.query.before?new Date(String(req.query.before)):null;
 const r=await q(`SELECT p.*,u.full_name,u.username,u.avatar_url,u.verified,
 (SELECT count(*)::int FROM reactions r WHERE r.post_id=p.id) AS reaction_count,
 (SELECT count(*)::int FROM comments c WHERE c.post_id=p.id) AS comment_count,
 EXISTS(SELECT 1 FROM reactions r WHERE r.post_id=p.id AND r.user_id=$1) AS liked,
 EXISTS(SELECT 1 FROM saved_items s WHERE s.item_id=p.id AND s.item_type='post' AND s.user_id=$1) AS saved
 FROM posts p JOIN profiles u ON u.id=p.author_id
 WHERE p.visibility='public' AND ($2::timestamptz IS NULL OR p.created_at<$2)
 ORDER BY p.created_at DESC LIMIT $3`,[req.user.id,before?.toISOString()||null,take]);res.json({items:r.rows});
}));
app.post('/api/posts',auth,validate(postSchema),asyncRoute(async(req,res)=>{
 const b=req.body;if(b.post_type==='poll'&&(!b.poll_options||b.poll_options.length<2))return res.status(400).json({error:'A poll needs at least two answer options.'});
 const r=await q(`INSERT INTO posts(author_id,post_type,body,title,media_url,link_url,poll_options,visibility,community_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[req.user.id,b.post_type,b.body,b.title,b.media_url||null,b.link_url||null,b.poll_options?JSON.stringify(b.poll_options):null,b.visibility,b.community_id||null]);res.status(201).json({post:{...r.rows[0],full_name:req.user.full_name,username:req.user.username,avatar_url:req.user.avatar_url,reaction_count:0,comment_count:0,liked:false,saved:false}});
}));
app.post('/api/posts/:id/react',auth,asyncRoute(async(req,res)=>{
 const exists=await q('SELECT 1 FROM reactions WHERE user_id=$1 AND post_id=$2 AND reaction=\'like\'',[req.user.id,req.params.id]);
 if(exists.rowCount)await q('DELETE FROM reactions WHERE user_id=$1 AND post_id=$2 AND reaction=\'like\'',[req.user.id,req.params.id]);else {const r=await q('INSERT INTO reactions(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING post_id',[req.user.id,req.params.id]);if(r.rowCount){const owner=await q('SELECT author_id FROM posts WHERE id=$1',[req.params.id]);if(owner.rowCount)await emitNotification(owner.rows[0].author_id,req.user.id,'reaction','post',req.params.id,`${req.user.full_name} liked your post`);}}
 const count=await q('SELECT count(*)::int AS n FROM reactions WHERE post_id=$1',[req.params.id]);res.json({liked:!exists.rowCount,count:count.rows[0].n});
}));
app.post('/api/reports',auth,validate(z.object({item_type:z.enum(['post','profile','opportunity','project','idea','community','message']),item_id:uuid,reason:text(1000)})),asyncRoute(async(req,res)=>{const b=req.body;const r=await q('INSERT INTO reports(reporter_id,item_type,item_id,reason) VALUES($1,$2,$3,$4) RETURNING id,status,created_at',[req.user.id,b.item_type,b.item_id,b.reason]);res.status(201).json({report:r.rows[0]});}));
app.post('/api/posts/:id/poll-vote',auth,validate(z.object({option:text(160)})),asyncRoute(async(req,res)=>{\n const p=await q(\"SELECT id,poll_options FROM posts WHERE id=$1 AND post_type='poll'\",[req.params.id]);if(!p.rowCount)return res.status(404).json({error:'Poll not found.'});const options=p.rows[0].poll_options||[];if(!options.includes(req.body.option))return res.status(400).json({error:'Choose one of the listed options.'});await q('INSERT INTO poll_votes(post_id,user_id,option) VALUES($1,$2,$3) ON CONFLICT(post_id,user_id) DO UPDATE SET option=EXCLUDED.option,created_at=now()',[req.params.id,req.user.id,req.body.option]);const votes=await q('SELECT option,count(*)::int AS count FROM poll_votes WHERE post_id=$1 GROUP BY option',[req.params.id]);const mine=await q('SELECT option FROM poll_votes WHERE post_id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.json({votes:votes.rows,my_vote:mine.rows[0]?.option||null});\n}));\napp.get('/api/posts/:id/comments',auth,asyncRoute(async(req,res)=>{
 const r=await q(`SELECT c.*,p.full_name,p.username,p.avatar_url FROM comments c JOIN profiles p ON p.id=c.author_id WHERE c.post_id=$1 ORDER BY c.created_at ASC LIMIT 250',[req.params.id]);res.json({items:r.rows});
}));
app.post('/api/posts/:id/comments',auth,validate(z.object({body:text(2000),parent_id:uuid.optional()})),asyncRoute(async(req,res)=>{
 const exists=await q('SELECT author_id FROM posts WHERE id=$1',[req.params.id]);if(!exists.rowCount)return res.status(404).json({error:'Post not found.'});
 const r=await q('INSERT INTO comments(post_id,author_id,parent_id,body) VALUES($1,$2,$3,$4) RETURNING *',[req.params.id,req.user.id,req.body.parent_id||null,req.body.body]);
 await emitNotification(exists.rows[0].author_id,req.user.id,'comment','post',req.params.id,`${req.user.full_name} commented on your post`);res.status(201).json({comment:{...r.rows[0],full_name:req.user.full_name,username:req.user.username,avatar_url:req.user.avatar_url}});
}));
app.post('/api/posts/:id/save',auth,asyncRoute(async(req,res)=>{
 const e=await q(`SELECT 1 FROM saved_items WHERE user_id=$1 AND item_id=$2 AND item_type='post'',[req.user.id,req.params.id]);
 if(e.rowCount)await q(`DELETE FROM saved_items WHERE user_id=$1 AND item_id=$2 AND item_type='post'`,[req.user.id,req.params.id]);else await q(`INSERT INTO saved_items(user_id,item_id,item_type) VALUES($1,$2,'post') ON CONFLICT DO NOTHING',[req.user.id,req.params.id]);
 res.json({saved:!e.rowCount});
}));

const opportunitySchema=z.object({title:text(180),kind:z.enum(['job','internship','freelance','business','partnership','investment','research','contract','vendor','mentorship','other']),description:text(8000),domain:z.string().max(120).optional().default(''),location:z.string().max(180).optional().default(''),work_mode:z.enum(['onsite','hybrid','remote','flexible']).optional().default('flexible'),budget_min:z.coerce.number().min(0).optional().nullable(),budget_max:z.coerce.number().min(0).optional().nullable(),currency:z.string().max(8).optional().default('INR'),required_skills:arrayText,deadline:z.string().datetime().optional().nullable(),status:z.enum(['draft','open','paused','closed','filled']).optional().default('open')});
app.get('/api/opportunities',auth,asyncRoute(async(req,res)=>{
 const t=String(req.query.q||'').slice(0,120),kind=String(req.query.kind||''),domain=String(req.query.domain||''),skills=String(req.query.skills||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,20);
 const r=await q(`SELECT o.*,p.full_name AS owner_name,p.username AS owner_username,p.avatar_url AS owner_avatar,p.verified AS owner_verified,
 EXISTS(SELECT 1 FROM applications a WHERE a.opportunity_id=o.id AND a.applicant_id=$1) AS applied,
 EXISTS(SELECT 1 FROM saved_items s WHERE s.item_id=o.id AND s.item_type='opportunity' AND s.user_id=$1) AS saved
 FROM opportunities o JOIN profiles p ON p.id=o.owner_id WHERE o.status='open'
 AND ($2='' OR o.title ILIKE '%'||$2||'%' OR o.description ILIKE '%'||$2||'%' OR o.domain ILIKE '%'||$2||'%')
 AND ($3='' OR o.kind=$3) AND ($4='' OR o.domain=$4)
 ORDER BY o.created_at DESC LIMIT 80`,[req.user.id,t,kind,domain]);
 const items=r.rows.map(o=>({...o,match:matchScore(req.user,{domains:[o.domain],skills:o.required_skills,location:o.location})})).filter(o=>!skills.length||skills.some(s=>(o.required_skills||[]).some(a=>a.toLowerCase()===s.toLowerCase())||(o.title+' '+o.description).toLowerCase().includes(s.toLowerCase())));res.json({items});
}));
app.post('/api/opportunities',auth,validate(opportunitySchema),asyncRoute(async(req,res)=>{
 const b=req.body;if(b.budget_min!=null&&b.budget_max!=null&&b.budget_max<b.budget_min)return res.status(400).json({error:'Maximum budget must be at least the minimum budget.'});
 const r=await q(`INSERT INTO opportunities(owner_id,title,kind,description,domain,location,work_mode,budget_min,budget_max,currency,required_skills,deadline,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[req.user.id,b.title,b.kind,b.description,b.domain,b.location,b.work_mode,b.budget_min??null,b.budget_max??null,b.currency,b.required_skills,b.deadline??null,b.status]);res.status(201).json({item:r.rows[0]});
}));
app.post('/api/opportunities/:id/apply',auth,validate(z.object({cover_note:z.string().max(3000).optional().default('')})),asyncRoute(async(req,res)=>{
 const o=await q('SELECT * FROM opportunities WHERE id=$1 AND status=\'open\'',[req.params.id]);if(!o.rowCount)return res.status(404).json({error:'This opportunity is closed or unavailable.'});if(o.rows[0].owner_id===req.user.id)return res.status(400).json({error:'You cannot apply to your own opportunity.'});
 const r=await q(`INSERT INTO applications(opportunity_id,applicant_id,cover_note) VALUES($1,$2,$3) ON CONFLICT(opportunity_id,applicant_id) DO UPDATE SET cover_note=EXCLUDED.cover_note,status='submitted',updated_at=now() RETURNING *',[req.params.id,req.user.id,req.body.cover_note]);
 await emitNotification(o.rows[0].owner_id,req.user.id,'application','opportunity',req.params.id,`${req.user.full_name} applied to ${o.rows[0].title}`);res.status(201).json({application:r.rows[0]});
}));
app.get('/api/my/applications',auth,asyncRoute(async(req,res)=>{
 const r=await q(`SELECT a.*,o.title,o.kind,o.domain,o.location,o.status AS opportunity_status,p.full_name AS owner_name FROM applications a JOIN opportunities o ON o.id=a.opportunity_id JOIN profiles p ON p.id=o.owner_id WHERE a.applicant_id=$1 ORDER BY a.created_at DESC',[req.user.id]);res.json({items:r.rows});
}));
app.get('/api/opportunities/:id/applications',auth,asyncRoute(async(req,res)=>{
 const own=await q('SELECT 1 FROM opportunities WHERE id=$1 AND owner_id=$2',[req.params.id,req.user.id]);if(!own.rowCount)return res.status(403).json({error:'Only the opportunity owner can view applicants.'});
 const r=await q(`SELECT a.*,p.full_name,p.username,p.avatar_url,p.skills,p.domains,p.experience,p.verified FROM applications a JOIN profiles p ON p.id=a.applicant_id WHERE a.opportunity_id=$1 ORDER BY a.created_at DESC',[req.params.id]);res.json({items:r.rows});
}));
app.patch('/api/applications/:id',auth,validate(z.object({status:z.enum(['reviewing','shortlisted','accepted','rejected','withdrawn'])})),asyncRoute(async(req,res)=>{
 const r=await q(`UPDATE applications a SET status=$3,updated_at=now() FROM opportunities o WHERE a.id=$1 AND o.id=a.opportunity_id AND ((o.owner_id=$2 AND $3<>'withdrawn') OR (a.applicant_id=$2 AND $3='withdrawn')) RETURNING a.*',[req.params.id,req.user.id,req.body.status]);if(!r.rowCount)return res.status(404).json({error:'Application not found or no permission.'});
 const owner=await q('SELECT applicant_id,opportunity_id FROM applications WHERE id=$1',[req.params.id]);const opp=await q('SELECT owner_id,title FROM opportunities WHERE id=$1',[owner.rows[0].opportunity_id]);await emitNotification(owner.rows[0].applicant_id,req.user.id,'application_status','application',req.params.id,`Application status updated: ${req.body.status}`);res.json({application:r.rows[0]});
}));

const projectSchema=z.object({title:text(180),summary:text(1200),problem:z.string().max(3000).optional().default(''),solution:z.string().max(3000).optional().default(''),domain:z.string().max(120).optional().default(''),stage:z.string().max(80).optional().default('idea'),budget:z.string().max(100).optional().default(''),timeline:z.string().max(120).optional().default(''),required_skills:arrayText,collaboration_model:z.string().max(100).optional().default('open'),status:z.enum(['open','active','paused','completed','archived']).optional().default('open')});
app.get('/api/projects',auth,asyncRoute(async(req,res)=>{
 const t=String(req.query.q||'').slice(0,120),domain=String(req.query.domain||'');
 const r=await q(`SELECT p.*,u.full_name AS owner_name,u.username AS owner_username,u.avatar_url AS owner_avatar,(SELECT count(*)::int FROM project_members m WHERE m.project_id=p.id AND m.status='active') AS member_count,EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$1 AND m.status IN ('pending','active')) AS joined FROM projects p JOIN profiles u ON u.id=p.owner_id WHERE p.status<>'archived' AND ($2='' OR p.title ILIKE '%'||$2||'%' OR p.summary ILIKE '%'||$2||'%') AND ($3='' OR p.domain=$3) ORDER BY p.created_at DESC LIMIT 80',[req.user.id,t,domain]);res.json({items:r.rows.map(x=>({...x,match:matchScore(req.user,{domains:[x.domain],skills:x.required_skills})}))});
}));
app.post('/api/projects',auth,validate(projectSchema),asyncRoute(async(req,res)=>{
 const b=req.body;const r=await q(`INSERT INTO projects(owner_id,title,summary,problem,solution,domain,stage,budget,timeline,required_skills,collaboration_model,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[req.user.id,b.title,b.summary,b.problem,b.solution,b.domain,b.stage,b.budget,b.timeline,b.required_skills,b.collaboration_model,b.status]);
 await q(`INSERT INTO project_members(project_id,user_id,member_role,status) VALUES($1,$2,'owner','active') ON CONFLICT DO NOTHING',[r.rows[0].id,req.user.id]);res.status(201).json({item:r.rows[0]});
}));
app.post('/api/projects/:id/join',auth,validate(z.object({message:z.string().max(1500).optional().default('')})),asyncRoute(async(req,res)=>{
 const p=await q('SELECT * FROM projects WHERE id=$1 AND status=\'open\'',[req.params.id]);if(!p.rowCount)return res.status(404).json({error:'Project not found or not open.'});if(p.rows[0].owner_id===req.user.id)return res.status(400).json({error:'You already own this project.'});
 await q(`INSERT INTO project_members(project_id,user_id,status) VALUES($1,$2,'pending') ON CONFLICT(project_id,user_id) DO UPDATE SET status='pending'',[req.params.id,req.user.id]);
 const c=await q(`INSERT INTO collaboration_requests(sender_id,target_type,target_id,message) VALUES($1,'project',$2,$3) RETURNING *',[req.user.id,req.params.id,req.body.message||'I would like to collaborate on this project.']);await emitNotification(p.rows[0].owner_id,req.user.id,'collaboration','project',req.params.id,`${req.user.full_name} wants to collaborate on ${p.rows[0].title}`);res.status(201).json({request:c.rows[0]});
}));
app.get('/api/my/projects',auth,asyncRoute(async(req,res)=>{const r=await q(`SELECT p.*,m.member_role,m.status AS membership_status FROM project_members m JOIN projects p ON p.id=m.project_id WHERE m.user_id=$1 ORDER BY m.created_at DESC',[req.user.id]);res.json({items:r.rows});}));

const ideaSchema=z.object({title:text(180),problem:text(3000),solution:z.string().max(4000).optional().default(''),domain:z.string().max(120).optional().default(''),stage:z.string().max(80).optional().default('concept'),ip_status:z.string().max(80).optional().default('undisclosed'),collaboration_needs:z.string().max(2000).optional().default(''),visibility:z.enum(['public','network','private']).optional().default('network')});
app.get('/api/ideas',auth,asyncRoute(async(req,res)=>{const t=String(req.query.q||'').slice(0,120);const r=await q(`SELECT i.*,p.full_name AS author_name,p.username,p.avatar_url FROM ideas i JOIN profiles p ON p.id=i.author_id WHERE (i.visibility<>'private' OR i.author_id=$1) AND ($2='' OR i.title ILIKE '%'||$2||'%' OR i.problem ILIKE '%'||$2||'%' OR i.domain ILIKE '%'||$2||'%') ORDER BY i.created_at DESC LIMIT 80',[req.user.id,t]);res.json({items:r.rows});}));
app.post('/api/ideas',auth,validate(ideaSchema),asyncRoute(async(req,res)=>{const b=req.body;const r=await q(`INSERT INTO ideas(author_id,title,problem,solution,domain,stage,ip_status,collaboration_needs,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[req.user.id,b.title,b.problem,b.solution,b.domain,b.stage,b.ip_status,b.collaboration_needs,b.visibility]);res.status(201).json({item:r.rows[0]});}));

app.get('/api/communities',auth,asyncRoute(async(req,res)=>{const r=await q(`SELECT c.*,(SELECT count(*)::int FROM community_members m WHERE m.community_id=c.id) AS member_count,EXISTS(SELECT 1 FROM community_members m WHERE m.community_id=c.id AND m.user_id=$1) AS joined FROM communities c WHERE c.visibility='public' OR EXISTS(SELECT 1 FROM community_members m WHERE m.community_id=c.id AND m.user_id=$1) ORDER BY c.name LIMIT 100',[req.user.id]);res.json({items:r.rows});}));
app.post('/api/communities',auth,validate(z.object({name:text(100),description:text(1200),domain:z.string().max(120).optional().default(''),visibility:z.enum(['public','private']).optional().default('public')})),asyncRoute(async(req,res)=>{
 const slug=req.body.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,90)+'-'+randomBytes(3).toString('hex');
 const r=await q('INSERT INTO communities(owner_id,name,slug,description,domain,visibility) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.user.id,req.body.name,slug,req.body.description,req.body.domain,req.body.visibility]);await q(`INSERT INTO community_members(community_id,user_id,role) VALUES($1,$2,'owner')',[r.rows[0].id,req.user.id]);res.status(201).json({item:r.rows[0]});
}));
app.post('/api/communities/:id/join',auth,asyncRoute(async(req,res)=>{
 const c=await q('SELECT * FROM communities WHERE id=$1 AND (visibility=\'public\' OR owner_id=$2)',[req.params.id,req.user.id]);if(!c.rowCount)return res.status(404).json({error:'Community not found or private.'});
 const e=await q('SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(e.rowCount)await q('DELETE FROM community_members WHERE community_id=$1 AND user_id=$2',[req.params.id,req.user.id]);else await q('INSERT INTO community_members(community_id,user_id) VALUES($1,$2)',[req.params.id,req.user.id]);
 res.json({joined:!e.rowCount});
}));

app.get('/api/messages/conversations',auth,asyncRoute(async(req,res)=>{
 const r=await q(`SELECT c.id,c.kind,c.title,c.created_at, json_agg(json_build_object('id',p.id,'full_name',p.full_name,'username',p.username,'avatar_url',p.avatar_url) ORDER BY p.full_name) AS members,
 (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
 (SELECT created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
 (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>$1 AND m.created_at>coalesce(cm.last_read_at,'epoch'::timestamptz)) AS unread_count
 FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1 JOIN conversation_members cm2 ON cm2.conversation_id=c.id JOIN profiles p ON p.id=cm2.user_id
 GROUP BY c.id,cm.last_read_at ORDER BY last_message_at DESC NULLS LAST LIMIT 100',[req.user.id]);res.json({items:r.rows});
}));
app.post('/api/messages/conversations',auth,validate(z.object({recipient_id:uuid})),asyncRoute(async(req,res)=>{
 if(req.body.recipient_id===req.user.id)return res.status(400).json({error:'Choose another member.'});
 const allowed=await q(`SELECT status FROM connections WHERE ((requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1)) AND status='accepted'',[req.user.id,req.body.recipient_id]);if(!allowed.rowCount)return res.status(403).json({error:'Connect first to start a direct message.'});
 const cx=await q(`SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=$1 JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=$2 WHERE c.kind='direct' AND (SELECT count(*) FROM conversation_members m WHERE m.conversation_id=c.id)=2 LIMIT 1',[req.user.id,req.body.recipient_id]);
 if(cx.rowCount)return res.json({conversation_id:cx.rows[0].id});
 const result=await pool.connect();try{await result.query('BEGIN');const c=await result.query(`INSERT INTO conversations(kind) VALUES('direct') RETURNING id`);for(const id of [req.user.id,req.body.recipient_id])await result.query('INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2)',[c.rows[0].id,id]);await result.query('COMMIT');res.status(201).json({conversation_id:c.rows[0].id});}catch(err){await result.query('ROLLBACK');throw err;}finally{result.release();}
}));
app.get('/api/messages/conversations/:id',auth,asyncRoute(async(req,res)=>{
 const member=await q('SELECT * FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!member.rowCount)return res.status(403).json({error:'Conversation access denied.'});
 const r=await q(`SELECT m.*,p.full_name,p.username,p.avatar_url FROM messages m JOIN profiles p ON p.id=m.sender_id WHERE m.conversation_id=$1 ORDER BY m.created_at ASC LIMIT 500',[req.params.id]);await q('UPDATE conversation_members SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.json({items:r.rows});
}));
app.post('/api/messages/conversations/:id',auth,validate(z.object({body:text(5000),attachment_url:z.string().url().optional().or(z.literal(''))})),asyncRoute(async(req,res)=>{
 const m=await q('SELECT user_id FROM conversation_members WHERE conversation_id=$1',[req.params.id]);if(!m.rows.some(x=>x.user_id===req.user.id))return res.status(403).json({error:'Conversation access denied.'});
 const r=await q('INSERT INTO messages(conversation_id,sender_id,body,attachment_url) VALUES($1,$2,$3,$4) RETURNING *',[req.params.id,req.user.id,req.body.body,req.body.attachment_url||null]);
 const others=m.rows.filter(x=>x.user_id!==req.user.id);for(const o of others)await emitNotification(o.user_id,req.user.id,'message','conversation',req.params.id,`New message from ${req.user.full_name}`);
 res.status(201).json({message:{...r.rows[0],full_name:req.user.full_name,username:req.user.username,avatar_url:req.user.avatar_url}});
}));

app.get('/api/notifications',auth,asyncRoute(async(req,res)=>{const r=await q(`SELECT n.*,p.full_name AS actor_name,p.username AS actor_username,p.avatar_url AS actor_avatar FROM notifications n LEFT JOIN profiles p ON p.id=n.actor_id WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 100',[req.user.id]);res.json({items:r.rows});}));
app.post('/api/notifications/read',auth,validate(z.object({id:uuid.optional()})),asyncRoute(async(req,res)=>{
 const r=req.body.id?await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id=$2 RETURNING id',[req.user.id,req.body.id]):await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL RETURNING id',[req.user.id]);res.json({updated:r.rowCount});
}));
app.get('/api/saved',auth,asyncRoute(async(req,res)=>{const r=await q('SELECT * FROM saved_items WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200',[req.user.id]);res.json({items:r.rows});}));
app.post('/api/collaboration-requests',auth,validate(z.object({target_type:z.enum(['project','idea','opportunity','profile']),target_id:uuid,message:text(2000),proposed_model:z.string().max(100).optional().default('open')})),asyncRoute(async(req,res)=>{
 const b=req.body;const targetTable={project:'projects',idea:'ideas',opportunity:'opportunities',profile:'profiles'}[b.target_type];const ownerKey={project:'owner_id',idea:'author_id',opportunity:'owner_id',profile:'id'}[b.target_type];
 const target=await q(`SELECT ${ownerKey} AS owner_id FROM ${targetTable} WHERE id=$1`,[b.target_id]);if(!target.rowCount)return res.status(404).json({error:'Collaboration target not found.'});
 const r=await q('INSERT INTO collaboration_requests(sender_id,target_type,target_id,message,proposed_model) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.id,b.target_type,b.target_id,b.message,b.proposed_model]);await emitNotification(target.rows[0].owner_id,req.user.id,'collaboration',b.target_type,b.target_id,`${req.user.full_name} sent a collaboration request`);res.status(201).json({item:r.rows[0]});
}));
app.get('/api/my/collaborations',auth,asyncRoute(async(req,res)=>{const r=await q(`SELECT cr.*,p.full_name AS sender_name,p.username AS sender_username FROM collaboration_requests cr JOIN profiles p ON p.id=cr.sender_id WHERE cr.sender_id=$1 OR (cr.target_type='profile' AND cr.target_id=$1) OR EXISTS(SELECT 1 FROM projects pr WHERE cr.target_type='project' AND pr.id=cr.target_id AND pr.owner_id=$1) OR EXISTS(SELECT 1 FROM ideas i WHERE cr.target_type='idea' AND i.id=cr.target_id AND i.author_id=$1) OR EXISTS(SELECT 1 FROM opportunities o WHERE cr.target_type='opportunity' AND o.id=cr.target_id AND o.owner_id=$1) ORDER BY cr.created_at DESC LIMIT 150',[req.user.id]);res.json({items:r.rows});}));
app.patch('/api/collaboration-requests/:id',auth,validate(z.object({status:z.enum(['accepted','declined','closed'])})),asyncRoute(async(req,res)=>{
 const old=await q('SELECT * FROM collaboration_requests WHERE id=$1',[req.params.id]);if(!old.rowCount)return res.status(404).json({error:'Request not found.'});const c=old.rows[0];let canOwn=false;
 if(c.target_type==='profile')canOwn=c.target_id===req.user.id;
 if(c.target_type==='project')canOwn=!!(await q('SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2',[c.target_id,req.user.id])).rowCount;
 if(c.target_type==='idea')canOwn=!!(await q('SELECT 1 FROM ideas WHERE id=$1 AND author_id=$2',[c.target_id,req.user.id])).rowCount;
 if(c.target_type==='opportunity')canOwn=!!(await q('SELECT 1 FROM opportunities WHERE id=$1 AND owner_id=$2',[c.target_id,req.user.id])).rowCount;
 if(!canOwn&&c.sender_id!==req.user.id)return res.status(403).json({error:'Permission denied.'});
 const r=await q('UPDATE collaboration_requests SET status=$2 WHERE id=$1 RETURNING *',[req.params.id,req.body.status]);await emitNotification(c.sender_id,req.user.id,'collaboration_status',c.target_type,c.target_id,`Collaboration request ${req.body.status}`);res.json({item:r.rows[0]});
}));
app.get('/api/search',auth,asyncRoute(async(req,res)=>{
 const term=String(req.query.q||'').trim().slice(0,100);if(term.length<2)return res.json({people:[],posts:[],opportunities:[],projects:[],ideas:[],communities:[]});
 const like='%'+term+'%';
 const [people,posts,opportunities,projects,ideas,communities]=await Promise.all([
 q(`SELECT id,full_name,username,avatar_url,bio,domains,skills,verified FROM profiles WHERE id<>$1 AND suspended=false AND (full_name ILIKE $2 OR username ILIKE $2 OR bio ILIKE $2 OR $3=ANY(skills) OR $3=ANY(domains)) LIMIT 10',[req.user.id,like,term]),
 q(`SELECT p.id,p.title,p.body,p.post_type,p.created_at,u.full_name,u.username FROM posts p JOIN profiles u ON u.id=p.author_id WHERE p.visibility='public' AND (p.body ILIKE $1 OR p.title ILIKE $1) ORDER BY p.created_at DESC LIMIT 10',[like]),
 q(`SELECT id,title,kind,domain,location,description,created_at FROM opportunities WHERE status='open' AND (title ILIKE $1 OR description ILIKE $1 OR domain ILIKE $1) ORDER BY created_at DESC LIMIT 10',[like]),
 q(`SELECT id,title,summary,domain,stage,created_at FROM projects WHERE status<>'archived' AND (title ILIKE $1 OR summary ILIKE $1 OR domain ILIKE $1) ORDER BY created_at DESC LIMIT 10',[like]),
 q(`SELECT id,title,problem,domain,stage,created_at FROM ideas WHERE visibility='public' AND (title ILIKE $1 OR problem ILIKE $1 OR domain ILIKE $1) ORDER BY created_at DESC LIMIT 10',[like]),
 q(`SELECT id,name,slug,description,domain FROM communities WHERE visibility='public' AND (name ILIKE $1 OR description ILIKE $1 OR domain ILIKE $1) LIMIT 10',[like])
 ]);res.json({people:people.rows,posts:posts.rows,opportunities:opportunities.rows,projects:projects.rows,ideas:ideas.rows,communities:communities.rows});
}));
app.get('/api/matches',auth,asyncRoute(async(req,res)=>{
 const [people,opps,projects]=await Promise.all([
 q(`SELECT ${publicSelect} FROM profiles WHERE id<>$1 AND suspended=false ORDER BY created_at DESC LIMIT 80',[req.user.id]),
 q(`SELECT o.*,p.full_name AS owner_name FROM opportunities o JOIN profiles p ON p.id=o.owner_id WHERE o.status='open' ORDER BY o.created_at DESC LIMIT 80`),
 q(`SELECT p.*,u.full_name AS owner_name FROM projects p JOIN profiles u ON u.id=p.owner_id WHERE p.status='open' ORDER BY p.created_at DESC LIMIT 80`)
 ]);
 res.json({people:people.rows.map(p=>({...p,match:matchScore(req.user,p),match_factors:matchFactors(req.user,p)})).sort((a,b)=>b.match-a.match).slice(0,12),opportunities:opps.rows.map(p=>({...p,match:matchScore(req.user,{domains:[p.domain],skills:p.required_skills,location:p.location}),match_factors:matchFactors(req.user,{domains:[p.domain],skills:p.required_skills,location:p.location})})).sort((a,b)=>b.match-a.match).slice(0,12),projects:projects.rows.map(p=>({...p,match:matchScore(req.user,{domains:[p.domain],skills:p.required_skills}),match_factors:matchFactors(req.user,{domains:[p.domain],skills:p.required_skills})})).sort((a,b)=>b.match-a.match).slice(0,12)});
}));
function norm(arr){return new Set((arr||[]).map(x=>String(x).toLowerCase().trim()).filter(Boolean))}
function matchFactors(a,b){const xs=norm(a.skills),ys=norm(b.skills),xd=norm(a.domains),yd=norm(b.domains),xi=norm(a.interests),yi=norm(b.interests);const intersect=(x,y)=>[...x].filter(v=>y.has(v)).length;return {skills:intersect(xs,ys),domains:intersect(xd,yd),interests:intersect(xi,yi),location:!!a.location&&!!b.location&&a.location.toLowerCase()===b.location.toLowerCase()};}
function matchScore(a,b){const f=matchFactors(a,b);const skillDen=Math.max(norm(a.skills).size,norm(b.skills).size,1),domainDen=Math.max(norm(a.domains).size,norm(b.domains).size,1),interestDen=Math.max(norm(a.interests).size,norm(b.interests).size,1);let raw=0,w=0;if(norm(a.skills).size||norm(b.skills).size){raw+=Math.min(1,f.skills/skillDen)*45;w+=45}if(norm(a.domains).size||norm(b.domains).size){raw+=Math.min(1,f.domains/domainDen)*30;w+=30}if(norm(a.interests).size||norm(b.interests).size){raw+=Math.min(1,f.interests/interestDen)*15;w+=15}if(f.location){raw+=5;w+=5}return w?Math.round(raw/w*100):0;}

app.get('/api/admin/overview',auth,admin,asyncRoute(async(req,res)=>{
 const entries=await Promise.all([
 q('SELECT count(*)::int AS n FROM profiles'),q('SELECT count(*)::int AS n FROM profiles WHERE created_at>now()-interval \'7 days\''),
 q('SELECT count(*)::int AS n FROM posts'),q('SELECT count(*)::int AS n FROM opportunities'),
 q('SELECT count(*)::int AS n FROM applications'),q(`SELECT count(*)::int AS n FROM reports WHERE status='open'`),
 q(`SELECT count(*)::int AS n FROM verifications WHERE status='pending'`),q('SELECT count(*)::int AS n FROM projects'),q('SELECT count(*)::int AS n FROM ideas'),q('SELECT count(*)::int AS n FROM communities')
 ]);res.json({users:entries[0].rows[0].n,new_users_7d:entries[1].rows[0].n,posts:entries[2].rows[0].n,opportunities:entries[3].rows[0].n,applications:entries[4].rows[0].n,open_reports:entries[5].rows[0].n,pending_verifications:entries[6].rows[0].n,projects:entries[7].rows[0].n,ideas:entries[8].rows[0].n,communities:entries[9].rows[0].n});
}));
app.get('/api/admin/reports',auth,admin,asyncRoute(async(req,res)=>{const r=await q(`SELECT r.*,p.full_name AS reporter_name FROM reports r JOIN profiles p ON p.id=r.reporter_id ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 250`);res.json({items:r.rows});}));
app.patch('/api/admin/reports/:id',auth,admin,validate(z.object({status:z.enum(['reviewing','actioned','dismissed']),review_note:z.string().max(1000).optional().default('')})),asyncRoute(async(req,res)=>{const r=await q('UPDATE reports SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1 RETURNING *',[req.params.id,req.body.status,req.body.review_note,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Report not found.'});res.json({item:r.rows[0]});}));
app.get('/api/admin/users',auth,admin,asyncRoute(async(req,res)=>{const r=await q(`SELECT ${publicSelect},suspended FROM profiles ORDER BY created_at DESC LIMIT 500`);res.json({items:r.rows});}));
app.patch('/api/admin/users/:id',auth,admin,validate(z.object({role:z.enum(['member','professional','organization','moderator','admin']).optional(),suspended:z.boolean().optional(),verified:z.boolean().optional()})),asyncRoute(async(req,res)=>{if(req.params.id===req.user.id&&req.body.suspended===true)return res.status(400).json({error:'You cannot suspend yourself.'});const e=Object.entries(req.body);if(!e.length)return res.status(400).json({error:'No changes supplied.'});const set=e.map(([k],i)=>`${k}=$${i+2}`).join(', ');const r=await q(`UPDATE profiles SET ${set},updated_at=now() WHERE id=$1 RETURNING ${publicSelect},suspended`,[req.params.id,...e.map(x=>x[1])]);if(!r.rowCount)return res.status(404).json({error:'User not found.'});res.json({user:r.rows[0]});}));
app.post('/api/verifications',auth,validate(z.object({document_type:text(100),document_ref:z.string().max(1000).optional().default(''),notes:z.string().max(2000).optional().default('')})),asyncRoute(async(req,res)=>{const r=await q(`INSERT INTO verifications(user_id,document_type,document_ref,notes) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,document_type) DO UPDATE SET document_ref=EXCLUDED.document_ref,notes=EXCLUDED.notes,status='pending' RETURNING *',[req.user.id,req.body.document_type,req.body.document_ref,req.body.notes]);res.status(201).json({verification:r.rows[0]});}));
app.get('/api/admin/verifications',auth,admin,asyncRoute(async(req,res)=>{const r=await q(`SELECT v.*,p.full_name,p.username FROM verifications v JOIN profiles p ON p.id=v.user_id ORDER BY CASE v.status WHEN 'pending' THEN 0 ELSE 1 END,v.created_at DESC LIMIT 300`);res.json({items:r.rows});}));
app.patch('/api/admin/verifications/:id',auth,admin,validate(z.object({status:z.enum(['approved','rejected'])})),asyncRoute(async(req,res)=>{const r=await q(`UPDATE verifications SET status=$2,reviewed_by=$3 WHERE id=$1 RETURNING *',[req.params.id,req.body.status,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Verification request not found.'});if(req.body.status==='approved')await q('UPDATE profiles SET verified=true WHERE id=$1',[r.rows[0].user_id]);res.json({item:r.rows[0]});}));

// Create tables from versioned SQL schema once on boot. Uses a transaction/advisory lock to avoid concurrent migrations.
async function migrate(){
 const client=await pool.connect();try{await client.query('SELECT pg_advisory_lock(724119902)');const schema=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');await client.query('BEGIN');await client.query(schema);await client.query('COMMIT');}catch(err){try{await client.query('ROLLBACK')}catch{}throw err}finally{try{await client.query('SELECT pg_advisory_unlock(724119902)')}catch{}client.release();}
}
app.get('/api/config',(_req,res)=>res.json({app:'SCIOP',version:'0.1.0',features:['profiles','feed','connections','opportunities','projects','ideas','communities','messages','notifications','matching','moderation']}));
app.use(express.static(webRoot,{index:'index.html',fallthrough:true,maxAge:PROD?'1h':0}));
app.get('*',(req,res)=>res.sendFile(path.join(webRoot,'index.html')));
app.use((err,req,res,next)=>{console.error('[SCIOP API]',err);if(res.headersSent)return next(err);const status=err.status|| (err.code==='23505'?409:500);res.status(status).json({error:status===500?'Unexpected server error. Check server logs for the request ID.':err.message||'Request failed.'});});
migrate().then(()=>app.listen(PORT,()=>console.log(`SCIOP API listening on :${PORT}`))).catch(err=>{console.error('SCIOP startup/migration failed:',err);process.exit(1);});
