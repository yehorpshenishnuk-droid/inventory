// ================================
// Poster API — универсальная новая версия
// ================================

const POSTER_TOKEN = process.env.POSTER_TOKEN;

// Базовая функция запроса с retry
async function safeFetch(url, retries = 3, delay = 400) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);

      if (res.status === 429) {
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        throw new Error(`Ошибка Poster API: ${res.status}`);
      }

      const data = await res.json();
      return data;

    } catch (err) {
      if (i === retries - 1) {
        console.error(`❌ Poster API failed: ${url}`, err);
        return null;
      }

      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ================================
// 1. Категории продуктов меню
// ================================

async function getPosterCategories() {
  if (!POSTER_TOKEN) return {};

  const url = `https://joinposter.com/api/menu.getCategories?token=${POSTER_TOKEN}`;
  const data = await safeFetch(url);

  if (!data || !data.response) return {};

  const categories = {};
  data.response.forEach(cat => {
    categories[cat.category_id] = cat.category_name;
  });

  return categories;
}

// ================================
// 2. Категории ингредиентов
// ================================

async function getIngredientCategories() {
  if (!POSTER_TOKEN) return {};

  const url = `https://joinposter.com/api/menu.getCategoriesIngredients?token=${POSTER_TOKEN}`;
  const data = await safeFetch(url);

  if (!data || !data.response) return {};

  const categories = {};
  data.response.forEach(cat => {
    categories[cat.category_id] = cat.name;
  });

  return categories;
}

// ================================
// 3. Продукты меню + техкарты
// ================================

export async function getPosterProducts() {
  if (!POSTER_TOKEN) {
    console.error("⚠️ POSTER_TOKEN не найден!");
    return [];
  }

  const categories = await getPosterCategories();
  const url = `https://joinposter.com/api/menu.getProducts?token=${POSTER_TOKEN}`;

  const data = await safeFetch(url);
  if (!data || !data.response) return [];

  return data.response.map(item => ({
    product_id: item.product_id,
    product_name: item.product_name,
    category_id: item.menu_category_id, // ID категории
    category_name: categories[item.menu_category_id] || item.category_name || "-",
    item_type: String(item.type) // 2 = техкарта, 3 = продукт
  }));
}

// ================================
// 4. Напівфабрикати
// ================================

export async function getPosterPrepacks() {
  if (!POSTER_TOKEN) return [];

  const url = `https://joinposter.com/api/menu.getPrepacks?token=${POSTER_TOKEN}`;
  const data = await safeFetch(url);

  if (!data || !data.response) return [];

  return data.response.map(item => ({
    product_id: item.product_id,
    product_name: item.product_name
  }));
}

// ================================
// 5. Інгредієнти
// ================================

export async function getPosterIngredients() {
  if (!POSTER_TOKEN) {
    console.error("⚠️ POSTER_TOKEN не найден!");
    return [];
  }

  const categories = await getIngredientCategories();
  const url = `https://joinposter.com/api/menu.getIngredients?token=${POSTER_TOKEN}`;

  const data = await safeFetch(url);
  if (!data || !data.response) return [];

  return data.response.map(item => ({
    ingredient_id: item.ingredient_id,
    ingredient_name: item.ingredient_name,
    category_id: item.category_id, // ID категории
    category_name: categories[item.category_id] || "-"
  }));
}

// ================================
// 6. Объединение всех позиций для инвентаризации
// ================================

export async function getAllPosterItems() {
  console.log("📡 Загружаю данные из Poster...");

  // ID категорій КУХНІ - ТІЛЬКИ ЦІ виводимо
  const HOT_CATEGORIES = [4, 13, 15, 46, 33];
  const COLD_CATEGORIES = [7, 8, 11, 16, 18, 19, 29, 32, 36, 44];
  const KITCHEN_CATEGORIES = [...HOT_CATEGORIES, ...COLD_CATEGORIES];

  // Категорії інгредієнтів БАРУ - виключаємо по назві
  const BAR_INGREDIENT_CATEGORIES = [
    "ДЖИН",
    "ВІСКІ", 
    "ГОРІЛКА",
    "СІК БАР",
    "СИРОП RIOBA",
    "ПИВО",
    "БАР МОРОЗКА",
    "ВИНО",
    "ВИНО ИГРИСТЕ",
    "БРЕНДІ"
  ];

  const [products, prepacks, ingredients] = await Promise.all([
    getPosterProducts(),
    getPosterPrepacks(),
    getPosterIngredients()
  ]);

  // Отдельно делим продукты на обычные и техкарты
  const regularProducts = [];
  const techCards = [];

  products.forEach(item => {
    // Берем ТОЛЬКО категории кухни
    if (KITCHEN_CATEGORIES.includes(Number(item.category_id))) {
      if (item.item_type === "2") techCards.push(item);
      else regularProducts.push(item);
    }
  });

  // Фильтруем ингредиенты - берем ТОЛЬКО кухню И исключаем бар по названию
  const filteredIngredients = ingredients.filter(i => {
    // Должна быть категория кухни
    const isKitchenCategory = KITCHEN_CATEGORIES.includes(Number(i.category_id));
    // И НЕ должна быть барная категория по названию
    const isBarCategory = BAR_INGREDIENT_CATEGORIES.includes(i.category_name);
    
    return isKitchenCategory && !isBarCategory;
  });

  // Фильтруем напівфабрикати - исключаем П/Ф бара (напитки)
  const filteredPrepacks = prepacks.filter(p => {
    const name = p.product_name.toLowerCase();
    // Исключаем если название начинается с "п/ф" и содержит напитки
    if (name.startsWith("п/ф")) {
      const drinkKeywords = ["лимонад", "облипиха", "клюква", "малина", "смородина", "чай", "соска"];
      return !drinkKeywords.some(keyword => name.includes(keyword));
    }
    return true;
  });

  const allItems = [
    ...regularProducts.map(p => ({
      id: p.product_id,
      name: p.product_name,
      category: p.category_name,
      type: "Продукт меню"
    })),

    ...techCards.map(t => ({
      id: t.product_id,
      name: t.product_name,
      category: t.category_name,
      type: "Тех.карта"
    })),

    // Напівфабрикати - фільтруємо бар
    ...filteredPrepacks.map(p => ({
      id: p.product_id,
      name: p.product_name,
      category: "Напівфабрикати",
      type: "Напівфабрикат"
    })),

    ...filteredIngredients.map(i => ({
      id: i.ingredient_id,
      name: i.ingredient_name,
      category: i.category_name,
      type: "Інгредієнт"
    }))
  ];

  console.log("📦 ВСЕГО ПОЗИЦИЙ:", allItems.length);
  return allItems;
}
