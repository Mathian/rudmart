/* ============================================================
   RudMart Online — Customer App
   ============================================================ */

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

/* ---- State ---- */
const S = {
  uid: null,
  user: null,
  cart: {},           // { barcode: { qty, checked, product } }
  favorites: new Set(),
  hasClubCard: false,
  currentTab: 'shop',
  currentCategory: null,
  categoryLastDoc: null,
  searchQuery: '',
  productCache: {},   // barcode -> product
  banners: [],
  settings: {},
  bannerTimer: null,
  bannerIdx: 0,
  pdProduct: null,    // product in detail modal
  pdQty: 1,
  regIntercom: false,
  profileIntercom: false,
  offerAccepted: false,
  unsubCart: null,
  unsubFav: null,
};

/* ---- Screens ---- */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

/* ---- Loading overlay ---- */
function showLoading() {
  const el = document.getElementById('loading-overlay');
  el.style.display = '';
  el.classList.remove('hidden');
}
function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.classList.add('hidden');
  // Force-remove from layout after transition completes
  setTimeout(() => { el.style.display = 'none'; }, 400);
}

/* ---- Toast ---- */
let toastTimer;
function showToast(msg, duration = 2000) {
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

/* ============================================================
   BOOT
   ============================================================ */
window.addEventListener('DOMContentLoaded', async () => {
  showLoading();

  // Safety net: force-hide overlay after 8s even if Firebase hangs
  const bootGuard = setTimeout(() => {
    hideLoading();
    showScreen('s-no-uid');
  }, 8000);

  try {
    await initFirebase();

    // Read ?uid= from URL
    const params = new URLSearchParams(location.search);
    const urlUid = params.get('uid');
    if (urlUid) {
      S.uid = urlUid;
      history.replaceState(null, '', location.pathname);
    } else {
      S.uid = localStorage.getItem('rm_uid');
    }

    if (!S.uid) {
      clearTimeout(bootGuard);
      hideLoading();
      showScreen('s-no-uid');
      return;
    }
    localStorage.setItem('rm_uid', S.uid);

    const settings = await dbGet('settings', 'app');
    S.settings = settings || {};

    const user = await dbGet('users', S.uid);

    clearTimeout(bootGuard);
    hideLoading();

    if (!user || !user.registered) {
      const tgUser = tg?.initDataUnsafe?.user || {};
      document.getElementById('reg-name').value = tgUser.first_name || user?.firstName || '';
      document.getElementById('reg-phone').value = user?.phone || '';
      if (user?.address) {
        document.getElementById('reg-street').value = user.address.street || '';
        document.getElementById('reg-house').value  = user.address.house  || '';
        document.getElementById('reg-apt').value    = user.address.apt    || '';
        S.regIntercom = !!user.address.intercom;
        if (S.regIntercom) document.getElementById('reg-intercom-cb').classList.add('checked');
      }
      showScreen('s-register');
      return;
    }

    if (!user.consented) {
      S.user = user;
      loadOfferLink();
      showScreen('s-consent');
      return;
    }

    S.user = user;
    enterMain();
  } catch (e) {
    console.error('[Boot] fatal:', e);
    clearTimeout(bootGuard);
    hideLoading();
    showScreen('s-no-uid');
  }
});

/* ============================================================
   REGISTRATION
   ============================================================ */
function toggleRegIntercom() {
  S.regIntercom = !S.regIntercom;
  document.getElementById('reg-intercom-cb').classList.toggle('checked', S.regIntercom);
}

async function submitRegistration() {
  const name   = document.getElementById('reg-name').value.trim();
  const phone  = document.getElementById('reg-phone').value.trim();
  const street = document.getElementById('reg-street').value.trim();
  const house  = document.getElementById('reg-house').value.trim();
  const apt    = document.getElementById('reg-apt').value.trim();

  if (!name)   { showToast('Введите имя'); return; }
  if (!street) { showToast('Введите улицу'); return; }
  if (!house)  { showToast('Введите номер дома'); return; }

  const btn = document.getElementById('btn-reg-submit');
  btn.disabled = true;
  btn.textContent = 'Сохраняем...';

  const tgUser = tg?.initDataUnsafe?.user || {};
  const userData = {
    uid: S.uid,
    firstName: name,
    username: tgUser.username || '',
    telegramId: tgUser.id || '',
    phone,
    address: { street, house, apt, intercom: S.regIntercom },
    registered: true,
    consented: false,
    createdAt: dbServerTimestamp(),
  };

  await dbSet('users', S.uid, userData);
  S.user = userData;
  loadOfferLink();
  btn.disabled = false;
  btn.textContent = 'Продолжить →';
  showScreen('s-consent');
}

/* ============================================================
   CONSENT
   ============================================================ */
function loadOfferLink() {
  const url = S.settings.offerUrl;
  const linkEl = document.getElementById('offer-read-link');
  if (url) linkEl.href = url;
  else linkEl.style.display = 'none';
}

function toggleConsentOffer() {
  S.offerAccepted = !S.offerAccepted;
  document.getElementById('offer-card').classList.toggle('checked', S.offerAccepted);
  document.getElementById('offer-cb').classList.toggle('checked', S.offerAccepted);
  document.getElementById('btn-consent-submit').disabled = !S.offerAccepted;
}

async function submitConsent() {
  if (!S.offerAccepted) return;
  const btn = document.getElementById('btn-consent-submit');
  btn.disabled = true;
  btn.textContent = 'Сохраняем...';
  await dbSet('users', S.uid, { consented: true, consentedAt: dbServerTimestamp() });
  S.user.consented = true;
  enterMain();
}

function openOffer(e) {
  if (e) e.preventDefault();
  const url = S.settings.offerUrl;
  if (url) {
    document.getElementById('offer-content').innerHTML =
      `<iframe src="${url}" style="width:100%;height:70vh;border:none;border-radius:8px"></iframe>`;
  } else {
    document.getElementById('offer-content').textContent = 'Текст оферты не указан. Обратитесь к администратору.';
  }
  openModal('offer');
}
function closeOffer() { closeModal('offer'); }

/* ============================================================
   MAIN APP
   ============================================================ */
async function enterMain() {
  showScreen('s-main');
  document.getElementById('cart-user-name').textContent = S.user.firstName || 'Корзина';
  document.getElementById('delivery-price-label').textContent = (S.settings.deliveryPrice || DELIVERY_PRICE) + ' ₸';

  // Load cart and favorites from Firebase
  loadCartFromDB();
  loadFavoritesFromDB();

  // Init shop
  loadShopHome();
}

/* ============================================================
   TABS
   ============================================================ */
function switchTab(tab) {
  S.currentTab = tab;
  ['shop', 'fav', 'cart'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`ni-${t}`).classList.toggle('on', t === tab);
  });
  if (tab === 'fav') renderFavorites();
  if (tab === 'cart') renderCart();
}

