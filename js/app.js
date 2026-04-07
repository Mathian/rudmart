/* ============================================================
   RudMart WebApp — Buyer Application Logic
   ============================================================ */

/* ---- Global state ---- */
let STATE = {
  uid:        null,
  user:       null,
  cart:       {},      // { barcode: { product, qty, checked } }
  favorites:  [],      // [barcode, ...]
  clubCard:   false,
  currentTab: 'shop',
  catPageLast: null,   // Firestore pagination cursor
  catProductsLoaded: false,
  currentCat: null,
  searchPageLast: null,
  offerUrl:   '',
  payMethod:  'cash',
  payBank:    '',
  changeFrom: '',
};

/* ================================================================
   INIT
   ================================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  // Telegram WebApp setup
  if (tg) {
    tg.ready();
    tg.expand();
    tg.BackButton.onClick(handleBack);
  }

  initFirebase();
  loadStateFromLS();
  replaceScreen('s-splash');

  // Get UID from URL
  const params = new URLSearchParams(window.location.search);
  const urlUid = params.get('uid');
  if (urlUid) {
    STATE.uid = urlUid;
    localStorage.setItem('rm_uid', urlUid);
    window.history.replaceState({}, document.title, window.location.pathname);
  } else {
    STATE.uid = localStorage.getItem('rm_uid') || null;
  }

  if (!STATE.uid) {
    setTimeout(() => replaceScreen('s-no-uid'), 1200);
    return;
  }

  // Anonymous Firebase auth
  try { await firebase.auth().signInAnonymously(); } catch (_) {}

  // Check user
  const user = await dbGet('users', STATE.uid);
  if (user && user.consentGiven) {
    STATE.user = user;
    await initMain();
  } else if (user && !user.consentGiven) {
    STATE.user = user;
    await loadOfferUrl();
    replaceScreen('s-consent');
  } else {
    await prefillRegistration();
    replaceScreen('s-register');
  }
});

function loadStateFromLS() {
  try {
    STATE.cart      = JSON.parse(localStorage.getItem('rm_cart') || '{}');
    STATE.favorites = JSON.parse(localStorage.getItem('rm_favs') || '[]');
    STATE.clubCard  = localStorage.getItem('rm_club') === '1';
  } catch (_) {}
}

function saveCartToLS() {
  try {
    localStorage.setItem('rm_cart', JSON.stringify(STATE.cart));
  } catch (_) {}
}

function saveFavsToLS() {
  try {
    localStorage.setItem('rm_favs', JSON.stringify(STATE.favorites));
  } catch (_) {}
}

function handleBack() {
  const activeSlide = document.querySelector('#s-product.active, #s-category.active, #s-search.active, #s-profile.active, #s-checkout.active');
  if (activeSlide) {
    activeSlide.classList.remove('active');
    document.getElementById('s-main').classList.add('active');
    if (tg) tg.BackButton.hide();
  }
}

/* ================================================================
   REGISTRATION
   ================================================================ */
async function prefillRegistration() {
  const tgUser = tg?.initDataUnsafe?.user;
  const nameEl  = document.getElementById('reg-name');
  const phoneEl = document.getElementById('reg-phone');

  if (tgUser?.first_name && nameEl)
    nameEl.value = tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : '');

  if (STATE.uid) {
    const link = await dbGet('user_links', STATE.uid);
    if (link?.phone && phoneEl) {
      phoneEl.value    = link.phone;
      phoneEl.readOnly = true;
      const lockEl = document.getElementById('phone-lock');
      if (lockEl) lockEl.style.display = '';
    }
    if (link?.firstName && nameEl && !nameEl.value)
      nameEl.value = link.firstName;
  }
}

async function submitRegistration() {
  const name     = v('reg-name');
  const phone    = v('reg-phone');
  const street   = v('reg-street');
  const house    = v('reg-house');
  const apt      = v('reg-apt');
  const intercom = document.getElementById('reg-intercom')?.checked;

  if (!name)   { showToast('Введите ваше имя', 'err'); return; }
  if (!street) { showToast('Введите улицу доставки', 'err'); return; }
  if (!house)  { showToast('Введите номер дома', 'err'); return; }

  const tgUser = tg?.initDataUnsafe?.user;
  const user = {
    uid:      STATE.uid,
    tgId:     String(tgUser?.id || ''),
    name,
    phone,
    address:  { street, house, apt: apt || '', intercom: !!intercom },
    consentGiven: false,
    createdAt: new Date().toISOString(),
  };

  showLoading();
  await dbSet('users', STATE.uid, user);
  STATE.user = user;
  hideLoading();

  await loadOfferUrl();
  replaceScreen('s-consent');
}

function v(id) {
  return (document.getElementById(id)?.value || '').trim();
}

/* ================================================================
   CONSENT
   ================================================================ */
async function loadOfferUrl() {
  const settings = await dbGet('settings', 'app');
  STATE.offerUrl = settings?.offerUrl || '';
  const linkEl = document.getElementById('offer-link');
  if (linkEl) {
    if (STATE.offerUrl) {
      linkEl.href = STATE.offerUrl;
      linkEl.style.display = '';
    } else {
      linkEl.style.display = 'none';
    }
  }
}

function openOfferLink() {
  if (STATE.offerUrl) {
    if (tg) tg.openLink(STATE.offerUrl);
    else window.open(STATE.offerUrl, '_blank');
  } else {
    showToast('Ссылка на оферту не настроена');
  }
}

async function submitConsent() {
  if (!document.getElementById('consent-cb')?.checked) {
    showToast('Необходимо принять публичную оферту', 'err');
    return;
  }
  showLoading();
  await dbSet('users', STATE.uid, { consentGiven: true, consentAt: new Date().toISOString() });
  STATE.user.consentGiven = true;
  hideLoading();
  await initMain();
}

/* ================================================================
   MAIN APP INIT
   ================================================================ */
async function initMain() {
  replaceScreen('s-main');
  updateCartBadge();
  renderCartUserName();

  // Load data
  loadActivityData();
  await Promise.all([
    syncCartFromDB(),
    syncFavsFromDB(),
  ]);

  renderCart();
  renderFavorites();
  updateCartBadge();
  switchTab('shop');
  renderShop();
}

/* ================================================================
   TABS
   ================================================================ */
