/* ============================================================
   RudMart Online — Admin Panel Logic
   ============================================================ */

/* ---- State ---- */
const A = {
  currentTab: 'orders',
  orderFilter: 'all',
  orders: [],
  unsubOrders: null,
  currentOrder: null,

  adminProdCategory: 'all',
  adminProdSearch: '',
  adminProdLastDoc: null,
  adminProdList: [],

  editBarcode: null,
  editPeSwitches: { available: true, bestOffer: false },
  peImgFile: null,
  peImgBlob: null,

  importData: null,
  importFile: null,

  bannerImgFile: null,
  bannerImgDataUrl: null,

  appSettings: {},
};

const ADMIN_PROD_PAGE = 20;

/* ---- Helpers ---- */
function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

let toastTimer;
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  t.classList.remove('hide');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    t.classList.add('hide');
  }, duration);
}

function fmt(n) {
  if (!n && n !== 0) return '0';
  return Math.round(n).toLocaleString('ru-RU');
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openModal(name) {
  document.getElementById(`overlay-${name}`)?.classList.add('active');
  document.getElementById(`modal-${name}`)?.classList.add('active');
}
function closeModal(name) {
  document.getElementById(`overlay-${name}`)?.classList.remove('active');
  document.getElementById(`modal-${name}`)?.classList.remove('active');
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

/* ============================================================
   BOOT
   ============================================================ */
window.addEventListener('DOMContentLoaded', async () => {
  showLoading();
  initFirebase();

  // Bootstrap: create default admin if none exist
  try {
    const existing = await dbQuery('admins', [{ type: 'limit', n: 1 }]);
    if (!existing.length) {
      await dbSetFull('admins', 'admin', {
        login: 'admin',
        password: 'rudmart2024',
        createdAt: dbServerTimestamp(),
      });
      console.log('[Admin] Default admin created: admin / rudmart2024');
    }
  } catch (e) { console.warn('[Admin] Bootstrap check failed:', e.message); }

  const savedLogin = localStorage.getItem('rm_admin_login');
  if (savedLogin) {
    const admin = await dbGet('admins', savedLogin);
    if (admin) {
      hideLoading();
      enterAdmin(admin);
      return;
    }
  }
  hideLoading();
  showScreen('s-login');
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

/* ============================================================
   LOGIN / LOGOUT
   ============================================================ */
async function doLogin() {
  const login = document.getElementById('login-user').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!login || !pass) { showToast('Введите логин и пароль'); return; }

  showLoading();
  const admin = await dbGet('admins', login);
  hideLoading();

  if (!admin || admin.password !== pass) {
    showToast('Неверный логин или пароль');
    return;
  }
  localStorage.setItem('rm_admin_login', login);
  enterAdmin(admin);
}

function enterAdmin(admin) {
  showScreen('s-main');
  buildCategoryFilters();
  loadAppSettings();
  loadOrders();
  loadAdminProducts(true);
}

function doLogout() {
  localStorage.removeItem('rm_admin_login');
  if (A.unsubOrders) A.unsubOrders();
  showScreen('s-login');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

/* ============================================================
   TABS
   ============================================================ */
function switchTab(tab) {
  A.currentTab = tab;
  ['orders', 'shop', 'settings'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`ni-${t}`).classList.toggle('on', t === tab);
  });
  if (tab === 'settings') loadAppSettingsUI();
}

/* ============================================================
   ORDERS
   ============================================================ */
const STATUS_LABELS = {
  new:       { label: 'Новый',     cls: 'st-new' },
  accepted:  { label: 'Принят',    cls: 'st-accepted' },
  assembled: { label: 'Собран',    cls: 'st-assembled' },
  sent:      { label: 'Отправлен', cls: 'st-sent' },
  done:      { label: 'Выполнен',  cls: 'st-done' },
  cancelled: { label: 'Отменён',   cls: 'st-cancelled' },
};

function statusBadge(status) {
  const s = STATUS_LABELS[status] || { label: status, cls: '' };
  return `<span class="order-status ${s.cls}">${s.label}</span>`;
}

function loadOrders() {
  if (A.unsubOrders) A.unsubOrders();
  let constraints = [{ type: 'orderBy', field: 'createdAt', dir: 'desc' }];
  if (A.orderFilter !== 'all') {
    constraints = [
      { type: 'where', field: 'status', op: '==', value: A.orderFilter },
      { type: 'orderBy', field: 'createdAt', dir: 'desc' },
    ];
  }
  A.unsubOrders = dbListenQuery('orders', constraints, orders => {
    A.orders = orders;
    renderOrders();
    const newCount = orders.filter(o => o.status === 'new').length;
    const badge = document.getElementById('orders-badge');
    badge.textContent = newCount;
    badge.classList.toggle('hidden', newCount === 0);
  });
}

function refreshOrders() { loadOrders(); }

function setOrderFilter(filter) {
  A.orderFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c =>
    c.classList.toggle('active', c.id === `fchip-${filter}`)
  );
  loadOrders();
}

function renderOrders() {
  const list = document.getElementById('orders-list');
  if (!A.orders.length) {
    list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text2)">Заказов нет</div>`;
    return;
  }
  list.innerHTML = A.orders.map(o => {
    const itemsPreview = (o.items || []).slice(0, 2).map(i => i.name).join(', ');
    const more = (o.items?.length || 0) > 2 ? ` +${o.items.length - 2} позиций` : '';
    const addr = formatAddress(o.address);
    return `
      <div class="order-card" onclick="openOrderDetail('${o.id}')">
        <div class="order-card-hdr">
          <div>
            <div class="order-id">#${o.id.slice(-8)}</div>
            <div class="order-time">${fmtDate(o.createdAt)}</div>
          </div>
          ${statusBadge(o.status)}
        </div>
        <div class="order-card-body">
          <div class="order-client">👤 ${esc(o.userName || '—')} · ${esc(o.userPhone || '')}</div>
          <div class="order-addr">📍 ${esc(addr)}</div>
          <div class="order-total">${fmt(o.total)} ₸
            ${o.hasClubCard ? `<span style="font-size:11px;color:var(--r2);font-weight:600;margin-left:6px">по КК</span>` : ''}
          </div>
          <div class="order-items-preview">${esc(itemsPreview)}${more}</div>
        </div>
      </div>`;
  }).join('');
}

