import express from "express";
import cors from "cors";

import {
  readProductsFromSheet,
  createInventorySheet,
  writeQuantitiesToInventorySheet,
  readInventorySheetData,
  checkInventorySheetExists,
  sheets,
  SPREADSHEET_ID
} from "./googleSheets.js";

import {
  getPosterProducts,
  getAllPosterItems,
  getPosterPrepacks
} from "./poster.js";

import LockManager from "./lockManager.js";

const app = express();
app.use(cors());
app.use(express.json());

// =====================================================
// POSTER API — получение продуктов
// =====================================================

const fallbackProducts = [
  { product_id: 1, product_name: "Кофе", menu_category_name: "Напитки" },
  { product_id: 2, product_name: "Круассан", menu_category_name: "Выпечка" },
  { product_id: 3, product_name: "Сэндвич", menu_category_name: "Закуски" },
];

app.get("/api/products", async (req, res) => {
  try {
    const products = await getPosterProducts();

    if (!products || products.length === 0) {
      return res.json(fallbackProducts);
    }

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки продуктов" });
  }
});

// =====================================================
// ВЫГРУЗКА В GOOGLE SHEETS
// =====================================================

app.get("/api/upload-to-sheets", async (req, res) => {
  try {
    const posterData = await getPosterProducts();
    const data = posterData.length ? posterData : fallbackProducts;

    await writeProductsToSheet(data);

    res.json({
      success: true,
      count: data.length,
      message: "Данные выгружены"
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/upload-all-to-sheets", async (req, res) => {
  try {
    const all = await getAllPosterItems();

    if (!all.length) {
      return res.json({ success: false, message: "Нет данных Poster" });
    }

    await writeProductsToSheet(all);

    res.json({
      success: true,
      message: "Все позиции выгружены",
      count: all.length
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =====================================================
// ВЫГРУЗКА ПОЛУФАБРИКАТОВ С ID
// =====================================================

app.get("/api/upload-prepacks-to-sheets", async (req, res) => {
  try {
    const prepacks = await getPosterPrepacks();
    
    if (!prepacks || prepacks.length === 0) {
      return res.json({ 
        success: false, 
        message: "Не удалось получить полуфабрикаты из Poster" 
      });
    }
    
    const PREPACKS_SHEET = "Напівфабрикати";
    
    // Проверяем существует ли лист
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const sheetExists = spreadsheet.data.sheets.find(
      s => s.properties.title === PREPACKS_SHEET
    );
    
    // Если листа нет - создаем
    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: PREPACKS_SHEET
              }
            }
          }]
        }
      });
      console.log(`✅ Створено новий аркуш: ${PREPACKS_SHEET}`);
    }
    
    // Записываем заголовки
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${PREPACKS_SHEET}!A1:C1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["ID", "Назва", "Тип"]]
      }
    });
    
    // Записываем данные
    const values = prepacks.map(p => [
      p.product_id, 
      p.product_name, 
      "Напівфабрикат"
    ]);
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${PREPACKS_SHEET}!A2`,
      valueInputOption: "RAW",
      requestBody: { values }
    });
    
    console.log(`✅ Виведено ${prepacks.length} напівфабрикатів з ID`);
    
    res.json({ 
      success: true, 
      message: `✅ Напівфабрикати (${prepacks.length} шт.) з ID успішно виведені!`,
      count: prepacks.length,
      sheetName: PREPACKS_SHEET
    });
  } catch (err) {
    console.error("Ошибка при выгрузке полуфабрикатов:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// =====================================================
// ИНВЕНТАРИЗАЦИЯ — ЧТЕНИЕ
// =====================================================

app.get("/api/inventory/products", async (req, res) => {
  try {
    const { date } = req.query;

    // Если есть существующий лист — читаем его
    if (date && await checkInventorySheetExists(date)) {
      const inventoryData = await readInventorySheetData(date);

      if (inventoryData) {
        const grouped = groupInventory(inventoryData);
        return res.json({
          data: grouped,
          existingInventory: true,
          date
        });
      }
    }

    // Иначе читаем шаблон Лист1
    const products = await readProductsFromSheet();
    const grouped = groupInventory(products);

    res.json({
      data: grouped,
      existingInventory: false
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Группировка по холодильникам
function groupInventory(products) {
  const fridges = {};

  products.forEach(item => {
    const loc = item.fridge || "Без холодильника";

    if (!fridges[loc]) fridges[loc] = [];

    fridges[loc].push({
      name: item.name,
      category: item.category,
      type: item.type,
      unit: item.unit || "кг",
      currentQuantity: item.quantity || "",
      savedQuantity: item.quantity || "",
      rowIndex: item.rowIndex
    });
  });

  return Object.keys(fridges).map(loc => ({
    fridgeNumber: loc,
    products: fridges[loc]
  }));
}

// =====================================================
// ИНВЕНТАРИЗАЦИЯ — СОХРАНЕНИЕ
// =====================================================

app.post("/api/inventory/save", async (req, res) => {
  try {
    const { inventoryData, inventoryDate } = req.body;

    if (!inventoryData || !inventoryDate) {
      return res.status(400).json({
        success: false,
        error: "Некорректные данные"
      });
    }

    let sheetName;

    if (!await checkInventorySheetExists(inventoryDate)) {
      sheetName = await createInventorySheet(inventoryDate);
    } else {
      sheetName = `Інвентаризація ${inventoryDate}`;
    }

    const dataByFridge = {};

    inventoryData.forEach(fridge => {
      dataByFridge[fridge.fridgeNumber] = fridge.products.map(item => ({
        name: item.name,
        quantity: item.quantity
      }));
    });

    await writeQuantitiesToInventorySheet(sheetName, dataByFridge);

    res.json({
      success: true,
      message: "Инвентаризация сохранена",
      sheetName
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =====================================================
// PDF EXPORT
// =====================================================

app.get("/api/inventory/export-pdf/:sheetName", async (req, res) => {
  try {
    const sheetName = decodeURIComponent(req.params.sheetName);

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });

    const sheet = spreadsheet.data.sheets.find(
      s => s.properties.title === sheetName
    );

    if (!sheet) {
      return res.status(404).json({
        success: false,
        error: "Лист не найден"
      });
    }

    const gid = sheet.properties.sheetId;

    const exportUrl =
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=pdf&gid=${gid}&portrait=false&fitw=true`;

    res.json({
      success: true,
      downloadUrl: exportUrl,
      sheetName
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =====================================================
// ЛОКИ НА ХОЛОДИЛЬНИКИ
// =====================================================

app.post("/api/locks/lock", (req, res) => {
  const { locationNumber, userName } = req.body;

  if (!locationNumber || !userName) {
    return res.status(400).json({
      success: false,
      error: "Нет данных"
    });
  }

  const exists = LockManager.getLock(locationNumber);

  if (exists) {
    return res.json({
      success: false,
      error: `Стеллаж/холодильник уже открыт пользователем ${exists.userName}`
    });
  }

  LockManager.setLock(locationNumber, userName);
  res.json({ success: true });
});

app.get("/api/locks/check/:locationNumber", (req, res) => {
  const { locationNumber } = req.params;

  const lock = LockManager.getLock(locationNumber);

  if (!lock) {
    return res.json({ locked: false });
  }

  res.json({
    locked: true,
    locationNumber,
    userName: lock.userName,
    lockedAt: lock.time
  });
});

app.delete("/api/locks/unlock/:locationNumber", (req, res) => {
  const { locationNumber } = req.params;

  LockManager.removeLock(locationNumber);

  res.json({ success: true });
});

app.get("/api/locks/all", (req, res) => {
  res.json({
    success: true,
    locks: LockManager.getAllLocks()
  });
});

// =====================================================
// Главная страница
// =====================================================

app.get("/", (req, res) => {
  res.send(`
    ✅ Сервер працює!<br><br>
    <strong>Доступні endpoints:</strong><br><br>
    📦 <strong>Poster API:</strong><br>
    - GET /api/products - отримати продукти з Poster<br><br>
    
    📤 <strong>Виведення в Google Sheets:</strong><br>
    - GET /api/upload-to-sheets - завантажити продукти<br>
    - GET /api/upload-all-to-sheets - завантажити всі позиції<br>
    - GET /api/upload-prepacks-to-sheets - 🆕 <strong>завантажити НАПІВФАБРИКАТИ з ID</strong><br><br>
    
    📋 <strong>Інвентаризація:</strong><br>
    - GET /api/inventory/products - отримати продукти для інвентаризації<br>
    - POST /api/inventory/save - зберегти залишки<br>
    - GET /api/inventory/export-pdf/:sheetName - експорт в PDF<br><br>
    
    🔒 <strong>Блокування:</strong><br>
    - POST /api/locks/lock - заблокувати локацію<br>
    - DELETE /api/locks/unlock/:locationNumber - розблокувати<br>
    - GET /api/locks/check/:locationNumber - перевірити блокування<br>
    - GET /api/locks/all - всі блокування
  `);
});

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 Backend запущен на порту ${PORT}`)
);
