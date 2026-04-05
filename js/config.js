/* ============================================================
   RudMart Online — Config & Constants
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

const DELIVERY_PRICE = 500; // тенге

const CATEGORIES = [
  { id: 'bread',      name: 'Хлеб и выпечка',       icon: '🍞' },
  { id: 'dairy',      name: 'Молочные продукты',     icon: '🥛' },
  { id: 'meat',       name: 'Мясо и птица',          icon: '🥩' },
  { id: 'fish',       name: 'Рыба и морепродукты',   icon: '🐟' },
  { id: 'produce',    name: 'Фрукты и овощи',        icon: '🥦' },
  { id: 'frozen',     name: 'Замороженные',           icon: '🧊' },
  { id: 'drinks',     name: 'Напитки',                icon: '🥤' },
  { id: 'tea_coffee', name: 'Чай и кофе',            icon: '☕' },
  { id: 'snacks',     name: 'Снеки и закуски',        icon: '🍿' },
  { id: 'sweets',     name: 'Кондитерские',          icon: '🍫' },
  { id: 'cereals',    name: 'Крупы и макароны',       icon: '🌾' },
  { id: 'oils',       name: 'Масло и жиры',           icon: '🫙' },
  { id: 'sauces',     name: 'Соусы и специи',         icon: '🧂' },
  { id: 'canned',     name: 'Консервы',               icon: '🥫' },
  { id: 'grocery',    name: 'Бакалея',                icon: '🛒' },
  { id: 'baby',       name: 'Детское питание',        icon: '👶' },
  { id: 'alcohol',    name: 'Алкоголь',               icon: '🍷' },
  { id: 'health',     name: 'Здоровое питание',       icon: '🥗' },
  { id: 'household',  name: 'Товары для дома',        icon: '🏠' },
  { id: 'hygiene',    name: 'Гигиена и косметика',    icon: '🧴' },
  { id: 'cleaning',   name: 'Чистящие средства',      icon: '🧹' },
  { id: 'pet',        name: 'Корм для животных',      icon: '🐾' },
  { id: 'other',      name: 'Прочее',                 icon: '📦' },
];
