import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { firebaseStore } from '../server/firebase.js';
import { initializeAdmin } from '../server/auth.js';
let muted=false;
const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback();}});
const rl=createInterface({input:process.stdin,output,terminal:!!process.stdin.isTTY});
const secret=async(label)=>{process.stdout.write(label);muted=true;const value=await rl.question('');muted=false;process.stdout.write('\n');return value;};
try {
  const username=(await rl.question('Initial username [ZQL]: ')).trim()||'ZQL';
  const password=await secret('Initial password (hidden): '),pin=await secret('Initial PIN (hidden): ');
  const store=firebaseStore();await initializeAdmin(store,username,password,pin);store.db.goOffline();
  console.log('Administrator initialized with Argon2id hashes. Change the initial password and PIN on first login.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{rl.close();}