/* ============================================================
   SHOP HOME
   ============================================================ */
async function loadShopHome() {
  loadBanners();
  buildCategoryGrid();
  loadBestOffers();
}

/* ---- Banners ---- */
async function loadBanners() {
  const banners = await dbQuery('banners', [
    { type: 'where', field: 'isActive', op: '==', value: true },
    { type: 'orderBy', field: 'order', dir: 'asc' },
  ]);
  S.banners = banners;

  const section = document.getElementById('banners-section');
  const track = document.getElementById('banners-track');
  const dots = document.getElementById('banner-dots');

  if (!banners.length) { section.style.display = 'none'; return; }

  track.innerHTML = banners.map((b, i) => `
    <div class="banner-slide" style="${b.bgColor ? `background:${b.bgColor}` : ''}">
      ${b.imageUrl ? `<img src="${b.imageUrl}" alt="Баннер ${i+1}" loading="lazy">` : ''}
    </div>
  `).join('');

  dots.innerHTML = banners.map((_, i) =>
    `<div class="banner-dot${i === 0 ? ' active' : ''}" onclick="goToBanner(${i})"></div>`
  ).join('');

  if (banners.length > 1) {
    clearInterval(S.bannerTimer);
    S.bannerTimer = setInterval(() => goToBanner((S.bannerIdx + 1) % S.banners.length), 4000);
  }
}

function goToBanner(idx) {
  S.bannerIdx = idx;
  document.getElementById('banners-track').style.transform = `translateX(-${idx * 100}%)`;
  document.querySelectorAll('.banner-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}

/* ---- Category grid ---- */
function buildCategoryGrid() {
  const grid = document.getElementById('cat-grid');
  grid.innerHTML = CATEGORIES.map(c => `
    <div class="cat-item" onclick="openCategory('${c.id}','${c.name}')">
      <div class="cat-icon">${c.icon}</div>
      <div class="cat-name">${c.name}</div>
    </div>
  `).join('');
}

/* ---- Best offers ---- */
async function loadBestOffers() {
  const products = await dbQuery('products', [
    { type: 'where', field: 'isBestOffer', op: '==', value: true },
    { type: 'where', field: 'isAvailable', op: '==', value: true },
    { type: 'limit', n: 20 },
  ]);

  const section = document.getElementById('best-offers-section');
  const track = document.getElementById('best-offers-track');

  if (!products.length) { section.style.display = 'none'; return; }

  products.forEach(p => { S.productCache[p.id] = p; });
  track.innerHTML = products.map(p => renderMiniCard(p)).join('');
}

/* ============================================================
   CATEGORY VIEW
   ============================================================ */
const CAT_PAGE_SIZE = 20;

async function openCategory(catId, catName) {
  S.currentCategory = catId;
  S.categoryLastDoc = null;
  document.getElementById('cat-page-name').textContent = catName;
  document.getElementById('shop-home').style.display = 'none';
  document.getElementById('shop-search').style.display = 'none';
  document.getElementById('shop-category').style.display = 'block';
  document.getElementById('cat-products-grid').innerHTML = renderSkeletons(6);
  document.getElementById('cat-load-more').style.display = 'none';

  await loadCategoryPage(true);
}

async function loadCategoryPage(reset = false) {
  const constraints = [
    { type: 'where', field: 'category', op: '==', value: S.currentCategory },
    { type: 'orderBy', field: 'nameSearch', dir: 'asc' },
    { type: 'limit', n: CAT_PAGE_SIZE },
  ];
  if (S.categoryLastDoc && !reset) {
    constraints.push({ type: 'startAfter', doc: S.categoryLastDoc });
  }

  const grid = document.getElementById('cat-products-grid');
  try {
    let q = db.collection('products');
    for (const c of constraints) {
      if (c.type === 'where')       q = q.where(c.field, c.op, c.value);
      else if (c.type === 'orderBy') q = q.orderBy(c.field, c.dir);
      else if (c.type === 'limit')   q = q.limit(c.n);
      else if (c.type === 'startAfter') q = q.startAfter(c.doc);
    }
    const snap = await q.get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (snap.docs.length === CAT_PAGE_SIZE) {
      S.categoryLastDoc = snap.docs[snap.docs.length - 1];
      document.getElementById('cat-load-more').style.display = 'block';
    } else {
      document.getElementById('cat-load-more').style.display = 'none';
    }

    products.forEach(p => { S.productCache[p.id] = p; });

    if (reset) grid.innerHTML = '';
    if (!products.length && reset) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text2);font-size:14px">В этой категории пока нет товаров</div>`;
    } else {
      grid.innerHTML += products.map(p => renderProductCard(p)).join('');
    }
  } catch (e) {
    console.warn('Category load error:', e);
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text2)">Ошибка загрузки</div>`;
  }
}

