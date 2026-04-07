/* ============================================================
   RudMart — Firebase Firestore helpers + localStorage fallback
   ============================================================ */

let db   = null;
let stor = null;
let isFirebaseReady = false;
const LS_PREFIX = 'rm_';

function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db   = firebase.firestore();
    stor = firebase.storage();
    db.enablePersistence({ synchronizeTabs: true }).catch(e => {
      if (e.code !== 'failed-precondition' && e.code !== 'unimplemented')
        console.warn('[DB] Persistence:', e.code);
    });
    isFirebaseReady = true;
    firebase.auth().signInAnonymously()
      .then(() => console.log('[DB] Auth OK'))
      .catch(e => console.warn('[DB] Auth warn:', e.message));
  } catch (e) {
    console.error('[DB] Init error:', e);
    isFirebaseReady = false;
  }
}

/* ---- Write (merge) ---- */
async function dbSet(col, docId, data) {
  const payload = { ...data, _updatedAt: new Date().toISOString() };
  try { localStorage.setItem(LS_PREFIX + col + '_' + docId, JSON.stringify(payload)); } catch (_) {}
  if (!isFirebaseReady) return;
  try {
    await db.collection(col).doc(String(docId)).set(payload, { merge: true });
  } catch (e) { console.warn('[DB] write:', e.message); }
}

/* ---- Delete ---- */
async function dbDelete(col, docId) {
  try { localStorage.removeItem(LS_PREFIX + col + '_' + docId); } catch (_) {}
  if (!isFirebaseReady) return;
  try { await db.collection(col).doc(String(docId)).delete(); } catch (e) { console.warn('[DB] delete:', e.message); }
}

/* ---- Read one ---- */
async function dbGet(col, docId) {
  if (isFirebaseReady) {
    try {
      const snap = await db.collection(col).doc(String(docId)).get();
      if (snap.exists) {
        const data = snap.data();
        try { localStorage.setItem(LS_PREFIX + col + '_' + docId, JSON.stringify(data)); } catch (_) {}
        return data;
      }
    } catch (e) { console.warn('[DB] read:', e.message); }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + col + '_' + docId);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

/* ---- Simple query ---- */
async function dbQuery(col, field, op, value, lim) {
  if (isFirebaseReady) {
    try {
      let ref = db.collection(col).where(field, op, value);
      if (lim) ref = ref.limit(lim);
      const snap = await ref.get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn('[DB] query:', e.message); }
  }
  return [];
}

/* ---- Paginated query ---- */
async function dbQueryPage(col, constraints, lim, afterDoc) {
  if (!isFirebaseReady) return { docs: [], last: null };
  try {
    let ref = db.collection(col);
    for (const [f, op, v] of constraints) ref = ref.where(f, op, v);
    ref = ref.limit(lim);
    if (afterDoc) ref = ref.startAfter(afterDoc);
    const snap = await ref.get();
    return {
      docs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      last: snap.docs[snap.docs.length - 1] || null,
    };
  } catch (e) {
    console.warn('[DB] queryPage:', e.message);
    return { docs: [], last: null };
  }
}

/* ---- Search by nameLower prefix ---- */
async function dbSearchProducts(q, lim = SEARCH_LIMIT) {
  if (!isFirebaseReady) return [];
  const low = q.toLowerCase().trim();
  if (low.length < 2) return [];
  try {
    const snap = await db.collection('products')
      .where('nameLower', '>=', low)
      .where('nameLower', '<=', low + '\uf8ff')
      .limit(lim)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[DB] search:', e.message);
    return [];
  }
}

/* ---- Real-time collection listener ---- */
function onColSnapshot(col, constraints, cb) {
  if (!isFirebaseReady) return () => {};
  try {
    let ref = db.collection(col);
    for (const [f, op, v] of constraints) ref = ref.where(f, op, v);
    ref = ref.orderBy('createdAt', 'desc');
    return ref.onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => console.warn('[DB] snapshot:', e));
  } catch (e) { return () => {}; }
}

/* ---- Real-time doc listener ---- */
function onDocSnapshot(col, docId, cb) {
  if (!isFirebaseReady) return () => {};
  try {
    return db.collection(col).doc(String(docId)).onSnapshot(
      snap => { if (snap.exists) cb({ id: snap.id, ...snap.data() }); },
      e => console.warn('[DB] docSnap:', e));
  } catch (_) { return () => {}; }
}

/* ---- Batch write (for XLSX import) ---- */
async function dbBatchSet(col, items, progressCb) {
  if (!isFirebaseReady) return 0;
  const CHUNK = 400;
  let total = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = db.batch();
    const chunk = items.slice(i, i + CHUNK);
    for (const { id, data } of chunk) {
      const ref = db.collection(col).doc(String(id));
      batch.set(ref, { ...data, _updatedAt: new Date().toISOString() }, { merge: true });
    }
    await batch.commit();
    total += chunk.length;
    if (progressCb) progressCb(total, items.length);
  }
  return total;
}

/* ---- Upload image to Firebase Storage ---- */
async function uploadImage(path, file, progressCb) {
  if (!stor) throw new Error('Storage not ready');
  const ref = stor.ref(path);
  const task = ref.put(file);
  return new Promise((resolve, reject) => {
    task.on('state_changed',
      snap => { if (progressCb) progressCb(snap.bytesTransferred / snap.totalBytes); },
      reject,
      async () => { resolve(await task.snapshot.ref.getDownloadURL()); }
    );
  });
}
