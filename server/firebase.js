import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

export function firebaseStore() {
  const emulator = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (process.env.NODE_ENV === 'production' && emulator) throw new Error('Emulator is forbidden in production');
  const projectId = process.env.FIREBASE_PROJECT_ID || 'test-key-system';
  if (emulator && !projectId.startsWith('demo-')) throw new Error('Use a demo- project with the emulator');
  const app = initializeApp({ projectId, databaseURL: emulator ? `http://${emulator}?ns=${projectId}-default-rtdb` : process.env.FIREBASE_DATABASE_URL, ...(emulator ? {} : { credential: applicationDefault() }) });
  const db = getDatabase(app);
  return {
    db,
    async get(path) { return (await db.ref(path).get()).val(); },
    async set(path, value) { await db.ref(path).set(value); },
    async update(changes) { await db.ref().update(changes); },
    async transact(path, fn) {
      // Pin a value listener until completion. A one-shot get does not retain the
      // SDK cache, so an otherwise valid transaction may initially see null.
      const ref=db.ref(path), keep=()=>{};
      ref.on('value',keep);
      try {
        await ref.once('value');
        let error;
        const result = await ref.transaction(value => { error=undefined; try { return fn(value); } catch (e) { error = e; return undefined; } }, undefined, false);
        if (error) throw error;
        return { committed: result.committed, value: result.snapshot.val() };
      } finally {ref.off('value',keep);}
    },
    async subscribe(path, changed, removed) {
      const ref = db.ref(path);
      const onChange = snap => changed(snap.key, snap.val());
      const onRemove = snap => removed(snap.key);
      let rejectInitial;
      const failed = new Promise((_, reject) => { rejectInitial = reject; });
      const onError = error => { rejectInitial(error); console.error('Firebase subscription failed:', error.code); };
      ref.on('child_added', onChange, onError); ref.on('child_changed', onChange, onError); ref.on('child_removed', onRemove, onError);
      await Promise.race([ref.once('value'), failed]);
      return () => ref.off();
    }
  };
}
