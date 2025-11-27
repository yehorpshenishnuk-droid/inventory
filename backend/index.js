import express from "express";
import cors from "cors";

import {
  addNewPrepacksToSheet,
  readProductsFromSheet,
  createInventorySheet,
  readInventorySheetData,
  writeQuantitiesToInventorySheet,
  checkInventorySheetExists,
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

// ====== НОВЫЙ ENDPOINT ДЛЯ ПІВФАБРИКАТІВ ======
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

// ====== ОСТАЛЬНЫЕ ТВОИ ENDPOINTS ТАКИЕ КАК ЕСТЬ ======

// ... твои остальные роуты (инвентаризация и т.д.)

// ====== СТАРТ СЕРВЕРА ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
