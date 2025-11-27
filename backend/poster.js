// ===== POSTER TOKEN =====
const POSTER_TOKEN = process.env.POSTER_TOKEN;

// ===== ПОЛУФАБРИКАТЫ =====
export async function getPosterPrepacksFull() {
  if (!POSTER_TOKEN) return [];

  const url = `https://joinposter.com/api/menu.getPrepacks?token=${POSTER_TOKEN}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.response) return [];

    return data.response.map((p) => ({
      id: p.prepack_id,
      name: p.product_name
    }));
  } catch (err) {
    console.error("Ошибка загрузки полуфабрикатов:", err);
    return [];
  }
}

// ===== ВСЕ ОСТАЛЬНЫЕ ТВОИ ЭКСПОРТЫ ОСТАЮТСЯ =====
export async function getPosterProducts() { /* твой код */ }
export async function getPosterIngredients() { /* твой код */ }
export async function getAllPosterItems() { /* твой код */ }
