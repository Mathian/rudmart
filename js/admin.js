/* ============================================================
   RudMart Admin Panel — Application Logic
   ============================================================ */

/* ---- Admin state ---- */
let ADMIN = {
  loggedIn:       false,
  currentTab:     'orders',
  ordersFilter:   'all',
  ordersUnsub:    null,
  allOrders:      [],
  currentOrder:   null,
  editingProduct: null,
  prodPageLast:   null,
  adminCatFilter: 'all',
  adminSearch:    '',
  pendingCount:   0,
};

/* ================================================================
   INIT
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  if (tg) { tg.ready(); tg.expand(); tg.BackButton.onClick(adminHandleBack); }
  initFirebase();
  replaceScreen('s-login');

  // Check saved session
  if (localStorage.getItem('rm_admin_logged') === '1') {
    enterAdmin();
  }
});

function adminHandleBack() {
  const slide = document.querySelector('#s-order-detail.active, #s-edit-product.active');
  if (slide) {
    slide.classList.remove('active');
    document.getElementById('s-main').classList.add('active');
    if (tg) tg.BackButton.hide();
  }
}

/* ================================================================
   LOGIN
   ================================================================ */
async function adminLogin() {
  const pwd = (document.getElementById('login-pwd')?.value || '').trim();
  if (!pwd) { showToast('Введите пароль', 'err'); return; }

  showLoading();
  try {
    await firebase.auth().signInAnonymously();
    const settings = await dbGet('settings', 'admin');
    const savedPwd = settings?.adminPassword || 'admin';

    if (pwd !== savedPwd) {
      hideLoading();
      showToast('Неверный пароль', 'err');
      return;
    }
    hideLoading();
    localStorage.setItem('rm_admin_logged', '1');
    enterAdmin();
  } catch (e) {
    hideLoading();
    showToast('Ошибка подключения', 'err');
  }
}

function enterAdmin() {
  ADMIN.loggedIn = true;
  replaceScreen('s-main');
  switchAdminTab('orders');
  subscribeOrders();
}

function adminLogout() {
  ADMIN.loggedIn = false;
  localStorage.removeItem('rm_admin_logged');
  if (ADMIN.ordersUnsub) ADMIN.ordersUnsub();
  replaceScreen('s-login');
  document.getElementById('login-pwd').value = '';
}

/* ================================================================
   TABS
   ================================================================ */
function switchAdminTab(tab) {
  ADMIN.currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const tabEl = document.getElementById('tab-' + tab);
  const btnEl = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
  if (tabEl) tabEl.classList.add('active');
  if (btnEl) btnEl.classList.add('active');

  if (tab === 'shop') loadAdminProducts(true);
  if (tab === 'settings') loadSettings();
}

/* ================================================================
   ORDERS TAB
   ================================================================ */
function subscribeOrders() {
  if (ADMIN.ordersUnsub) ADMIN.ordersUnsub();
  if (!isFirebaseReady) return;

  ADMIN.ordersUnsub = db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .onSnapshot(snap => {
      ADMIN.allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      ADMIN.pendingCount = ADMIN.allOrders.filter(o => o.status === 'new').length;
      const badge = document.getElementById('orders-nav-badge');
      if (badge) {
        badge.textContent = ADMIN.pendingCount;
        badge.style.display = ADMIN.pendingCount > 0 ? 'flex' : 'none';
      }
      renderOrders();
    }, e => console.warn('[Orders]', e));
}

function setOrdersFilter(filter) {
  ADMIN.ordersFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.filter === filter));
  renderOrders();
}

const ORDER_STATUS_LABELS = {
  new:       'Новый',
  accepted:  'Принят',
  collected: 'Собран',
  sent:      'Отправлен',
  cancelled: 'Отменён',
};

