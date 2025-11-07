import express from "express";
import cors from "cors";
import { writeProductsToSheet } from "./googleSheets.js";
import { getPosterProducts, getAllPosterItems } from "./poster.js";

const app = express();
app.use(cors());
app.use(express.json());

// 📦 Временные тестовые данные (если Poster API недоступен)
const testProducts = [
  { product_id: 1, product_name: "Кофе", menu_category_name: "Напитки" },
  { product_id: 2, product_name: "Круассан", menu_category_name: "Выпечка" },
  { product_id: 3, product_name: "Сэндвич", menu_category_name: "Закуски" },
];

// 📥 API endpoint для получения списка продуктов (для фронтенда)
app.get("/api/products", async (req, res) => {
  try {
    const products = await getPosterProducts();
    
    // Логируем первый продукт для проверки структуры
    if (products.length > 0) {
      console.log("Пример продукта из Poster:", JSON.stringify(products[0], null, 2));
    }
    
    // Если Poster вернул пустой массив, отправляем тестовые данные
    if (products.length === 0) {
      console.log("⚠️ Poster API вернул пустой ответ, используем тестовые данные");
      return res.json(testProducts);
    }
    
    res.json(products);
  } catch (error) {
    console.error("Ошибка при получении продуктов:", error);
    res.status(500).json({ error: "Ошибка при загрузке данных" });
  }
});

// 📤 API endpoint для выгрузки в Google Sheets
app.get("/api/upload-to-sheets", async (req, res) => {
  try {
    const products = await getPosterProducts();
    
    // Используем тестовые данные если Poster не вернул ничего
    const dataToUpload = products.length > 0 ? products : testProducts;
    
    await writeProductsToSheet(dataToUpload);
    res.json({ 
      success: true, 
      message: "✅ Данные успешно выгружены в Google Sheets!",
      count: dataToUpload.length
    });
  } catch (error) {
    console.error("Ошибка при выгрузке в Google Sheets:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 📦 API endpoint для выгрузки ВСЕХ позиций (продукты + ингредиенты)
app.get("/api/upload-all-to-sheets", async (req, res) => {
  try {
    const allItems = await getAllPosterItems();
    
    if (allItems.length === 0) {
      console.log("⚠️ Не удалось получить данные из Poster");
      return res.json({ 
        success: false, 
        message: "Не удалось получить данные из Poster" 
      });
    }
    
    await writeProductsToSheet(allItems);
    res.json({ 
      success: true, 
      message: "✅ Все позиции (продукты + ингредиенты) успешно выгружены в Google Sheets!",
      count: allItems.length
    });
  } catch (error) {
    console.error("Ошибка при выгрузке всех позиций в Google Sheets:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 🏠 Главная страница
app.get("/", (req, res) => {
  res.send("✅ Сервер работает! Доступные endpoints: /api/products, /api/upload-to-sheets, /api/upload-all-to-sheets (все позиции)");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
