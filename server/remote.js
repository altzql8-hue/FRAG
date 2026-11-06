import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, assert } from './errors.js';

// All releases and configuration live in Firebase; no process-local or Render disk state.
// A one-time signing key is generated and stored under the Admin-only Firebase namespace.
// Applications trust the HTTPS-delivered public key on first install and pin it thereafter.
const slugSchema = z.string().min(2).max(48).regex(/^[a-z][a-z0-9-]*$/);
const versionSchema = z.string().min(1).max(40).regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/);
const releaseIdSchema = z.string().uuid();
const configSchema = z.object({
  status: z.enum(['online','maintenance','offline']),
  message: z.string().max(500),
  announcement: z.string().max(500),
  minVersion: z.string().max(40),
  forceUpdate: z.boolean(),
  updatesEnabled: z.boolean()
}).strict();
const defaultConfig = Object.freeze({status:'online',message:'Service temporarily unavailable.',announcement:'',minVersion:'',forceUpdate:false,updatesEnabled:true});
const appSchema = z.object({slug:slugSchema,name:z.string().trim().min(2).max(80),description:z.string().max(250).default('')}).strict();
const uploadSchema = z.object({version:versionSchema,notes:z.string().max(2000).default(''),source:z.string().min(1)}).strict();
const signaturePayload = (slug,id,sha,b64)=>`ALTF5_LUA_RELEASE_V1\n${slug}\n${id}\n${sha}\n${b64}`;
const sha256 = b=>createHash('sha256').update(b).digest('hex');
const appPath=slug=>`frag/remote/apps/${slug}`;
const releasePath=(slug,id)=>`frag/remote/releases/${slug}/${id}`;
const releaseIndexPath=slug=>`frag/remote/releases/${slug}`;

