/* ============================================================
   RudMart WebApp — Configuration
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyACNHxb3K5J3rldlv3knvR2kNJsFPUUZOY",
  authDomain: "rudmart-d4520.firebaseapp.com",
  projectId: "rudmart-d4520",
  storageBucket: "rudmart-d4520.firebasestorage.app",
  messagingSenderId: "818734438113",
  appId: "1:818734438113:web:f5af454e7a8341238e89a0",
  measurementId: "G-YDB8MEBZWX"
};

/* ---- App constants ---- */
const DELIVERY_COST   = 500;   // Стоимость доставки (тенге)
const PRODUCTS_PER_PAGE = 20;  // Товаров на страницу
const SEARCH_LIMIT    = 7;     // Автодополнение: кол-во подсказок

/* ---- Supermarket categories ---- */
const SUPERMARKET_CATEGORIES = [
  { id: 'dairy',     name: 'Молочные продукты',    emoji: '🥛' },
  { id: 'bread',     name: 'Хлеб и выпечка',       emoji: '🍞' },
  { id: 'meat',      name: 'Мясо и птица',          emoji: '🥩' },
  { id: 'fish',      name: 'Рыба и морепродукты',   emoji: '🐟' },
  { id: 'produce',   name: 'Овощи и фрукты',        emoji: '🥦' },
  { id: 'frozen',    name: 'Замороженные',           emoji: '🧊' },
  { id: 'alcohol',   name: 'Алкоголь',              emoji: '🍷' },
  { id: 'drinks',    name: 'Напитки',               emoji: '🥤' },
  { id: 'canned',    name: 'Консервы',              emoji: '🥫' },
  { id: 'groceries', name: 'Бакалея',               emoji: '🌾' },
  { id: 'oils',      name: 'Масла и жиры',          emoji: '🫙' },
  { id: 'sauces',    name: 'Соусы и специи',        emoji: '🌶️' },
  { id: 'sweets',    name: 'Сладости и снеки',      emoji: '🍫' },
  { id: 'coffee',    name: 'Чай и кофе',            emoji: '☕' },
  { id: 'baby',      name: 'Детское питание',       emoji: '👶' },
  { id: 'cosmetics', name: 'Косметика',             emoji: '💄' },
  { id: 'hygiene',   name: 'Гигиена',               emoji: '🧴' },
  { id: 'household', name: 'Бытовая химия',         emoji: '🧹' },
  { id: 'home',      name: 'Товары для дома',       emoji: '🏠' },
  { id: 'pets',      name: 'Зоотовары',             emoji: '🐾' },
  { id: 'other',     name: 'Другое',                emoji: '📦' },
];

/* ---- Payment methods ---- */
const PAYMENT_METHODS = [
  { id: 'cash',  label: 'Наличные',    icon: '💵' },
  { id: 'card',  label: 'Карта',       icon: '💳' },
];
const BANKS = ['Kaspi', 'Halyk', 'Alatau', 'Eurasian', 'Другой'];