function renderOrders() {
  const list = document.getElementById('orders-list');
  if (!list) return;

  let orders = ADMIN.allOrders;
  if (ADMIN.ordersFilter !== 'all')
    orders = orders.filter(o => o.status === ADMIN.ordersFilter);

  if (!orders.length) {
    list.innerHTML = `<div style="text-align:center;padding:48px 20px;color:var(--text3);font-size:14px;">Заказов нет</div>`;
    return;
  }

  list.innerHTML = orders.map(o => {
    const statusClass = 'os-' + (o.status || 'new');
    const addr = o.address ? `${o.address.street}, д.${o.address.house}${o.address.apt?', кв.'+o.address.apt:''}` : '—';
    return `
    <div class="order-card" onclick="openOrderDetail('${esc(o.id)}')">
      <div class="order-card-top">
        <div class="order-id">${esc(o.id)}</div>
        <div class="order-status ${statusClass}">${ORDER_STATUS_LABELS[o.status] || o.status}</div>
      </div>
      <div class="order-card-mid">
        👤 ${esc(o.userName || '—')} · 📱 ${esc(o.userPhone || '—')}<br>
        📍 ${esc(addr)}<br>
        🕐 ${fmtDate(o.createdAt)}
      </div>
      <div class="order-card-bot">
        <div class="order-total">${fmtPrice(o.total)}</div>
        <div style="font-size:12px;color:var(--text3)">${(o.items||[]).length} поз.</div>
      </div>
    </div>`;
  }).join('');
}

function openOrderDetail(orderId) {
  const order = ADMIN.allOrders.find(o => o.id === orderId);
  if (!order) return;
  ADMIN.currentOrder = order;

  // Fill detail
  setText('od-id',       order.id);
  setText('od-status',   ORDER_STATUS_LABELS[order.status] || order.status);
  setText('od-user',     order.userName || '—');
  setText('od-phone',    order.userPhone || '—');
  setText('od-date',     fmtDate(order.createdAt));
  const addr = order.address;
  setText('od-address',  addr ? `${addr.street}, д.${addr.house}${addr.apt?', кв.'+addr.apt:''}${addr.intercom?' (домофон есть)':''}` : '—');
  setText('od-payment',  paymentLabel(order.payment));
  setText('od-comment',  order.comment || '—');
  setText('od-total',    fmtPrice(order.total));

  // Items
  const itemsEl = document.getElementById('od-items');
  if (itemsEl) {
    itemsEl.innerHTML = (order.items || []).map((item, i) => `
      <div class="order-item-row" id="od-item-${i}">
        <div class="order-item-name">${esc(item.name || item.barcode)}</div>
        <div class="order-item-qty">× ${item.qty}</div>
        <div class="order-item-price">${fmtPrice((item.price||0) * item.qty)}</div>
        <button class="order-item-del" onclick="removeOrderItem(${i})" title="Удалить">✕</button>
      </div>`).join('');
  }

  // Status buttons
  renderOrderActions(order.status);

  document.getElementById('s-main').classList.remove('active');
  document.getElementById('s-order-detail').classList.add('active');
  if (tg) tg.BackButton.show();
}

function paymentLabel(payment) {
  if (!payment) return '—';
  if (payment.method === 'cash') {
    return `Наличные${payment.changeFrom ? ` (сдача с ${payment.changeFrom} ₸)` : ''}`;
  }
  return `Карта${payment.bank ? ' ' + payment.bank : ''}`;
}

function renderOrderActions(status) {
  const el = document.getElementById('od-actions');
  if (!el) return;

  const btns = [];
  if (status === 'new') {
    btns.push(`<button class="btn btn-blue btn-sm" onclick="updateOrderStatus('accepted')">✓ Принять</button>`);
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="updateOrderStatus('cancelled')">✕ Отменить</button>`);
  } else if (status === 'accepted') {
    btns.push(`<button class="btn btn-orange btn-sm" onclick="updateOrderStatus('collected')">📦 Собран</button>`);
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="updateOrderStatus('cancelled')">✕ Отменить</button>`);
  } else if (status === 'collected') {
    btns.push(`<button class="btn btn-green btn-sm" onclick="updateOrderStatus('sent')">🚚 Отправлен</button>`);
  }

  // Call client button
  if (ADMIN.currentOrder?.userPhone) {
    btns.push(`<a href="tel:${esc(ADMIN.currentOrder.userPhone)}" class="btn btn-out btn-sm" style="text-decoration:none;display:flex;align-items:center;justify-content:center;">📞 Позвонить</a>`);
  }

  el.innerHTML = `<div class="order-action-row" style="flex-wrap:wrap">${btns.join('')}</div>`;
}