function loadMoreCategory() {
  loadCategoryPage(false);
}

function backToShopHome() {
  S.currentCategory = null;
  document.getElementById('shop-category').style.display = 'none';
  document.getElementById('shop-home').style.display = 'block';
}

/* ============================================================
   SEARCH
   ============================================================ */
let searchTimer;
function onSearchInput(val) {
  S.searchQuery = val.trim();
  const clearBtn = document.getElementById('search-clear');
  clearBtn.style.display = val ? 'block' : 'none';

  if (!val) {
    document.getElementById('shop-search').style.display = 'none';
    document.getElementById('shop-home').style.display = 'block';
    document.getElementById('shop-category').style.display = 'none';
    return;
  }

  document.getElementById('shop-home').style.display = 'none';
  document.getElementById('shop-category').style.display = 'none';
  document.getElementById('shop-search').style.display = 'block';

  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => doSearch(S.searchQuery), 350);
}

async function doSearch(query) {
  if (!query) return;
  const grid = document.getElementById('search-products-grid');
  const hdr = document.getElementById('search-results-hdr');
  grid.innerHTML = renderSkeletons(4);
  hdr.textContent = `Поиск: «${query}»...`;

  const lq = query.toLowerCase();
  try {
    const snap = await db.collection('products')
      .where('nameSearch', '>=', lq)
      .where('nameSearch', '<=', lq + '\uf8ff')
      .limit(40)
      .get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    products.forEach(p => { S.productCache[p.id] = p; });

    hdr.textContent = products.length
      ? `Найдено: ${products.length} товаров`
      : 'Ничего не найдено';
    grid.innerHTML = products.length
      ? products.map(p => renderProductCard(p)).join('')
      : `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text2)">Попробуйте другой запрос</div>`;
  } catch (e) {
    hdr.textContent = 'Ошибка поиска';
    grid.innerHTML = '';
  }
}

function clearSearch() {
  document.getElementById('search-inp').value = '';
  onSearchInput('');
}

/* ============================================================
   RENDER PRODUCT CARDS
   ============================================================ */
function renderProductCard(p) {
  const inCart = !!S.cart[p.id];
  const isFav  = S.favorites.has(p.id);
  const price  = getEffectivePrice(p);
  const isPromo = p.promoPrice && isPromoActive(p);

  return `<div class="pcard" onclick="openProduct('${p.id}')">
    <div class="pcard-img">
      ${p.imageUrl
        ? `<img src="${p.imageUrl}" alt="${esc(p.name)}" loading="lazy">`
        : `<div class="pcard-img-placeholder">📦</div>`}
      ${isPromo ? `<span class="badge-promo">АКЦИЯ</span>` : ''}
      <button class="pcard-fav" onclick="event.stopPropagation();toggleFavorite('${p.id}')">${isFav ? '❤️' : '🤍'}</button>
    </div>
    <div class="pcard-body">
      <div class="pcard-name">${esc(p.name)}</div>
      <div class="pcard-price-row">
        <span class="pcard-price">${fmt(price)} ₸</span>
        ${p.clubPrice && p.clubPrice < p.price
          ? `<span class="pcard-club-label">КК</span><span class="pcard-club">${fmt(p.clubPrice)} ₸</span>`
          : ''}
        ${isPromo && p.price ? `<span class="pcard-promo">${fmt(p.price)} ₸</span>` : ''}
      </div>
      <div class="pcard-availability ${p.isAvailable ? 'avail-yes' : 'avail-no'}">
        ${p.isAvailable ? '● В наличии' : '● Нет в наличии'}
      </div>
    </div>
    <div class="pcard-footer">
      <button class="btn-add ${inCart ? 'in-cart' : ''}" onclick="event.stopPropagation();addToCart('${p.id}')">
        ${inCart ? '✓ В корзине' : '+ В корзину'}
      </button>
    </div>
  </div>`;
}

