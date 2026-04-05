/* ============================================================
   RudMart Online — Firebase DB helpers
   ============================================================ */

let db = null;
let isReady = false;

function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    isReady = true;
    firebase.auth().signInAnonymously().catch(() => {});
  } catch (e) {
    console.error('[DB] init error:', e);
    isReady = false;
  }
}

/* ---- Write (merge) ---- */
async function dbSet(col, docId, data) {
  if (!isReady) return;
  try {
    await db.collection(col).doc(String(docId)).set(
      { ...data, _updAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (e) { console.warn('[DB] set:', e.message); }
}

/* ---- Write (overwrite) ---- */
async function dbSetFull(col, docId, data) {
  if (!isReady) return;
  try {
    await db.collection(col).doc(String(docId)).set(
      { ...data, _updAt: firebase.firestore.FieldValue.serverTimestamp() }
    );
  } catch (e) { console.warn('[DB] setFull:', e.message); }
}

/* ---- Read one ---- */
async function dbGet(col, docId) {
  if (!isReady) return null;
  try {
    const snap = await db.collection(col).doc(String(docId)).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  } catch (e) { console.warn('[DB] get:', e.message); return null; }
}

/* ---- Delete ---- */
async function dbDelete(col, docId) {
  if (!isReady) return;
  try { await db.collection(col).doc(String(docId)).delete(); }
  catch (e) { console.warn('[DB] delete:', e.message); }
}

/* ---- Query with chained constraints ----
   Each constraint: { type:'where'|'orderBy'|'limit'|'startAfter', ... }
*/
async function dbQuery(col, constraints = []) {
  if (!isReady) return [];
  try {
    let q = db.collection(col);
    for (const c of constraints) {
      if (c.type === 'where')      q = q.where(c.field, c.op, c.value);
      else if (c.type === 'orderBy') q = q.orderBy(c.field, c.dir || 'asc');
      else if (c.type === 'limit')   q = q.limit(c.n);
      else if (c.type === 'startAfter') q = q.startAfter(c.doc);
    }
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('[DB] query:', e.message); return []; }
}

/* ---- Real-time listener on a single doc ---- */
function dbListen(col, docId, cb) {
  if (!isReady) return () => {};
  return db.collection(col).doc(String(docId)).onSnapshot(
    snap => cb(snap.exists ? { id: snap.id, ...snap.data() } : null),
    e => console.warn('[DB] listen:', e.message)
  );
}

/* ---- Real-time listener on a query ---- */
function dbListenQuery(col, constraints, cb) {
  if (!isReady) return () => {};
  let q = db.collection(col);
  for (const c of constraints) {
    if (c.type === 'where')       q = q.where(c.field, c.op, c.value);
    else if (c.type === 'orderBy') q = q.orderBy(c.field, c.dir || 'asc');
    else if (c.type === 'limit')   q = q.limit(c.n);
  }
  return q.onSnapshot(
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => console.warn('[DB] listenQuery:', e.message)
  );
}

/* ---- Batch helpers ---- */
function dbBatch() { return db.batch(); }

function dbBatchSet(batch, col, docId, data, merge = true) {
  const ref = db.collection(col).doc(String(docId));
  merge ? batch.set(ref, { ...data }, { merge: true }) : batch.set(ref, { ...data });
}

function dbBatchUpdate(batch, col, docId, data) {
  db.collection(col).doc(String(docId));
  batch.update(db.collection(col).doc(String(docId)), { ...data });
}

/* ---- Paginated getAll doc IDs (for large collections) ---- */
async function dbGetAllIds(col, pageSize = 500) {
  const ids = [];
  let lastDoc = null;
  while (true) {
    let q = db.collection(col).orderBy(firebase.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach(d => ids.push(d.id));
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }
  return ids;
}

function dbServerTimestamp() {
  return firebase.firestore.FieldValue.serverTimestamp();
}

function dbArrayUnion(...items) {
  return firebase.firestore.FieldValue.arrayUnion(...items);
}

function dbArrayRemove(...items) {
  return firebase.firestore.FieldValue.arrayRemove(...items);
}
