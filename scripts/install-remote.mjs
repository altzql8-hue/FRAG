import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]||'.');
const get=p=>fs.readFileSync(path.join(root,p),'utf8');
const staged=new Map();
function edit(p,mutator){const before=get(p),after=mutator(before);staged.set(p,{before,after});console.log((after!==before?'PREPARED ':'UNCHANGED ')+p)}
function once(src,needle,replacement,marker){
  if(marker&&src.includes(marker))return src;
  const at=src.indexOf(needle);
  if(at<0||src.indexOf(needle,at+needle.length)>=0)throw Error('Expected exactly one anchor: '+needle.slice(0,100));
  return src.slice(0,at)+replacement+src.slice(at+needle.length);
}

edit('server/app.js',s=>{
  s=once(s,"import { publicKeyMiddleware } from './publicKey.js';", "import { publicKeyMiddleware } from './publicKey.js';\nimport { RemoteApps } from './remote.js';", "import { RemoteApps } from './remote.js';");
  s=once(s,'const app=express(), licenses=new Licenses(store,index),auth=new Auth(store,index,licenses,{production});','const app=express(), licenses=new Licenses(store,index),auth=new Auth(store,index,licenses,{production}),remote=new RemoteApps(store,licenses);','remote=new RemoteApps(store,licenses)');
  s=once(s,"app.use(express.json({limit:'128kb'}),cookieParser());","app.use(express.json({limit:'1mb'}),cookieParser());", "app.use(express.json({limit:'1mb'}),cookieParser());");
  const publicRoutes=`  // Public app-specific boot and license APIs. Existing free-key endpoint remains unchanged.
  app.get('/api/v1/apps/:slug/manifest',async(req,res)=>res.json({success:true,data:await remote.manifest(req.params.slug)}));
  app.get('/api/v1/apps/:slug/releases/:id/download',async(req,res)=>{
    const {bytes,record}=await remote.download(req.params.slug,req.params.id);
    res.set('Cache-Control','no-store').set('X-Content-Type-Options','nosniff').type('text/plain; charset=utf-8').send(bytes.toString('utf8'));
  });
  app.post('/api/v1/apps/:slug/authenticate',async(req,res)=>{
    assert(index.limit('license:'+req.ip,60,60000),429,'RATE_LIMIT','Too many requests.');
    const p=z.object({key:keyText,hwid:z.string().min(3).max(256).regex(/^[^\\x00-\\x1f]+$/)}).strict().parse(req.body);
    res.json({success:true,data:await remote.authenticate(req.params.slug,p.key,p.hwid,req.ip)});
  });
`;
  s=once(s,"  app.use('/api',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method))", publicRoutes+"  app.use('/api',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method))", "app.get('/api/v1/apps/:slug/manifest'");
  const adminRoutes=`  // Remote application manager. Routes below require admin session + CSRF on writes.
  app.get('/api/apps',async(req,res)=>res.json({success:true,data:await remote.list()}));
  app.post('/api/apps',async(req,res)=>res.status(201).json({success:true,data:await remote.create(req.body,req.context)}));
  app.get('/api/apps/:slug',async(req,res)=>res.json({success:true,data:await remote.get(req.params.slug)}));
  app.put('/api/apps/:slug/config',async(req,res)=>res.json({success:true,data:await remote.config(req.params.slug,req.body,req.context)}));
  app.get('/api/apps/:slug/releases',async(req,res)=>res.json({success:true,data:await remote.releases(req.params.slug)}));
  app.post('/api/apps/:slug/releases',async(req,res)=>res.status(201).json({success:true,data:await remote.upload(req.params.slug,req.body,req.context)}));
  app.post('/api/apps/:slug/releases/:id/publish',async(req,res)=>res.json({success:true,data:await remote.publish(req.params.slug,req.params.id,req.context)}));
`;
  s=once(s,"  app.get('/api/settings',async(_req,res)=>res.json",adminRoutes+"  app.get('/api/settings',async(_req,res)=>res.json","app.get('/api/apps',async(req,res)");
  return s;
});

edit('server/validation.js',s=>once(s, "  key: keyText.optional(), label:","  appId: z.string().min(2).max(48).regex(/^[a-z][a-z0-9-]*$/).default('rog-premier'),\n  key: keyText.optional(), label:","appId: z.string().min(2).max(48)"));
edit('server/licenses.js',s=>{
  s=once(s,'const value={id,key,type:p.type,status:p.status,expiresAt:', 'const value={id,key,appId:p.appId,type:p.type,status:p.status,expiresAt:', 'const value={id,key,appId:p.appId,type:');
  s=once(s,"if(p.action==='duplicate') return this.create({...metadata(before),type:before.type", "if(p.action==='duplicate') return this.create({...metadata(before),appId:before.appId||'rog-premier',type:before.type", "appId:before.appId||'rog-premier'");
  s=once(s,"async authenticate(key,hwid,ip) {", "async authenticate(key,hwid,ip,appId='rog-premier') {", "async authenticate(key,hwid,ip,appId='rog-premier')");
  s=once(s,"      if(!current) {outcome='invalid';return undefined;}","      if(!current) {outcome='invalid';return undefined;}\n      if((current.appId||'rog-premier')!==appId){outcome='wrong_app';return undefined;}","outcome='wrong_app'");
  s=once(s,"({invalid:'Invalid license key.',expired:'Key expired.'", "({wrong_app:'This key belongs to a different application.',invalid:'Invalid license key.',expired:'Key expired.'", "wrong_app:'This key belongs");
  return s;
});