async function updateOrderStatus(newStatus) {
  if (!ADMIN.currentOrder) return;
  showLoading();
  await dbSet('orders', ADMIN.currentOrder.id, { status: newStatus });
  ADMIN.currentOrder.status = newStatus;
  setText('od-status', ORDER_STATUS_LABELS[newStatus] || newStatus);
  renderOrderActions(newStatus);
  hideLoading();
  showToast('Статус обновлён ✓', 'ok');
}

function removeOrderItem(idx) {
  if (!ADMIN.currentOrder) return;
  const items = [...(ADMIN.currentOrder.items || [])];
  items.splice(idx, 1);
  ADMIN.currentOrder.items = items;

  // Recalc total
  let total = items.reduce((s, i) => s + (i.price || 0) * i.qty, 0) + DELIVERY_COST;
  ADMIN.currentOrder.total = total;

  // Re-render items
  const itemsEl = document.getElementById('od-items');
  if (itemsEl) {
    itemsEl.innerHTML = items.map((item, i) => `
      <div class="order-item-row">
        <div class="order-item-name">${esc(item.name)}</div>
        <div class="order-item-qty">× ${item.qty}</div>
        <div class="order-item-price">${fmtPrice((item.price||0) * item.qty)}</div>
        <button class="order-item-del" onclick="removeOrderItem(${i})">✕</button>
      </div>`).join('');
  }
  setText('od-total', fmtPrice(total));
}

async function saveOrderEdits() {
  if (!ADMIN.currentOrder) return;
  showLoading();
  await dbSet('orders', ADMIN.currentOrder.id, {
    items: ADMIN.currentOrder.items,
    total: ADMIN.currentOrder.total,
  });
  hideLoading();
  showToast('Заказ сохранён ✓', 'ok');
}

function closeOrderDetail() {
  document.getElementById('s-order-detail').classList.remove('active');
  document.getElementById('s-main').classList.add('active');
  if (tg) tg.BackButton.hide();
}

/* ================================================================
   SHOP TAB (admin)
   ================================================================ */
