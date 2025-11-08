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

// 📥 ЧИТАННЯ ДАНИХ З GOOGLE SHEETS
export async function readProductsFromSheet() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A2:E`, // Читаємо з головного аркуша
    });

    const rows = response.data.values || [];
    
    // Перетворюємо рядки в об'єкти
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || "";
      const name = row[1] || "";
      const category = row[2] || "";
      const type = row[3] || "";
      const quantity = row[4] || "";
      
      // Якщо в колонці A записано "2,3" або "2, 3", розбиваємо на окремі холодильники
      if (fridgeValue.includes(",")) {
        const fridgeNumbers = fridgeValue.split(",").map(f => f.trim());
        
        fridgeNumbers.forEach(fridgeNum => {
          products.push({
            rowIndex: index + 2,
            fridge: fridgeNum,
            name,
            category,
            type,
            quantity
          });
        });
      } else {
        products.push({
          rowIndex: index + 2,
          fridge: fridgeValue,
          name,
          category,
          type,
          quantity
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

// 🆕 ЧИТАННЯ ДАНИХ З КОНКРЕТНОГО АРКУША ІНВЕНТАРИЗАЦІЇ
export async function readInventorySheetData(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;
    
    // Перевіряємо чи існує такий аркуш
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const existingSheet = spreadsheet.data.sheets.find(
      sheet => sheet.properties.title === sheetName
    );
    
    if (!existingSheet) {
      console.log(`⚠️ Аркуш "${sheetName}" не існує`);
      return null;
    }
    
    // Читаємо дані з аркуша
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:E`,
    });
    
    const rows = response.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || "";
      const name = row[1] || "";
      const category = row[2] || "";
      const type = row[3] || "";
      const quantity = row[4] || "";
      
      if (fridgeValue.includes(",")) {
        const fridgeNumbers = fridgeValue.split(",").map(f => f.trim());
        
        fridgeNumbers.forEach(fridgeNum => {
          products.push({
            rowIndex: index + 2,
            fridge: fridgeNum,
            name,
            category,
            type,
            quantity
          });
        });
      } else {
        products.push({
          rowIndex: index + 2,
          fridge: fridgeValue,
          name,
          category,
          type,
          quantity
        });
      }
    });
    
    console.log(`📋 Прочитано ${products.length} продуктів з аркуша "${sheetName}"`);
    return products;
  } catch (error) {
    console.error("❌ Помилка при читанні аркуша інвентаризації:", error);
    return null;
  }
}

// 🆕 ПЕРЕВІРКА ІСНУВАННЯ АРКУША ІНВЕНТАРИЗАЦІЇ
export async function checkInventorySheetExists(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;
    
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const existingSheet = spreadsheet.data.sheets.find(
      sheet => sheet.properties.title === sheetName
    );
    
    return !!existingSheet;
  } catch (error) {
    console.error("❌ Помилка при перевірці існування аркуша:", error);
    return false;
  }
}

// 🆕 СТВОРЕННЯ НОВОГО АРКУША ДЛЯ ІНВЕНТАРИЗАЦІЇ
export async function createInventorySheet(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;
    
    // Перевіряємо чи існує вже такий аркуш
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const existingSheet = spreadsheet.data.sheets.find(
      sheet => sheet.properties.title === sheetName
    );
    
    if (existingSheet) {
      console.log(`⚠️ Аркуш "${sheetName}" вже існує`);
      return sheetName;
    }
    
    // Копіюємо дані з головного аркуша
    const masterData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A1:D`, // Копіюємо без колонки E (Залишки)
    });
    
    // Створюємо новий аркуш
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        }]
      }
    });
    
    // Копіюємо структуру (заголовки + дані без залишків)
    const rows = masterData.data.values || [];
    const newRows = rows.map((row, index) => {
      if (index === 0) {
        // Заголовки + додаємо колонку "Залишки"
        return [...row, "Залишки"];
      } else {
        // Дані без залишків
        return row.slice(0, 4); // Тільки A, B, C, D
      }
    });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: newRows }
    });
    
    console.log(`✅ Створено новий аркуш: ${sheetName}`);
    return sheetName;
  } catch (error) {
    console.error("❌ Помилка при створенні аркуша:", error);
    throw error;
  }
}

// 📤 ЗАПИС ЗАЛИШКІВ В НОВИЙ АРКУШ ІНВЕНТАРИЗАЦІЇ
export async function writeQuantitiesToInventorySheet(sheetName, quantities) {
  try {
    // Читаємо всі дані з нового аркуша
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:D`, // Читаємо без колонки E
    });
    
    const rows = response.data.values || [];
    
    // Створюємо Map для швидкого пошуку
    const quantityMap = new Map();
    quantities.forEach(q => {
      quantityMap.set(q.name, q.totalQuantity);
    });
    
    // Готуємо масив для batch update
    const updates = [];
    
    rows.forEach((row, index) => {
      const productName = row[1]; // Колонка B - Назва
      const rowIndex = index + 2;
      
      if (quantityMap.has(productName)) {
        const quantity = quantityMap.get(productName);
        updates.push({
          range: `${sheetName}!E${rowIndex}`,
          values: [[quantity]]
        });
      }
    });
    
    if (updates.length === 0) {
      console.log("⚠️ Немає даних для запису");
      return;
    }
    
    // Batch update - оновлюємо всі комірки одним запитом
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    });
    
    console.log(`✅ Оновлено ${updates.length} записів у аркуші "${sheetName}"`);
  } catch (error) {
    console.error("❌ Помилка при запису залишків:", error);
    throw error;
  }
}

// 📤 ЗАПИС ЗАЛИШКІВ В КОЛОНКУ E
export async function writeQuantitiesToSheet(quantities) {
  try {
    // quantities - це масив об'єктів { name: "Назва продукту", totalQuantity: 1.3 }
    
    // Спочатку читаємо всі дані
    const allProducts = await readProductsFromSheet();
    
    // Створюємо Map для швидкого пошуку
    const quantityMap = new Map();
    quantities.forEach(q => {
      quantityMap.set(q.name, q.totalQuantity);
    });
    
    // Готуємо масив для batch update
    const updates = [];
    
    allProducts.forEach(product => {
      if (quantityMap.has(product.name)) {
        const quantity = quantityMap.get(product.name);
        updates.push({
          range: `E${product.rowIndex}`, // Записуємо в колонку E
          values: [[quantity]]
        });
      }
    });
    
    if (updates.length === 0) {
      console.log("⚠️ Немає даних для запису");
      return;
    }
    
    // Batch update - оновлюємо всі комірки одним запитом
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    });
    
    console.log(`✅ Оновлено ${updates.length} записів у Google Sheets`);
  } catch (error) {
    console.error("❌ Помилка при запису залишків:", error);
    throw error;
  }
}

// 📦 ЗАПИС ПРОДУКТІВ (старий метод, залишаємо для сумісності)
export async function writeProductsToSheet(products) {
  const hasType = products.length > 0 && products[0].hasOwnProperty('type');
  
  const headers = hasType 
    ? [["Назва", "Категорія", "Тип"]]
    : [["Назва", "Категорія"]];
  
  const values = products.map((p) => {
    if (hasType) {
      return [
        p.name || p.product_name,
        p.category || p.menu_category_name || "-",
        p.type || "-"
      ];
    } else {
      return [
        p.name || p.product_name,
        p.category || p.menu_category_name || "-"
      ];
    }
  });
  
  const headerRange = hasType ? "A1:C1" : "A1:B1";
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: headerRange,
    valueInputOption: "RAW",
    requestBody: { values: headers },
  });
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "A2",
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
