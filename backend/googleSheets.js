import fs from "fs";
import { google } from "googleapis";

// === Google Sheets credentials ===
const CREDENTIALS_PATH = "/etc/secrets/credentials.json";

// Читаем JSON с сервисным аккаунтом
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

// Авторизация Google API
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// === Основная логика ===
const SPREADSHEET_ID = "1eiJw3ADAdq6GfQxsbJp0STDsc1MyJfPXCf2caQy8khw";
const MASTER_SHEET_NAME = "Лист1"; // Головний аркуш з шаблоном

// 📥 ЧИТАННЯ ДАНИХ З GOOGLE SHEETS (Мастер-лист)
export async function readProductsFromSheet() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A2:G`, // Читаем чуть шире
    });

    const rows = response.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || "";
      const name = row[1] || "";
      const category = row[2] || "";
      const type = row[3] || "";
      // row[4] пропускаем (старые данные)
      const unit = row[5] || "кг"; 
      
      if (fridgeValue.includes(",")) {
        const fridgeNumbers = fridgeValue.split(",").map(f => f.trim());
        fridgeNumbers.forEach(fridgeNum => {
          products.push({
            rowIndex: index + 2,
            fridge: fridgeNum,
            name,
            category,
            type,
            unit,
            quantity: "" 
          });
        });
      } else {
        products.push({
          rowIndex: index + 2,
          fridge: fridgeValue,
          name,
          category,
          type,
          unit,
          quantity: ""
        });
      }
    });

    console.log(`📋 Прочитано ${products.length} продуктів з Google Sheets`);
    return products;
  } catch (error) {
    console.error("❌ Помилка при читанні даних з Google Sheets:", error);
    throw error;
  }
}

// 🆕 ЧИТАННЯ ДАНИХ З КОНКРЕТНОГО АРКУША ІНВЕНТАРИЗАЦІЇ (ВИПРАВЛЕНО)
export async function readInventorySheetData(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;
    
    // Перевіряємо чи існує
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const existingSheet = spreadsheet.data.sheets.find(
      sheet => sheet.properties.title === sheetName
    );
    
    if (!existingSheet) {
      return null;
    }

    // 1. Читаємо заголовки, щоб знайти де чий холодильник
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });
    const headers = headerResponse.data.values?.[0] || [];
    
    // Карта колонок: { "1": 6, "2": 7 } (Холодильник 1 -> індекс колонки 6)
    const fridgeColIndices = {};
    headers.forEach((h, i) => {
      const match = h?.match(/Холодильник\s+(\d+)/i);
      if(match) fridgeColIndices[match[1]] = i;
    });

    // 2. Читаємо всі дані
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });
    
    const rows = response.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || "";
      const name = row[1] || "";
      const category = row[2] || "";
      const type = row[3] || "";
      const unit = row[5] || "кг"; // Зазвичай F
      
      // Логіка для розділення по холодильниках
      const targetFridges = fridgeValue.includes(",") 
        ? fridgeValue.split(",").map(f => f.trim()) 
        : [fridgeValue];

      targetFridges.forEach(fridgeNum => {
        // Шукаємо, чи є збережене значення для цього холодильника
        let savedQty = "";
        const colIdx = fridgeColIndices[fridgeNum];
        
        if (colIdx !== undefined && row[colIdx] !== undefined && row[colIdx] !== "") {
            savedQty = row[colIdx]; // Беремо збережене значення
        }

        products.push({
          rowIndex: index + 2,
          fridge: fridgeNum,
          name,
          category,
          type,
          unit,
          quantity: savedQty // Тут тепер буде число, якщо воно є в таблиці
        });
      });
    });
    
    console.log(`📋 Відновлено ${products.length} записів з аркуша "${sheetName}"`);
    return products;

  } catch (error) {
    console.error("❌ Помилка при читанні аркуша інвентаризації:", error);
    return null;
  }
}

// 🆕 ПЕРЕВІРКА ІСНУВАННЯ АРКУША
export async function checkInventorySheetExists(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    return !!spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
  } catch (error) {
    return false;
  }
}

// 🆕 СТВОРЕННЯ НОВОГО АРКУША (ВИПРАВЛЕНО ОЧИЩЕННЯ)
export async function createInventorySheet(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;
    
    // Перевірка існування
    const exists = await checkInventorySheetExists(date);
    if (exists) return sheetName;
    
    // Читаємо Мастер-лист
    const masterData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A1:Z`,
    });
    
    // Створюємо аркуш
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
    });
    
    const rows = masterData.data.values || [];
    if (rows.length === 0) throw new Error("Немає даних в головному аркуші");

    // === ОЧИЩЕННЯ ДАНИХ ПЕРЕД ЗАПИСОМ ===
    // Ми залишаємо заголовки (row 0) і метадані (колонки A-F), 
    // але стираємо будь-які цифри в колонках інвентаризації (G+), щоб не було "фантомів"
    
    const cleanRows = rows.map((row, rowIndex) => {
      if (rowIndex === 0) return row; // Заголовки залишаємо як є
      
      // Для рядків з даними:
      return row.map((cell, colIndex) => {
        // Залишаємо перші 6 колонок (A-F: Холодильник, Назва, Кат, Тип, Старе, Од.)
        if (colIndex < 6) return cell; 
        // Все інше (кількості) стираємо
        return ""; 
      });
    });
    
    // Записуємо чисті дані
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: cleanRows }
    });
    
    console.log(`✅ Створено чистий аркуш: ${sheetName}`);
    return sheetName;
  } catch (error) {
    console.error("❌ Помилка при створенні аркуша:", error);
    throw error;
  }
}