function openOrderDetail(orderId) {
  const order = A.orders.find(o => o.id === orderId);
  if (!order) return;
  A.currentOrder = order;

  document.getElementById('od-title').textContent = `Заказ #${orderId.slice(-8)}`;
  document.getElementById('od-time').textContent = fmtDate(order.createdAt);
  document.getElementById('od-status-badge').innerHTML = statusBadge(order.status);

  const addr = formatAddress(order.address);
  const delivPrice = order.deliveryPrice || 500;

  document.getElementById('od-body').innerHTML = `
    <div class="od-section">
      <div class="od-sec-title">Покупатель</div>
      <div style="font-size:14px;font-weight:700">${esc(order.userName || '—')}</div>
      <div style="font-size:13px;color:var(--text2);margin-top:3px">
        📱 ${esc(order.userPhone || '—')}
        <a href="tel:${esc(order.userPhone)}" style="color:var(--r2);text-decoration:none;margin-left:8px">Позвонить</a>
      </div>
    </div>
    <div class="od-section">
      <div class="od-sec-title">Адрес доставки</div>
      <div style="font-size:13px">${esc(addr)}</div>
      ${order.address?.intercom ? `<div style="font-size:12px;color:var(--text2);margin-top:3px">🔔 Есть домофон</div>` : ''}
    </div>
    <div class="od-section">
      <div class="od-sec-title">Состав заказа (${(order.items||[]).length} позиций)</div>
      <div id="od-items-list">
        ${(order.items || []).map((item, idx) => `
          <div class="od-item-row" id="od-item-${idx}">
            <span class="od-item-name">${esc(item.name)}</span>
            <span class="od-item-qty" id="od-iq-${idx}">×${item.qty}</span>
            <span class="od-item-price" id="od-ip-${idx}">${fmt(item.total)} ₸</span>
            <div class="od-item-actions">
              <button class="btn btn-ghost btn-sm" style="padding:4px 8px"
                onclick="event.stopPropagation();editOrderItem(${idx})">✎</button>
              <button class="btn btn-danger btn-sm" style="padding:4px 8px"
                onclick="event.stopPropagation();removeOrderItem(${idx})">✕</button>
            </div>
          </div>`).join('')}
      </div>
    </div>
    <div class="od-section">
      <div class="od-sec-title">Итого</div>
      <div style="display:flex;flex-direction:column;gap:4px;font-size:13px">
        <div style="display:flex;justify-content:space-between;color:var(--text2)">
          <span>Товары</span><span>${fmt(order.sum)} ₸</span>
        </div>
        ${order.hasClubCard && order.saved > 0 ? `
          <div style="display:flex;justify-content:space-between;color:var(--r2)">
            <span>По клубной карте</span><span>${fmt(order.clubSum)} ₸</span>
          </div>
          <div style="display:flex;justify-content:space-between;color:var(--green)">
            <span>Скидка КК</span><span>−${fmt(order.saved)} ₸</span>
          </div>` : ''}
        <div style="display:flex;justify-content:space-between;color:var(--text2)">
          <span>Доставка</span><span>${fmt(delivPrice)} ₸</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;
          border-top:1px solid var(--border);padding-top:6px;margin-top:2px">
          <span>Итого</span><span>${fmt(order.total)} ₸</span>
        </div>
      </div>
    </div>
    <div class="od-section">
      <div class="od-sec-title">Оплата</div>
      <div style="font-size:13px">
        ${order.paymentType === 'cash'
          ? `💵 Наличные${order.cashFrom ? ` (сдача с ${fmt(order.cashFrom)} ₸)` : ''}`
          : `💳 Карта${order.bank ? ` — ${order.bank}` : ''}`}
      </div>
    </div>
    ${order.comment ? `
      <div class="od-section">
        <div class="od-sec-title">Комментарий</div>
        <div style="font-size:13px">${esc(order.comment)}</div>
      </div>` : ''}
  `;

  renderOrderFooter(order);
  openModal('order');
}

