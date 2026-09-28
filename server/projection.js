import { DatabaseSync } from 'node:sqlite';
import { listQuery } from './validation.js';

export class Projection {
  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS keys (key TEXT PRIMARY KEY, id TEXT, type TEXT, status TEXT, expiresAt REAL, maxDevices INTEGER, devices INTEGER, usageCount INTEGER, lastUsed REAL, createdAt REAL, updatedAt REAL, archived INTEGER, search TEXT, data TEXT);
      CREATE INDEX IF NOT EXISTS key_status ON keys(archived,status,type,createdAt);
      CREATE INDEX IF NOT EXISTS key_expiry ON keys(archived,expiresAt);
      CREATE INDEX IF NOT EXISTS key_usage ON keys(usageCount);
      CREATE INDEX IF NOT EXISTS key_id ON keys(id);
      CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, data TEXT);
      CREATE TABLE IF NOT EXISTS devices (key TEXT, slot TEXT, device TEXT, firstRegistered REAL, lastAuthentication REAL, disabled INTEGER, PRIMARY KEY(key,slot));
      CREATE INDEX IF NOT EXISTS device_key ON devices(key);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, kind TEXT, at REAL, action TEXT, resource TEXT, actor TEXT, ip TEXT, success INTEGER, data TEXT);
      CREATE INDEX IF NOT EXISTS event_date ON events(kind,at);
      CREATE INDEX IF NOT EXISTS event_resource ON events(resource,at);
      CREATE TABLE IF NOT EXISTS limits (id TEXT PRIMARY KEY, start REAL, count INTEGER);`);
  }
  reset() { this.db.exec('DELETE FROM keys; DELETE FROM metadata; DELETE FROM devices; DELETE FROM events;'); }
  putMeta(id, value) {
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run(id, JSON.stringify(value || {}));
    for (const row of this.db.prepare('SELECT key,data FROM keys WHERE id=?').all(id)) this.putKey(row.key, JSON.parse(row.data));
  }
  putKey(key, value) {
    if (!value || typeof value !== 'object') return;
    const id = value.id || key;
    const meta = JSON.parse(this.db.prepare('SELECT data FROM metadata WHERE id=?').get(id)?.data || '{}');
    const k = { ...value, ...meta, key, id };
    const hwids = Object.entries(value.hwids || {}).filter(([,v]) => typeof v === 'string');
    const search = [key,k.label,k.name,k.assignedUser,...(k.tags || [])].join(' ').toLowerCase();
    this.db.prepare('INSERT OR REPLACE INTO keys VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,id,k.type || 'CUSTOM',k.status || 'disabled',Number(k.expiresAt)||0,Number(k.maxDevices)||1,hwids.length,Number(k.usageCount)||0,Number(k.lastUsed)||0,Number(k.createdAt)||0,Number(k.updatedAt)||0,k.archived?1:0,search,JSON.stringify(value));
    this.db.prepare('DELETE FROM devices WHERE key=?').run(key);
    const ins = this.db.prepare('INSERT INTO devices VALUES (?,?,?,?,?,?)');
    for (const [slot, device] of hwids) { const d = value.deviceInfo?.[slot] || {}; ins.run(key,slot,device,d.firstRegistered || 0,d.lastAuthentication || 0,d.disabled ? 1 : 0); }
  }
  removeKey(key) { this.db.prepare('DELETE FROM keys WHERE key=?').run(key); this.db.prepare('DELETE FROM devices WHERE key=?').run(key); }
  putEvent(id, e) { this.db.prepare('INSERT OR REPLACE INTO events VALUES (?,?,?,?,?,?,?,?,?)').run(id,e.kind,e.at,e.action||'',e.resource||'',e.actor||'',e.ip||'',e.success===true?1:0,JSON.stringify(e)); }
  inflate(row, now = Date.now()) {
    const data = JSON.parse(row.data);
    const meta = JSON.parse(this.db.prepare('SELECT data FROM metadata WHERE id=?').get(row.id)?.data || '{}');
    return { ...data, ...meta, key:row.key, id:row.id, devices:row.devices, effectiveStatus: data.status==='active' && data.expiresAt>0 && data.expiresAt<=now ? 'expired' : data.status, remainingMs:data.expiresAt ? Math.max(0,data.expiresAt-now) : null };
  }
  where(q, now = Date.now()) {
    const w = ['archived=?'], args = [q.archived==='true'?1:0];
    const add=(sql,...values)=>{ w.push(sql); args.push(...values); };
    if(q.search) add("search LIKE ? ESCAPE '\\'",`%${q.search.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`);
    if(q.type) add('type=?',q.type);
    if(q.status==='expired') add("(status='expired' OR (status='active' AND expiresAt>0 AND expiresAt<=?))",now);
    else if(q.status==='active') add("status='active' AND (expiresAt=0 OR expiresAt>?)",now);
    else if(q.status) add('status=?',q.status);
    const today = new Date(now).setUTCHours(0,0,0,0);
    if(q.expiration==='lifetime') add('expiresAt=0');
    if(q.expiration==='expired') add('expiresAt>0 AND expiresAt<=?',now);
    if(['today','24h','7d','30d'].includes(q.expiration)) add('expiresAt>? AND expiresAt<=?',now,q.expiration==='today'?today+86400000:now+({'24h':1,'7d':7,'30d':30}[q.expiration])*86400000);
    if(q.expiresFrom!==undefined) add('expiresAt>=?',q.expiresFrom);
    if(q.expiresTo!==undefined) add('expiresAt<=?',q.expiresTo);
    if(q.devices==='none') add('devices=0');
    if(q.devices==='full') add('devices>=maxDevices');
    if(q.devices==='available') add('devices<maxDevices');
    if(q.devices==='custom' && q.deviceCount!==undefined) add('devices=?',q.deviceCount);
    if(q.created==='today') add('createdAt>=?',today);
    if(q.created==='week') add('createdAt>=?',today-((new Date(today).getUTCDay()+6)%7)*86400000);
    if(q.created==='month') { const d=new Date(today); d.setUTCDate(1); add('createdAt>=?',d.getTime()); }
    if(q.from!==undefined) add('createdAt>=?',q.from);
    if(q.to!==undefined) add('createdAt<=?',q.to);
    if(q.tag) add("EXISTS (SELECT 1 FROM metadata m,json_each(m.data,'$.tags') t WHERE m.id=keys.id AND t.value=?)",q.tag);
    return { sql:w.join(' AND '),args };
  }
  keys(input) {
    const q=listQuery.parse(input), {sql,args}=this.where(q);
    const total=this.db.prepare(`SELECT COUNT(*) n FROM keys WHERE ${sql}`).get(...args).n;
    const pagination=pages(q,total);
    const rows=this.db.prepare(`SELECT * FROM keys WHERE ${sql} ORDER BY ${q.sort} ${q.direction}, key ASC LIMIT ? OFFSET ?`).all(...args,q.limit,(pagination.page-1)*q.limit);
    return { data:rows.map(r=>this.inflate(r)),pagination,serverTime:Date.now() };
  }
  events(q={}) {
    const w=[],args=[];
    for(const field of ['kind','action','resource','actor','ip']) if(q[field]) { w.push(`${field}=?`); args.push(q[field]); }
    if(q.from) { w.push('at>=?'); args.push(Number(q.from)); } if(q.to) { w.push('at<=?'); args.push(Number(q.to)); }
    if(q.search) { w.push('data LIKE ?'); args.push(`%${q.search}%`); }
    const where=w.length?w.join(' AND '):'1=1';
    const total=this.db.prepare(`SELECT COUNT(*) n FROM events WHERE ${where}`).get(...args).n;
    const p=pages(q,total);
    return { data:this.db.prepare(`SELECT data FROM events WHERE ${where} ORDER BY at DESC,id DESC LIMIT ? OFFSET ?`).all(...args,p.limit,(p.page-1)*p.limit).map(r=>JSON.parse(r.data)),pagination:p };
  }
  devices(q) {
    const args=[`%${q.search||''}%`,`%${q.search||''}%`];
    const where='(d.key LIKE ? OR d.device LIKE ?)';
    const total=this.db.prepare(`SELECT COUNT(*) n FROM devices d WHERE ${where}`).get(...args).n;
    const p=pages(q,total);
    return {data:this.db.prepare(`SELECT d.*,k.type FROM devices d JOIN keys k ON k.key=d.key WHERE ${where} ORDER BY d.key,d.slot LIMIT ? OFFSET ?`).all(...args,p.limit,(p.page-1)*p.limit),pagination:p};
  }
  limit(id, max, windowMs) {
    const now=Date.now();
    this.db.prepare('DELETE FROM limits WHERE start<?').run(now-86400000);
    const row=this.db.prepare('SELECT * FROM limits WHERE id=?').get(id);
    const start=row && now-row.start<windowMs?row.start:now, count=start===now?1:row.count+1;
    this.db.prepare('INSERT OR REPLACE INTO limits VALUES (?,?,?)').run(id,start,count);
    return count<=max;
  }
  close(){this.db.close();}
}
export function pages(q,total) { const limit=Number(q.limit)||25,totalPages=Math.max(1,Math.ceil(total/limit)),page=Math.min(Number(q.page)||1,totalPages); return {page,limit,total,totalPages,hasNext:page<totalPages,hasPrevious:page>1}; }
