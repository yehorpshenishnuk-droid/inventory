// Токен берется из переменных окружения Render
const POSTER_TOKEN = process.env.POSTER_TOKEN;

// ===== КАТЕГОРИИ =====

// Получаем категории продуктов меню
async function getPosterCategories() {
  if (!POSTER_TOKEN) return {};

  const url = `https://joinposter.com/api/menu.getCategories?token=${POSTER_TOKEN}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.response) return {};

    const categories = {};
    data.response.forEach((cat) => {
      categories[cat.category_id] = cat.category_name;
    });

    return categories;
  } catch (err) {
    console.error("Ошибка при получении категорий:", err);
    return {};
  }
}

// Получаем категории ингредиентов
async function getIngredientCategories() {
  if (!POSTER_TOKEN) return {};

  const url = `https://joinposter.com/api/menu.getCategoriesIngredients?token=${POSTER_TOKEN}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.response) return {};

    const categories = {};
    data.response.forEach((cat) => {
      categories[cat.category_id] = cat.name;
    });

    return categories;
  } catch (err) {
    console.error("Ошибка при получении категорий ингредиентов:", err);
    return {};
  }
}

// ===== 1. ПРОДУКТЫ МЕНЮ + ТЕХ.КАРТЫ =====

export async function getPosterProducts() {
  if (!POSTER_TOKEN) {
    console.error("⚠️ POSTER_TOKEN не найден в переменных окружения!");
    return [];
  }

  const categories = await getPosterCategories();
  const url = `https://joinposter.com/api/menu.getProducts?token=${POSTER_TOKEN}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.response) {
      console.error("Ошибка при получении продуктов из Poster:", data);
      return [];
    }

    console.log(`📋 Получено продуктов и тех.карт: ${data.response.length}`);

    return data.response.map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      category_name: categories[item.menu_category_id] || item.category_name || "-",
      item_type: item.type, // 2 = тех.карта, 3 = продукт
    }));
  } catch (err) {
    console.error("Ошибка при получении продуктов:", err);
    return [];
  }
}

// ===== 2. НАПІВФАБРИКАТИ =====

export async function getPosterPrepacks() {
  if (!POSTER_TOKEN) return [];

  const url = `https://joinposter.com/api/menu.getPrepacks?token=${POSTER_TOKEN}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.response) {
      console.log("⚠️ Напівфабрикати не знайдені");
      return [];
    }

    console.log(`🍽️ Получено напівфабрикатів: ${data.response.length}`);

    return data.response.map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
    }));
  } catch (err) {
    console.error("Ошибка при получении напівфабрикатів:", err);
    return [];
  }
}

// ===== 3. ІНГРЕДІЄНТИ =====

export async function getPosterIngredients() {
  if (!POSTER_TOKEN) {
    console.error("⚠️ POSTER_TOKEN не найден в переменных окружения!");
    return [];
  }

  const categories = await getIngredientCategories();
  const url = `https://joinposter.com/api/menu.getIngredients?token=${POSTER_TOKEN}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.response) {
      console.error("Ошибка при получении ингредиентов из Poster:", data);
      return [];
    }

    console.log(`📦 Получено ингредиентов: ${data.response.length}`);

    return data.response.map((item) => ({
      ingredient_id: item.ingredient_id,
      ingredient_name: item.ingredient_name,
      category_name: categories[item.category_id] || "-",
    }));
  } catch (err) {
    console.error("Ошибка при получении ингредиентов:", err);
    return [];
  }
}

// ===== ОБЪЕДИНЯЕМ ВСЕ ДЛЯ ИНВЕНТАРИЗАЦИИ =====

export async function getAllPosterItems() {
  const [products, prepacks, ingredients] = await Promise.all([
    getPosterProducts(),
    getPosterPrepacks(),
    getPosterIngredients()
  ]);

  // Разделяем продукты на обычные и тех.карты
  const regularProducts = [];
  const techCards = [];
  
  products.forEach(item => {
    if (item.item_type === "2") {
      techCards.push(item);
    } else {
      regularProducts.push(item);
    }
  });

  // Объединяем все позиции
  const allItems = [
    ...regularProducts.map(p => ({
      name: p.product_name,
      category: p.category_name,
      type: "Продукт меню"
    })),
    ...techCards.map(t => ({
      name: t.product_name,
      category: t.category_name,
      type: "Тех.карта"
    })),
    ...prepacks.map(p => ({
      name: p.product_name,
      category: "Напівфабрикати",
      type: "Напівфабрикат"
    })),
    ...ingredients.map(i => ({
      name: i.ingredient_name,
      category: i.category_name,
      type: "Інгредієнт"
    }))
  ];

  console.log(`📦 ВСЬОГО позицій: ${allItems.length}`);
  console.log(`   - Продуктів меню: ${regularProducts.length}`);
  console.log(`   - Тех.карт: ${techCards.length}`);
  console.log(`   - Напівфабрикатів: ${prepacks.length}`);
  console.log(`   - Інгредієнтів: ${ingredients.length}`);
  
  return allItems;
}