// 📤 ЗАПИС ЗАЛИШКІВ (БЕЗ ЗМІН)
export async function writeQuantitiesToInventorySheet(sheetName, inventoryByFridge) {
  try {
    // Читаємо заголовки
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });
    const headers = headerResponse.data.values?.[0] || [];
    
    const fridgeColumns = {};
    let totalColumn = null;
    
    headers.forEach((header, index) => {
      const columnLetter = String.fromCharCode(65 + index);
      const match = header?.match(/Холодильник\s+(\d+)/i);
      if (match) fridgeColumns[match[1]] = columnLetter;
      if (header?.toLowerCase().includes('залишки')) totalColumn = columnLetter;
    });
    
    if (Object.keys(fridgeColumns).length === 0) throw new Error("Не знайдено колонок холодильників");

    // Читаємо продукти
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:E`,
    });
    const rows = response.data.values || [];
    
    const dataByFridge = {};
    Object.keys(inventoryByFridge).forEach(fridgeNum => {
      dataByFridge[fridgeNum] = new Map();
      inventoryByFridge[fridgeNum].forEach(item => {
        // Тільки якщо є значення
        if (item.quantity !== "" && item.quantity !== null) {
             dataByFridge[fridgeNum].set(item.name, item.quantity);
        }
      });
    });
    
    const updates = [];
    
    rows.forEach((row, index) => {
      const productName = row[1];
      const rowIndex = index + 2;
      let totalForProduct = 0;
      let hasData = false;
      
      Object.keys(fridgeColumns).forEach(fridgeNum => {
        const column = fridgeColumns[fridgeNum];
        if (dataByFridge[fridgeNum]?.has(productName)) {
          const quantity = dataByFridge[fridgeNum].get(productName);
          updates.push({
            range: `${sheetName}!${column}${rowIndex}`,
            values: [[quantity]]
          });
          totalForProduct += Number(quantity) || 0;
          hasData = true;
        }
      });
      
      if (hasData && totalColumn) {
        updates.push({
          range: `${sheetName}!${totalColumn}${rowIndex}`,
          values: [[totalForProduct]]
        });
      }
    });
    
    if (updates.length === 0) return;
    
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data: updates }
    });
    
    console.log(`✅ Оновлено комірки в ${sheetName}`);
  } catch (error) {
    console.error("❌ Помилка запису:", error);
    throw error;
  }
}

// Старі методи (залишаємо для сумісності, якщо потрібні)
export async function writeProductsToSheet(products) { /* ... код без змін ... */ }
export async function writeQuantitiesToSheet(quantities) { /* ... код без змін ... */ }
