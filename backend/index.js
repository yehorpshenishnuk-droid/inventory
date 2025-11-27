import express from "express";
import cors from "cors";

import {
  readProductsFromSheet,
  mergePosterItemsToSheet,
  createInventorySheet,
  readInventorySheetData,
  writeQuantitiesToInventorySheet,
  checkInventorySheetExists,
  lockLocation,
  unlockLocation,
  checkLock,
  getAllLocks,
  SPREADSHEET_ID,
  sheets
} from "./googleSheets.js";

import { getPosterProducts, getAllPosterItems } from "./poster.js";

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------------------------------------
// Тестовые данные на случай если Poster не работает
// -------------------------------------------------------------
const testProducts = [
  { product_id: 1, product_name: "Кофе", menu_category_name: "Напитки" },
  { product_id: 2, product_name: "Круассан", menu_category_name: "Выпечка" },
  { product_id: 3, product_name: "Сэндвич", menu_category_name: "Закуски" },
];

// -------------------------------------------------------------
// Получение продуктов (для фронтенда)
// -------------------------------------------------------------
app.get("/api/products", async (req, res) => {
  try {
    const products = await getPosterProducts();

    if (products.length === 0) {
      return res.json(testProducts);
    }

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: "Ошибка при загрузке продуктов" });
  }
});

// -------------------------------------------------------------
// ПОЛНОЕ ОБНОВЛЕНИЕ LIST1 — ТОЛЬКО ДОБАВЛЕНИЕ НОВЫХ ТОВАРОВ
// -------------------------------------------------------------
app.get("/api/upload-all-to-sheets", async (req, res) => {
  try {
    const posterItems = await getAllPosterItems();

    if (!posterItems || posterItems.length === 0) {
      return res.json({
        success: false,
        message: "Poster API вернул пустой список",
      });
    }

    const result = await mergePosterItemsToSheet(posterItems);

    res.json({
      success: true,
      message: `Добавлено новых позиций: ${result.added}`,
    });
  } catch (error) {
    console.error("Ошибка при обновлении таблицы:", error);
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// Получение данных для инвентаризации
// -------------------------------------------------------------
app.get("/api/inventory/products", async (req, res) => {
  try {
    const { date } = req.query;

    if (date) {
      const exists = await checkInventorySheetExists(date);

      if (exists) {
        const inventoryData = await readInventorySheetData(date);

        const fridges = {};
        inventoryData.forEach((product) => {
          const fridgeNum = product.fridge || "Без холодильника";

          if (!fridges[fridgeNum]) fridges[fridgeNum] = [];

          fridges[fridgeNum].push({
            name: product.name,
            category: product.category,
            type: product.type,
            unit: product.unit,
            currentQuantity: product.total || 0,
            savedQuantity: product.total || "",
            rowIndex: product.rowIndex,
          });
        });

        return res.json({
          data: Object.keys(fridges).map((key) => ({
            fridgeNumber: key,
            products: fridges[key],
          })),
          existingInventory: true,
          date,
        });
      }
    }

    const products = await readProductsFromSheet();

    const fridges = {};
    products.forEach((product) => {
      const fridgeNum = product.fridge || "Без холодильника";
      if (!fridges[fridgeNum]) fridges[fridgeNum] = [];
      fridges[fridgeNum].push(product);
    });

    res.json({
      data: Object.keys(fridges).map((key) => ({
        fridgeNumber: key,
        products: fridges[key],
      })),
      existingInventory: false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// СОХРАНЕНИЕ ИНВЕНТАРИЗАЦИИ
// -------------------------------------------------------------
app.post("/api/inventory/save", async (req, res) => {
  try {
    const { inventoryData, inventoryDate } = req.body;

    if (!inventoryData || !Array.isArray(inventoryData))
      return res.status(400).json({ error: "Неверный формат данных" });

    if (!inventoryDate)
      return res.status(400).json({ error: "Дата не указана" });

    const exists = await checkInventorySheetExists(inventoryDate);

    let sheetName;
    if (!exists) {
      sheetName = await createInventorySheet(inventoryDate);
    } else {
      sheetName = `Інвентаризація ${inventoryDate}`;
    }

    const inventoryByFridge = {};

    inventoryData.forEach((fridge) => {
      inventoryByFridge[fridge.fridgeNumber] = fridge.products.map((p) => ({
        name: p.name,
        quantity: p.quantity,
      }));
    });

    await writeQuantitiesToInventorySheet(sheetName, inventoryByFridge);

    res.json({
      success: true,
      message: `Инвентаризация сохранена в "${sheetName}"`,
      sheetName,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// Создать лист при выборе даты
// -------------------------------------------------------------
app.post("/api/inventory/init-sheet", async (req, res) => {
  try {
    const { inventoryDate } = req.body;

    if (!inventoryDate) {
      return res.status(400).json({
        success: false,
        error: "Дата не указана",
      });
    }

    const exists = await checkInventorySheetExists(inventoryDate);

    let sheetName;
    if (!exists) {
      sheetName = await createInventorySheet(inventoryDate);
    } else {
      sheetName = `Інвентаризація ${inventoryDate}`;
    }

    res.json({
      success: true,
      existed: exists,
      sheetName,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// Экспорт PDF
// -------------------------------------------------------------
app.get("/api/inventory/export-pdf/:sheetName", async (req, res) => {
  try {
    const sheetName = decodeURIComponent(req.params.sheetName);

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const sheet = spreadsheet.data.sheets.find(
      (s) => s.properties.title === sheetName
    );

    if (!sheet) {
      return res.status(404).json({
        success: false,
        error: `Аркуш "${sheetName}" не найден`,
      });
    }

    const sheetId = sheet.properties.sheetId;

    const exportUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=pdf&gid=${sheetId}&portrait=false&fitw=true`;

    res.json({
      success: true,
      downloadUrl: exportUrl,
      sheetName,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// БЛОКИРОВКИ
// -------------------------------------------------------------
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
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/locks/unlock/:locationNumber", async (req, res) => {
  try {
    const { locationNumber } = req.params;

    const result = await unlockLocation(locationNumber);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/locks/all", async (req, res) => {
  try {
    const locks = await getAllLocks();
    res.json({ success: true, locks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// Главная
// -------------------------------------------------------------
app.get("/", (req, res) => {
  res.send(`
    ✅ Сервер работает!<br><br>
    Доступные endpoints:<br>
    - GET /api/products<br>
    - GET /api/upload-all-to-sheets<br>
    - GET /api/inventory/products<br>
    - POST /api/inventory/save<br>
  `);
});

// -------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
