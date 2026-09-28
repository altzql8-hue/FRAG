import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { firebaseStore } from './firebase.js';
import { Projection } from './projection.js';
import { createApp } from './app.js';
const production=process.env.NODE_ENV==='production';
const origin=process.env.APP_ORIGIN||'http://localhost:5173';
if(production&&!origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS');
if(!process.env.FIREBASE_DATABASE_URL&&!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw new Error('Configure FIREBASE_DATABASE_URL in .env');
const dataDir=path.resolve(process.env.DATA_DIR||'data');fs.mkdirSync(dataDir,{recursive:true});
// One server owns this SQLite index. Horizontal deployments need a shared search index.
const lock=path.join(dataDir,'server.lock');
let lockFd;
try { lockFd=fs.openSync(lock,'wx');fs.writeFileSync(lockFd,String(process.pid)); }
catch { throw new Error(`Data directory is already locked. Stop the other server; after a crash verify its PID before removing ${lock}.`); }
const index=new Projection(path.join(dataDir,'search.sqlite')),store=firebaseStore();
let connected=false,initialized=false;
store.db.ref('.info/connected').on('value',s=>{connected=s.val()===true;});
const {app}=createApp({store,index,origin,production,trustProxy:Number(process.env.TRUST_PROXY_HOPS||0),ready:()=>initialized&&connected});
const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('FRAG server listening; synchronizing Firebase index.'));
const stops=[];
try {
  index.reset();
  stops.push(await store.subscribe('frag/keyMeta',(id,v)=>index.putMeta(id,v),id=>index.putMeta(id,{})));
  stops.push(await store.subscribe('keys',(key,v)=>index.putKey(key,v),key=>index.removeKey(key)));
  stops.push(await store.subscribe('frag/events',(id,v)=>index.putEvent(id,v),()=>{}));
  initialized=true;console.log('FRAG ready. Firebase is the source of truth.');
} catch(e) {console.error('Firebase initialization failed:',e.code||e.message);await shutdown(1);}
async function shutdown(code=0){initialized=false;server.close();for(const stop of stops)stop();store.db.goOffline();index.close();fs.closeSync(lockFd);fs.unlinkSync(lock);process.exit(code);}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());