function renderOrderFooter(order) {
  const footer = document.getElementById('od-footer');
  const actions = [];
  if (order.status === 'new') {
    actions.push(`<button class="btn btn-success" style="flex:1" onclick="setOrderStatus('accepted')">✓ Принять заказ</button>`);
    actions.push(`<button class="btn btn-danger btn-sm" style="padding:0 14px" onclick="setOrderStatus('cancelled')">Отменить</button>`);
  } else if (order.status === 'accepted') {
    actions.push(`<button class="btn btn-warning" style="flex:1" onclick="setOrderStatus('assembled')">Заказ собран</button>`);
  } else if (order.status === 'assembled') {
    actions.push(`<button class="btn btn-red" style="flex:1" onclick="setOrderStatus('sent')">Отправлен курьером</button>`);
  } else if (order.status === 'sent') {
    actions.push(`<button class="btn btn-success" style="flex:1" onclick="setOrderStatus('done')">Доставлен ✓</button>`);
  }
  footer.innerHTML = actions.join('');
}

async function setOrderStatus(status) {
  if (!A.currentOrder) return;
  await dbSet('orders', A.currentOrder.id, { status });
  A.currentOrder.status = status;
  document.getElementById('od-status-badge').innerHTML = statusBadge(status);
  renderOrderFooter(A.currentOrder);
  showToast('Статус обновлён');
}

function editOrderItem(idx) {
  const item = A.currentOrder?.items?.[idx];
  if (!item) return;
  const newQty = prompt(`Количество "${item.name}":`, item.qty);
  if (!newQty || isNaN(newQty) || parseInt(newQty) < 1) return;
  A.currentOrder.items[idx].qty = parseInt(newQty);
  A.currentOrder.items[idx].total = A.currentOrder.items[idx].price * parseInt(newQty);
  document.getElementById(`od-iq-${idx}`).textContent = `×${newQty}`;
  document.getElementById(`od-ip-${idx}`).textContent = `${fmt(A.currentOrder.items[idx].total)} ₸`;
  saveOrderItems();
}

function removeOrderItem(idx) {
  if (!A.currentOrder?.items) return;
  const name = A.currentOrder.items[idx].name;
  if (!confirm(`Удалить "${name}" из заказа?`)) return;
  A.currentOrder.items.splice(idx, 1);
  saveOrderItems();
  openOrderDetail(A.currentOrder.id);
}

async function saveOrderItems() {
  if (!A.currentOrder) return;
  const items = A.currentOrder.items;
  const sum = items.reduce((s, i) => s + (i.total || 0), 0);
  await dbSet('orders', A.currentOrder.id, { items, sum, total: sum });
  showToast('Заказ обновлён');
}

