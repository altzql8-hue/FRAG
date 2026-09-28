// Isolated unit-test adapter. Production always uses firebaseStore().
export class MemoryStore {
  constructor(){this.data={};this.queue=Promise.resolve();}
  async get(path){return structuredClone(path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],this.data)??null);}
  async set(path,value){const parts=path.split('/').filter(Boolean);if(!parts.length){this.data=structuredClone(value||{});return;}let parent=this.data;for(const k of parts.slice(0,-1))parent=parent[k]??={};if(value===null)delete parent[parts.at(-1)];else parent[parts.at(-1)]=structuredClone(value);}
  async update(changes){for(const [p,v]of Object.entries(changes))await this.set(p,v);}
  async transact(path,fn){const task=this.queue.then(async()=>{const current=await this.get(path);const next=fn(current);if(next===undefined)return {committed:false,value:current};await this.set(path,next);return {committed:true,value:structuredClone(next)};});this.queue=task.catch(()=>{});return task;}
}