function switchTab(tab) {
  STATE.currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const tabEl = document.getElementById('tab-' + tab);
  const btnEl = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
  if (tabEl) tabEl.classList.add('active');
  if (btnEl) btnEl.classList.add('active');

  if (tab === 'cart') renderCart();
  if (tab === 'favorites') renderFavorites();
}

/* ================================================================
   SHOP — BANNERS
   ================================================================ */
async function renderShop() {
  renderCategories();
  await Promise.all([loadBanners(), loadBestOffers(), loadForYou()]);
}

/* ================================================================
   FOR YOU FEED — релевантная лента
   ================================================================ */

// Собираем сигналы интереса из STATE
function collectInterestSignals() {
  const signals = new Map(); // categoryId → score

  // Корзина — вес 3
  Object.values(STATE.cart).forEach(item => {
    const cat = item.product?.category;
    if (cat) signals.set(cat, (signals.get(cat) || 0) + 3);
  });

  // Избранное — вес 2
  STATE.favorites.forEach(id => {
    const cached = STATE._prodCache?.[id];
    if (cached?.category) signals.set(cached.category, (signals.get(cached.category) || 0) + 2);
  });

  // История просмотра — вес 1
  (STATE._viewHistory || []).forEach(cat => {
    if (cat) signals.set(cat, (signals.get(cat) || 0) + 1);
  });

  // Купленные заказы — вес 4
  (STATE._purchasedCategories || []).forEach(cat => {
    if (cat) signals.set(cat, (signals.get(cat) || 0) + 4);
  });

  return [...signals.entries()].sort((a, b) => b[1] - a[1]);
}

let _forYouLastCat = null;
let _forYouLastDoc = null;
let _forYouShown   = new Set();

async function loadForYou(append = false) {
  if (!append) {
    _forYouLastCat = null;
    _forYouLastDoc = null;
    _forYouShown   = new Set();
  }

  const section = document.getElementById('for-you-section');
  const grid    = document.getElementById('for-you-grid');
  const moreBtn = document.getElementById('for-you-more');
  if (!section || !grid) return;

  const signals = collectInterestSignals();

  // Если совсем нет сигналов — скрываем блок
  if (!signals.length && !append) {
    section.style.display = 'none';
    return;
  }

  // Берём первую (самую релевантную) категорию или fallback 'other'
  const targetCat = _forYouLastCat || signals[0]?.[0] || 'other';
  _forYouLastCat = targetCat;

  try {
    let ref = db.collection('products')
      .where('category', '==', targetCat)
      .limit(10);
    if (_forYouLastDoc) ref = ref.startAfter(_forYouLastDoc);

    const snap = await ref.get();
    const docs = snap.docs.filter(d => !_forYouShown.has(d.id));

    if (!docs.length) {
      if (moreBtn) moreBtn.style.display = 'none';
      return;
    }

    docs.forEach(d => {
      const p = { id: d.id, ...d.data() };
      _forYouShown.add(d.id);
      // Cache for future signal collection
      if (!STATE._prodCache) STATE._prodCache = {};
      STATE._prodCache[d.id] = p;
      const el = document.createElement('div');
      el.innerHTML = makeCard(p, 'grid');
      grid.appendChild(el.firstElementChild);
    });

    _forYouLastDoc = snap.docs[snap.docs.length - 1] || null;
    section.style.display = '';
    if (moreBtn) moreBtn.style.display = docs.length >= 10 ? 'block' : 'none';
  } catch (e) {
    section.style.display = 'none';
  }
}

function loadMoreForYou() {
  loadForYou(true);
}

// Записываем просмотренную категорию в историю
function trackViewHistory(category) {
  if (!category) return;
  if (!STATE._viewHistory) STATE._viewHistory = [];
  STATE._viewHistory.unshift(category);
  if (STATE._viewHistory.length > 50) STATE._viewHistory.pop();
  try {
    localStorage.setItem('rm_view_history',
      JSON.stringify([...new Set(STATE._viewHistory)].slice(0, 20)));
  } catch (_) {}
}

// Загружаем историю и купленные категории
function loadActivityData() {
  try {
    STATE._viewHistory = JSON.parse(localStorage.getItem('rm_view_history') || '[]');
  } catch (_) { STATE._viewHistory = []; }

  // Купленные категории из корзины/заказов уже в STATE.cart
  STATE._purchasedCategories = [];
  Object.values(STATE.cart).forEach(item => {
    const cat = item.product?.category;
    if (cat && !STATE._purchasedCategories.includes(cat))
      STATE._purchasedCategories.push(cat);
  });
}

async function loadBanners() {
  const settings = await dbGet('settings', 'app');
  if (!settings?.bannersEnabled) {
    document.getElementById('banners-wrap').style.display = 'none';
    return;
  }
  let banners = [];
  try {
    const snap = await db.collection('banners').where('active', '==', true).orderBy('order').get();
    banners = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) {}

  const wrap = document.getElementById('banners-scroll');
  const dots = document.getElementById('banner-dots');
  if (!wrap) return;

  if (!banners.length) {
    document.getElementById('banners-wrap').style.display = 'none';
    return;
  }

  wrap.innerHTML = banners.map((b, i) => `
    <div class="banner-card">
      ${b.imageUrl ? `<img src="${esc(b.imageUrl)}" alt="">` : `<div style="background:var(--reddim);width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--red2)">${esc(b.title||'RudMart')}</div>`}
    </div>`).join('');

  if (dots) dots.innerHTML = banners.map((_, i) =>
    `<div class="banner-dot${i===0?' active':''}"></div>`).join('');

  // Auto-scroll
  let cur = 0;
  setInterval(() => {
    cur = (cur + 1) % banners.length;
    wrap.scrollTo({ left: cur * wrap.offsetWidth, behavior: 'smooth' });
    document.querySelectorAll('.banner-dot').forEach((d, i) => d.classList.toggle('active', i === cur));
  }, 4000);
}

/* ================================================================
   SHOP — CATEGORIES GRID
   ================================================================ */
function renderCategories() {
  const grid = document.getElementById('cats-grid');
  if (!grid) return;
  grid.innerHTML = SUPERMARKET_CATEGORIES.map(cat => `
    <div class="cat-card" onclick="openCategory('${cat.id}')">
      <div class="cat-emoji">${cat.emoji}</div>
      <div class="cat-name">${esc(cat.name)}</div>
    </div>`).join('');
}