function closeOrderDetail() { closeModal('order'); A.currentOrder = null; }

/* ============================================================
   ADMIN PRODUCTS
   ============================================================ */
function buildCategoryFilters() {
  const filter = document.getElementById('admin-cat-filter');
  filter.innerHTML =
    `<button class="cat-chip active" id="acat-all" onclick="setAdminCat('all')">Все</button>` +
    CATEGORIES.map(c =>
      `<button class="cat-chip" id="acat-${c.id}" onclick="setAdminCat('${c.id}')">${c.icon} ${c.name}</button>`
    ).join('');

  const importSel = document.getElementById('import-category');
  importSel.innerHTML = CATEGORIES.map(c =>
    `<option value="${c.id}">${c.name}</option>`
  ).join('');

  const peSel = document.getElementById('pe-category');
  peSel.innerHTML = `<option value="">— Выбрать категорию —</option>` +
    CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
}

function setAdminCat(catId) {
  A.adminProdCategory = catId;
  document.querySelectorAll('.cat-chip').forEach(c =>
    c.classList.toggle('active', c.id === `acat-${catId}`)
  );
  loadAdminProducts(true);
}

let adminSearchTimer;
function onAdminSearch(val) {
  A.adminProdSearch = val.trim().toLowerCase();
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => loadAdminProducts(true), 350);
}

async function loadAdminProducts(reset = false) {
  if (reset) {
    A.adminProdLastDoc = null;
    A.adminProdList = [];
    document.getElementById('admin-prod-grid').innerHTML = renderAdminSkeletons(6);
  }

  try {
    let q = db.collection('products');

    if (A.adminProdSearch) {
      q = q.where('nameSearch', '>=', A.adminProdSearch)
           .where('nameSearch', '<=', A.adminProdSearch + '\uf8ff')
           .orderBy('nameSearch').limit(ADMIN_PROD_PAGE);
    } else if (A.adminProdCategory !== 'all') {
      q = q.where('category', '==', A.adminProdCategory)
           .orderBy('nameSearch').limit(ADMIN_PROD_PAGE);
    } else {
      q = q.orderBy('nameSearch').limit(ADMIN_PROD_PAGE);
    }

    if (A.adminProdLastDoc && !reset) q = q.startAfter(A.adminProdLastDoc);

    const snap = await q.get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (snap.docs.length === ADMIN_PROD_PAGE) {
      A.adminProdLastDoc = snap.docs[snap.docs.length - 1];
      document.getElementById('admin-load-more').style.display = 'block';
    } else {
      A.adminProdLastDoc = null;
      document.getElementById('admin-load-more').style.display = 'none';
    }

    if (reset) A.adminProdList = products;
    else A.adminProdList.push(...products);

    renderAdminProducts();
  } catch (e) {
    console.warn('Admin products error:', e);
    document.getElementById('admin-prod-grid').innerHTML =
      `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text2)">Ошибка загрузки</div>`;
  }
}

function loadMoreAdminProducts() { loadAdminProducts(false); }

function renderAdminProducts() {
  const grid = document.getElementById('admin-prod-grid');
  if (!A.adminProdList.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text2)">Товаров не найдено</div>`;
    return;
  }
  grid.innerHTML = A.adminProdList.map(p => `
    <div class="admin-prod-card">
      <div class="apc-img">
        ${p.imageUrl
          ? `<img src="${p.imageUrl}" alt="${esc(p.name)}" loading="lazy">`
          : `<div class="apc-img-ph">📦</div>`}
      </div>
      <div class="apc-body">
        <div class="apc-name">${esc(p.name)}</div>
        <div class="apc-price">${fmt(p.price)} ₸</div>
        ${p.clubPrice ? `<div class="apc-club">КК: ${fmt(p.clubPrice)} ₸</div>` : ''}
        <div class="apc-avail ${p.isAvailable ? 'text-green' : 'text-red'}">
          ${p.isAvailable ? '● В наличии' : '● Нет'}
        </div>
        <button class="apc-edit-btn" onclick="openProdEdit('${p.id}')">✎ Редактировать</button>
      </div>
    </div>`).join('');
}

