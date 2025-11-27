import express from "express";
import cors from "cors";

import {
  addNewPrepacksToSheet,
  readPrepacksSheet,
  readProductsFromSheet,
  ensureSheetExists,
  lockLocation,
  unlockLocation,
  checkLock,
  getAllLocks,
  sheets,
  SPREADSHEET_ID
} from "./googleSheets.js";

import {
  getPosterProducts,
  getAllPosterItems,
  getPosterPrepacksFull
} from "./poster.js";

const app = express();
app.use(cors());
app.use(express.json());

// ========= NEW: Upload semi-prepacks =========
app.get("/api/prepacks/upload", async (req, res) => {
  try {
    const prepacks = await getPosterPrepacksFull();

    if (!prepacks || prepacks.length === 0) {
      return res.json({
        success: false,
        message: "Poster не вернул полуфабрикаты",
      });
    }

    const result = await addNewPrepacksToSheet(prepacks);

    res.json({
      success: true,
      added: result.added,
      message: `Добавлено новых полуфабрикатов: ${result.added}`,
    });
  } catch (err) {
    console.error("Ошибка:", err);
    res.status(500).json({ error: err.message });
  }
});

// ========= Products from Poster =========
app.get("/api/products", async (req, res) => {
  try {
    const items = await getPosterProducts();
    res.json(items);
  } catch (err) {
    console.error("Ошибка загрузки продуктов:", err);
    res.status(500).json({ error: "Ошибка загрузки" });
  }
});

// ========= Upload ALL Poster items to Sheets =========
app.get("/api/upload-all-to-sheets", async (req, res) => {
  try {
    const items = await getAllPosterItems();
    res.json({ success: true, count: items.length });
  } catch (err) {
    console.error("Ошибка:", err);
    res.status(500).json({ error: err.message });
  }
});

// ========= LOCKS =========

// Lock
app.post("/api/locks/lock", async (req, res) => {
  try {
    const { locationNumber, userName } = req.body;
    const result = await lockLocation(locationNumber, userName);
    res.json(result);
  } catch (err) {
    console.error("Ошибка блокировки:", err);
    res.status(500).json({ error: err.message });
  }
});

// Unlock
app.delete("/api/locks/unlock/:locationNumber", async (req, res) => {
  try {
    const result = await unlockLocation(req.params.locationNumber);
    res.json(result);
  } catch (err) {
    console.error("Ошибка:", err);
    res.status(500).json({ error: err.message });
  }
});

// Check lock
app.get("/api/locks/check/:locationNumber", async (req, res) => {
  try {
    const lock = await checkLock(req.params.locationNumber);
    res.json(lock ? { locked: true, ...lock } : { locked: false });
  } catch (err) {
    console.error("Ошибка:", err);
    res.status(500).json({ error: err.message });
  }
});

// All locks
app.get("/api/locks/all", async (req, res) => {
  try {
    const locks = await getAllLocks();
    res.json({ success: true, locks });
  } catch (err) {
    console.error("Ошибка:", err);
    res.status(500).json({ error: err.message });
  }
});

// ========= Root =========
app.get("/", (req, res) => {
  res.send(`
    <h2>Сервер работает</h2>
    <p>Endpoints:</p>
    <ul>
      <li>/api/products</li>
      <li>/api/upload-all-to-sheets</li>
      <li>/api/prepacks/upload</li>
      <li>/api/locks/*</li>
    </ul>
  `);
});

// ========= START SERVER =========
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
