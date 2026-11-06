import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createVerify} from 'node:crypto';
import {MemoryStore} from './memory-store.js';
import {RemoteApps} from '../server/remote.js';
import {Licenses} from '../server/licenses.js';
import {Projection} from '../server/projection.js';

function fixture(){
  const store=new MemoryStore();
  const calls=[];
  const licenses={audit:async()=>{},authenticate:async(...args)=>{calls.push(args);return {status:'active',appId:args[3]};}};
  return {store,calls,remote:new RemoteApps(store,licenses),ctx:{adminId:'admin',username:'admin',ip:'127.0.0.1',sessionId:'test'}};
}
const payload=(slug,release)=>['ALTF5_LUA_RELEASE_V1',slug,release.id,release.sha256,release.sha256Base64].join('\n');

test('default app is automatically registered without changing existing license records',async()=>{
  const {store,remote}=fixture();
  const apps=await remote.list();
  assert.equal(apps.length,1);
  assert.equal(apps[0].slug,'rog-premier');
  assert.equal(apps[0].config.status,'online');
  assert.equal(await store.get('keys'),null);
});

test('per-app config isolation and maintenance enforcement',async()=>{
  const {remote,ctx}=fixture();
  await remote.create({slug:'virtual-container',name:'Virtual Container',description:''},ctx);
  const c={status:'maintenance',message:'Upgrading',announcement:'Soon',minVersion:'1.2.0',forceUpdate:true,updatesEnabled:true};
  await remote.config('virtual-container',c,ctx);
  assert.equal((await remote.get('rog-premier')).config.status,'online');
  assert.equal((await remote.get('virtual-container')).config.status,'maintenance');
  await assert.rejects(()=>remote.authenticate('virtual-container','MY-KEY','DEVICE-1','1.2.3.4'),e=>e.status===503);
});

test('published Lua bytes are hash-checked and RSA-signed',async()=>{
  const {remote,ctx}=fixture();
  const source='print("AltF5 interface")\n';
  const release=await remote.upload('rog-premier',{source,version:'1.2.0',notes:'Test release'},ctx);
  const before=await remote.manifest('rog-premier');
  assert.equal(before.release,null);
  await remote.publish('rog-premier',release.id,ctx);
  const manifest=await remote.manifest('rog-premier');
  const current=manifest.release;
  assert.equal(current.sha256,createHash('sha256').update(source).digest('hex'));
  assert.equal(current.sha256Base64,createHash('sha256').update(source).digest('base64'));
  const verifier=createVerify('RSA-SHA256');verifier.update(payload('rog-premier',current));verifier.end();
  assert.equal(verifier.verify({key:Buffer.from(current.publicKey,'base64'),format:'der',type:'spki'},Buffer.from(current.signature,'base64')),true);
  const download=await remote.download('rog-premier',release.id);
  assert.equal(download.bytes.toString('utf8'),source);
  const releases=await remote.releases('rog-premier');
  assert.equal(releases.length,1);
  assert.equal('sourceBase64' in releases[0],false);
});

test('release rollback and app scoped authentication',async()=>{
  const {remote,ctx,calls}=fixture();
  const first=await remote.upload('rog-premier',{source:'print(1)',version:'1.0.0'},ctx);
  const second=await remote.upload('rog-premier',{source:'print(2)',version:'1.1.0'},ctx);
  await remote.publish('rog-premier',first.id,ctx);
  await remote.publish('rog-premier',second.id,ctx);
  await remote.publish('rog-premier',first.id,ctx);
  assert.equal((await remote.manifest('rog-premier')).release.id,first.id);
  await assert.rejects(()=>remote.download('rog-premier',second.id),e=>e.status===404);
  const status=await remote.authenticate('rog-premier','LICENSE-1','DEVICE-1','1.1.1.1');
  assert.equal(status.appId,'rog-premier');assert.equal(calls[0][3],'rog-premier');
});

test('invalid slugs and oversized source are rejected',async()=>{
  const {remote,ctx}=fixture();
  await assert.rejects(()=>remote.get('../other-app'));
  await assert.rejects(()=>remote.upload('rog-premier',{source:'x'.repeat(512*1024+1),version:'1.2.0'},ctx),e=>e.status===413);
});


test('license records are restricted to their assigned application',async()=>{
  const store=new MemoryStore(),index=new Projection(':memory:');
  try {
    const licenses=new Licenses(store,index),ctx={adminId:'admin',username:'admin',ip:'127.0.0.1',sessionId:'test'};
    await licenses.create({key:'ALT-VIRTUAL-ONLY',appId:'virtual-container',type:'FREE',days:1},ctx);
    await assert.rejects(()=>licenses.authenticate('ALT-VIRTUAL-ONLY','device-123','local','rog-premier'),e=>e.code==='WRONG_APP');
    const authorized=await licenses.authenticate('ALT-VIRTUAL-ONLY','device-123','local','virtual-container');
    assert.equal(authorized.status,'active');
  } finally {index.close();}
});