function renderMiniCard(p) {
  const inCart = !!S.cart[p.id];
  const isFav  = S.favorites.has(p.id);
  const price  = getEffectivePrice(p);
  return `<div class="pcard pcard-mini" onclick="openProduct('${p.id}')">
    <div class="pcard-img">
      ${p.imageUrl
        ? `<img src="${p.imageUrl}" alt="${esc(p.name)}" loading="lazy">`
        : `<div class="pcard-img-placeholder">📦</div>`}
      <button class="pcard-fav" onclick="event.stopPropagation();toggleFavorite('${p.id}')">${isFav ? '❤️' : '🤍'}</button>
    </div>
    <div class="pcard-body">
      <div class="pcard-name">${esc(p.name)}</div>
      <div class="pcard-price-row">
        <span class="pcard-price" style="font-size:13px">${fmt(price)} ₸</span>
        ${p.clubPrice && p.clubPrice < p.price
          ? `<span class="pcard-club" style="font-size:11px">${fmt(p.clubPrice)} ₸</span>`
          : ''}
      </div>
    </div>
    <div class="pcard-footer">
      <button class="btn-add ${inCart ? 'in-cart' : ''}" onclick="event.stopPropagation();addToCart('${p.id}')">
        ${inCart ? '✓' : '+'}
      </button>
    </div>
  </div>`;
}

function renderSkeletons(n) {
  return Array.from({length: n}).map(() => `
    <div style="background:var(--card);border-radius:var(--rad);border:1px solid var(--border);overflow:hidden">
      <div class="skel skel-card" style="height:120px"></div>
      <div style="padding:10px">
        <div class="skel skel-text w80"></div>
        <div class="skel skel-text w60"></div>
        <div class="skel skel-text w40"></div>
      </div>
    </div>`).join('');
}

/* ============================================================
   PRODUCT DETAIL
   ============================================================ */
async function openProduct(barcode) {
  let p = S.productCache[barcode];
  if (!p) {
    p = await dbGet('products', barcode);
    if (!p) return;
    S.productCache[barcode] = p;
  }
  S.pdProduct = p;
  S.pdQty = S.cart[barcode]?.qty || 1;
  renderProductModal(p);
  openModal('product');
}

function renderProductModal(p) {
  const isPromo = p.promoPrice && isPromoActive(p);
  const price = getEffectivePrice(p);
  const isFav = S.favorites.has(p.id);
  const inCart = !!S.cart[p.id];

  // Image
  const imgEl = document.getElementById('pd-img');
  const ph = document.getElementById('pd-img-ph');
  if (p.imageUrl) {
    let img = imgEl.querySelector('img.pd-product-img');
    if (!img) { img = document.createElement('img'); img.className = 'pd-product-img'; imgEl.appendChild(img); }
    img.src = p.imageUrl;
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain';
    ph.style.display = 'none';
  } else {
    ph.style.display = 'flex';
    const existing = imgEl.querySelector('img.pd-product-img');
    if (existing) existing.remove();
  }

  // Promo badge
  document.getElementById('pd-promo-badge').classList.toggle('hidden', !isPromo);
  // Fav
  document.getElementById('pd-fav-btn').textContent = isFav ? '❤️' : '🤍';
  // Availability
  const avEl = document.getElementById('pd-avail');
  avEl.textContent = p.isAvailable ? '● В наличии' : '● Нет в наличии';
  avEl.className = 'pd-availability ' + (p.isAvailable ? 'avail-yes' : 'avail-no');
  // Name
  document.getElementById('pd-name').textContent = p.name;
  // Price
  document.getElementById('pd-price').textContent = `${fmt(price)} ₸`;
  // Club price
  const clubBlock = document.getElementById('pd-club-block');
  if (p.clubPrice && p.clubPrice < p.price) {
    clubBlock.classList.remove('hidden');
    document.getElementById('pd-club-price').textContent = `${fmt(p.clubPrice)} ₸`;
  } else {
    clubBlock.classList.add('hidden');
  }
  // Promo original
  const promoOrig = document.getElementById('pd-promo-orig');
  if (isPromo && p.price) {
    promoOrig.classList.remove('hidden');
    promoOrig.textContent = `${fmt(p.price)} ₸`;
  } else {
    promoOrig.classList.add('hidden');
  }

  // Characteristics
  const chars = p.characteristics || {};
  const charMap = [
    ['Бренд', chars.brand],
    ['Объём', chars.volume ? chars.volume + ' л' : null],
    ['Масса', chars.weight ? chars.weight + ' г' : null],
    ['Жирность', chars.fatContent ? chars.fatContent + ' %' : null],
    ['Крепость', chars.strength ? chars.strength + ' %' : null],
    ['Газированный', chars.carbonated != null ? (chars.carbonated ? 'Да' : 'Нет') : null],
    ['Белки', chars.proteins ? chars.proteins + ' г' : null],
    ['Жиры', chars.fats ? chars.fats + ' г' : null],
    ['Углеводы', chars.carbs ? chars.carbs + ' г' : null],
  ].filter(([, v]) => v != null);

  const charsEl = document.getElementById('pd-chars');
  const charsListEl = document.getElementById('pd-chars-list');
  if (charMap.length) {
    charsEl.classList.remove('hidden');
    charsListEl.innerHTML = charMap.map(([k, v]) =>
      `<div class="pd-char-row"><span class="pd-char-key">${k}</span><span class="pd-char-val">${v}</span></div>`
    ).join('');
  } else {
    charsEl.classList.add('hidden');
  }

  // Qty
  document.getElementById('pd-qty').textContent = S.pdQty;
  // Add button
  const addBtn = document.getElementById('pd-add-btn');
  addBtn.textContent = inCart ? '✓ Обновить корзину' : 'В корзину';
}

