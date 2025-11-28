import express from "express";
import cors from "cors";

import {
  readProductsFromSheet,
  readAllProductsFromPoster,
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

// CORS налаштування для frontend
app.use(cors({
  origin: [
    'https://inventory-1-fydp.onrender.com',
    'http://localhost:3000',
    'http://localhost:5000'
  ],
  credentials: true
}));

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
// СИНХРОНИЗАЦИЯ ПОЛУФАБРИКАТОВ (обновление изменений)
// =====================================================

app.get("/api/sync-prepacks", async (req, res) => {
  try {
    const SHEET_NAME = "Напівфабрикати";
    
    // Получаем актуальные данные из Poster
    const posterPrepacks = await getPosterPrepacks();
    
    if (!posterPrepacks || posterPrepacks.length === 0) {
      return res.json({ 
        success: false, 
        message: "Не вдалося отримати дані з Poster" 
      });
    }
    
    // Создаем Map для быстрого поиска по ID
    const posterMap = new Map();
    posterPrepacks.forEach(p => {
      posterMap.set(String(p.product_id), p.product_name);
    });
    
    // Проверяем существует ли лист
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const sheetExists = spreadsheet.data.sheets.find(
      s => s.properties.title === SHEET_NAME
    );
    
    // Если листа нет - создаем и выгружаем всё
    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: SHEET_NAME } }
          }]
        }
      });
      
      // Заголовки
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:C1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [["ID", "Назва", "Тип"]]
        }
      });
      
      // Все данные
      const values = posterPrepacks.map(p => [
        p.product_id,
        p.product_name,
        "Напівфабрикат"
      ]);
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2`,
        valueInputOption: "RAW",
        requestBody: { values }
      });
      
      return res.json({
        success: true,
        message: `✅ Створено аркуш і додано ${posterPrepacks.length} напівфабрикатів`,
        added: posterPrepacks.length,
        updated: 0,
        deleted: 0
      });
    }
    
    // Читаем существующие данные из таблицы
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:C`
    });
    
    const rows = sheetData.data.values || [];
    
    // Создаем Map существующих записей (ID -> {name, rowIndex})
    const sheetMap = new Map();
    rows.forEach((row, index) => {
      if (row[0]) { // Если есть ID
        sheetMap.set(String(row[0]), {
          name: row[1] || "",
          rowIndex: index + 2
        });
      }
    });
    
    const updates = [];
    let addedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    
    // 1. Обновляем существующие и находим новые
    for (const [id, newName] of posterMap) {
      if (sheetMap.has(id)) {
        // Запись существует - проверяем изменилось ли название
        const existing = sheetMap.get(id);
        if (existing.name !== newName) {
          updates.push({
            range: `${SHEET_NAME}!B${existing.rowIndex}`,
            values: [[newName]]
          });
          updatedCount++;
        }
      } else {
        // Новая запись - добавим в конец
        addedCount++;
      }
    }
    
    // Применяем обновления названий
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: updates
        }
      });
    }
    
    // 2. Добавляем новые записи
    if (addedCount > 0) {
      const newRows = [];
      for (const [id, name] of posterMap) {
        if (!sheetMap.has(id)) {
          newRows.push([id, name, "Напівфабрикат"]);
        }
      }
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:C`,
        valueInputOption: "RAW",
        requestBody: { values: newRows }
      });
    }
    
    // 3. Помечаем удаленные (которые есть в таблице, но нет в Poster)
    const deletedRows = [];
    for (const [id, data] of sheetMap) {
      if (!posterMap.has(id)) {
        deletedRows.push({
          range: `${SHEET_NAME}!C${data.rowIndex}`,
          values: [["❌ Видалено з Poster"]]
        });
        deletedCount++;
      }
    }
    
    if (deletedRows.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: deletedRows
        }
      });
    }
    
    res.json({
      success: true,
      message: `✅ Синхронізація завершена`,
      added: addedCount,
      updated: updatedCount,
      deleted: deletedCount,
      total: posterPrepacks.length
    });
    
  } catch (err) {
    console.error("Ошибка синхронизации:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// =====================================================
// ДОБАВЛЕНИЕ ФОРМУЛ ВПР ДЛЯ ID НАПІВФАБРИКАТІВ
// =====================================================

app.get("/api/add-id-formulas", async (req, res) => {
  try {
    const MASTER_SHEET = "Лист1";
    const PREPACKS_SHEET = "Напівфабрикати";
    
    console.log("📋 Додаю колонку ID та формули ВПР...");
    
    // Получаем данные из Лист1
    const masterData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET}!A1:F`
    });
    
    const rows = masterData.data.values || [];
    
    if (rows.length === 0) {
      return res.json({
        success: false,
        message: "Лист1 порожній"
      });
    }
    
    // Проверяем есть ли уже колонка ID
    const headers = rows[0];
    const hasIdColumn = headers.includes("ID");
    
    if (hasIdColumn) {
      return res.json({
        success: false,
        message: "Колонка ID вже існує"
      });
    }
    
    // Добавляем заголовок ID в колонку G
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET}!G1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["ID"]]
      }
    });
    
    console.log("✅ Додано заголовок ID");
    
    // Создаем формулы ВПР для каждой строки
    const formulas = [];
    
    for (let i = 2; i <= rows.length; i++) {
      // Формула ВПР:
      // =IFERROR(VLOOKUP(C{i},'Напівфабрикати'!B:A,2,FALSE),"")
      // Ищет название из колонки C в листе Напівфабрикати (колонка B),
      // возвращает ID из колонки A
      
      const formula = `=IFERROR(VLOOKUP(C${i},'${PREPACKS_SHEET}'!B:A,2,FALSE),"")`;
      
      formulas.push({
        range: `${MASTER_SHEET}!G${i}`,
        values: [[formula]]
      });
    }
    
    // Применяем все формулы одним batch update
    if (formulas.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "USER_ENTERED", // ВАЖНО: USER_ENTERED для формул
          data: formulas
        }
      });
      
      console.log(`✅ Додано ${formulas.length} формул ВПР`);
    }
    
    res.json({
      success: true,
      message: `✅ Додано колонку ID та ${formulas.length} формул ВПР`,
      formulasCount: formulas.length
    });
    
  } catch (err) {
    console.error("❌ Помилка додавання формул:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// =====================================================
// ОБНОВЛЕНИЕ ФОРМУЛ ПОСЛЕ СИНХРОНИЗАЦИИ
// =====================================================

app.get("/api/update-id-formulas", async (req, res) => {
  try {
    const MASTER_SHEET = "Лист1";
    const PREPACKS_SHEET = "Напівфабрикати";
    
    console.log("🔄 Оновлюю формули ВПР...");
    
    // Получаем данные из Лист1
    const masterData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET}!A1:G`
    });
    
    const rows = masterData.data.values || [];
    
    if (rows.length === 0) {
      return res.json({
        success: false,
        message: "Лист1 порожній"
      });
    }
    
    // Проверяем есть ли колонка ID
    const headers = rows[0];
    const idColumnIndex = headers.indexOf("ID");
    
    if (idColumnIndex === -1) {
      return res.json({
        success: false,
        message: "Колонка ID не знайдена. Спочатку викличте /api/add-id-formulas"
      });
    }
    
    // Обновляем формулы для строк где нет ID
    const formulas = [];
    
    for (let i = 1; i < rows.length; i++) {
      const rowIndex = i + 1;
      const row = rows[i];
      
      // Проверяем есть ли уже ID
      const hasId = row[idColumnIndex] && row[idColumnIndex].trim() !== "";
      
      if (!hasId) {
        const formula = `=IFERROR(VLOOKUP(C${rowIndex},'${PREPACKS_SHEET}'!B:A,2,FALSE),"")`;
        
        formulas.push({
          range: `${MASTER_SHEET}!G${rowIndex}`,
          values: [[formula]]
        });
      }
    }
    
    if (formulas.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: formulas
        }
      });
      
      console.log(`✅ Оновлено ${formulas.length} формул`);
    }
    
    res.json({
      success: true,
      message: `✅ Оновлено ${formulas.length} формул ВПР`,
      formulasCount: formulas.length
    });
    
  } catch (err) {
    console.error("❌ Помилка оновлення формул:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// =====================================================
// СТВОРЕННЯ ДОВІДНИКА ЛОКАЦІЙ З ЛИСТ1
// =====================================================

app.get("/api/create-locations-reference", async (req, res) => {
  try {
    const MASTER_SHEET = "Лист1";
    const REFERENCE_SHEET = "Локації-Довідник";
    
    console.log("📋 Створюю довідник локацій з Лист1...");
    
    // 1. Читаем данные из Лист1
    const masterData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET}!A2:F`
    });
    
    const rows = masterData.data.values || [];
    
    if (rows.length === 0) {
      return res.json({
        success: false,
        message: "Лист1 порожній"
      });
    }
    
    console.log(`📦 Обробляю ${rows.length} рядків...`);
    
    // 2. Парсим локации и создаем справочник
    const locationMap = new Map(); // Назва -> Set локацій
    
    rows.forEach(row => {
      const fridgeValue = row[0] || ""; // Колонка A - Холодильники
      const shelfValue = row[1] || "";  // Колонка B - Стелажі
      const name = row[2] || "";        // Колонка C - Назва
      
      if (!name) return;
      
      // Парсим холодильники
      const fridges = [];
      if (fridgeValue) {
        fridgeValue.split(",").forEach(f => {
          const trimmed = f.trim();
          if (trimmed) fridges.push({ type: "Холодильник", number: trimmed });
        });
      }
      
      // Парсим стелажі
      const shelves = [];
      if (shelfValue) {
        shelfValue.split(",").forEach(s => {
          const trimmed = s.trim();
          if (trimmed) shelves.push({ type: "Стелаж", number: trimmed });
        });
      }
      
      // Объединяем все локации
      const allLocations = [...fridges, ...shelves];
      
      if (allLocations.length > 0) {
        if (!locationMap.has(name)) {
          locationMap.set(name, []);
        }
        locationMap.get(name).push(...allLocations);
      }
    });
    
    console.log(`📍 Знайдено ${locationMap.size} позицій з локаціями`);
    
    // 3. Создаем новый лист если его нет
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const sheetExists = spreadsheet.data.sheets.find(
      s => s.properties.title === REFERENCE_SHEET
    );
    
    if (sheetExists) {
      // Удаляем старый лист
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteSheet: {
              sheetId: sheetExists.properties.sheetId
            }
          }]
        }
      });
      console.log("🗑️ Видалено старий аркуш");
    }
    
    // Создаем новый лист
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: REFERENCE_SHEET
            }
          }
        }]
      }
    });
    
    console.log(`✅ Створено аркуш "${REFERENCE_SHEET}"`);
    
    // 4. Записываем заголовки
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${REFERENCE_SHEET}!A1:C1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Назва", "Тип локації", "Номер"]]
      }
    });
    
    // 5. Формируем данные для записи
    const referenceData = [];
    
    for (const [name, locations] of locationMap) {
      locations.forEach(loc => {
        referenceData.push([
          name,
          loc.type,
          loc.number
        ]);
      });
    }
    
    // Сортируем для удобства
    referenceData.sort((a, b) => {
      // Сначала по названию
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      // Потом по типу (Холодильник перед Стелаж)
      if (a[1] < b[1]) return -1;
      if (a[1] > b[1]) return 1;
      // Потом по номеру
      return Number(a[2]) - Number(b[2]);
    });
    
    console.log(`📝 Записую ${referenceData.length} рядків...`);
    
    // 6. Записываем данные
    if (referenceData.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${REFERENCE_SHEET}!A2`,
        valueInputOption: "RAW",
        requestBody: {
          values: referenceData
        }
      });
    }
    
    res.json({
      success: true,
      message: `✅ Створено довідник локацій "${REFERENCE_SHEET}"`,
      totalProducts: locationMap.size,
      totalRows: referenceData.length,
      sheetName: REFERENCE_SHEET
    });
    
  } catch (err) {
    console.error("❌ Помилка створення довідника:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// =====================================================
// ВИВЕДЕННЯ ВСІХ ID З POSTER (не тільки напівфабрикати)
// =====================================================

app.get("/api/upload-all-ids-to-sheets", async (req, res) => {
  try {
    const SHEET_NAME = "Всі ID з Poster";
    
    console.log("📋 Отримую ВСІ позиції з Poster з ID...");
    
    // Получаем ВСЕ позиции из Poster
    const allItems = await getAllPosterItems();
    
    if (!allItems || allItems.length === 0) {
      return res.json({
        success: false,
        message: "Не вдалося отримати дані з Poster"
      });
    }
    
    console.log(`📦 Отримано: ${allItems.length} позицій`);
    
    // Проверяем существует ли лист
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const sheetExists = spreadsheet.data.sheets.find(
      s => s.properties.title === SHEET_NAME
    );
    
    // Если листа нет - создаем
    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: SHEET_NAME
              }
            }
          }]
        }
      });
      console.log(`✅ Створено аркуш "${SHEET_NAME}"`);
    } else {
      // Очищаем существующий лист
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:D`
      });
      console.log("🗑️ Очищено старі дані");
    }
    
    // Записываем заголовки
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:D1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["ID", "Назва", "Категорія", "Тип"]]
      }
    });
    
    // Формируем данные
    const values = allItems.map(item => [
      item.id,
      item.name,
      item.category,
      item.type
    ]);
    
    // Записываем данные
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: "RAW",
      requestBody: {
        values: values
      }
    });
    
    console.log(`✅ Записано ${values.length} рядків`);
    
    res.json({
      success: true,
      message: `✅ ВСІ ID (${allItems.length} шт.) успішно виведені в "${SHEET_NAME}"!`,
      count: allItems.length,
      sheetName: SHEET_NAME,
      breakdown: {
        products: allItems.filter(i => i.type === "Продукт меню").length,
        techCards: allItems.filter(i => i.type === "Тех.карта").length,
        prepacks: allItems.filter(i => i.type === "Напівфабрикат").length,
        ingredients: allItems.filter(i => i.type === "Інгредієнт").length
      }
    });
    
  } catch (err) {
    console.error("Ошибка выгрузки всех ID:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// =====================================================
// СИНХРОНИЗАЦИЯ ВСЕХ ID (обновление изменений)
// =====================================================

app.get("/api/sync-all-ids", async (req, res) => {
  try {
    const SHEET_NAME = "Всі ID з Poster";
    
    console.log("🔄 Синхронізація ВСІХ ID з Poster...");
    
    // Получаем актуальные данные из Poster
    const posterItems = await getAllPosterItems();
    
    if (!posterItems || posterItems.length === 0) {
      return res.json({
        success: false,
        message: "Не вдалося отримати дані з Poster"
      });
    }
    
    console.log(`📦 Отримано: ${posterItems.length} позицій`);
    
    // Проверяем существует ли лист
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const sheetExists = spreadsheet.data.sheets.find(
      s => s.properties.title === SHEET_NAME
    );
    
    // Если листа нет - создаем
    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: SHEET_NAME
              }
            }
          }]
        }
      });
      console.log(`✅ Створено аркуш "${SHEET_NAME}"`);
    }
    
    // Очищаем лист полностью
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:D`
    });
    console.log("🗑️ Очищено старі дані");
    
    // Записываем заголовки
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:D1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["ID", "Назва", "Категорія", "Тип"]]
      }
    });
    
    // Формируем данные
    const values = posterItems.map(item => [
      item.id,
      item.name,
      item.category,
      item.type
    ]);
    
    // Записываем данные
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: "RAW",
      requestBody: {
        values: values
      }
    });
    
    console.log(`✅ Записано ${values.length} рядків`);
    
    res.json({
      success: true,
      message: `✅ Синхронізація завершена! Оновлено ${posterItems.length} позицій`,
      total: posterItems.length,
      breakdown: {
        products: posterItems.filter(i => i.type === "Продукт меню").length,
        techCards: posterItems.filter(i => i.type === "Тех.карта").length,
        prepacks: posterItems.filter(i => i.type === "Напівфабрикат").length,
        ingredients: posterItems.filter(i => i.type === "Інгредієнт").length
      }
    });
    
  } catch (err) {
    console.error("Ошибка синхронизации всех ID:", err);
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

    // Иначе читаем шаблон + всі продукти
    const products = await readProductsFromSheet();
    const allProducts = await readAllProductsFromPoster();
    
    // Объединяем: сначала продукты с локациями, потом все продукты
    const combined = [...products, ...allProducts];
    const grouped = groupInventory(combined);

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
        category: item.category || "",
        type: item.type || "",
        unit: item.unit || "кг",
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
    - GET /api/upload-prepacks-to-sheets - завантажити напівфабрикати з ID<br>
    - GET /api/upload-all-ids-to-sheets - 🆕 <strong>завантажити ВСІ ID з Poster</strong><br>
    - GET /api/sync-prepacks - синхронізувати напівфабрикати<br>
    - GET /api/sync-all-ids - 🆕 <strong>синхронізувати ВСІ ID</strong><br><br>
    
    🔢 <strong>Формули та ID:</strong><br>
    - GET /api/add-id-formulas - додати формули ВПР для ID<br>
    - GET /api/update-id-formulas - оновити формули після змін<br>
    - GET /api/create-locations-reference - створити довідник локацій<br><br>
    
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