function renderAdminSkeletons(n) {
  return Array.from({length: n}).map(() => `
    <div style="background:var(--card);border-radius:var(--rad);border:1px solid var(--border);overflow:hidden">
      <div class="skel" style="height:90px"></div>
      <div style="padding:10px">
        <div class="skel" style="height:12px;margin-bottom:6px;width:80%"></div>
        <div class="skel" style="height:10px;width:50%"></div>
      </div>
    </div>`).join('');
}

/* ============================================================
   PRODUCT EDIT
   ============================================================ */
async function openProdEdit(barcode) {
  A.editBarcode = barcode;
  A.peImgFile = null;
  A.peImgBlob = null;
  A.editPeSwitches = { available: true, bestOffer: false };

  const p = await dbGet('products', barcode);
  if (!p) { showToast('Товар не найден'); return; }

  const preview = document.getElementById('pe-img-preview');
  const ico = document.getElementById('pe-img-ico');
  const lbl = document.getElementById('pe-img-label');
  if (p.imageUrl) {
    preview.src = p.imageUrl;
    preview.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    ico.style.display = 'none';
    lbl.style.display = 'none';
  } else {
    preview.style.display = 'none';
    ico.style.display = 'block';
    lbl.style.display = 'block';
  }

  document.getElementById('pe-name').value       = p.name || '';
  document.getElementById('pe-category').value   = p.category || '';
  document.getElementById('pe-price').value      = p.price || '';
  document.getElementById('pe-club-price').value = p.clubPrice || '';

  A.editPeSwitches.available = !!p.isAvailable;
  A.editPeSwitches.bestOffer = !!p.isBestOffer;
  document.getElementById('pe-available-sw').classList.toggle('on', A.editPeSwitches.available);
  document.getElementById('pe-bestOffer-sw').classList.toggle('on', A.editPeSwitches.bestOffer);

  const ch = p.characteristics || {};
  document.getElementById('pe-brand').value     = ch.brand || '';
  document.getElementById('pe-volume').value    = ch.volume || '';
  document.getElementById('pe-weight').value    = ch.weight || '';
  document.getElementById('pe-fat').value       = ch.fatContent || '';
  document.getElementById('pe-strength').value  = ch.strength || '';
  document.getElementById('pe-carbonated').value = ch.carbonated != null ? String(ch.carbonated) : '';
  document.getElementById('pe-proteins').value  = ch.proteins || '';
  document.getElementById('pe-fats').value      = ch.fats || '';
  document.getElementById('pe-carbs').value     = ch.carbs || '';

  openModal('prod-edit');
}

function closeProdEdit() { closeModal('prod-edit'); }

function togglePeSw(key) {
  A.editPeSwitches[key] = !A.editPeSwitches[key];
  document.getElementById(`pe-${key}-sw`).classList.toggle('on', A.editPeSwitches[key]);
}

function onPeImgSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  A.peImgFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    A.peImgBlob = e.target.result;
    const preview = document.getElementById('pe-img-preview');
    preview.src = e.target.result;
    preview.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    document.getElementById('pe-img-ico').style.display = 'none';
    document.getElementById('pe-img-label').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function saveProdEdit() {
  if (!A.editBarcode) return;
  const btn = document.querySelector('#modal-prod-edit .btn-red');
  btn.disabled = true;
  btn.textContent = 'Сохранение...';

  let imageUrl = undefined;
  if (A.peImgFile) {
    try {
      const storage = firebase.storage();
      const ref = storage.ref(`products/${A.editBarcode}.jpg`);
      await ref.put(A.peImgFile);
      imageUrl = await ref.getDownloadURL();
    } catch (e) {
      showToast('Ошибка загрузки фото: ' + e.message);
    }
  }

  const numVal = id => {
    const v = document.getElementById(id).value;
    return v !== '' ? parseFloat(v) : null;
  };

  const data = {
    name:        document.getElementById('pe-name').value.trim(),
    nameSearch:  document.getElementById('pe-name').value.trim().toLowerCase(),
    category:    document.getElementById('pe-category').value || 'other',
    price:       numVal('pe-price'),
    clubPrice:   numVal('pe-club-price'),
    isAvailable: A.editPeSwitches.available,
    isBestOffer: A.editPeSwitches.bestOffer,
    characteristics: {
      brand:      document.getElementById('pe-brand').value.trim() || null,
      volume:     numVal('pe-volume'),
      weight:     numVal('pe-weight'),
      fatContent: numVal('pe-fat'),
      strength:   numVal('pe-strength'),
      carbonated: document.getElementById('pe-carbonated').value === ''
        ? null
        : document.getElementById('pe-carbonated').value === 'true',
      proteins:   numVal('pe-proteins'),
      fats:       numVal('pe-fats'),
      carbs:      numVal('pe-carbs'),
    },
  };
  if (imageUrl !== undefined) data.imageUrl = imageUrl;

  await dbSet('products', A.editBarcode, data);
  const idx = A.adminProdList.findIndex(p => p.id === A.editBarcode);
  if (idx >= 0) A.adminProdList[idx] = { ...A.adminProdList[idx], ...data };
  renderAdminProducts();

  closeProdEdit();
  showToast('Товар обновлён');
  btn.disabled = false;
  btn.textContent = 'Сохранить изменения';
}