/* ================================================================
   SHOP — BEST OFFERS
   ================================================================ */
async function loadBestOffers() {
  const scroll = document.getElementById('offers-scroll');
  if (!scroll) return;
  scroll.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:13px;">Загрузка…</div>';

  try {
    const snap = await db.collection('products')
      .where('isBestOffer', '==', true)
      .where('stock', '>', 0)
      .limit(20).get();
    const prods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!prods.length) {
      document.getElementById('best-offers-section').style.display = 'none';
      return;
    }
    scroll.innerHTML = prods.map(p => makeCard(p, 'offer')).join('');
  } catch (e) {
    document.getElementById('best-offers-section').style.display = 'none';
  }
}

/* ================================================================
   CATEGORY VIEW
   ================================================================ */
async function openCategory(catId) {
  STATE.currentCat = catId;
  STATE.catPageLast = null;
  trackViewHistory(catId);
  STATE.catProductsLoaded = false;

  const cat = SUPERMARKET_CATEGORIES.find(c => c.id === catId);
  document.getElementById('cat-screen-title').textContent = (cat?.emoji || '') + ' ' + (cat?.name || catId);
  document.getElementById('cat-products-list').innerHTML = '';

  document.getElementById('s-main').classList.remove('active');
  document.getElementById('s-category').classList.add('active');
  if (tg) tg.BackButton.show();

  await loadCategoryProducts();
}

async function loadCategoryProducts() {
  if (STATE.catProductsLoaded) return;
  const list = document.getElementById('cat-products-list');
  const loadMore = document.getElementById('cat-load-more');

  if (loadMore) loadMore.style.display = 'none';
  const spinner = document.createElement('div');
  spinner.style.cssText = 'text-align:center;padding:20px;color:var(--text3);font-size:13px;';
  spinner.textContent = 'Загрузка…';
  list.appendChild(spinner);

  const { docs, last } = await dbQueryPage('products',
    [['category', '==', STATE.currentCat]],
    PRODUCTS_PER_PAGE, STATE.catPageLast);

  list.removeChild(spinner);

  if (!docs.length && !STATE.catPageLast) {
    list.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:14px;">Товары не найдены</div>';
    return;
  }

  const grid = list.querySelector('.products-grid') || (() => {
    const g = document.createElement('div');
    g.className = 'products-grid';
    list.appendChild(g);
    return g;
  })();

  docs.forEach(p => {
    const div = document.createElement('div');
    div.innerHTML = makeCard(p, 'grid');
    grid.appendChild(div.firstElementChild);
  });

  STATE.catPageLast = last;
  if (last && docs.length === PRODUCTS_PER_PAGE) {
    if (loadMore) loadMore.style.display = 'block';
  }
}

function closeCatScreen() {
  document.getElementById('s-category').classList.remove('active');
  document.getElementById('s-main').classList.add('active');
  if (tg) tg.BackButton.hide();
}

/* ================================================================
   SEARCH
   ================================================================ */
const _handleSearchDebounced = debounce(handleSearch, 280);

function onSearchInput(val) {
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.toggle('show', val.length > 0);
  _handleSearchDebounced(val);
}

