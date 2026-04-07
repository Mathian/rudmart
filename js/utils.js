/* ============================================================
   RudMart — Shared utilities
   ============================================================ */

/* ---- Telegram WebApp handle ---- */
const tg = window.Telegram?.WebApp || null;

/* ---- Format price (₸) ---- */
function fmtPrice(v) {
  if (v == null || v === '' || isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('ru-RU') + ' ₸';
}

/* ---- Format date ---- */
function fmtDate(str) {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (_) { return str; }
}

/* ---- Check promo active ---- */
function isPromoActive(p) {
  if (!p.promoPrice || !p.promoStart || !p.promoEnd) return false;
  const now = Date.now();
  return now >= new Date(p.promoStart).getTime() && now <= new Date(p.promoEnd).getTime();
}

/* ---- Get effective price ---- */
function getPrice(p, useClub) {
  if (isPromoActive(p)) return Number(p.promoPrice);
  if (useClub && p.clubPrice && Number(p.clubPrice) < Number(p.price)) return Number(p.clubPrice);
  return Number(p.price) || 0;
}

/* ---- Toast notification ---- */
let _toastTimer = null;
function showToast(msg, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast toast-' + type + ' show';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---- Loading overlay ---- */
function showLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.add('show');
}
function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.remove('show');
}

/* ---- Screen navigation stack ---- */
const _screenStack = [];

function showScreen(id, slide = false) {
  const prev = document.querySelector('.screen.active:not(.base-screen)');
  if (prev && prev.id !== id) {
    prev.classList.remove('active');
    if (slide) _screenStack.push(prev.id);
  }
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('active');
  if (slide) el.classList.add('slide-in');
  // Telegram back button
  if (_screenStack.length > 0 && tg) {
    tg.BackButton.show();
  }
}

function goBack() {
  const cur = document.querySelector('.screen.active:not(.base-screen)');
  if (cur) cur.classList.remove('active', 'slide-in');
  const prev = _screenStack.pop();
  if (prev) {
    const el = document.getElementById(prev);
    if (el) el.classList.add('active');
  }
  if (_screenStack.length === 0 && tg) tg.BackButton.hide();
}

function pushScreen(id) {
  const cur = document.querySelector('.screen.active');
  if (cur && cur.id !== id) _screenStack.push(cur.id);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'slide-in'));
  const el = document.getElementById(id);
  if (el) { el.classList.add('active', 'slide-in'); }
  if (tg && _screenStack.length > 0) tg.BackButton.show();
  else if (tg) tg.BackButton.hide();
}

function replaceScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'slide-in'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  _screenStack.length = 0;
  if (tg) tg.BackButton.hide();
}

/* ---- Get category name by id ---- */
function getCatName(id) {
  const cat = SUPERMARKET_CATEGORIES.find(c => c.id === id);
  return cat ? cat.name : 'Другое';
}
function getCatEmoji(id) {
  const cat = SUPERMARKET_CATEGORIES.find(c => c.id === id);
  return cat ? cat.emoji : '📦';
}

/* ---- Escape HTML ---- */
function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ---- Truncate string ---- */
function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ---- Parse Excel date serial ---- */
function parseExcelDate(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') {
    // Excel date serial to JS date
    const date = new Date((val - 25569) * 86400 * 1000);
    return date.toISOString().slice(0, 10);
  }
  return String(val);
}

/* ---- Generate order ID ---- */
function genOrderId() {
  return 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,5).toUpperCase();
}

/* ---- Debounce ---- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