/* ============================================================
   XLSX IMPORT
   ============================================================ */
function openImport() {
  A.importData = null;
  A.importFile = null;
  document.getElementById('import-drop-label').textContent = 'Нажмите или перетащите .xlsx файл';
  document.getElementById('import-progress').style.display = 'none';
  document.getElementById('import-log').textContent = '';
  document.getElementById('btn-start-import').disabled = true;
  document.getElementById('import-file').value = '';
  openModal('import');
}

function closeImport() { closeModal('import'); }

function onImportDrop(e) {
  e.preventDefault();
  document.getElementById('import-drop').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processImportFile(file);
}

function onImportFileSelect(e) {
  const file = e.target.files[0];
  if (file) processImportFile(file);
}

function processImportFile(file) {
  A.importFile = file;
  document.getElementById('import-drop-label').textContent = `Загрузка: ${file.name}...`;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const products = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r[0]) continue;
        products.push({
          barcode:    String(r[0]).trim(),
          name:       String(r[1] || '').trim(),
          code:       String(r[2] || '').trim(),
          price:      parseFloat(r[3]) || 0,
          clubPrice:  parseFloat(r[4]) || 0,
          promoPrice: parseFloat(r[5]) || 0,
          promoStart: r[6],
          promoEnd:   r[7],
          stock:      parseFloat(r[9]) || 0,
        });
      }
      A.importData = products;
      document.getElementById('import-drop-label').textContent =
        `${file.name} — найдено ${products.length} товаров`;
      document.getElementById('btn-start-import').disabled = false;
    } catch (err) {
      showToast('Ошибка чтения файла: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function importLog(msg) {
  const log = document.getElementById('import-log');
  log.textContent += msg + '\n';
  log.scrollTop = log.scrollHeight;
}

function setImportProgress(pct, statusText) {
  document.getElementById('import-progress-bar').style.width = pct + '%';
  document.getElementById('import-pct').textContent = Math.round(pct) + '%';
  if (statusText) document.getElementById('import-status-text').textContent = statusText;
}

function parseDateFromXlsx(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    } catch (e) {}
  }
  return String(val).trim() || null;
}