async function handleSearch(val) {
  const q  = val.toLowerCase().trim();
  const dd = document.getElementById('search-dropdown');
  if (!dd) return;

  if (q.length < 2) { dd.classList.remove('show'); return; }

  const results = await dbSearchProducts(q, SEARCH_LIMIT);

  if (!results.length) {
    dd.innerHTML = '<div class="sd-empty">Ничего не найдено</div>';
    dd.classList.add('show');
    return;
  }

  dd.innerHTML = results.map(p => `
    <div class="sd-item" onclick="openProduct('${esc(p.id || p.barcode)}')">
      <div class="sd-img">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" loading="lazy">` : (p.emoji || '🛒')}</div>
      <div class="sd-name">${esc(trunc(p.name, 40))}</div>
      <div class="sd-price">${fmtPrice(getPrice(p, STATE.clubCard))}</div>
    </div>`).join('');
  dd.classList.add('show');
}

function clearSearch() {
  const inp = document.getElementById('search-inp');
  if (inp) { inp.value = ''; inp.focus(); }
  document.getElementById('search-dropdown')?.classList.remove('show');
  document.getElementById('search-clear')?.classList.remove('show');
}

function closeDropdown() {
  setTimeout(() => document.getElementById('search-dropdown')?.classList.remove('show'), 200);
}

async function performSearch() {
  const q = (document.getElementById('search-inp')?.value || '').trim();
  if (q.length < 2) { showToast('Введите хотя бы 2 символа', 'err'); return; }

  document.getElementById('search-dropdown')?.classList.remove('show');
  document.getElementById('s-main').classList.remove('active');
  document.getElementById('s-search').classList.add('active');
  if (tg) tg.BackButton.show();

  document.getElementById('search-res-query').textContent = `«${q}»`;
  document.getElementById('search-res-count').textContent = 'Поиск…';
  document.getElementById('search-res-grid').innerHTML = '';

  try {
    const results = await dbSearchProducts(q, 50);
    document.getElementById('search-res-count').textContent = `Найдено: ${results.length} товаров`;
    if (!results.length) {
      document.getElementById('search-res-grid').innerHTML =
        '<div class="empty-state"><div class="empty-ico">🔍</div><div class="empty-title">Ничего не найдено</div><div class="empty-sub">Попробуйте другой запрос</div></div>';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'products-grid';
    grid.style.padding = '14px 16px';
    results.forEach(p => {
      const d = document.createElement('div');
      d.innerHTML = makeCard(p, 'grid');
      grid.appendChild(d.firstElementChild);
    });
    document.getElementById('search-res-grid').appendChild(grid);
  } catch (e) {
    document.getElementById('search-res-count').textContent = 'Ошибка поиска';
  }
}

function closeSearchScreen() {
  document.getElementById('s-search').classList.remove('active');
  document.getElementById('s-main').classList.add('active');
  if (tg) tg.BackButton.hide();
}

/* ================================================================
   PRODUCT CARD (mini)
   ================================================================ */
function makeCard(p, type) {
  const id         = p.id || p.barcode || '';
  const inStock    = Number(p.stock) > 0;
  const isFav      = STATE.favorites.includes(id);
  const inCart     = !!STATE.cart[id];
  const cartQty    = STATE.cart[id]?.qty || 0;
  const price      = getPrice(p, STATE.clubCard);
  const clubPrice  = (p.clubPrice && Number(p.clubPrice) < Number(p.price)) ? Number(p.clubPrice) : null;
  const promoActive= isPromoActive(p);
  const imgHtml    = p.imageUrl
    ? `<img src="${esc(p.imageUrl)}" loading="lazy" alt="${esc(p.name)}">`
    : `<div class="prod-img-emoji">${p.emoji || '🛒'}</div>`;

  return `
<div class="prod-card">
  <div class="prod-img-wrap" onclick="openProduct('${esc(id)}')">
    ${imgHtml}
    ${promoActive ? `<div class="prod-promo-badge">АКЦИЯ</div>` : ''}
    <button class="prod-fav-btn${isFav?' active':''}" onclick="event.stopPropagation();toggleFavorite('${esc(id)}')" title="В избранное">
      ${isFav ? '❤️' : '🤍'}
    </button>
  </div>
  <div class="prod-body">
    <div class="prod-name" onclick="openProduct('${esc(id)}')">${esc(p.name)}</div>
    <div class="${inStock?'prod-stock-ok':'prod-stock-no'}">${inStock?'● Есть в наличии':'● Нет в наличии'}</div>
    <div class="prod-prices">
      <div class="prod-price">${fmtPrice(price)}</div>
      ${clubPrice ? `<div class="prod-club">🎫 ${fmtPrice(clubPrice)}</div>` : ''}
      ${promoActive && p.price ? `<div class="prod-price-old">${fmtPrice(p.price)}</div>` : ''}
    </div>
    <div class="prod-actions">
      ${inStock ? (inCart
        ? `<div class="qty-ctrl">
             <button class="qty-btn" onclick="changeQty('${esc(id)}',-1)">−</button>
             <span class="qty-val">${cartQty}</span>
             <button class="qty-btn" onclick="changeQty('${esc(id)}',1)">+</button>
           </div>`
        : `<button class="prod-cart-btn" onclick="addToCart('${esc(id)}')">В корзину</button>`)
        : `<button class="prod-cart-btn" disabled>Нет в наличии</button>`}
    </div>
  </div>
</div>`;
}

/* ================================================================
   PRODUCT DETAIL
   ================================================================ */
async function openProduct(id) {
  if (!STATE._productReturnTo) STATE._productReturnTo = null; // will be set by caller if needed
  showLoading();
  let p = await dbGet('products', id);
  hideLoading();
  if (!p) { showToast('Товар не найден'); return; }
  p.id = p.id || id;

  const inStock   = Number(p.stock) > 0;
  const isFav     = STATE.favorites.includes(id);
  const inCart    = !!STATE.cart[id];
  const cartQty   = STATE.cart[id]?.qty || 0;
  const price     = getPrice(p, STATE.clubCard);
  const clubPrice = (p.clubPrice && Number(p.clubPrice) < Number(p.price)) ? Number(p.clubPrice) : null;
  const promo     = isPromoActive(p);

  // Image
  const imgEl = document.getElementById('pd-image');
  if (imgEl) {
    if (p.imageUrl) {
      imgEl.innerHTML = `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}">`;
    } else {
      imgEl.innerHTML = p.emoji || '🛒';
      imgEl.style.fontSize = '80px';
    }
  }

  setText('pd-name', p.name);

  // Availability
  const avEl = document.getElementById('pd-avail');
  if (avEl) {
    avEl.textContent = inStock ? '● Есть в наличии' : '● Нет в наличии';
    avEl.className = 'prod-detail-avail ' + (inStock ? 'text-green' : 'text-red');
  }

  // Prices
  const pricesEl = document.getElementById('pd-prices');
  if (pricesEl) {
    pricesEl.innerHTML = `
      <div class="prod-price-main">${fmtPrice(price)}</div>
      ${clubPrice ? `<div class="prod-price-club">🎫 ${fmtPrice(clubPrice)}</div>` : ''}
      ${promo && p.price ? `<div class="prod-price-crossed">${fmtPrice(p.price)}</div>` : ''}`;
  }

  // Characteristics
  const chars = [];
  if (p.brand)       chars.push(['Бренд', p.brand]);
  if (p.volume)      chars.push(['Объём', p.volume]);
  if (p.mass)        chars.push(['Масса', p.mass]);
  if (p.fat != null && p.fat !== '') chars.push(['Жирность', p.fat + '%']);
  if (p.alcohol != null && p.alcohol !== '') chars.push(['Крепость', p.alcohol + '%']);
  if (p.carbonated != null) chars.push(['Газированный', p.carbonated ? 'Да' : 'Нет']);
  if (p.protein != null && p.protein !== '') chars.push(['Белки (100г)', p.protein + ' г']);
  if (p.fat100 != null && p.fat100 !== '')   chars.push(['Жиры (100г)', p.fat100 + ' г']);
  if (p.carbs != null && p.carbs !== '')     chars.push(['Углеводы (100г)', p.carbs + ' г']);

  const charsEl = document.getElementById('pd-chars');
  if (charsEl) {
    if (chars.length) {
      charsEl.style.display = '';
      document.getElementById('pd-chars-grid').innerHTML = chars.map(([l, v]) => `
        <div class="prod-char-row">
          <span class="prod-char-label">${esc(l)}</span>
          <span class="prod-char-val">${esc(String(v))}</span>
        </div>`).join('');
    } else {
      charsEl.style.display = 'none';
    }
  }

  // Fav button
  const favBtn = document.getElementById('pd-fav-btn');
  if (favBtn) {
    favBtn.textContent = isFav ? '❤️ В избранном' : '🤍 В избранное';
    favBtn.onclick = () => toggleFavorite(id);
  }

  // Cart button
  const cartBtn = document.getElementById('pd-cart-btn');
  if (cartBtn) {
    if (!inStock) {
      cartBtn.textContent = 'Нет в наличии';
      cartBtn.disabled = true;
    } else if (inCart) {
      cartBtn.textContent = `В корзине (${cartQty})`;
      cartBtn.disabled = false;
      cartBtn.onclick = () => switchTabAndClose('cart');
    } else {
      cartBtn.textContent = '+ В корзину';
      cartBtn.disabled = false;
      cartBtn.onclick = () => { addToCart(id, p); updateProductDetail(id); };
    }
  }

  // Store current product
  STATE._currentProductId = id;
  STATE._currentProduct = p;
  // Track for relevance feed
  trackViewHistory(p.category);
  if (!STATE._prodCache) STATE._prodCache = {};
  STATE._prodCache[id] = p;

  document.getElementById('s-main').classList.remove('active');
  document.getElementById('s-category').classList.remove('active');
  document.getElementById('s-product').classList.add('active');
  if (tg) tg.BackButton.show();
}

