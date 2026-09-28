import { randomInt, randomUUID, createHash } from 'node:crypto';
import { assert, fail } from './errors.js';
import { keyFields, editFields, keyText, typeText, defaults } from './validation.js';

export function generateKey(o={}) {
  const p=keyFields.parse(o);
  const alphabet=(p.uppercase?'ABCDEFGHIJKLMNOPQRSTUVWXYZ':'')+(p.lowercase?'abcdefghijklmnopqrstuvwxyz':'')+(p.numbers?'0123456789':'');
  assert(alphabet.length>0,400,'ALPHABET','Choose at least one character set.');
  assert(p.groups*p.characters*Math.log2(alphabet.length)>=50,400,'ENTROPY','Use at least 50 bits of random key entropy (for example two groups of five letters and digits).');
  const groups=Array.from({length:p.groups},()=>Array.from({length:p.characters},()=>alphabet[randomInt(alphabet.length)]).join(''));
  return keyText.parse([...(p.prefix?[p.prefix]:[]),...groups].join(p.separator));
}
const metadata=p=>Object.fromEntries(['label','name','assignedUser','notes','tags','prefix'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
export class Licenses {
  constructor(store, index) { this.store=store; this.index=index; }
  async event(kind, fields) {
    const id=randomUUID(), e={id,kind,at:Date.now(),...fields};
    await this.store.set(`frag/events/${id}`,e); this.index.putEvent(id,e); return e;
  }
  async settings(){ return {...defaults,...await this.store.get('frag/settings')}; }
  async detail(key) {
    keyText.parse(key); const value=await this.store.get(`keys/${key}`);
    assert(value,404,'NOT_FOUND','Key not found.');
    const meta=await this.store.get(`frag/keyMeta/${value.id||key}`)||{};
    this.index.putMeta(value.id||key,meta); this.index.putKey(key,value);
    return {...value,...meta,key,id:value.id||key,devices:Object.keys(value.hwids||{}).length,version:value.version||0,serverTime:Date.now()};
  }
  async audit(ctx,action,resource,before,after,phase='completed') {
    return this.event('audit',{actor:ctx.adminId||'system',username:ctx.username||'system',ip:ctx.ip||'',session:ctx.sessionId||'',action,resource,before:before||null,after:after||null,phase});
  }
  async create(input,ctx) {
    const p=keyFields.parse(input), now=Date.now();
    const settings=await this.settings(); assert(settings.types.some(t=>t.name===p.type),400,'TYPE','Select a configured key type.');
    for(let tries=0;tries<5;tries++) {
      const key=p.key||generateKey(p), id=randomUUID();
      const value={id,key,type:p.type,status:p.status,expiresAt:p.expiresAt??(p.days===0?0:now+p.days*86400000),maxDevices:p.maxDevices,hwids:{},usageCount:0,lastUsed:0,createdAt:now,updatedAt:now,createdBy:ctx.adminId,updatedBy:ctx.adminId,version:1,archived:false,bindingEnabled:p.bindingEnabled};
      await this.audit(ctx,'create',id,null,{key},'intent');
      const result=await this.store.transact(`keys/${key}`,current=>current?undefined:value);
      if(!result.committed) { if(p.key) fail(409,'KEY_ALREADY_EXISTS','That key already exists.'); continue; }
      await this.store.set(`frag/keyMeta/${id}`,metadata(p));
      this.index.putMeta(id,metadata(p)); this.index.putKey(key,value);
      await this.audit(ctx,'create',id,null,{...value,...metadata(p)});
      return this.detail(key);
    }
    fail(409,'COLLISION','Could not reserve a unique key. Please retry.');
  }
  async edit(key,input,ctx) {
    const p=editFields.parse(input), before=await this.detail(key), nextKey=p.key||key;
    if(p.type) assert((await this.settings()).types.some(t=>t.name===p.type),400,'TYPE','Select a configured key type.');
    await this.audit(ctx,'edit',before.id,before,p,'intent');
    const mutate=current=>{
      assert(current,404,'NOT_FOUND','Key not found.');
      assert((current.version||0)===p.version,409,'CONFLICT','This key changed. Refresh before saving.');
      const next={...current,key:nextKey,id:before.id,version:(current.version||0)+1,updatedAt:Date.now(),updatedBy:ctx.adminId};
      for(const field of ['type','status','expiresAt','maxDevices','bindingEnabled']) if(p[field]!==undefined) next[field]=p[field];
      if(p.days!==undefined) next.expiresAt=p.days===0?0:Date.now()+p.days*86400000;
      if(p.adjustHours!==undefined) next.expiresAt=Math.max(1, (current.expiresAt>0?current.expiresAt:Date.now())+p.adjustHours*3600000);
      assert((next.maxDevices||1)>=Object.keys(current.hwids||{}).length,409,'DEVICE_COUNT','Reset device bindings before reducing below the current device count.');
      return next;
    };
    let value;
    if(nextKey!==key) {
      // Renames are rare: a parent transaction reserves the destination and removes
      // the source atomically, retaining usage and bindings under concurrent auth.
      const r=await this.store.transact('keys',all=>{ all=all||{}; assert(!all[nextKey],409,'KEY_ALREADY_EXISTS','That key already exists.'); const next=mutate(all[key]); const out={...all,[nextKey]:next}; delete out[key]; return out; });
      value=r.value[nextKey]; this.index.removeKey(key);
    } else value=(await this.store.transact(`keys/${key}`,mutate)).value;
    const meta={...metadata(before),...metadata(p)};
    await this.store.set(`frag/keyMeta/${before.id}`,meta);
    this.index.putMeta(before.id,meta); this.index.putKey(nextKey,value);
    const after=await this.detail(nextKey); await this.audit(ctx,nextKey===key?'edit':'rename',before.id,before,after); return after;
  }
  async action(key,p,ctx) {
    const before=await this.detail(key);
    if(p.action==='duplicate') return this.create({...metadata(before),type:before.type,status:'active',maxDevices:before.maxDevices,days:before.expiresAt===0?0:Math.max(1/24,(before.expiresAt-Date.now())/86400000),bindingEnabled:before.bindingEnabled!==false},ctx);
    if(p.action==='regenerate') { assert(p.confirmation===key,400,'CONFIRM','Type the current key to confirm regeneration.'); return this.edit(key,{key:generateKey({prefix:before.prefix||'Frag'}),version:before.version},ctx); }
    if(p.action==='change-type') { typeText.parse(p.value); return this.edit(key,{type:p.value,version:before.version},ctx); }
    if(p.action==='change-max') return this.edit(key,{maxDevices:Number(p.value),version:before.version},ctx);
    if(['add-tag','remove-tag'].includes(p.action)) { assert(typeof p.value==='string' && p.value.length<=40,400,'TAG','Invalid tag.'); return this.edit(key,{tags:p.action==='add-tag'?[...new Set([...(before.tags||[]),p.value])]:(before.tags||[]).filter(t=>t!==p.value),version:before.version},ctx); }
    await this.audit(ctx,p.action,before.id,{key},p,'intent');
    const map={freeze:'frozen',unfreeze:'active',disable:'disabled',enable:'active',revoke:'banned',expire:'expired'};
    const result=await this.store.transact(`keys/${key}`,current=>{
      assert(current,404,'NOT_FOUND','Key not found.');
      const next={...current,version:(current.version||0)+1,updatedAt:Date.now(),updatedBy:ctx.adminId};
      if(map[p.action]) next.status=map[p.action];
      if(p.action==='archive') { next.archived=true; next.preArchiveStatus=current.status; next.status='disabled'; }
      if(p.action==='restore') { assert(current.archived,409,'NOT_ARCHIVED','Key is not archived.'); next.archived=false; next.status=current.preArchiveStatus||'disabled'; }
      if(p.action==='reset-devices') { next.hwids={}; next.deviceInfo={}; }
      if(['reset-device','disable-device'].includes(p.action)) {
        assert(typeof p.value==='string' && /^[A-Za-z0-9_-]+$/.test(p.value),400,'SLOT','Invalid device slot.');
        assert(current.hwids?.[p.value],404,'SLOT','Device slot not found.');
        next.hwids={...current.hwids}; next.deviceInfo={...current.deviceInfo};
        if(p.action==='reset-device') { delete next.hwids[p.value]; delete next.deviceInfo[p.value]; }
        else next.deviceInfo[p.value]={...next.deviceInfo[p.value],disabled:true};
      }
      if(p.action==='extend') { const hours=Number(p.value); assert(Number.isFinite(hours)&&hours>0&&hours<=876000,400,'DURATION','Enter hours between 1 and 876000.'); next.expiresAt=Math.max(Date.now(),current.expiresAt||0)+hours*3600000; if(current.status==='expired') next.status='active'; }
      if(p.action==='expire') next.expiresAt=Date.now()-1;
      if(p.action==='lifetime') next.expiresAt=0;
      if(p.action==='delete') { assert(current.archived && p.confirmation===key,400,'CONFIRM','Archive first and type the exact key to permanently delete.'); return null; }
      return next;
    });
    if(result.value) this.index.putKey(key,result.value); else this.index.removeKey(key);
    await this.audit(ctx,p.action,before.id,before,result.value);
    return result.value?this.detail(key):{key,deleted:true};
  }
  async authenticate(key,hwid,ip) {
    let outcome='invalid', newDevice=false, record;
    const now=Date.now();
    const result=await this.store.transact(`keys/${key}`,current=>{
      newDevice=false;
      if(!current) {outcome='invalid';return undefined;}
      if(current.archived) {outcome='disabled';return undefined;}
      if(current.status!=='active') {outcome=current.status||'disabled';return undefined;}
      if(current.expiresAt>0 && current.expiresAt<=now) {outcome='expired';return undefined;}
      const hwids={...current.hwids}, info={...current.deviceInfo};
      let slot=Object.keys(hwids).find(k=>hwids[k]===hwid);
      if(slot && info[slot]?.disabled) {outcome='device_disabled';return undefined;}
      if(current.bindingEnabled!==false) {
        if(!slot && Object.keys(hwids).length>=Math.max(1,current.maxDevices||1)) {outcome='device_limit';return undefined;}
        if(!slot) { slot=`hwid_${randomUUID().replaceAll('-','')}`;hwids[slot]=hwid;newDevice=true; }
        info[slot]={...info[slot],firstRegistered:info[slot]?.firstRegistered||now,lastAuthentication:now,disabled:false};
      }
      outcome='active';
      return {...current,hwids,deviceInfo:info,usageCount:(Number(current.usageCount)||0)+1,lastUsed:now};
    });
    record=result.value;
    await this.event('license',{action:outcome,success:result.committed,resource:record?.id||'',key:record?key:'',keyDigest:createHash('sha256').update(key).digest('hex').slice(0,16),ip,newDevice:result.committed&&newDevice});
    assert(result.committed,403,outcome.toUpperCase(),({invalid:'Invalid license key.',expired:'Key expired.',banned:'Key revoked.',frozen:'Key frozen.',device_limit:'Device limit reached.',device_disabled:'Device disabled.'})[outcome]||'Access denied.');
    this.index.putKey(key,record);
    // Explicit allowlist: no private metadata, other HWIDs, admin IDs, or history.
    return {key,type:record.type,status:record.status,expiresAt:record.expiresAt,maxDevices:record.maxDevices,devices:Object.keys(record.hwids||{}).length,usageCount:record.usageCount,lastUsed:record.lastUsed,serverTime:now};
  }
}