edit('frontend/src/pages/Create.jsx',s=>{
  s=once(s,"import React,{useState} from 'react';", "import React,{useEffect,useState} from 'react';", "import React,{useEffect,useState} from 'react';");
  s=once(s,"  const [form,setForm]=useState(()=>({prefix:",`  const [appChoices,setAppChoices]=useState([]);
  useEffect(()=>{api('/apps').then(r=>setAppChoices(r.data)).catch(()=>{});},[]);
  const [form,setForm]=useState(()=>({appId:'rog-premier',prefix:`, "const [appChoices,setAppChoices]");
  s=once(s,`<Field label="Prefix" value={form.prefix}`, `<Field label="Application"><select value={form.appId} onChange={e=>change('appId',e.target.value)}>{appChoices.length?appChoices.map(a=><option key={a.slug} value={a.slug}>{a.name}</option>):<option value="rog-premier">ROG Premier (legacy)</option>}</select></Field><Field label="Prefix" value={form.prefix}`, 'label="Application"><select value={form.appId}');
  return s;
});

edit('frontend/src/main.jsx',s=>{
  s=once(s, "const Dashboard=lazy(()=>import('./pages/Dashboard')),", "const RemoteApps=lazy(()=>import('./pages/RemoteApps'));\nconst Dashboard=lazy(()=>import('./pages/Dashboard')),", "const RemoteApps=lazy");
  s=once(s,'<Route path="/control" element={<Control/>}/>', '<Route path="/control" element={<Control/>}/><Route path="/remote-apps" element={<RemoteApps/>}/>', 'path="/remote-apps"');
  return s;
});
edit('frontend/src/components/Shell.jsx',s=>{
  s=once(s,'Menu,X,RefreshCw}', 'Menu,X,RefreshCw,Radio}', 'RefreshCw,Radio}');
  s=once(s,"['/control','Control',SlidersHorizontal],['/appearance'","['/control','Control',SlidersHorizontal],['/remote-apps','Remote Apps',Radio],['/appearance'","'/remote-apps','Remote Apps'");
  return s;
});

const css=`
/* AltF5 Remote Apps: intentionally uses the dashboard's existing dark/cyan tokens. */
.remote-app-tabs{display:flex;gap:10px;overflow:auto;padding:0 0 16px;margin:0 0 7px}
.remote-app-tabs button{min-width:190px;display:flex;gap:7px;align-items:center;flex-wrap:wrap;text-align:left;border:1px solid var(--border);background:var(--panel);border-radius:8px;padding:13px 15px}
.remote-app-tabs button.selected{border-color:var(--accent);background:var(--panel-2)}
.remote-app-tabs button small{width:100%;margin-left:15px}
.remote-dot{display:inline-block;width:8px;height:8px;background:#56d994;border-radius:50%}
.remote-dot.offline{background:#e97882}.remote-dot.maintenance{background:#edb45f}
.remote-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:18px}
.remote-metrics>div{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:20px;min-width:0}
.remote-metrics small,.remote-metrics span{display:block;color:var(--muted);font-size:11px}
.remote-metrics strong{display:block;font-size:19px;margin:8px 0 4px;overflow-wrap:anywhere}
.remote-create,.remote-form,.remote-upload{display:flex;flex-direction:column;gap:15px;align-items:stretch}
.remote-check{display:flex;align-items:center;gap:10px;font-size:13px}
.remote-endpoints{display:grid;gap:12px}.remote-endpoints>div{display:grid;grid-template-columns:1fr auto;gap:5px;align-items:center;border:1px solid var(--border);padding:12px;border-radius:7px;min-width:0}
.remote-endpoints small{grid-column:1/-1}.remote-endpoints code{overflow-wrap:anywhere;min-width:0}
.remote-releases>div{border-top:1px solid var(--border);display:flex;gap:15px;align-items:center;justify-content:space-between;padding:15px 0}
.remote-releases>div:first-child{border-top:0}.remote-releases small,.remote-releases code{display:block;color:var(--muted);margin-top:5px}
.remote-releases p{margin:6px 0 0}.remote-live{color:#66d69e;display:inline-flex;align-items:center;gap:3px;margin-left:10px;font-size:11px;font-weight:700}
@media(max-width:850px){.remote-metrics{grid-template-columns:1fr}.remote-releases>div{align-items:flex-start;flex-direction:column}.remote-app-tabs button{min-width:160px}}
`;
edit('frontend/src/styles.css',s=>s.includes('/* AltF5 Remote Apps:')?s:s+'\n'+css);
for(const [p,{before,after}] of staged){
  if(before===after)continue;
  const filename=path.join(root,p),temporary=filename+'.altf5-new';
  fs.writeFileSync(temporary,after,'utf8');fs.renameSync(temporary,filename);
}
console.log('FRAG Remote Update integration complete. Existing 24h free-key middleware untouched.');