function updateProductDetail(id) {
  const cartBtn = document.getElementById('pd-cart-btn');
  if (!cartBtn) return;
  const inCart = !!STATE.cart[id];
  const qty = STATE.cart[id]?.qty || 0;
  if (inCart) {
    cartBtn.textContent = `В корзине (${qty})`;
    cartBtn.onclick = () => switchTabAndClose('cart');
  } else {
    cartBtn.textContent = '+ В корзину';
    cartBtn.onclick = () => { addToCart(id, STATE._currentProduct); updateProductDetail(id); };
  }
}

async function openProductFromCart(id) {
  // Remember we came from cart tab
  STATE._productReturnTo = 'cart';
  await openProduct(id);
}

function closeProductScreen() {
  document.getElementById('s-product').classList.remove('active');
  // Return to correct screen
  if (STATE._productReturnTo === 'cart') {
    STATE._productReturnTo = null;
    document.getElementById('s-main').classList.add('active');
    if (tg) tg.BackButton.hide();
    switchTab('cart');
    return;
  }
  const cat = STATE.currentCat;
  if (cat && document.getElementById('cat-products-list')?.children.length) {
    document.getElementById('s-category').classList.add('active');
  } else {
    document.getElementById('s-main').classList.add('active');
    if (tg) tg.BackButton.hide();
  }
}

function switchTabAndClose(tab) {
  document.getElementById('s-product').classList.remove('active');
  document.getElementById('s-category').classList.remove('active');
  document.getElementById('s-search').classList.remove('active');
  document.getElementById('s-main').classList.add('active');
  if (tg) tg.BackButton.hide();
  switchTab(tab);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || '';
}

/* ================================================================
   FAVORITES
   ================================================================ */
async function syncFavsFromDB() {
  try {
    const data = await dbGet('favorites', STATE.uid);
    if (data?.list) {
      STATE.favorites = data.list;
      saveFavsToLS();
    }
  } catch (_) {}
}

async function toggleFavorite(id) {
  const idx = STATE.favorites.indexOf(id);
  if (idx >= 0) {
    STATE.favorites.splice(idx, 1);
  } else {
    STATE.favorites.push(id);
  }
  saveFavsToLS();
  await dbSet('favorites', STATE.uid, { list: STATE.favorites, uid: STATE.uid });

  // Update fav buttons in current view
  document.querySelectorAll(`.prod-fav-btn`).forEach(btn => {
    const card = btn.closest('.prod-card');
    // Re-render is complex; just update icon
    const onclick = btn.getAttribute('onclick') || '';
    if (onclick.includes(`'${id}'`)) {
      const isFav = STATE.favorites.includes(id);
      btn.className = 'prod-fav-btn' + (isFav ? ' active' : '');
      btn.textContent = isFav ? '❤️' : '🤍';
    }
  });

  // Update detail screen fav btn
  if (STATE._currentProductId === id) {
    const btn = document.getElementById('pd-fav-btn');
    if (btn) btn.textContent = STATE.favorites.includes(id) ? '❤️ В избранном' : '🤍 В избранное';
  }

  if (STATE.currentTab === 'favorites') renderFavorites();
}

function renderFavorites() {
  const grid = document.getElementById('fav-grid');
  if (!grid) return;
  if (!STATE.favorites.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-ico">🤍</div>
        <div class="empty-title">Избранное пусто</div>
        <div class="empty-sub">Добавляйте товары в избранное, нажимая на ❤️</div>
      </div>`;
    return;
  }
  // Load products for favorites
  const cached = STATE.favorites.map(id => STATE.cart[id]?.product || STATE._prodCache?.[id]).filter(Boolean);
  if (cached.length === STATE.favorites.length) {
    renderFavGrid(cached);
  } else {
    // Load from Firestore
    Promise.all(STATE.favorites.map(id => dbGet('products', id))).then(prods => {
      renderFavGrid(prods.filter(Boolean));
    });
  }
}

function renderFavGrid(prods) {
  const grid = document.getElementById('fav-grid');
  if (!grid) return;
  if (!prods.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-ico">🤍</div><div class="empty-title">Избранное пусто</div></div>`;
    return;
  }
  const d = document.createElement('div');
  d.className = 'products-grid';
  d.innerHTML = prods.map(p => makeCard(p, 'fav')).join('');
  grid.innerHTML = '';
  grid.appendChild(d);
}

/* ================================================================
   CART
   ================================================================ */
async function syncCartFromDB() {
  try {
    const data = await dbGet('carts', STATE.uid);
    if (data?.items) {
      STATE.cart = data.items;
      saveCartToLS();
    }
  } catch (_) {}
}

async function addToCart(id, product) {
  if (!product) {
    product = await dbGet('products', id);
    if (!product) return;
  }
  if (STATE.cart[id]) {
    STATE.cart[id].qty += 1;
  } else {
    STATE.cart[id] = { product, qty: 1, checked: true };
  }
  saveCartToLS();
  updateCartBadge();
  await dbSet('carts', STATE.uid, { items: STATE.cart, uid: STATE.uid });
  showToast('Добавлено в корзину ✓', 'ok');
  refreshCardInView(id);
  if (STATE.currentTab === 'cart') renderCart();
}

async function changeQty(id, delta) {
  if (!STATE.cart[id]) return;
  STATE.cart[id].qty += delta;
  if (STATE.cart[id].qty <= 0) {
    delete STATE.cart[id];
  }
  saveCartToLS();
  updateCartBadge();
  await dbSet('carts', STATE.uid, { items: STATE.cart, uid: STATE.uid });
  refreshCardInView(id);
  if (STATE.currentTab === 'cart') renderCart();
}

async function removeFromCart(id) {
  delete STATE.cart[id];
  saveCartToLS();
  updateCartBadge();
  await dbSet('carts', STATE.uid, { items: STATE.cart, uid: STATE.uid });
  renderCart();
  refreshCardInView(id);
}

