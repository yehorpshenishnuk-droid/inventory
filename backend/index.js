import express from "express";
import cors from "cors";

import {
  lockLocation,
  unlockLocation,
  checkLock,
  getAllLocks,
  readProductsFromSheet,
} from "./googleSheets.js";

import {
  getPosterProducts,
  getAllPosterItems,
} from "./poster.js";

import { uploadPrepacks } from "./prepacks_uploader.js";

const app = express();
app.use(cors());
app.use(express.json());

// ==========================
// POSTER PRODUCTS
// ==========================

// Получение продуктов из Poster
app.get("/api/products", async (req, res) => {
  try {
    const products = await getPosterProducts();
    res.json(products);
  } catch (error) {
    console.error("Ошибка при получении продуктов:", error);
    res.status(500).json({ error: "Ошибка при загрузке данных" });
  }
});

// Выгрузка ВСЕХ позиций (продукты + ингредиенты + тех.карты)
app.get("/api/upload-all-to-sheets", async (req, res) => {
  try {
    const items = await getAllPosterItems();
    res.json({
      success: true,
      count: items.length,
    });
  } catch (error) {
    console.error("Ошибка при выгрузке:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================
// ВЫГРУЗКА ПОЛУФАБРИКАТОВ В ОТДЕЛЬНЫЙ ЛИСТ
// ==========================

app.get("/api/prepacks/upload", async (req, res) => {
  try {
    const added = await uploadPrepacks();
    res.json({
      success: true,
      added,
      message: `Добавлено новых полуфабрикатов: ${added}`
    });
  } catch (error) {
    console.error("Ошибка при загрузке полуфабрикатов:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================
// LOCKS (Блокировка холодильников)
// ==========================

// Заблокировать место
app.post("/api/locks/lock", async (req, res) => {
  try {
    const { locationNumber, userName } = req.body;

    if (!locationNumber || !userName) {
      return res.status(400).json({
        success: false,
        error: "Не указан номер или имя пользователя",
      });
    }

    const result = await lockLocation(locationNumber, userName);
    res.json(result);

  } catch (error) {
    console.error("Ошибка блокировки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Разблокировать место
app.delete("/api/locks/unlock/:locationNumber", async (req, res) => {
  try {
    const { locationNumber } = req.params;
    const result = await unlockLocation(locationNumber);
    res.json(result);
  } catch (error) {
    console.error("Ошибка разблокировки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Проверить блокировку
app.get("/api/locks/check/:locationNumber", async (req, res) => {
  try {
    const { locationNumber } = req.params;
    const lock = await checkLock(locationNumber);

    if (lock) {
      res.json({ locked: true, ...lock });
    } else {
      res.json({ locked: false });
    }
  } catch (error) {
    console.error("Ошибка проверки:", error);
    res.status(500).json({ error: error.message });
  }
});

// Получить все блокировки
app.get("/api/locks/all", async (req, res) => {
  try {
    const locks = await getAllLocks();
    res.json({ success: true, locks });
  } catch (error) {
    console.error("Ошибка при получении блокировок:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================
// ROOT PAGE
// ==========================

app.get("/", (req, res) => {
  res.send(`
    <h2>Сервер працює</h2>
    <p>Доступні endpoints:</p>
    <ul>
      <li>/api/products</li>
      <li>/api/upload-all-to-sheets</li>
      <li>/api/prepacks/upload</li>
      <li>/api/locks/*</li>
    </ul>
  `);
});

// ==========================
// START SERVER
// ==========================

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер запущено на порту ${PORT}`));
