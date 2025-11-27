import express from "express";
import cors from "cors";
import {
  writeProductsToSheet,
  readProductsFromSheet,
  writeQuantitiesToSheet,
  createInventorySheet,
  writeQuantitiesToInventorySheet,
  addQuantitiesToInventorySheet,
  readInventorySheetData,
  checkInventorySheetExists,
  sheets,
  SPREADSHEET_ID
} from "./googleSheets.js";

import { getPosterProducts, getAllPosterItems } from "./poster.js";

// Новый быстрый механизм блокировок
import LockManager from "./lockManager.js";

const app = express();
app.use(cors());
app.use(express.json());

/*  
   =====================================================
        POSTER API — получение продуктов
   =====================================================
*/

const testProducts = [
  { product_id: 1, product_name: "Кофе", menu_category_name: "Напитки" },
  { product_id: 2, product_name: "Круассан", menu_category_name: "Выпечка" },
  { product_id: 3, product_name: "Сэндвич", menu_category_name: "Закуски" },
];

app.get("/api/products", async (req, res) => {
  try {
    const products = await getPosterProducts();

    if (products.length === 0) {
      return res.json(testProducts);
    }

    res.json(products);

  } catch (error) {
    res.status(500).json({ error: "Ошибка загрузки продуктов" });
  }
});

/*  
   =====================================================
        ВЫГРУЗКА ДАННЫХ В GOOGLE SHEETS
   =====================================================
*/

app.get("/api/upload-to-sheets", async (req, res) => {
  try {
    const items = await getPosterProducts();
    await writeProductsToSheet(items.length ? items : testProducts);

    res.json({
      success: true,
      message: "Данные выгружены",
      count: items.length
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
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

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/*  
   =====================================================
        ИНВЕНТАРИЗАЦИЯ
   =====================================================
*/

app.get("/api/inventory/products", async (req, res) => {
  try {
    const { date } = req.query;

    // Если загружаем существующую инвентаризацию
    if (date && await checkInventorySheetExists(date)) {

      const inventoryData = await readInventorySheetData(date);

      if (inventoryData) {
        const result = groupInventory(inventoryData);
        return res.json({
          data: result,
          existingInventory: true,
          date
        });
      }
    }

    // Иначе — загрузка по шаблону
    const products = await readProductsFromSheet();
    const result = groupInventory(products);

    res.json({
      data: result,
      existingInventory: false
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function groupInventory(products) {
  const fridges = {};

  products.forEach(p => {
    const num = p.fridge || "Без холодильника";
    if (!fridges[num]) fridges[num] = [];

    fridges[num].push({
      name: p.name,
      category: p.category,
      type: p.type,
      unit: p.unit || "кг",
      currentQuantity: p.quantity || "",
      savedQuantity: p.quantity || "",
      rowIndex: p.rowIndex
    });
  });

  return Object.keys(fridges).map(n => ({
    fridgeNumber: n,
    products: fridges[n]
  }));
}

/*  
   =====================================================
        СОХРАНЕНИЕ ИНВЕНТАРИЗАЦИИ
   =====================================================
*/

app.post("/api/inventory/save", async (req, res) => {
  try {
    const { inventoryData, inventoryDate } = req.body;

    if (!inventoryData || !inventoryDate) {
      return res.status(400).json({ success: false, error: "Неверные данные" });
    }

    let sheetName;

    if (!await checkInventorySheetExists(inventoryDate)) {
      sheetName = await createInventorySheet(inventoryDate);
    } else {
      sheetName = `Инвентаризация ${inventoryDate}`;
    }

    // Формируем данные по холодильникам
    const dataByFridge = {};
    inventoryData.forEach(fridge => {
      dataByFridge[fridge.fridgeNumber] =
        fridge.products.map(p => ({
          name: p.name,
          quantity: p.quantity
        }));
    });

    await writeQuantitiesToInventorySheet(sheetName, dataByFridge);

    res.json({
      success: true,
      message: "Инвентаризация сохранена",
      sheetName
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/*  
   =====================================================
        PDF EXPORT
   (оставлено как у вас — можно улучшить позже)
   =====================================================
*/

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
      return res.status(404).json({ success: false, error: "Лист не найден" });
    }

    const gid = sheet.properties.sheetId;

    const exportUrl =
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}` +
      `/export?format=pdf&gid=${gid}&portrait=false&fitw=true`;

    res.json({
      success: true,
      downloadUrl: exportUrl,
      sheetName
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/*  
   =====================================================
        НОВЫЕ БЫСТРЫЕ БЛОКИРОВКИ
   =====================================================
*/

// Заблокировать стеллаж/холодильник
app.post("/api/locks/lock", (req, res) => {
  const { locationNumber, userName } = req.body;

  if (!locationNumber || !userName) {
    return res.status(400).json({ success: false, error: "Нет данных" });
  }

  const existing = LockManager.getLock(locationNumber);

  if (existing) {
    return res.json({
      success: false,
      error: `Стеллаж уже открыт пользователем ${existing.userName}`
    });
  }

  LockManager.setLock(locationNumber, userName);
  return res.json({ success: true });
});

// Проверить
app.get("/api/locks/check/:locationNumber", (req, res) => {
  const lock = LockManager.getLock(req.params.locationNumber);

  if (!lock) return res.json({ locked: false });

  return res.json({
    locked: true,
    userName: lock.userName
  });
});

// Разблокировать
app.delete("/api/locks/unlock/:locationNumber", (req, res) => {
  LockManager.removeLock(req.params.locationNumber);
  return res.json({ success: true });
});

// Все блокировки
app.get("/api/locks/all", (req, res) => {
  res.json({
    success: true,
    locks: LockManager.getAllLocks()
  });
});

/*  
   =====================================================
        СТАРТ СЕРВЕРА
   =====================================================
*/

app.get("/", (req, res) => {
  res.send("Сервер работает");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