function refreshCardInView(id) {
  // Update any visible mini-cards
  document.querySelectorAll('.prod-card').forEach(card => {
    const favBtn = card.querySelector('.prod-fav-btn');
    if (!favBtn) return;
    const onclick = favBtn.getAttribute('onclick') || '';
    if (!onclick.includes(`'${id}'`)) return;
    // Re-render this card
    const p = STATE.cart[id]?.product;
    if (!p) return;
    const newCard = document.createElement('div');
    newCard.innerHTML = makeCard(p, 'grid');
    card.replaceWith(newCard.firstElementChild);
  });
}

function toggleCartItem(id) {
  if (STATE.cart[id]) STATE.cart[id].checked = !STATE.cart[id].checked;
  saveCartToLS();
  renderCartTotals();
}

function toggleClubCard() {
  STATE.clubCard = !STATE.clubCard;
  localStorage.setItem('rm_club', STATE.clubCard ? '1' : '0');
  renderCartTotals();
}

function updateCartBadge() {
  const total = Object.values(STATE.cart).reduce((s, i) => s + i.qty, 0);
  document.querySelectorAll('.cart-badge').forEach(el => {
    el.textContent = total;
    el.style.display = total > 0 ? 'flex' : 'none';
  });
}

function renderCartUserName() {
  const el = document.getElementById('cart-user-name');
  if (el) el.textContent = STATE.user?.name || 'Гость';
}