function changePdQty(delta) {
  S.pdQty = Math.max(1, S.pdQty + delta);
  document.getElementById('pd-qty').textContent = S.pdQty;
}

function addFromModal() {
  if (!S.pdProduct) return;
  addToCartQty(S.pdProduct.id, S.pdQty);
  closeModal('product');
  showToast('Добавлено в корзину');
}

function toggleFavFromModal() {
  if (!S.pdProduct) return;
  toggleFavorite(S.pdProduct.id);
  document.getElementById('pd-fav-btn').textContent = S.favorites.has(S.pdProduct.id) ? '❤️' : '🤍';
}

function closeProductModal() { closeModal('product'); }

/* ============================================================
   CART
   ============================================================ */
async function loadCartFromDB() {
  const data = await dbGet('carts', S.uid);
  if (data?.items) {
    S.cart = data.items;
    // Prefetch product data for cart items
    const barcodes = Object.keys(S.cart);
    for (const bc of barcodes) {
      if (!S.productCache[bc]) {
        const p = await dbGet('products', bc);
        if (p) {
          S.productCache[bc] = p;
          S.cart[bc].product = p;
        }
      } else {
        S.cart[bc].product = S.productCache[bc];
      }
    }
  }
  updateCartBadge();
}

function addToCart(barcode) {
  addToCartQty(barcode, 1);
  showToast('Добавлено в корзину');
  refreshProductButtons(barcode);
}

function addToCartQty(barcode, qty) {
  const product = S.productCache[barcode];
  if (!product) return;
  if (S.cart[barcode]) {
    S.cart[barcode].qty = qty;
  } else {
    S.cart[barcode] = { qty, checked: true, product };
  }
  saveCartToDB();
  updateCartBadge();
}

function removeFromCart(barcode) {
  delete S.cart[barcode];
  saveCartToDB();
  updateCartBadge();
  renderCart();
  refreshProductButtons(barcode);
}

function changeCartQty(barcode, delta) {
  if (!S.cart[barcode]) return;
  const newQty = S.cart[barcode].qty + delta;
  if (newQty < 1) { removeFromCart(barcode); return; }
  S.cart[barcode].qty = newQty;
  saveCartToDB();
  renderCart();
}

function toggleCartItem(barcode) {
  if (!S.cart[barcode]) return;
  S.cart[barcode].checked = !S.cart[barcode].checked;
  saveCartToDB();
  renderCart();
}

async function saveCartToDB() {
  await dbSet('carts', S.uid, { items: S.cart });
}