async function startImport() {
  if (!A.importData?.length) return;

  const defaultCategory = document.getElementById('import-category').value || 'other';
  const products = A.importData;
  const total = products.length;

  document.getElementById('import-progress').style.display = 'block';
  document.getElementById('btn-start-import').disabled = true;
  document.getElementById('import-log').textContent = '';
  setImportProgress(0, 'Загрузка индекса...');

  importLog(`Импорт: ${total} товаров`);
  importLog(`Категория для новых: ${defaultCategory}`);

  // Load existing barcode index (one doc read)
  let existingBarcodes = new Set();
  try {
    const meta = await dbGet('meta', 'barcodeIndex');
    if (meta?.list) existingBarcodes = new Set(meta.list);
    importLog(`Существующих штрих-кодов: ${existingBarcodes.size}`);
  } catch (e) {
    importLog(`Предупреждение: ${e.message}`);
  }

  const BATCH_SIZE = 400;
  let processed = 0, created = 0, updated = 0, errors = 0;
  const newBarcodes = [];

  for (let start = 0; start < total; start += BATCH_SIZE) {
    const chunk = products.slice(start, start + BATCH_SIZE);
    const batch = dbBatch();

    for (const p of chunk) {
      if (!p.barcode) continue;
      const isNew = !existingBarcodes.has(p.barcode);
      const isAvailable = p.stock > 0;
      const promoStart = parseDateFromXlsx(p.promoStart);
      const promoEnd   = parseDateFromXlsx(p.promoEnd);

      if (isNew) {
        dbBatchSet(batch, 'products', p.barcode, {
          barcode:    p.barcode,
          name:       p.name,
          nameSearch: p.name.toLowerCase(),
          code:       p.code,
          price:      p.price,
          clubPrice:  p.clubPrice || null,
          promoPrice: p.promoPrice || null,
          promoStart: promoStart,
          promoEnd:   promoEnd,
          stock:      p.stock,
          isAvailable,
          category:   defaultCategory,
          isBestOffer: false,
          imageUrl:   null,
          characteristics: {},
        }, false); // overwrite = full set for new
        newBarcodes.push(p.barcode);
        created++;
      } else {
        // Existing: update only price/stock/promo — do NOT overwrite category/characteristics/image
        dbBatchSet(batch, 'products', p.barcode, {
          name:       p.name,
          nameSearch: p.name.toLowerCase(),
          price:      p.price,
          clubPrice:  p.clubPrice || null,
          promoPrice: p.promoPrice || null,
          promoStart: promoStart,
          promoEnd:   promoEnd,
          stock:      p.stock,
          isAvailable,
        }, true); // merge = keep category/chars/image
        updated++;
      }
    }

    try {
      await batch.commit();
    } catch (e) {
      errors++;
      importLog(`Ошибка батча: ${e.message}`);
    }

    processed += chunk.length;
    setImportProgress((processed / total) * 90, `Обработано ${processed} / ${total}`);
  }

  // Update barcode index
  if (newBarcodes.length > 0) {
    importLog(`Обновление индекса (+${newBarcodes.length})...`);
    try {
      const allBarcodes = [...existingBarcodes, ...newBarcodes];
      await dbSet('meta', 'barcodeIndex', { list: allBarcodes });
    } catch (e) {
      importLog(`Предупреждение: не удалось обновить индекс`);
    }
  }

  setImportProgress(100, 'Готово!');
  importLog(`\n✓ Импорт завершён!`);
  importLog(`  Создано новых: ${created}`);
  importLog(`  Обновлено: ${updated}`);
  if (errors) importLog(`  Ошибок: ${errors}`);

  showToast(`Импорт: +${created} новых, обновлено ${updated}`);
  document.getElementById('btn-start-import').disabled = false;
  loadAdminProducts(true);
}

/* ============================================================
   EXPORT
   ============================================================ */
