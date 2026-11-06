import React,{useCallback,useEffect,useState} from 'react';
import './remote.css';
import {Radio,Plus,UploadCloud,Copy,RefreshCw,CheckCircle2,History,ShieldCheck} from 'lucide-react';
import {api} from '../api';
import {useApp} from '../context';
import {PageHeading,Panel,Button,Field,Empty} from '../components/ui';

const initial={status:'online',message:'Service temporarily unavailable.',announcement:'',minVersion:'',forceUpdate:false,updatesEnabled:true};
const linkFor=(slug,suffix='manifest')=>`${location.origin}/api/v1/apps/${slug}/${suffix}`;
const formatDate=value=>value?new Date(value).toLocaleString():'Never';

export default function RemoteApps(){
  const {toast}=useApp();
  const [apps,setApps]=useState([]),[selected,setSelected]=useState(''),[current,setCurrent]=useState(null);
  const [releases,setReleases]=useState([]),[config,setConfig]=useState(initial),[create,setCreate]=useState(false);
  const [name,setName]=useState(''),[slug,setSlug]=useState(''),[description,setDescription]=useState('');
  const [keyType,setKeyType]=useState('FREE'),[keyDays,setKeyDays]=useState(1),[keyDevices,setKeyDevices]=useState(1),[newKey,setNewKey]=useState('');
  const [file,setFile]=useState(null),[version,setVersion]=useState('1.0.0'),[notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const load=useCallback(async()=>{
    const result=await api('/apps');setApps(result.data);
    setSelected(old=>result.data.find(x=>x.slug===old)?old:(result.data[0]?.slug||''));
  },[]);
  useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
  const refresh=useCallback(async id=>{
    if(!id){setCurrent(null);setReleases([]);return;}
    const [a,r]=await Promise.all([api('/apps/'+id),api('/apps/'+id+'/releases')]);
    setCurrent(a.data);setConfig({...initial,...a.data.config});setReleases(r.data);
  },[]);
  useEffect(()=>{refresh(selected).catch(e=>setError(e.message));},[selected,refresh]);
  const run=async task=>{setBusy(true);setError('');try{await task();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const createApp=async e=>{e.preventDefault();await run(async()=>{
    const r=await api('/apps',{method:'POST',body:{name,slug,description}});
    await load();setSelected(r.data.slug);setCreate(false);toast('Application endpoint created');
  });};
  const generateAppKey=async e=>{e.preventDefault();await run(async()=>{
    const r=await api('/apps/'+selected+'/keys',{method:'POST',body:{type:keyType,days:Number(keyDays),maxDevices:Number(keyDevices)}});
    setNewKey(r.data.key);toast('Application license created');
  });};
  const save=async()=>run(async()=>{
    await api('/apps/'+selected+'/config',{method:'PUT',body:config});await refresh(selected);
    toast('Remote control settings saved');
  });
  const upload=async e=>{e.preventDefault();await run(async()=>{
    if(!file)throw new Error('Choose a .lua file.');
    if(!file.name.toLowerCase().endsWith('.lua'))throw new Error('Only UTF-8 .lua files are accepted.');
    if(file.size>512*1024)throw new Error('Lua script exceeds the 512 KiB upload limit.');
    const source=await file.text();
    const result=await api('/apps/'+selected+'/releases',{method:'POST',body:{version,notes,source}});
    await refresh(selected);setFile(null);
    const input=document.getElementById('lua-upload');if(input)input.value='';
    toast('Release uploaded. Publish it to activate the update.');
    return result;
  });};
  const publish=id=>run(async()=>{
    await api('/apps/'+selected+'/releases/'+id+'/publish',{method:'POST'});
    await refresh(selected);toast('Published release is now live');
  });
  const copy=async text=>{await navigator.clipboard.writeText(text);toast('Copied endpoint URL');};
  return <div className="remote-page">
    <PageHeading title="Remote Apps" subtitle="Application endpoints, maintenance controls and verified Lua releases.">
      <Button onClick={()=>{setCreate(v=>!v);setError('');}}><Plus size={16}/>Create endpoint</Button>
      <Button aria-label="Refresh applications" onClick={()=>run(load)}><RefreshCw size={16}/></Button>
    </PageHeading>
    {error&&<p className="error" role="alert">{error}</p>}
    {create&&<Panel title="New application endpoint" subtitle="Each app receives independent status, releases and license validation.">
      <form className="remote-create" onSubmit={createApp}>
        <Field label="Application name" value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={80}/>
        <Field label="Endpoint ID" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase())} required pattern="[a-z][a-z0-9-]{1,47}"/>
        <Field label="Description" value={description} onChange={e=>setDescription(e.target.value)} maxLength={250}/>
        <Button className="primary" type="submit" busy={busy}><Plus size={16}/>Create application</Button>
      </form>
    </Panel>}
    {apps.length>0&&<div className="remote-app-tabs" role="tablist" aria-label="Applications">
      {apps.map(a=><button key={a.slug} role="tab" aria-selected={a.slug===selected} className={a.slug===selected?'selected':''} onClick={()=>setSelected(a.slug)}>
        <span className={`remote-dot ${a.config?.status||'online'}`}/><span>{a.name}</span><small>{a.slug}</small>
      </button>)}
    </div>}
    {apps.length===0&&!create&&<Empty title="No apps registered" text="Create your first endpoint to manage remote updates and app status."/>}
    {current&&<>
      <div className="remote-metrics">
        <div><small>Application</small><strong>{current.name}</strong><span>{current.slug}</span></div>
        <div><small>Service status</small><strong>{config.status.toUpperCase()}</strong><span>Controlled from Firebase</span></div>
        <div><small>Live version</small><strong>{releases.find(r=>r.id===current.currentRelease)?.version||'Not published'}</strong><span>RSA-SHA256 signed</span></div>
      </div>
      <div className="two-column">
        <Panel title="Remote server control" subtitle="Applies to this app only." actions={<Radio size={19}/> }>
          <div className="remote-form">
            <Field label="App status"><select value={config.status} onChange={e=>setConfig(s=>({...s,status:e.target.value}))}>
              <option value="online">Online</option><option value="maintenance">Maintenance</option><option value="offline">Offline</option>
            </select></Field>
            <Field label="Status message" help="Shown by the launcher when offline or in maintenance.">
              <textarea rows={3} maxLength={500} value={config.message} onChange={e=>setConfig(s=>({...s,message:e.target.value}))}/>
            </Field>
            <Field label="Announcement"><textarea rows={2} maxLength={500} value={config.announcement} onChange={e=>setConfig(s=>({...s,announcement:e.target.value}))}/></Field>
            <Field label="Minimum APK version" value={config.minVersion} placeholder="1.0.0" onChange={e=>setConfig(s=>({...s,minVersion:e.target.value}))}/>
            <label className="remote-check"><input type="checkbox" checked={config.forceUpdate} onChange={e=>setConfig(s=>({...s,forceUpdate:e.target.checked}))}/><span>Require APK update below the minimum version</span></label>
            <label className="remote-check"><input type="checkbox" checked={config.updatesEnabled} onChange={e=>setConfig(s=>({...s,updatesEnabled:e.target.checked}))}/><span>Allow Lua updates for installed clients</span></label>
            <Button className="primary" busy={busy} onClick={save}>Save remote settings</Button>
          </div>
        </Panel>
        <Panel title="Application endpoints" subtitle="HTTPS APIs owned by this application." actions={<ShieldCheck size={19}/> }>
          <div className="remote-endpoints">
            {[['Status + release manifest',linkFor(selected)],['License authentication',linkFor(selected,'authenticate')],['Public Lua download','/api/v1/apps/'+selected+'/releases/{release-id}/download']].map(([name,url])=><div key={name}>
              <small>{name}</small><code>{url}</code><Button onClick={()=>copy(url)} aria-label={`Copy ${name}`}><Copy size={15}/></Button>
            </div>)}
          </div>
          <p className="muted">Release signatures are generated by the backend. The APK remembers the signing public key on first verified launch.</p>
        </Panel>
      </div>
      <Panel title="Create application license" subtitle="Keys created here work only with the selected application. Existing 24-hour website generation remains unchanged.">
        <form className="remote-form" onSubmit={generateAppKey}>
          <div className="form-grid">
            <Field label="Key type"><select value={keyType} onChange={e=>setKeyType(e.target.value)}><option>FREE</option><option>PREMIUM</option><option>VIP</option><option>TESTER</option></select></Field>
            <Field label="Duration (days; 0 = lifetime)" type="number" value={keyDays} min="0" max="36500" onChange={e=>setKeyDays(Number(e.target.value))}/>
            <Field label="Devices" type="number" value={keyDevices} min="1" max="100" onChange={e=>setKeyDevices(Number(e.target.value))}/>
          </div>
          <Button className="primary" busy={busy} type="submit"><Plus size={16}/>Generate license for {current.name}</Button>
          {newKey&&<div className="remote-endpoints"><div><small>New license key</small><code>{newKey}</code><Button type="button" onClick={()=>copy(newKey)}><Copy size={15}/></Button></div></div>}
        </form>
      </Panel>
      <Panel title="Upload Lua release" subtitle="Publish your full main.lua. The APK fetches it once and caches it in private app storage." actions={<UploadCloud size={20}/> }>
        <form className="remote-upload" onSubmit={upload}>
          <Field label="Version" value={version} onChange={e=>setVersion(e.target.value)} required maxLength={40}/>
          <Field label="Lua source file"><input id="lua-upload" type="file" accept=".lua,text/plain" onChange={e=>setFile(e.target.files?.[0]||null)} required/></Field>
          <Field label="Release notes"><textarea rows={2} value={notes} maxLength={2000} onChange={e=>setNotes(e.target.value)}/></Field>
          <Button type="submit" busy={busy} disabled={!file} className="primary"><UploadCloud size={16}/>Upload release</Button>
        </form>
      </Panel>
      <Panel title="Release history" subtitle="Publish an earlier release to roll back without changing the APK." actions={<History size={20}/> }>
        {releases.length===0?<Empty title="No Lua releases" text="Upload main.lua to publish the first release."/>:<div className="remote-releases">
          {releases.map(r=><div key={r.id}>
            <div><strong>{r.version}</strong>{current.currentRelease===r.id&&<span className="remote-live"><CheckCircle2 size={13}/>LIVE</span>}
              <small>{formatDate(r.createdAt)} · {(r.size/1024).toFixed(1)} KiB</small>
              <code>{r.sha256.slice(0,20)}…</code>{r.notes&&<p>{r.notes}</p>}</div>
            <Button disabled={busy||current.currentRelease===r.id} onClick={()=>publish(r.id)}>{current.currentRelease===r.id?'Published':'Publish / rollback'}</Button>
          </div>)}
        </div>}
      </Panel>
    </>}
  </div>;
}