async function loadAdminProducts(reset) {
  if (reset) {
    ADMIN.prodPageLast = null;
    document.getElementById('admin-products-grid')?.setAttribute('data-loaded','0');
    document.getElementById('admin-products-grid').innerHTML = '';
  }

  const grid = document.getElementById('admin-products-grid');
  if (!grid) return;

  showLoading();
  let ref = db.collection('products');

  if (ADMIN.adminCatFilter && ADMIN.adminCatFilter !== 'all')
    ref = ref.where('category', '==', ADMIN.adminCatFilter);

  if (ADMIN.adminSearch) {
    const q = ADMIN.adminSearch.toLowerCase();
    ref = ref.where('nameLower', '>=', q).where('nameLower', '<=', q + '\uf8ff');
  }

  ref = ref.limit(30);
  if (ADMIN.prodPageLast) ref = ref.startAfter(ADMIN.prodPageLast);

  try {
    const snap = await ref.get();
    const prods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    ADMIN.prodPageLast = snap.docs[snap.docs.length - 1] || null;

    prods.forEach(p => {
      const d = document.createElement('div');
      d.className = 'admin-prod-card';
      d.innerHTML = `
        <div class="admin-prod-img">
          ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" loading="lazy">` : (p.emoji || '🛒')}
        </div>
        <div class="admin-prod-body">
          <div class="admin-prod-name">${esc(p.name)}</div>
          <div class="admin-prod-stock">Остаток: ${p.stock ?? '—'}</div>
          <div class="admin-prod-price">${fmtPrice(p.price)}</div>
        </div>
        <button class="admin-prod-edit" onclick="openEditProduct('${esc(p.id)}')">✏️ Ред.</button>`;
      grid.appendChild(d);
    });

    const loadMoreBtn = document.getElementById('admin-load-more');
    if (loadMoreBtn) loadMoreBtn.style.display = (prods.length === 30) ? 'block' : 'none';
  } catch (e) {
    showToast('Ошибка загрузки товаров', 'err');
  }
  hideLoading();
}

function adminFilterCat(catId) {
  ADMIN.adminCatFilter = catId;
  document.querySelectorAll('.admin-cat-chip').forEach(c =>
    c.classList.toggle('sel', c.dataset.cat === catId));
  loadAdminProducts(true);
}

const _adminSearchDebounced = debounce(q => {
  ADMIN.adminSearch = q;
  loadAdminProducts(true);
}, 400);

async function openEditProduct(barcode) {
  showLoading();
  const p = await dbGet('products', barcode);
  hideLoading();
  if (!p) { showToast('Товар не найден'); return; }
  p.id = barcode;
  ADMIN.editingProduct = { ...p };

  // Fill form
  setText('ep-title', p.name || '');
  setVal2('ep-name', p.name || '');
  setVal2('ep-price', p.price || '');
  setVal2('ep-club', p.clubPrice || '');
  setVal2('ep-promo', p.promoPrice || '');
  setVal2('ep-promo-start', p.promoStart || '');
  setVal2('ep-promo-end', p.promoEnd || '');
  setVal2('ep-stock', p.stock ?? '');
  setVal2('ep-brand', p.brand || '');
  setVal2('ep-volume', p.volume || '');
  setVal2('ep-mass', p.mass || '');
  setVal2('ep-fat', p.fat ?? '');
  setVal2('ep-alcohol', p.alcohol ?? '');
  setVal2('ep-protein', p.protein ?? '');
  setVal2('ep-fat100', p.fat100 ?? '');
  setVal2('ep-carbs', p.carbs ?? '');

  const carbCb = document.getElementById('ep-carbonated');
  if (carbCb) carbCb.checked = !!p.carbonated;
  const offerCb = document.getElementById('ep-best-offer');
  if (offerCb) offerCb.checked = !!p.isBestOffer;

  // Image preview
  const imgEl = document.getElementById('ep-img-preview');
  if (imgEl) imgEl.src = p.imageUrl || '';
  const imgWrap = document.getElementById('ep-img-wrap');
  if (imgWrap) {
    imgWrap.querySelector('img').style.display = p.imageUrl ? 'block' : 'none';
  }

  // Category chips
  document.querySelectorAll('.cat-sel-chip').forEach(c =>
    c.classList.toggle('sel', c.dataset.cat === p.category));

  document.getElementById('s-main').classList.remove('active');
  document.getElementById('s-edit-product').classList.add('active');
  if (tg) tg.BackButton.show();
}

function setVal2(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function selectEditCategory(catId) {
  if (!ADMIN.editingProduct) return;
  ADMIN.editingProduct.category = catId;
  document.querySelectorAll('.cat-sel-chip').forEach(c =>
    c.classList.toggle('sel', c.dataset.cat === catId));
}

async function uploadProductImage() {
  const input = document.getElementById('ep-img-input');
  if (!input?.files?.length) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { showToast('Фото до 5 МБ', 'err'); return; }

  showLoading();
  try {
    const url = await uploadImage(`products/${ADMIN.editingProduct.id}`, file,
      p => document.getElementById('ep-upload-progress').style.width = (p * 100) + '%');
    ADMIN.editingProduct.imageUrl = url;
    const imgEl = document.getElementById('ep-img-preview');
    if (imgEl) { imgEl.src = url; imgEl.style.display = 'block'; }
    hideLoading();
    showToast('Фото загружено ✓', 'ok');
  } catch (e) {
    hideLoading();
    showToast('Ошибка загрузки фото', 'err');
  }
}

async function saveEditProduct() {
  if (!ADMIN.editingProduct) return;
  const p = ADMIN.editingProduct;

  const name = (document.getElementById('ep-name')?.value || '').trim();
  if (!name) { showToast('Введите название', 'err'); return; }

  const updated = {
    name,
    nameLower: name.toLowerCase(),
    price:     parseFloat(document.getElementById('ep-price')?.value) || p.price || 0,
    clubPrice: parseFloat(document.getElementById('ep-club')?.value) || 0,
    promoPrice:parseFloat(document.getElementById('ep-promo')?.value) || 0,
    promoStart:document.getElementById('ep-promo-start')?.value || '',
    promoEnd:  document.getElementById('ep-promo-end')?.value || '',
    stock:     parseInt(document.getElementById('ep-stock')?.value) ?? p.stock ?? 0,
    category:  p.category || 'other',
    brand:     document.getElementById('ep-brand')?.value || '',
    volume:    document.getElementById('ep-volume')?.value || '',
    mass:      document.getElementById('ep-mass')?.value || '',
    fat:       document.getElementById('ep-fat')?.value || '',
    alcohol:   document.getElementById('ep-alcohol')?.value || '',
    protein:   document.getElementById('ep-protein')?.value || '',
    fat100:    document.getElementById('ep-fat100')?.value || '',
    carbs:     document.getElementById('ep-carbs')?.value || '',
    carbonated:document.getElementById('ep-carbonated')?.checked || false,
    isBestOffer:document.getElementById('ep-best-offer')?.checked || false,
  };
  if (p.imageUrl) updated.imageUrl = p.imageUrl;

  showLoading();
  await dbSet('products', p.id, updated);
  hideLoading();
  showToast('Товар сохранён ✓', 'ok');
  closeEditProduct();
  loadAdminProducts(true);
}

function closeEditProduct() {
  document.getElementById('s-edit-product').classList.remove('active');
  document.getElementById('s-main').classList.add('active');
  if (tg) tg.BackButton.hide();
}

/* ================================================================
   SETTINGS TAB
   ================================================================ */
async function loadSettings() {
  const app   = await dbGet('settings', 'app')   || {};
  const admin = await dbGet('settings', 'admin') || {};

  // Banners toggle
  const bt = document.getElementById('toggle-banners');
  if (bt) bt.checked = !!app.bannersEnabled;

  // Offer URL
  setVal2('settings-offer-url', app.offerUrl || '');

  // Admin password
  setVal2('settings-admin-pwd', admin.adminPassword || '');

  // Load banners list
  loadBannersList();
}

async function saveGeneralSettings() {
  const offerUrl      = (document.getElementById('settings-offer-url')?.value || '').trim();
  const bannersEnabled= document.getElementById('toggle-banners')?.checked || false;

  showLoading();
  await dbSet('settings', 'app', { offerUrl, bannersEnabled });
  hideLoading();
  showToast('Настройки сохранены ✓', 'ok');
}

async function saveAdminPassword() {
  const pwd = (document.getElementById('settings-admin-pwd')?.value || '').trim();
  if (pwd.length < 4) { showToast('Минимум 4 символа', 'err'); return; }

  showLoading();
  await dbSet('settings', 'admin', { adminPassword: pwd });
  hideLoading();
  showToast('Пароль изменён ✓', 'ok');
}

/* ---- Banners management ---- */
async function loadBannersList() {
  const list = document.getElementById('banners-list');
  if (!list) return;
  try {
    const snap = await db.collection('banners').orderBy('order').get();
    const banners = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!banners.length) {
      list.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0">Баннеры не добавлены</div>';
      return;
    }
    list.innerHTML = banners.map(b => `
      <div class="banner-manage-item">
        <div class="banner-manage-img">
          ${b.imageUrl ? `<img src="${esc(b.imageUrl)}">` : ''}
        </div>
        <div class="banner-manage-name">${esc(b.title || b.id)}</div>
        <label class="toggle" title="Вкл/выкл">
          <input type="checkbox" ${b.active?'checked':''} onchange="toggleBanner('${esc(b.id)}',this.checked)">
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
        <button class="btn btn-ghost btn-sm" onclick="deleteBanner('${esc(b.id)}')">✕</button>
      </div>`).join('');
  } catch (_) {}
}

async function toggleBanner(id, active) {
  await dbSet('banners', id, { active });
}

async function deleteBanner(id) {
  if (!confirm('Удалить баннер?')) return;
  showLoading();
  await dbDelete('banners', id);
  hideLoading();
  loadBannersList();
}

async function addBanner() {
  const title = (document.getElementById('new-banner-title')?.value || '').trim();
  const input = document.getElementById('new-banner-img');
  if (!title) { showToast('Введите название баннера', 'err'); return; }
  if (!input?.files?.length) { showToast('Выберите изображение', 'err'); return; }

  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { showToast('Фото до 5 МБ', 'err'); return; }

  showLoading();
  try {
    const id  = 'banner_' + Date.now();
    const url = await uploadImage(`banners/${id}`, file);
    const snap = await db.collection('banners').get();
    await dbSet('banners', id, { title, imageUrl: url, active: true, order: snap.size });
    document.getElementById('new-banner-title').value = '';
    input.value = '';
    hideLoading();
    showToast('Баннер добавлен ✓', 'ok');
    loadBannersList();
  } catch (e) {
    hideLoading();
    showToast('Ошибка загрузки баннера', 'err');
  }
}

/* ================================================================
   IMPORT / EXPORT
   ================================================================ */
function showImportModal() {
  document.getElementById('import-modal')?.classList.add('show');
}
function hideImportModal() {
  document.getElementById('import-modal')?.classList.remove('show');
}

async function startImport() {
  const input = document.getElementById('import-file');
  if (!input?.files?.length) { showToast('Выберите файл', 'err'); return; }

  const file = input.files[0];
  const defaultCat = document.getElementById('import-category')?.value || 'other';

  showLoading();
  const reader = new FileReader();
  reader.onload = async e => {
    hideLoading();
    try {
      const data  = new Uint8Array(e.target.result);
      const wb    = XLSX.read(data, { type: 'array' });
      const ws    = wb.Sheets[wb.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      // Skip header row if first cell looks like text
      const startRow = (typeof rows[0][0] === 'string' && isNaN(Number(rows[0][0]))) ? 1 : 0;
      const dataRows = rows.slice(startRow).filter(r => r[0]);

      if (!dataRows.length) { showToast('Нет данных в файле', 'err'); return; }

      const progress = document.getElementById('import-progress');
      const fill     = document.getElementById('import-fill');
      const label    = document.getElementById('import-label');
      if (progress) progress.classList.add('show');

      let created = 0, updated = 0;
      const items = [];

      for (const row of dataRows) {
        const barcode    = String(row[0] || '').trim();
        if (!barcode) continue;
        const name       = String(row[1] || '').trim();
        const price      = parseFloat(row[3]) || 0;
        const clubPrice  = parseFloat(row[4]) || 0;
        const promoPrice = parseFloat(row[5]) || 0;
        const promoStart = parseExcelDate(row[6]);
        const promoEnd   = parseExcelDate(row[7]);
        const stock      = parseInt(row[9]) || 0;

        // Check existing
        const existing = await dbGet('products', barcode);

        const productData = existing
          ? { price, clubPrice, promoPrice, promoStart, promoEnd, stock,
              name, nameLower: name.toLowerCase() }
          : { barcode, name, nameLower: name.toLowerCase(),
              price, clubPrice, promoPrice, promoStart, promoEnd, stock,
              category: defaultCat, imageUrl: '', emoji: '',
              brand:'', volume:'', mass:'', fat:'', alcohol:'',
              protein:'', fat100:'', carbs:'', carbonated: false, isBestOffer: false,
              createdAt: new Date().toISOString() };

        items.push({ id: barcode, data: productData });
        if (existing) updated++; else created++;
      }

      // Batch write
      await dbBatchSet('products', items, (done, total) => {
        const pct = Math.round(done / total * 100);
        if (fill)  fill.style.width = pct + '%';
        if (label) label.textContent = `${done} / ${total} товаров (${pct}%)`;
      });

      if (progress) progress.classList.remove('show');
      hideImportModal();
      showToast(`Импорт завершён: ${created} добавлено, ${updated} обновлено ✓`, 'ok');
      if (ADMIN.currentTab === 'shop') loadAdminProducts(true);
    } catch (err) {
      showToast('Ошибка чтения файла: ' + err.message, 'err');
    }
  };
  reader.readAsArrayBuffer(file);
}

async function exportProducts() {
  showLoading();
  try {
    const snap = await db.collection('products').get();
    const rows = [['Штрихкод','Наименование','Категория','Цена','Клуб.цена','Акц.цена','Нач.акции','Кон.акции','Остаток']];
    snap.docs.forEach(d => {
      const p = d.data();
      rows.push([d.id, p.name||'', p.category||'', p.price||'', p.clubPrice||'',
        p.promoPrice||'', p.promoStart||'', p.promoEnd||'', p.stock??'']);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, 'RudMart_products_' + new Date().toISOString().slice(0,10) + '.xlsx');
    hideLoading();
  } catch (e) {
    hideLoading();
    showToast('Ошибка экспорта', 'err');
  }
}

/* ================================================================
   SHARED HELPERS (mirror of utils.js, kept here for completeness)
   ================================================================ */
function replaceScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'slide-in'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  if (tg) tg.BackButton.hide();
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '';
}
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ''; }