async function exportProducts() {
  showToast('Подготовка экспорта...');
  const rows = [['Штрих-код','Наименование','Код','Цена','Цена КК','Акц.цена','Акция нач.','Акция кон.','Остаток','Категория','В наличии']];
  let lastDoc = null;
  let total = 0;
  while (true) {
    let q = db.collection('products').orderBy('nameSearch').limit(500);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach(d => {
      const p = d.data();
      rows.push([d.id, p.name||'', p.code||'', p.price||0, p.clubPrice||0, p.promoPrice||0,
        p.promoStart||'', p.promoEnd||'', p.stock||0, p.category||'', p.isAvailable?'Да':'Нет']);
      total++;
    });
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < 500) break;
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.writeFile(wb, `RudMart_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast(`Экспортировано: ${total} товаров`);
}

/* ============================================================
   BANNERS
   ============================================================ */
async function openBannerEditor() {
  const banners = await dbQuery('banners', [{ type: 'orderBy', field: 'order', dir: 'asc' }]);
  const list = document.getElementById('banners-editor-list');
  list.innerHTML = banners.length
    ? banners.map(b => `
        <div class="banner-item">
          <div class="banner-item-preview">
            ${b.imageUrl
              ? `<img src="${b.imageUrl}">`
              : `<div style="width:100%;height:100%;background:${b.bgColor||'#A60000'}"></div>`}
          </div>
          <div class="banner-item-info">
            <div class="banner-item-title">Баннер #${b.id.slice(-4)}</div>
            <div class="banner-item-status ${b.isActive ? 'text-green' : 'text-muted'}">${b.isActive ? '● Активен' : '○ Скрыт'}</div>
          </div>
          <div class="banner-actions">
            <button class="btn btn-ghost btn-sm" onclick="toggleBanner('${b.id}',${!b.isActive})">
              ${b.isActive ? 'Скрыть' : 'Показать'}
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteBanner('${b.id}')">✕</button>
          </div>
        </div>`).join('')
    : `<div style="text-align:center;padding:40px;color:var(--text2)">Баннеров нет</div>`;
  openModal('banners');
}

function closeBannerEditor() { closeModal('banners'); }

async function toggleBanner(bannerId, isActive) {
  await dbSet('banners', bannerId, { isActive });
  openBannerEditor();
}

async function deleteBanner(bannerId) {
  if (!confirm('Удалить баннер?')) return;
  await dbDelete('banners', bannerId);
  openBannerEditor();
}

function addBanner() {
  A.bannerImgFile = null;
  A.bannerImgDataUrl = null;
  document.getElementById('banner-img-preview').style.display = 'none';
  document.getElementById('banner-img-ico').style.display = 'block';
  document.getElementById('banner-img-file').value = '';
  closeModal('banners');
  openModal('add-banner');
}

function closeAddBanner() { closeModal('add-banner'); openBannerEditor(); }

function onBannerImgSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  A.bannerImgFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    A.bannerImgDataUrl = ev.target.result;
    const preview = document.getElementById('banner-img-preview');
    preview.src = ev.target.result;
    preview.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    document.getElementById('banner-img-ico').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function saveBanner() {
  const btn = document.querySelector('#modal-add-banner .btn-red');
  btn.disabled = true;
  btn.textContent = 'Сохранение...';

  let imageUrl = null;
  if (A.bannerImgFile && firebase.storage) {
    try {
      const storage = firebase.storage();
      const ref = storage.ref(`banners/banner_${Date.now()}.jpg`);
      await ref.put(A.bannerImgFile);
      imageUrl = await ref.getDownloadURL();
    } catch (e) { console.warn('Banner upload:', e); }
  }

  const bgColor = document.getElementById('banner-bg-color').value;
  const existingBanners = await dbQuery('banners', [
    { type: 'orderBy', field: 'order', dir: 'desc' }, { type: 'limit', n: 1 }
  ]);
  const maxOrder = existingBanners.length ? (existingBanners[0].order || 0) + 1 : 0;
  const bannerId = 'banner_' + Date.now();

  await dbSetFull('banners', bannerId, {
    imageUrl, bgColor, isActive: true, order: maxOrder,
    createdAt: dbServerTimestamp(),
  });

  btn.disabled = false;
  btn.textContent = 'Сохранить баннер';
  closeAddBanner();
  showToast('Баннер добавлен');
}

/* ============================================================
   APP SETTINGS
   ============================================================ */
async function loadAppSettings() {
  const s = await dbGet('settings', 'app');
  A.appSettings = s || {};
}

function loadAppSettingsUI() {
  document.getElementById('set-delivery').value  = A.appSettings.deliveryPrice || 500;
  document.getElementById('set-offer-url').value = A.appSettings.offerUrl || '';
}

async function saveAppSettings() {
  const deliveryPrice = parseInt(document.getElementById('set-delivery').value) || 500;
  const offerUrl = document.getElementById('set-offer-url').value.trim();
  A.appSettings = { ...A.appSettings, deliveryPrice, offerUrl };
  await dbSet('settings', 'app', A.appSettings);
  showToast('Настройки сохранены');
}

async function addAdmin() {
  const login = document.getElementById('new-admin-login').value.trim();
  const pass  = document.getElementById('new-admin-pass').value;
  if (!login || !pass) { showToast('Заполните логин и пароль'); return; }
  await dbSet('admins', login, { login, password: pass, createdAt: dbServerTimestamp() });
  document.getElementById('new-admin-login').value = '';
  document.getElementById('new-admin-pass').value = '';
  showToast(`Администратор "${login}" добавлен`);
}

/* ============================================================
   UTILITIES
   ============================================================ */
function formatAddress(addr) {
  if (!addr) return '—';
  const parts = [
    addr.street ? `ул. ${addr.street}` : '',
    addr.house  ? `д. ${addr.house}`   : '',
    addr.apt    ? `кв. ${addr.apt}`    : '',
  ].filter(Boolean);
  return parts.join(', ') || '—';
}