function renderCart() {
  renderCartUserName();

  const items = document.getElementById('cart-items');
  if (!items) return;

  const cartArr = Object.entries(STATE.cart);
  if (!cartArr.length) {
    items.innerHTML = `
      <div class="empty-state" style="margin:0;padding:48px 0">
        <div class="empty-ico">🛒</div>
        <div class="empty-title">Корзина пуста</div>
        <div class="empty-sub">Добавьте товары из каталога</div>
      </div>`;
    document.getElementById('cart-totals-section')?.style.setProperty('display','none');
    document.getElementById('cart-order-btn')?.setAttribute('disabled', '');
    return;
  }

  document.getElementById('cart-totals-section')?.style.removeProperty('display');
  document.getElementById('cart-order-btn')?.removeAttribute('disabled');

  items.innerHTML = cartArr.map(([id, item]) => {
    const p = item.product || {};
    const price = getPrice(p, false);
    const clubPrice = getPrice(p, true);
    return `
    <div class="cart-item">
      <input type="checkbox" class="cart-item-cb" ${item.checked !== false ? 'checked' : ''}
        onchange="toggleCartItem('${esc(id)}')">
      <div class="cart-item-img" onclick="openProductFromCart('${esc(id)}')" style="cursor:pointer">
        ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" loading="lazy">` : (p.emoji || '🛒')}
      </div>
      <div class="cart-item-body">
        <div class="cart-item-name" onclick="openProductFromCart('${esc(id)}')" style="cursor:pointer">${esc(p.name || id)}</div>
        <div class="prod-actions" style="margin-top:6px">
          <div class="qty-ctrl">
            <button class="qty-btn" onclick="changeQty('${esc(id)}',-1)">−</button>
            <span class="qty-val">${item.qty}</span>
            <button class="qty-btn" onclick="changeQty('${esc(id)}',1)">+</button>
          </div>
        </div>
        <div class="cart-item-price">${fmtPrice(price * item.qty)}</div>
        ${STATE.clubCard && clubPrice < price ? `<div class="cart-item-old">${fmtPrice(price * item.qty)}</div>` : ''}
      </div>
      <button class="cart-item-del" onclick="removeFromCart('${esc(id)}')">🗑</button>
    </div>`;
  }).join('');

  // Club card checkbox state
  const clubCb = document.getElementById('club-card-cb');
  if (clubCb) clubCb.checked = STATE.clubCard;

  renderCartTotals();
}

function renderCartTotals() {
  const checkedItems = Object.entries(STATE.cart).filter(([, i]) => i.checked !== false);

  let totalReg  = 0;
  let totalClub = 0;

  checkedItems.forEach(([, item]) => {
    const p = item.product || {};
    totalReg  += getPrice(p, false) * item.qty;
    totalClub += getPrice(p, true)  * item.qty;
  });

  const saved = totalReg - totalClub;
  const final = STATE.clubCard ? totalClub : totalReg;

  setText('cart-total-val', fmtPrice(totalReg));
  setText('cart-total-club', STATE.clubCard ? fmtPrice(totalClub) : '');

  const clubRow = document.getElementById('cart-club-total-row');
  const saveRow = document.getElementById('cart-save-row');
  if (clubRow) clubRow.style.display = STATE.clubCard ? 'flex' : 'none';
  if (saveRow) {
    saveRow.style.display = (STATE.clubCard && saved > 0) ? 'flex' : 'none';
    setText('cart-save-val', fmtPrice(saved));
  }

  setText('cart-final-val', fmtPrice(final + DELIVERY_COST));
}

/* ================================================================
   PROFILE
   ================================================================ */
function openProfile() {
  if (!STATE.user) return;
  const u = STATE.user;

  // Fill fields
  setVal('profile-name', u.name || '');
  setVal('profile-phone', u.phone || '');
  setVal('profile-street', u.address?.street || '');
  setVal('profile-house', u.address?.house || '');
  setVal('profile-apt', u.address?.apt || '');
  const ic = document.getElementById('profile-intercom');
  if (ic) ic.checked = !!u.address?.intercom;

  // Offer link
  const ol = document.getElementById('profile-offer-link');
  if (ol) {
    if (STATE.offerUrl) { ol.href = STATE.offerUrl; ol.style.display = ''; }
    else ol.style.display = 'none';
  }

  document.getElementById('s-main').classList.remove('active');
  document.getElementById('s-profile').classList.add('active');
  if (tg) tg.BackButton.show();
}

function closeProfile() {
  document.getElementById('s-profile').classList.remove('active');
  document.getElementById('s-main').classList.add('active');
  if (tg) tg.BackButton.hide();
  switchTab('cart');
}

async function saveProfile() {
  const name   = v('profile-name');
  const street = v('profile-street');
  const house  = v('profile-house');
  const apt    = v('profile-apt');
  const intercom = document.getElementById('profile-intercom')?.checked;

  if (!name) { showToast('Введите имя', 'err'); return; }
  if (!street) { showToast('Введите улицу', 'err'); return; }
  if (!house)  { showToast('Введите дом', 'err'); return; }

  showLoading();
  const updates = {
    name,
    address: { street, house, apt: apt || '', intercom: !!intercom },
  };
  await dbSet('users', STATE.uid, updates);
  STATE.user = { ...STATE.user, ...updates };
  hideLoading();
  showToast('Профиль сохранён ✓', 'ok');
  renderCartUserName();
  closeProfile();
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

/* ================================================================
   CHECKOUT
   ================================================================ */
function openCheckout() {
  const checkedItems = Object.entries(STATE.cart).filter(([, i]) => i.checked !== false);
  if (!checkedItems.length) {
    showToast('Выберите товары для заказа', 'err');
    return;
  }

  // Fill order summary
  const itemsEl = document.getElementById('checkout-items');
  if (itemsEl) {
    itemsEl.innerHTML = checkedItems.map(([, item]) => {
      const p = item.product || {};
      const price = getPrice(p, STATE.clubCard);
      return `
      <div class="checkout-item">
        <span class="checkout-item-name">${esc(p.name || '')}</span>
        <span class="checkout-item-qty">× ${item.qty}</span>
        <span class="checkout-item-price">${fmtPrice(price * item.qty)}</span>
      </div>`;
    }).join('');
  }

  // Totals
  let totalReg  = 0;
  let totalClub = 0;
  checkedItems.forEach(([, item]) => {
    const p = item.product || {};
    totalReg  += getPrice(p, false) * item.qty;
    totalClub += getPrice(p, true)  * item.qty;
  });
  const saved = totalReg - totalClub;
  const final = (STATE.clubCard ? totalClub : totalReg) + DELIVERY_COST;

  setText('co-total-reg',  fmtPrice(totalReg));
  setText('co-total-club', STATE.clubCard ? fmtPrice(totalClub) : '—');
  setText('co-total-save', (STATE.clubCard && saved > 0) ? fmtPrice(saved) : '—');
  setText('co-total-delivery', fmtPrice(DELIVERY_COST));
  setText('co-total-final', fmtPrice(final));

  const clubRow = document.getElementById('co-club-row');
  const saveRow = document.getElementById('co-save-row');
  if (clubRow) clubRow.style.display = STATE.clubCard ? '' : 'none';
  if (saveRow) saveRow.style.display = (STATE.clubCard && saved > 0) ? '' : 'none';

  // Pre-fill address from profile
  const addr = STATE.user?.address || {};
  setVal('co-street', addr.street || '');
  setVal('co-house', addr.house || '');
  setVal('co-apt', addr.apt || '');
  const coIc = document.getElementById('co-intercom');
  if (coIc) coIc.checked = !!addr.intercom;

  // Payment
  STATE.payMethod = 'cash';
  STATE.payBank = '';
  STATE.changeFrom = '';
  renderPayment();

  document.getElementById('s-main').classList.remove('active');
  document.getElementById('s-checkout').classList.add('active');
  if (tg) tg.BackButton.show();
}

function closeCheckout() {
  document.getElementById('s-checkout').classList.remove('active');
  document.getElementById('s-main').classList.add('active');
  if (tg) tg.BackButton.hide();
}

function selectPayMethod(method) {
  STATE.payMethod = method;
  renderPayment();
}

function selectBank(bank) {
  STATE.payBank = bank;
  document.querySelectorAll('.bank-btn').forEach(b => b.classList.toggle('sel', b.dataset.bank === bank));
}

function renderPayment() {
  document.querySelectorAll('.pay-btn').forEach(b => b.classList.toggle('sel', b.dataset.method === STATE.payMethod));
  const cashExtra = document.getElementById('co-cash-extra');
  const cardExtra = document.getElementById('co-card-extra');
  if (cashExtra) cashExtra.style.display = STATE.payMethod === 'cash' ? 'block' : 'none';
  if (cardExtra) cardExtra.style.display = STATE.payMethod === 'card' ? 'block' : 'none';
}

async function confirmOrder() {
  const street = v('co-street');
  const house  = v('co-house');
  const apt    = v('co-apt');
  const intercom = document.getElementById('co-intercom')?.checked;
  const comment = v('co-comment');

  if (!street) { showToast('Укажите улицу доставки', 'err'); return; }
  if (!house)  { showToast('Укажите дом', 'err'); return; }

  if (STATE.payMethod === 'card' && !STATE.payBank) {
    showToast('Выберите банк', 'err'); return;
  }

  const checkedItems = Object.entries(STATE.cart).filter(([, i]) => i.checked !== false);
  const items = checkedItems.map(([id, item]) => {
    const p = item.product || {};
    return {
      barcode: id,
      name: p.name || id,
      qty: item.qty,
      price: getPrice(p, STATE.clubCard),
      priceReg: getPrice(p, false),
    };
  });

  let total = 0;
  items.forEach(i => { total += i.price * i.qty; });
  total += DELIVERY_COST;

  const order = {
    uid: STATE.uid,
    userName: STATE.user?.name || '',
    userPhone: STATE.user?.phone || '',
    items,
    total,
    clubCard: STATE.clubCard,
    address: { street, house, apt: apt || '', intercom: !!intercom },
    payment: {
      method: STATE.payMethod,
      bank: STATE.payBank || null,
      changeFrom: STATE.payMethod === 'cash' ? (v('co-change-from') || '') : '',
    },
    comment: comment || '',
    status: 'new',
    createdAt: new Date().toISOString(),
  };

  const orderId = genOrderId();

  showLoading();
  try {
    await dbSet('orders', orderId, order);
    // Remove ordered items from cart
    checkedItems.forEach(([id]) => delete STATE.cart[id]);
    saveCartToLS();
    await dbSet('carts', STATE.uid, { items: STATE.cart, uid: STATE.uid });
    hideLoading();

    // Notify
    showToast('Заказ оформлен! ✓', 'ok');
    closeCheckout();
    updateCartBadge();
    renderCart();

    // Show success
    showOrderSuccess(orderId);
  } catch (e) {
    hideLoading();
    showToast('Ошибка при оформлении заказа', 'err');
  }
}

function showOrderSuccess(orderId) {
  const modal = document.getElementById('order-success-modal');
  if (modal) {
    document.getElementById('success-order-id').textContent = orderId;
    modal.classList.add('show');
  }
}

function closeOrderSuccess() {
  document.getElementById('order-success-modal')?.classList.remove('show');
  switchTab('shop');
}

/* ================================================================
   MY ORDERS
   ================================================================ */
const ORDER_STATUS_LABELS_BUYER = {
  new:       '🕐 Новый',
  accepted:  '✓ Принят',
  collected: '📦 Собирается',
  sent:      '🚚 В доставке',
  cancelled: '✕ Отменён',
};

async function openMyOrders() {
  const list = document.getElementById('my-orders-list');
  if (list) list.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text3)">Загрузка…</div>';

  document.getElementById('s-main').classList.remove('active');
  document.getElementById('s-my-orders').classList.add('active');
  if (tg) tg.BackButton.show();

  try {
    const snap = await db.collection('orders')
      .where('uid', '==', STATE.uid)
      .limit(50)
      .get();
    const orders = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    renderMyOrders(orders);
  } catch (e) {
    if (list) list.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text3)">Ошибка загрузки</div>';
  }
}

// Хранит все загруженные заказы для детального просмотра
let _myOrders = [];

function renderMyOrders(orders) {
  _myOrders = orders;
  const list = document.getElementById('my-orders-list');
  if (!list) return;

  if (!orders.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-ico">📋</div>
        <div class="empty-title">Заказов пока нет</div>
        <div class="empty-sub">Оформите первый заказ в магазине</div>
      </div>`;
    return;
  }

  const cancellable = ['new', 'accepted'];

  list.innerHTML = orders.map(o => {
    const statusClass = 'mos-' + (o.status || 'new');
    const statusLabel = ORDER_STATUS_LABELS_BUYER[o.status] || o.status;
    const itemsSummary = (o.items || []).slice(0, 3).map(i => i.name).join(', ')
      + ((o.items || []).length > 3 ? ` и ещё ${o.items.length - 3}…` : '');
    const canCancel = cancellable.includes(o.status);

    return `
    <div class="my-order-card" onclick="openMyOrderDetail('${esc(o.id)}')">
      <div class="my-order-top">
        <div class="my-order-id">${esc(o.id)}</div>
        <div class="my-order-date">${fmtDate(o.createdAt)}</div>
      </div>
      <div class="my-order-items">${esc(itemsSummary)}</div>
      <div class="my-order-bot">
        <div class="my-order-total">${fmtPrice(o.total)}</div>
        <div class="my-order-status ${statusClass}">${statusLabel}</div>
      </div>
      ${canCancel ? `
      <div class="my-order-cancel" onclick="event.stopPropagation()">
        <button class="btn btn-out btn-sm" style="color:var(--red-err);border-color:var(--red-err)"
          onclick="cancelMyOrder('${esc(o.id)}', this)">Отменить заказ</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function openMyOrderDetail(orderId) {
  const o = _myOrders.find(x => x.id === orderId);
  if (!o) return;
  STATE._currentDetailOrder = o;

  setText('mod-id-title', o.id);
  setText('mod-date', fmtDate(o.createdAt));

  const statusEl = document.getElementById('mod-status');
  if (statusEl) {
    statusEl.textContent = ORDER_STATUS_LABELS_BUYER[o.status] || o.status;
    statusEl.className = 'my-order-status mos-' + (o.status || 'new');
  }

  const addr = o.address;
  setText('mod-address', addr
    ? `${addr.street}, д.${addr.house}${addr.apt ? ', кв.' + addr.apt : ''}${addr.intercom ? ' (домофон)' : ''}`
    : '—');

  const pay = o.payment;
  setText('mod-payment', pay
    ? (pay.method === 'cash'
        ? `Наличные${pay.changeFrom ? ` (сдача с ${pay.changeFrom} ₸)` : ''}`
        : `Карта${pay.bank ? ' ' + pay.bank : ''}`)
    : '—');

  const commentRow = document.getElementById('mod-comment-row');
  if (o.comment) {
    setText('mod-comment', o.comment);
    if (commentRow) commentRow.style.display = '';
  } else {
    if (commentRow) commentRow.style.display = 'none';
  }

  // Items
  const itemsEl = document.getElementById('mod-items');
  if (itemsEl) {
    itemsEl.innerHTML = (o.items || []).map(item => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
        background:var(--card);border:1px solid var(--border2);border-radius:var(--r2);margin-bottom:8px">
        <div style="flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name)}</div>
        <div style="font-size:12px;color:var(--text2);white-space:nowrap">× ${item.qty}</div>
        <div style="font-size:13px;font-weight:800;color:var(--red2);white-space:nowrap">${fmtPrice((item.price || 0) * item.qty)}</div>
      </div>`).join('');
  }

  setText('mod-total', fmtPrice(o.total));

  // Cancel button
  const cancelWrap = document.getElementById('mod-cancel-wrap');
  if (cancelWrap)
    cancelWrap.style.display = ['new', 'accepted'].includes(o.status) ? 'block' : 'none';

  document.getElementById('s-my-orders').classList.remove('active');
  document.getElementById('s-my-order-detail').classList.add('active');
  if (tg) tg.BackButton.show();
}

function closeMyOrderDetail() {
  document.getElementById('s-my-order-detail').classList.remove('active');
  document.getElementById('s-my-orders').classList.add('active');
}

async function cancelMyOrder(orderId, btn, fromDetail = false) {
  const id = orderId || STATE._currentDetailOrder?.id;
  if (!id) return;
  if (!confirm('Отменить заказ ' + id + '?')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Отмена…'; }
  try {
    await dbSet('orders', id, { status: 'cancelled' });
    showToast('Заказ отменён', 'ok');
    // Update local cache
    const o = _myOrders.find(x => x.id === id);
    if (o) o.status = 'cancelled';
    if (fromDetail) {
      // Refresh detail screen
      openMyOrderDetail(id);
    } else {
      renderMyOrders(_myOrders);
    }
  } catch (e) {
    showToast('Ошибка отмены', 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Отменить заказ'; }
  }
}

function closeMyOrders() {
  document.getElementById('s-my-orders').classList.remove('active');
  document.getElementById('s-my-order-detail').classList.remove('active');
  document.getElementById('s-main').classList.add('active');
  if (tg) tg.BackButton.hide();
}
