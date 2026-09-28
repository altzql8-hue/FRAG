import argon2 from 'argon2';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { assert } from './errors.js';
const digest=s=>createHash('sha256').update(s).digest('hex');
export const hash=s=>argon2.hash(s,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
const verify=async(h,v)=>{try{return await argon2.verify(h,v);}catch{return false;}};
export async function initializeAdmin(store,username,password,pin) {
  z.string().min(3).max(50).parse(username); z.string().min(7).max(128).parse(password); z.string().regex(/^\d{4,12}$/).parse(pin);
  const admin={id:randomUUID(),username,passwordHash:await hash(password),pinHash:await hash(pin),forceChange:true,version:1,createdAt:Date.now()};
  const r=await store.transact('frag/admins',current=>current?undefined:{[admin.id]:admin});
  assert(r.committed,409,'ALREADY_INITIALIZED','An administrator already exists; initialization did not overwrite it.');
  return admin.id;
}
export class Auth {
  constructor(store,index,licenses,{production=false}={}){this.store=store;this.index=index;this.licenses=licenses;this.production=production;this.dummy=hash(randomBytes(32).toString('hex'));}
  cookie(res,token,maxAge){res.cookie('frag_session',token,{httpOnly:true,secure:this.production,sameSite:'strict',path:'/',...(maxAge?{maxAge}:{})});}
  async login(input,req,res) {
    const p=z.object({username:z.string().min(1).max(50),password:z.string().min(1).max(128),remember:z.boolean().default(false)}).strict().parse(input);
    const settings=await this.licenses.settings(), ip=req.ip;
    // Limits include ALL attempts; successes cannot be used to bypass the cap.
    const allowed=this.index.limit(`login:ip:${ip}`,settings.loginLimit,60000) && this.index.limit(`login:account:${digest(p.username.toLowerCase())}`,settings.loginLimit*3,900000);
    if(!allowed) { await this.licenses.event('login',{action:'rate_limited',success:false,actor:p.username,ip,browser:req.get('user-agent')?.slice(0,250)||''}); res.set('Retry-After','60'); }
    assert(allowed,429,'RATE_LIMIT','Too many attempts. Please wait before trying again.');
    const admins=await this.store.get('frag/admins')||{};
    const admin=Object.values(admins).find(a=>a.username===p.username);
    const valid=await verify(admin?.passwordHash||await this.dummy,p.password);
    if(!valid||!admin) { await this.licenses.event('login',{action:'login',success:false,actor:p.username,ip,browser:req.get('user-agent')?.slice(0,250)||''}); }
    assert(valid&&admin,401,'INVALID_LOGIN','The username or password is incorrect.');
    const token=randomBytes(32).toString('base64url'), sessionId=digest(token), csrf=randomBytes(32).toString('base64url'), now=Date.now();
    const duration=p.remember?settings.rememberedDays*86400000:settings.sessionHours*3600000;
    const session={id:sessionId,adminId:admin.id,createdAt:now,lastActivity:now,expiresAt:now+duration,csrf,ip,browser:req.get('user-agent')?.slice(0,250)||'',version:admin.version};
    await this.store.set(`frag/sessions/${sessionId}`,session);
    await this.licenses.event('login',{action:'login',success:true,actor:admin.username,adminId:admin.id,ip,browser:session.browser,session:sessionId.slice(0,12)});
    this.cookie(res,token,p.remember?duration:undefined);
    return this.publicSession(session,admin);
  }
  publicSession(s,a){return {username:a.username,adminId:a.id,forceChange:!!a.forceChange,csrf:s.csrf,sessionId:s.id.slice(0,12),createdAt:s.createdAt,expiresAt:s.expiresAt,ip:s.ip,browser:s.browser};}
  async require(req,res,next) {
    const token=req.cookies.frag_session;
    assert(typeof token==='string'&&token.length<200,401,'UNAUTHENTICATED','Please sign in.');
    const s=await this.store.get(`frag/sessions/${digest(token)}`);
    assert(s&&s.expiresAt>Date.now()&&!s.revokedAt,401,'SESSION_EXPIRED','Your session expired. Please sign in.');
    const a=await this.store.get(`frag/admins/${s.adminId}`);
    assert(a&&s.version===a.version,401,'SESSION_REVOKED','This session was revoked. Please sign in.');
    req.auth={session:s,admin:a}; req.context={adminId:a.id,username:a.username,ip:req.ip,sessionId:s.id.slice(0,12)};
    if(Date.now()-s.lastActivity>60000) await this.store.update({[`frag/sessions/${s.id}/lastActivity`]:Date.now()});
    if(!['GET','HEAD'].includes(req.method)) {
      const supplied=req.get('x-csrf-token')||'';
      assert(supplied.length===s.csrf.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(s.csrf)),403,'CSRF','Security token missing or invalid. Refresh the page.');
    }
    next();
  }
  async confirm(req,password,pin) {
    assert(this.index.limit(`sensitive:${req.auth.admin.id}:${req.ip}`,5,300000),429,'RATE_LIMIT','Too many verification attempts. Wait five minutes.');
    const [a,b]=await Promise.all([verify(req.auth.admin.passwordHash,password),verify(req.auth.admin.pinHash,pin)]);
    if(!a||!b) await this.licenses.audit(req.context,'credential-verification-failed',req.auth.admin.id,null,null);
    assert(a&&b,403,'VERIFICATION','Current password or PIN is incorrect.');
  }
  async change(req,input) {
    const p=z.object({currentPassword:z.string().max(128),pin:z.string().max(12),username:z.string().min(3).max(50).optional(),password:z.string().min(12).max(128).optional(),passwordConfirmation:z.string().optional(),newPin:z.string().regex(/^\d{6,12}$/).optional(),pinConfirmation:z.string().optional()}).strict().parse(input);
    await this.confirm(req,p.currentPassword,p.pin);
    assert(p.username||p.password||p.newPin,400,'EMPTY','Choose a credential to update.');
    if(p.password) assert(p.password===p.passwordConfirmation && p.password!==p.currentPassword,400,'PASSWORD','New passwords must match and differ from the current password.');
    if(p.newPin) assert(p.newPin===p.pinConfirmation && p.newPin!==p.pin,400,'PIN','New PINs must match and differ from the current PIN.');
    if(req.auth.admin.forceChange) assert(p.password&&p.newPin,400,'FIRST_SETUP','Change both the initial password and PIN to continue.');
    const updates={...(p.password?{passwordHash:await hash(p.password)}:{}),...(p.newPin?{pinHash:await hash(p.newPin)}:{})};
    await this.licenses.audit(req.context,'credentials-change',req.auth.admin.id,null,{username:p.username||req.auth.admin.username},'intent');
    await this.store.transact('frag/admins',admins=>{
      const a=admins?.[req.auth.admin.id]; assert(a&&a.version===req.auth.admin.version,409,'CONFLICT','Account changed. Sign in again.');
      assert(!p.username||!Object.values(admins).some(other=>other.id!==a.id&&other.username===p.username),409,'USERNAME','Username is already taken.');
      return {...admins,[a.id]:{...a,...updates,username:p.username||a.username,forceChange:false,version:a.version+1}};
    });
    await this.licenses.audit(req.context,'credentials-change',req.auth.admin.id,null,{username:p.username||req.auth.admin.username});
    return {signInAgain:true};
  }
  async sessions(req){ const all=await this.store.get('frag/sessions')||{};return Object.values(all).filter(s=>s.adminId===req.auth.admin.id&&!s.revokedAt&&s.expiresAt>Date.now()&&s.version===req.auth.admin.version).map(s=>({id:s.id,createdAt:s.createdAt,lastActivity:s.lastActivity,expiresAt:s.expiresAt,ip:s.ip,browser:s.browser,current:s.id===req.auth.session.id})); }
  async revoke(req,id) {
    const sessions=await this.sessions(req), selected=id==='others'?sessions.filter(s=>!s.current):sessions.filter(s=>s.id===id);
    assert(selected.length>0||id==='others',404,'SESSION','Session not found.');
    for(const s of selected) await this.store.update({[`frag/sessions/${s.id}/revokedAt`]:Date.now()});
    await this.licenses.audit(req.context,'revoke-session',req.auth.admin.id,null,{count:selected.length});
    return {revoked:selected.length};
  }
}