function updateCartBadge() {
  const count = Object.keys(S.cart).length;
  const badge = document.getElementById('cart-badge');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

function renderCart() {
  const list = document.getElementById('cart-items-list');
  const empty = document.getElementById('cart-empty');
  const content = document.getElementById('cart-content');
  const items = Object.entries(S.cart);

  if (!items.length) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  content.style.display = 'block';

  list.innerHTML = items.map(([bc, item]) => {
    const p = item.product || S.productCache[bc] || {};
    const price = getEffectivePrice(p);
    const clubPrice = p.clubPrice;
    const lineTotal = price * item.qty;
    const lineCclub = clubPrice ? clubPrice * item.qty : null;
    return `
      <div class="cart-item ${item.checked ? 'item-checked' : ''}" onclick="toggleCartItem('${bc}')">
        <div class="ci-cb ${item.checked ? 'checked' : ''}"></div>
        <div class="ci-img">
          ${p.imageUrl
            ? `<img src="${p.imageUrl}" alt="" loading="lazy">`
            : `<div class="ci-img-ph">📦</div>`}
        </div>
        <div class="ci-info">
          <div class="ci-name">${esc(p.name || 'Товар')}</div>
          <div class="ci-price">${fmt(lineTotal)} ₸</div>
          ${lineCclub ? `<div class="ci-club">КК: ${fmt(lineCclub)} ₸</div>` : ''}
          <div class="ci-qty" onclick="event.stopPropagation()">
            <button class="ci-qty-btn" onclick="changeCartQty('${bc}',-1)">−</button>
            <span class="ci-qty-num">${item.qty}</span>
            <button class="ci-qty-btn" onclick="changeCartQty('${bc}',1)">+</button>
          </div>
        </div>
        <button class="ci-remove" onclick="event.stopPropagation();removeFromCart('${bc}')">✕</button>
      </div>`;
  }).join('');

  renderCartTotals();
}

function toggleClubCard() {
  S.hasClubCard = !S.hasClubCard;
  document.getElementById('cart-club-cb').classList.toggle('checked', S.hasClubCard);
  renderCartTotals();
}

function renderCartTotals() {
  const checkedItems = Object.entries(S.cart).filter(([, i]) => i.checked);
  const count = checkedItems.length;
  let sum = 0, clubSum = 0;
  checkedItems.forEach(([bc, item]) => {
    const p = item.product || S.productCache[bc] || {};
    sum += getEffectivePrice(p) * item.qty;
    clubSum += (p.clubPrice && p.clubPrice < getEffectivePrice(p) ? p.clubPrice : getEffectivePrice(p)) * item.qty;
  });
  const saved = S.hasClubCard ? (sum - clubSum) : 0;
  const total = S.hasClubCard ? clubSum : sum;

  document.getElementById('ct-count').textContent = count;
  document.getElementById('ct-sum').textContent = fmt(sum) + ' ₸';
  document.getElementById('ct-total').textContent = fmt(total) + ' ₸';

  const clubRow = document.getElementById('ct-club-row');
  const savedRow = document.getElementById('ct-saved-row');
  if (S.hasClubCard && saved > 0) {
    clubRow.classList.remove('hidden');
    savedRow.classList.remove('hidden');
    document.getElementById('ct-club-sum').textContent = fmt(clubSum) + ' ₸';
    document.getElementById('ct-saved').textContent = fmt(saved) + ' ₸';
  } else {
    clubRow.classList.add('hidden');
    savedRow.classList.add('hidden');
  }
}

function refreshProductButtons(barcode) {
  const inCart = !!S.cart[barcode];
  document.querySelectorAll(`.btn-add`).forEach(btn => {
    const card = btn.closest('.pcard');
    if (!card) return;
    const onclick = card.getAttribute('onclick') || '';
    if (onclick.includes(barcode)) {
      btn.classList.toggle('in-cart', inCart);
      btn.textContent = inCart ? (btn.closest('.pcard-mini') ? '✓' : '✓ В корзине') : (btn.closest('.pcard-mini') ? '+' : '+ В корзину');
    }
  });
}

/* ============================================================
   FAVORITES
   ============================================================ */
async function loadFavoritesFromDB() {
  const data = await dbGet('favorites', S.uid);
  if (data?.list) {
    S.favorites = new Set(data.list);
    updateFavBadge();
  }
}

async function toggleFavorite(barcode) {
  if (S.favorites.has(barcode)) {
    S.favorites.delete(barcode);
    showToast('Убрано из избранного');
  } else {
    S.favorites.add(barcode);
    showToast('Добавлено в избранное');
    // Prefetch product if needed
    if (!S.productCache[barcode]) {
      const p = await dbGet('products', barcode);
      if (p) S.productCache[barcode] = p;
    }
  }
  await dbSet('favorites', S.uid, { list: [...S.favorites] });
  updateFavBadge();
  refreshFavButtons(barcode);
  if (S.currentTab === 'fav') renderFavorites();
}

function updateFavBadge() {
  const count = S.favorites.size;
  const badge = document.getElementById('fav-badge');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
  // Heart icon update
  document.getElementById('ni-fav').querySelector('.ni-ico').textContent = count ? '❤️' : '🤍';
}

function refreshFavButtons(barcode) {
  const isFav = S.favorites.has(barcode);
  document.querySelectorAll('.pcard-fav').forEach(btn => {
    const card = btn.closest('.pcard');
    if (!card) return;
    const onclick = card.getAttribute('onclick') || '';
    if (onclick.includes(barcode)) btn.textContent = isFav ? '❤️' : '🤍';
  });
}

async function renderFavorites() {
  const grid = document.getElementById('fav-grid');
  const empty = document.getElementById('fav-empty');
  const barcodes = [...S.favorites];

  if (!barcodes.length) {
    empty.style.display = 'flex';
    grid.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  // Load any uncached products
  const toLoad = barcodes.filter(bc => !S.productCache[bc]);
  for (const bc of toLoad) {
    const p = await dbGet('products', bc);
    if (p) S.productCache[bc] = p;
  }

  grid.innerHTML = barcodes.map(bc => {
    const p = S.productCache[bc];
    if (!p) return '';
    return renderProductCard(p);
  }).filter(Boolean).join('');
}

/* ============================================================
   CHECKOUT
   ============================================================ */
function openCheckout() {
  const checked = Object.entries(S.cart).filter(([, i]) => i.checked);
  if (!checked.length) { showToast('Выберите товары для заказа'); return; }
  renderCheckoutBody();
  openModal('checkout');
}

function renderCheckoutBody() {
  const checked = Object.entries(S.cart).filter(([, i]) => i.checked);
  let sum = 0, clubSum = 0;
  const itemsHtml = checked.map(([bc, item]) => {
    const p = item.product || S.productCache[bc] || {};
    const price = getEffectivePrice(p);
    const clubPrice = p.clubPrice;
    const lineTotal = price * item.qty;
    const lineClub = clubPrice && clubPrice < price ? clubPrice * item.qty : lineTotal;
    sum += lineTotal;
    clubSum += lineClub;
    return `<div class="ci-small">
      <span class="ci-small-name">${esc(p.name || 'Товар')}</span>
      <span class="ci-small-qty">×${item.qty}</span>
      <span class="ci-small-price">${fmt(lineTotal)} ₸</span>
    </div>`;
  }).join('');

  const saved = S.hasClubCard ? (sum - clubSum) : 0;
  const total = S.hasClubCard ? clubSum : sum;
  const addr = S.user?.address || {};
  const delivPrice = S.settings.deliveryPrice || DELIVERY_PRICE;

  document.getElementById('checkout-body').innerHTML = `
    <!-- Items -->
    <div class="checkout-section">
      <div class="checkout-sec-title">Состав заказа (${checked.length} поз.)</div>
      <div class="checkout-items-list">${itemsHtml}</div>
    </div>

    <!-- Summary -->
    <div class="checkout-section">
      <div class="checkout-sec-title">Стоимость</div>
      <div class="checkout-summary">
        <div class="co-sum-row"><span>Товары</span><span>${fmt(sum)} ₸</span></div>
        ${S.hasClubCard && saved > 0
          ? `<div class="co-sum-row"><span>По клубной карте</span><span class="text-red">${fmt(clubSum)} ₸</span></div>
             <div class="co-sum-row saved"><span>Скидка по КК</span><span>−${fmt(saved)} ₸</span></div>`
          : ''}
        <div class="co-sum-row"><span>Доставка</span><span>${fmt(delivPrice)} ₸</span></div>
        <div class="co-sum-row main"><span>Итого</span><span>${fmt(total)} ₸</span></div>
      </div>
    </div>

    <!-- Address -->
    <div class="checkout-section">
      <div class="checkout-sec-title">Адрес доставки</div>
      <div class="addr-display" id="co-addr-display">
        ${formatAddress(addr)}
      </div>
      <span class="addr-change" onclick="toggleCoAddrEdit()">Изменить адрес</span>
      <div id="co-addr-edit" style="display:none;margin-top:10px">
        <div class="inp-wrap">
          <div class="inp-label">Улица</div>
          <input class="inp" id="co-street" type="text" value="${esc(addr.street||'')}">
        </div>
        <div style="display:flex;gap:10px">
          <div class="inp-wrap" style="flex:1">
            <div class="inp-label">Дом</div>
            <input class="inp" id="co-house" type="text" value="${esc(addr.house||'')}">
          </div>
          <div class="inp-wrap" style="flex:1">
            <div class="inp-label">Квартира</div>
            <input class="inp" id="co-apt" type="text" value="${esc(addr.apt||'')}">
          </div>
        </div>
        <label class="cb-row" onclick="toggleCoIntercom()">
          <div class="cb-box ${addr.intercom ? 'checked' : ''}" id="co-intercom-cb"></div>
          <span class="cb-label">Есть домофон</span>
        </label>
      </div>
    </div>

    <!-- Payment -->
    <div class="checkout-section">
      <div class="checkout-sec-title">Способ оплаты</div>
      <div class="payment-btns">
        <button class="pay-btn sel" id="pay-cash" onclick="selectPayment('cash')">💵 Наличные</button>
        <button class="pay-btn" id="pay-card" onclick="selectPayment('card')">💳 Карта</button>
      </div>
      <div id="pay-cash-extra">
        <div class="inp-wrap">
          <div class="inp-label">Подготовить сдачу с</div>
          <input class="inp" id="co-cash-from" type="number" placeholder="Например: 5000">
        </div>
      </div>
      <div id="pay-card-extra" style="display:none">
        <div class="inp-label" style="margin-bottom:8px">Банк</div>
        <div class="bank-btns">
          ${['Kaspi','Halyk','Alatau','Eurasian','Другой'].map(b =>
            `<button class="bank-btn" id="bank-${b}" onclick="selectBank('${b}')">${b}</button>`
          ).join('')}
        </div>
      </div>
    </div>

    <!-- Comment -->
    <div class="checkout-section">
      <div class="checkout-sec-title">Комментарий к заказу</div>
      <textarea class="inp" id="co-comment" rows="3" placeholder="Особые пожелания, код домофона..."></textarea>
    </div>
  `;

  // State vars for checkout
  window._coPayment = 'cash';
  window._coBank = '';
  window._coIntercom = !!addr.intercom;
}

function toggleCoAddrEdit() {
  const el = document.getElementById('co-addr-edit');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function toggleCoIntercom() {
  window._coIntercom = !window._coIntercom;
  document.getElementById('co-intercom-cb').classList.toggle('checked', window._coIntercom);
}

function selectPayment(type) {
  window._coPayment = type;
  document.getElementById('pay-cash').classList.toggle('sel', type === 'cash');
  document.getElementById('pay-card').classList.toggle('sel', type === 'card');
  document.getElementById('pay-cash-extra').style.display = type === 'cash' ? 'block' : 'none';
  document.getElementById('pay-card-extra').style.display = type === 'card' ? 'block' : 'none';
}

function selectBank(bank) {
  window._coBank = bank;
  document.querySelectorAll('.bank-btn').forEach(b =>
    b.classList.toggle('sel', b.id === `bank-${bank}`)
  );
}

async function placeOrder() {
  const btn = document.getElementById('btn-place-order');
  const checked = Object.entries(S.cart).filter(([, i]) => i.checked);
  if (!checked.length) { showToast('Нет выбранных товаров'); return; }

  // Collect address from checkout form
  const editVisible = document.getElementById('co-addr-edit').style.display !== 'none';
  let addr;
  if (editVisible) {
    addr = {
      street:   document.getElementById('co-street').value.trim(),
      house:    document.getElementById('co-house').value.trim(),
      apt:      document.getElementById('co-apt').value.trim(),
      intercom: window._coIntercom,
    };
  } else {
    addr = S.user?.address || {};
  }

  if (!addr.street || !addr.house) { showToast('Укажите адрес доставки'); return; }

  btn.disabled = true;
  btn.textContent = 'Оформляем...';

  let sum = 0, clubSum = 0;
  const items = checked.map(([bc, item]) => {
    const p = item.product || S.productCache[bc] || {};
    const price = getEffectivePrice(p);
    const club  = p.clubPrice && p.clubPrice < price ? p.clubPrice : price;
    sum     += price * item.qty;
    clubSum += club  * item.qty;
    return {
      barcode: bc,
      name:    p.name || '',
      qty:     item.qty,
      price,
      clubPrice: p.clubPrice || price,
      total: price * item.qty,
    };
  });

  const delivPrice = S.settings.deliveryPrice || DELIVERY_PRICE;
  const total = S.hasClubCard ? clubSum : sum;

  const order = {
    uid:         S.uid,
    userId:      S.uid,
    userName:    S.user.firstName || '',
    userPhone:   S.user.phone || '',
    items,
    sum,
    clubSum:     S.hasClubCard ? clubSum : null,
    saved:       S.hasClubCard ? (sum - clubSum) : 0,
    total,
    hasClubCard: S.hasClubCard,
    deliveryPrice: delivPrice,
    address:     addr,
    paymentType: window._coPayment,
    cashFrom:    window._coPayment === 'cash' ? (document.getElementById('co-cash-from').value || '') : '',
    bank:        window._coPayment === 'card' ? window._coBank : '',
    comment:     document.getElementById('co-comment').value.trim(),
    status:      'new',
    createdAt:   dbServerTimestamp(),
  };

  const orderId = 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  await dbSetFull('orders', orderId, order);

  // Clear checked items from cart
  checked.forEach(([bc]) => delete S.cart[bc]);
  await saveCartToDB();
  updateCartBadge();

  closeModal('checkout');
  showToast('Заказ оформлен! Мы скоро свяжемся с вами.', 4000);
  renderCart();

  btn.disabled = false;
  btn.textContent = 'Подтвердить заказ';

  // Send data to Telegram if available
  if (tg) {
    tg.sendData(JSON.stringify({ action: 'order_placed', orderId }));
  }
}

function closeCheckout() { closeModal('checkout'); }

/* ============================================================
   PROFILE
   ============================================================ */
function openProfile() {
  if (!S.user) return;
  const name = S.user.firstName || '';
  const initial = name.charAt(0).toUpperCase();
  document.getElementById('profile-avatar').textContent = initial || '👤';
  document.getElementById('profile-disp-name').textContent = name;
  document.getElementById('profile-disp-phone').textContent = S.user.phone || '';
  document.getElementById('profile-name-inp').value = name;
  const addr = S.user.address || {};
  document.getElementById('profile-street').value = addr.street || '';
  document.getElementById('profile-house').value  = addr.house  || '';
  document.getElementById('profile-apt').value    = addr.apt    || '';
  S.profileIntercom = !!addr.intercom;
  document.getElementById('profile-intercom-cb').classList.toggle('checked', S.profileIntercom);
  openModal('profile');
}

function toggleProfileIntercom() {
  S.profileIntercom = !S.profileIntercom;
  document.getElementById('profile-intercom-cb').classList.toggle('checked', S.profileIntercom);
}

async function saveProfileName() {
  const name = document.getElementById('profile-name-inp').value.trim();
  if (!name) { showToast('Введите имя'); return; }
  await dbSet('users', S.uid, { firstName: name });
  S.user.firstName = name;
  document.getElementById('cart-user-name').textContent = name;
  document.getElementById('profile-disp-name').textContent = name;
  showToast('Имя сохранено');
}

async function saveProfileAddress() {
  const addr = {
    street:   document.getElementById('profile-street').value.trim(),
    house:    document.getElementById('profile-house').value.trim(),
    apt:      document.getElementById('profile-apt').value.trim(),
    intercom: S.profileIntercom,
  };
  if (!addr.street || !addr.house) { showToast('Заполните улицу и дом'); return; }
  await dbSet('users', S.uid, { address: addr });
  S.user.address = addr;
  showToast('Адрес сохранён');
}

function closeProfile() { closeModal('profile'); }

/* ============================================================
   MODAL HELPERS
   ============================================================ */
function openModal(name) {
  document.getElementById(`overlay-${name}`).classList.add('active');
  document.getElementById(`modal-${name}`).classList.add('active');
}

function closeModal(name) {
  document.getElementById(`overlay-${name}`).classList.remove('active');
  document.getElementById(`modal-${name}`).classList.remove('active');
}

/* ============================================================
   UTILITIES
   ============================================================ */
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

function getEffectivePrice(p) {
  if (!p) return 0;
  if (p.promoPrice && isPromoActive(p)) return p.promoPrice;
  return p.price || 0;
}

function isPromoActive(p) {
  if (!p.promoPrice) return false;
  const now = Date.now();
  const start = p.promoStart ? new Date(p.promoStart).getTime() : 0;
  const end   = p.promoEnd   ? new Date(p.promoEnd).getTime()   : Infinity;
  return now >= start && now <= end;
}

function formatAddress(addr) {
  if (!addr) return 'Адрес не указан';
  const parts = [
    addr.street ? `ул. ${addr.street}` : '',
    addr.house  ? `д. ${addr.house}`   : '',
    addr.apt    ? `кв. ${addr.apt}`    : '',
  ].filter(Boolean);
  let s = parts.join(', ');
  if (addr.intercom) s += ' (есть домофон)';
  return s || 'Адрес не указан';
}
