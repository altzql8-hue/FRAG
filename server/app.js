import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { Auth } from './auth.js';
import { Licenses } from './licenses.js';
import { AppError, assert } from './errors.js';
import { actionSchema, keyFields, keyText, listQuery, settingsSchema } from './validation.js';
import { analytics } from './analytics.js';
import { publicKeyMiddleware } from './publicKey.js';

const eventQuery=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),limit:z.coerce.number().refine(n=>[10,25,50,100].includes(n)).default(25),search:z.string().max(150).optional(),action:z.string().max(60).optional(),resource:z.string().max(120).optional(),actor:z.string().max(100).optional(),ip:z.string().max(100).optional(),from:z.coerce.number().min(0).optional(),to:z.coerce.number().min(0).optional()}).strict();
export function createApp({store,index,origin='http://localhost:5173',production=false,trustProxy=0,ready=()=>true}) {
  const app=express(), licenses=new Licenses(store,index),auth=new Auth(store,index,licenses,{production});
  app.disable('x-powered-by');app.set('trust proxy',trustProxy);
  app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],fontSrc:["'self'"],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],...(production?{}:{upgradeInsecureRequests:null})}},hsts:production?undefined:false}));
  app.use(express.json({limit:'128kb'}),cookieParser());
  // Public AltF5 website endpoint (POST /api/public/free-key). Must stay before the origin and auth guards below.
  app.use('/api/public',publicKeyMiddleware({licenses,ready,env:process.env}));
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');assert(ready(),503,'DATABASE_UNAVAILABLE','Database connection is unavailable. Please retry.');next();});
  app.get('/api/health',(_req,res)=>res.json({success:true,data:{ready:ready()}}));
  app.post('/api/license/authenticate',async(req,res)=>{
    assert(index.limit(`license:${req.ip}`,60,60000),429,'RATE_LIMIT','Too many requests. Try again shortly.');
    const p=z.object({key:keyText,hwid:z.string().min(3).max(256).regex(/^[^\x00-\x1f]+$/)}).strict().parse(req.body);
    res.json({success:true,data:await licenses.authenticate(p.key,p.hwid,req.ip)});
  });
  app.use('/api',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)) assert(req.get('origin')===origin,403,'ORIGIN','Request origin is not allowed.'); next();});
  app.post('/api/auth/login',async(req,res)=>res.json({success:true,data:await auth.login(req.body,req,res)}));
  app.use('/api',auth.require.bind(auth));
  app.use('/api',(req,res,next)=>{assert(index.limit(`admin:${req.auth.admin.id}`,500,60000),429,'RATE_LIMIT','Request limit reached. Please wait.');next();});
  app.get('/api/auth/session',(req,res)=>res.json({success:true,data:auth.publicSession(req.auth.session,req.auth.admin)}));
  app.post('/api/auth/logout',async(req,res)=>{
    await store.update({[`frag/sessions/${req.auth.session.id}/revokedAt`]:Date.now()});
    await licenses.event('login',{action:'logout',success:true,actor:req.auth.admin.username,ip:req.ip,session:req.auth.session.id.slice(0,12),logoutAt:Date.now()});
    res.clearCookie('frag_session',{path:'/',secure:production,httpOnly:true,sameSite:'strict'}).json({success:true,data:{loggedOut:true}});
  });
  app.post('/api/control/credentials',async(req,res)=>res.json({success:true,data:await auth.change(req,req.body)}));
  app.get('/api/control/sessions',async(req,res)=>res.json({success:true,data:await auth.sessions(req)}));
  app.post('/api/control/sessions/:id/revoke',async(req,res)=>{z.string().regex(/^(others|[a-f0-9]{64})$/).parse(req.params.id);res.json({success:true,data:await auth.revoke(req,req.params.id)});});
  app.use('/api',(req,res,next)=>{assert(!req.auth.admin.forceChange,403,'FIRST_SETUP','Change your initial password and PIN on the Control page.');next();});
  app.get('/api/settings',async(_req,res)=>res.json({success:true,data:await licenses.settings()}));
  app.put('/api/settings',async(req,res)=>{
    const p=z.object({settings:settingsSchema,currentPassword:z.string().max(128).optional(),pin:z.string().max(12).optional()}).strict().parse(req.body);
    const before=await licenses.settings();
    if(['sessionHours','rememberedDays','loginLimit'].some(k=>p.settings[k]!==before[k])) await auth.confirm(req,p.currentPassword||'',p.pin||'');
    await licenses.audit(req.context,'settings','settings',before,p.settings,'intent');
    await store.set('frag/settings',p.settings);await licenses.audit(req.context,'settings','settings',before,p.settings);
    res.json({success:true,data:p.settings});
  });
  app.get('/api/keys',(req,res)=>res.json({success:true,...index.keys(req.query)}));
  app.post('/api/keys',async(req,res)=>res.status(201).json({success:true,data:await licenses.create(req.body,req.context)}));
  app.post('/api/keys/batch',async(req,res)=>{
    const p=z.object({amount:z.number().int().min(1).max(200),config:keyFields}).strict().parse(req.body);
    assert(!p.config.key,400,'BATCH_KEY','Batch generation must use random keys.');
    const data=[];let error;
    for(let i=0;i<p.amount;i++) { try {data.push(await licenses.create({...p.config,label:p.config.label?`${p.config.label} ${i+1}`:''},req.context));}catch(e){error=e instanceof AppError?e.message:'Database write failed.';break;} }
    res.status(error?207:201).json({success:true,data,partial:!!error,errorMessage:error||null,requested:p.amount,completed:data.length});
  });
  app.post('/api/keys/bulk',async(req,res)=>{
    const p=z.object({keys:z.array(keyText).min(1).max(100),operation:actionSchema}).strict().parse(req.body);
    assert(!['delete','regenerate','duplicate','reset-device','disable-device'].includes(p.operation.action),400,'ACTION','This action requires an individual key.');
    const results=[];
    for(const key of new Set(p.keys)) {try {await licenses.action(key,p.operation,req.context);results.push({key,success:true});}catch(e){results.push({key,success:false,error:e instanceof AppError?e.message:'Database write failed.'});}}
    res.json({success:true,data:results});
  });
  app.get('/api/keys/export',async(req,res)=>{
    const {format='csv',selection,...query}=req.query;
    z.enum(['csv','json','txt']).parse(format);
    const q=listQuery.parse(query),selected=selection?z.array(keyText).max(100).parse(String(selection).split(',')):null;
    await licenses.audit(req.context,'export','keys',null,{format,filters:q,selection:selected});
    const fields=['key','type','status','expiresAt','maxDevices','usageCount','lastUsed','label','assignedUser','tags'];
    res.set('Content-Disposition',`attachment; filename="FRAG-keys.${format}"`).type(format==='json'?'application/json':format==='csv'?'text/csv':'text/plain');
    const csv=v=>`"${String(v??'').replace(/^[=+@\-\t\r]/,'\'$&').replaceAll('"','""')}"`;
    if(format==='csv') res.write(fields.join(',')+'\r\n');if(format==='json')res.write('[');
    let first=true,page=1;
    while(true){
      const result=index.keys({...q,page,limit:100});
      for(const row of result.data){if(selected&&!selected.includes(row.key))continue;const k=Object.fromEntries(fields.map(f=>[f,row[f]??null]));res.write(format==='txt'?`${row.key}\n`:format==='csv'?fields.map(f=>csv(Array.isArray(k[f])?k[f].join(';'):k[f])).join(',')+'\r\n':`${first?'':','}${JSON.stringify(k)}`);first=false;}
      if(!result.pagination.hasNext||res.destroyed)break;page++;
    }
    if(format==='json')res.write(']');res.end();
  });
  app.get('/api/keys/:key',async(req,res)=>res.json({success:true,data:await licenses.detail(req.params.key)}));
  app.patch('/api/keys/:key',async(req,res)=>res.json({success:true,data:await licenses.edit(req.params.key,req.body,req.context)}));
  app.post('/api/keys/:key/actions',async(req,res)=>res.json({success:true,data:await licenses.action(req.params.key,actionSchema.parse(req.body),req.context)}));
  app.get('/api/keys/:key/history',async(req,res)=>{const k=await licenses.detail(req.params.key);res.json({success:true,...index.events({...eventQuery.parse(req.query),kind:'audit',resource:k.id})});});
  app.get('/api/devices',(req,res)=>res.json({success:true,...index.devices(eventQuery.parse(req.query))}));
  app.get('/api/audit',(req,res)=>res.json({success:true,...index.events({...eventQuery.parse(req.query),kind:'audit'})}));
  app.get('/api/login-activity',(req,res)=>res.json({success:true,...index.events({...eventQuery.parse(req.query),kind:'login'})}));
  app.get('/api/analytics',(req,res)=>{
    const p=z.object({from:z.coerce.number().min(0).default(Date.now()-30*86400000),to:z.coerce.number().min(0).default(Date.now())}).strict().parse(req.query);
    assert(p.to>=p.from&&p.to-p.from<=366*86400000,400,'RANGE','Choose a date range of up to one year.');res.json({success:true,data:analytics(index,p.from,p.to)});
  });
  app.use('/api',()=>{throw new AppError(404,'NOT_FOUND','API route not found.');});
  app.use(express.static(path.resolve('dist'),{index:false,maxAge:production?'1h':0}));
  app.get('/{*path}',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
  app.use((err,req,res,_next)=>{
    if(res.headersSent){res.end();return;}
    const invalid=err instanceof ZodError,status=invalid?400:err.status||500;
    if(status>=500) console.error(JSON.stringify({component:'api',event:'request_failed',code:err.code||'INTERNAL',message:err.message?.slice(0,200)}));
    res.status(status).json({success:false,error:{code:invalid?'VALIDATION':err.code||'INTERNAL',message:invalid?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):status>=500?'The operation could not complete. Check connectivity and retry.':err.message}});
  });
  return {app,licenses,auth};
}