export class RemoteApps {
  constructor(store,licenses){ this.store=store;this.licenses=licenses;this.signer=null; }
  async signing(){
    if(this.signer)return this.signer;
    let saved=await this.store.get('frag/remote/signing');
    if(!saved){
      const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
      const candidate={privateKey:pair.privateKey,publicKey:pair.publicKey,createdAt:Date.now()};
      const result=await this.store.transact('frag/remote/signing',current=>current?undefined:candidate);
      saved=result.value;
    }
    assert(saved?.publicKey&&saved?.privateKey,503,'SIGNING_UNAVAILABLE','Release signer unavailable.');
    this.signer=saved;
    return saved;
  }
  async ensureDefault(){
    const now=Date.now(),slug='rog-premier';
    if(await this.store.get(appPath(slug)))return;
    await this.store.transact(appPath(slug),existing=>existing?undefined:{slug,name:'AltF5 ROG Premier',description:'Legacy Lua application',config:{...defaultConfig},currentRelease:null,createdAt:now,updatedAt:now,createdBy:'system'});
  }
  async list(){
    await this.ensureDefault();
    const items=await this.store.get('frag/remote/apps')||{};
    return Object.values(items).sort((a,b)=>a.name.localeCompare(b.name));
  }
  async get(slug){
    slugSchema.parse(slug);
    if(slug==='rog-premier')await this.ensureDefault();
    const item=await this.store.get(appPath(slug));
    assert(item,404,'APP_NOT_FOUND','Application does not exist.');
    return item;
  }
  async create(body,ctx){
    const p=appSchema.parse(body),now=Date.now();
    const value={...p,config:{...defaultConfig},currentRelease:null,createdAt:now,updatedAt:now,createdBy:ctx.adminId};
    const result=await this.store.transact(appPath(p.slug),existing=>existing?undefined:value);
    assert(result.committed,409,'APP_EXISTS','An application with that identifier already exists.');
    await this.licenses.audit(ctx,'app-create',p.slug,null,{name:p.name});
    return value;
  }
  async config(slug,body,ctx){
    const p=configSchema.parse(body),old=await this.get(slug);
    const result=await this.store.transact(appPath(slug),current=>{
      assert(current,404,'APP_NOT_FOUND','Application does not exist.');
      return {...current,config:p,updatedAt:Date.now()};
    });
    await this.licenses.audit(ctx,'app-config',slug,old.config,p);
    return result.value;
  }
  async releases(slug){
    await this.get(slug);
    const all=await this.store.get(releaseIndexPath(slug))||{};
    return Object.values(all).map(({sourceBase64,...meta})=>meta).sort((a,b)=>b.createdAt-a.createdAt);
  }
  async upload(slug,body,ctx){
    await this.get(slug);
    const p=uploadSchema.parse(body);
    const data=Buffer.from(p.source,'utf8');
    assert(data.length<=512*1024,413,'SCRIPT_TOO_LARGE','Lua script exceeds the 512 KiB limit.');
    assert(!p.source.includes('\0'),400,'SCRIPT_BINARY','Upload UTF-8 Lua source, not precompiled bytecode.');
    const id=randomUUID(),sha=sha256(data),sha64=createHash('sha256').update(data).digest('base64'),signer=await this.signing();
    const signerPublicKey=signer.publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g,'');
    const sign=createSign('RSA-SHA256');sign.update(signaturePayload(slug,id,sha,sha64));sign.end();
    const signature=sign.sign(signer.privateKey).toString('base64');
    const record={id,slug,version:p.version,notes:p.notes,sha256:sha,sha256Base64:sha64,size:data.length,signature,publicKey:signerPublicKey,sourceBase64:data.toString('base64'),createdAt:Date.now(),createdBy:ctx.adminId};
    await this.store.transact(releasePath(slug,id),current=>current?undefined:record);
    await this.licenses.audit(ctx,'lua-upload',slug,null,{releaseId:id,version:p.version,sha256:sha,size:data.length});
    const {sourceBase64,...safe}=record;return safe;
  }
  async publish(slug,id,ctx){
    releaseIdSchema.parse(id);
    const record=await this.store.get(releasePath(slug,id));
    assert(record,404,'RELEASE_NOT_FOUND','Release does not exist.');
    const previous=await this.get(slug);
    const result=await this.store.transact(appPath(slug),app=>{
      assert(app,404,'APP_NOT_FOUND','Application does not exist.');
      return {...app,currentRelease:id,updatedAt:Date.now()};
    });
    await this.licenses.audit(ctx,'lua-publish',slug,{releaseId:previous.currentRelease},{releaseId:id,version:record.version});
    return result.value;
  }
  async manifest(slug){
    const app=await this.get(slug);
    const config={...defaultConfig,...app.config};
    const base={appId:slug,status:config.status,message:config.message,announcement:config.announcement,minVersion:config.minVersion,forceUpdate:config.forceUpdate,updatesEnabled:config.updatesEnabled,serverTime:Date.now(),release:null};
    if(!app.currentRelease)return base;
    const record=await this.store.get(releasePath(slug,app.currentRelease));
    assert(record,503,'RELEASE_MISSING','The published release is missing.');
    return {...base,release:{id:record.id,version:record.version,sha256:record.sha256,sha256Base64:record.sha256Base64,size:record.size,signature:record.signature,publicKey:record.publicKey,algorithm:'RSA-SHA256',url:`/api/v1/apps/${slug}/releases/${record.id}/download`,notes:record.notes}};
  }
  async download(slug,id){
    releaseIdSchema.parse(id);
    const app=await this.get(slug);
    assert(app.config.status==='online',503,'APP_UNAVAILABLE','Application is not online.');
    assert(app.currentRelease===id,404,'RELEASE_NOT_CURRENT','Only the published release is available.');
    const record=await this.store.get(releasePath(slug,id));
    assert(record,404,'RELEASE_NOT_FOUND','Release not found.');
    const bytes=Buffer.from(record.sourceBase64,'base64');
    assert(bytes.length===record.size&&sha256(bytes)===record.sha256,503,'RELEASE_CORRUPTED','Published script failed its integrity check.');
    return {bytes,record};
  }
  async authenticate(slug,key,hwid,ip){
    const app=await this.get(slug);
    assert(app.config.status==='online',503,'APP_UNAVAILABLE','Application is not online.');
    return this.licenses.authenticate(key,hwid,ip,slug);
  }
}
export const remoteAppSchemas={appSchema,configSchema,uploadSchema};
