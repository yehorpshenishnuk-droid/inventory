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
      range: `${MASTER_SHEET_NAME}!A2:F`, // Читаємо включно з F (Одиниці виміру)
    });

    const rows = response.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || ""; // Колонка A - Холодильники
      const shelfValue = row[1] || "";  // Колонка B - Стелажі
      const name = row[2] || "";        // Колонка C - Назва
      const category = row[3] || "";    // Колонка D - Категорія
      const type = row[4] || "";        // Колонка E - Тип
      const unit = row[5] || "кг";      // Колонка F - Одиниці виміру
      
      // Об'єднуємо холодильники та стелажі
      const allLocations = [];
      
      // Додаємо холодильники з колонки A
      if (fridgeValue) {
        if (fridgeValue.includes(",")) {
          allLocations.push(...fridgeValue.split(",").map(f => f.trim()));
        } else {
          allLocations.push(fridgeValue);
        }
      }
      
      // Додаємо стелажі з колонки B
      if (shelfValue) {
        if (shelfValue.includes(",")) {
          allLocations.push(...shelfValue.split(",").map(f => f.trim()));
        } else {
          allLocations.push(shelfValue);
        }
      }
      
      // Створюємо запис для кожного місця (холодильника або стелажа)
      if (allLocations.length > 0) {
        allLocations.forEach(location => {
          products.push({
            rowIndex: index + 2,
            fridge: location,
            name,
            category,
            type,
            unit,
            quantity: "" // Не читаємо старі залишки
          });
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
    
    // Читаємо заголовки (перший рядок) щоб знайти колонки холодильників
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    
    // Знаходимо які колонки відповідають яким холодильникам/стелажам
    const locationColumns = {};
    
    headers.forEach((header, index) => {
      const columnLetter = String.fromCharCode(65 + index); // A=65, B=66...
      
      // Шукаємо колонки типу "Холодильник 1", "Стелаж 3" і т.д.
      const fridgeMatch = header?.match(/Холодильник\s+(\d+)/i);
      const shelfMatch = header?.match(/Стелаж\s+(\d+)/i);
      
      if (fridgeMatch) {
        locationColumns[fridgeMatch[1]] = { column: columnLetter, index };
      } else if (shelfMatch) {
        locationColumns[shelfMatch[1]] = { column: columnLetter, index };
      }
    });
    
    // Читаємо дані з аркуша (всі колонки до Z)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });
    
    const rows = response.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || ""; // Колонка A - Холодильники
      const shelfValue = row[1] || "";  // Колонка B - Стелажі
      const name = row[2] || "";        // Колонка C - Назва
      const category = row[3] || "";    // Колонка D - Категорія
      const type = row[4] || "";        // Колонка E - Тип
      const unit = row[5] || "кг";      // Колонка F - Одиниці виміру
      
      // Об'єднуємо холодильники та стелажі
      const allLocations = [];
      
      if (fridgeValue) {
        if (fridgeValue.includes(",")) {
          allLocations.push(...fridgeValue.split(",").map(f => f.trim()));
        } else {
          allLocations.push(fridgeValue.trim());
        }
      }
      
      if (shelfValue) {
        if (shelfValue.includes(",")) {
          allLocations.push(...shelfValue.split(",").map(f => f.trim()));
        } else {
          allLocations.push(shelfValue.trim());
        }
      }
      
      // Створюємо запис для кожного місця з реальними залишками
      if (allLocations.length > 0) {
        allLocations.forEach(location => {
          // Знаходимо залишок для цього місця
          const locationInfo = locationColumns[location];
          const quantity = locationInfo && row[locationInfo.index] ? row[locationInfo.index] : "";
          
          products.push({
            rowIndex: index + 2,
            fridge: location,
            name,
            category,
            type,
            unit,
            quantity: quantity // Реальний залишок з колонки холодильника!
          });
        });
      }
    });
    
    console.log(`📋 Прочитано ${products.length} продуктів з аркуша "${sheetName}" (з залишками)`);
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
    
    // Читаємо ВСІ дані з головного аркуша (весь перший рядок з заголовками)
    const masterData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A1:Z`, // Читаємо всі колонки до Z
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
    
    const rows = masterData.data.values || [];
    
    if (rows.length === 0) {
      throw new Error("Немає даних в головному аркуші");
    }
    
    // Відфільтровуємо рядки - залишаємо тільки заголовок + продукти з прив'язкою
    const filteredRows = [];
    
    rows.forEach((row, index) => {
      // Перший рядок (заголовки) - завжди копіюємо
      if (index === 0) {
        filteredRows.push(row);
        return;
      }
      
      // Для інших рядків - перевіряємо чи є прив'язка до холодильника/стелажа
      const hasLocation = (row[0] && row[0].toString().trim()) || // Колонка A - Холодильник
                          (row[1] && row[1].toString().trim());    // Колонка B - Стелаж
      
      if (hasLocation) {
        filteredRows.push(row);
      }
    });
    
    // Копіюємо тільки відфільтровані рядки
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: filteredRows }
    });
    
    const skippedCount = rows.length - filteredRows.length;
    console.log(`✅ Створено новий аркуш: ${sheetName}`);
    console.log(`   📋 Скопійовано: ${filteredRows.length - 1} продуктів (з прив'язкою)`);
    console.log(`   ⏭️ Пропущено: ${skippedCount} продуктів (без прив'язки)`);
    return sheetName;
  } catch (error) {
    console.error("❌ Помилка при створенні аркуша:", error);
    throw error;
  }
}

// 📤 ЗАПИС ЗАЛИШКІВ В НОВИЙ АРКУШ ІНВЕНТАРИЗАЦІЇ (АВТОМАТИЧНИЙ ПОШУК КОЛОНОК)
export async function writeQuantitiesToInventorySheet(sheetName, inventoryByFridge) {
  try {
    // Читаємо заголовки (перший рядок)
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    
    // Знаходимо які колонки відповідають яким холодильникам
    const fridgeColumns = {};
    let totalColumn = null;
    
    headers.forEach((header, index) => {
      const columnLetter = String.fromCharCode(65 + index); // A=65, B=66...
      
      // Шукаємо колонки типу "Холодильник 1", "Холодильник 2" і т.д.
      const match = header?.match(/Холодильник\s+(\d+)/i);
      if (match) {
        const fridgeNum = match[1];
        fridgeColumns[fridgeNum] = columnLetter;
        console.log(`📋 Знайдено: Холодильник ${fridgeNum} → колонка ${columnLetter}`);
      }
      
      // Шукаємо колонку "Залишки"
      if (header?.toLowerCase().includes('залишки')) {
        totalColumn = columnLetter;
        console.log(`📋 Знайдено: Залишки → колонка ${columnLetter}`);
      }
    });
    
    if (Object.keys(fridgeColumns).length === 0) {
      throw new Error("Не знайдено жодної колонки з холодильниками");
    }
    
    // Читаємо всі дані продуктів (з другого рядка)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:E`,
    });
    
    const rows = response.data.values || [];
    
    // Створюємо Map для швидкого пошуку по кожному холодильнику
    const dataByFridge = {};
    Object.keys(inventoryByFridge).forEach(fridgeNum => {
      dataByFridge[fridgeNum] = new Map();
      inventoryByFridge[fridgeNum].forEach(item => {
        dataByFridge[fridgeNum].set(item.name, item.quantity);
      });
    });
    
    // Готуємо масив для batch update
    const updates = [];
    
    rows.forEach((row, index) => {
      const productName = row[2]; // Колонка C - Назва (row[0]=A, row[1]=B, row[2]=C)
      const rowIndex = index + 2;
      
      let totalForProduct = 0;
      
      // Для кожного холодильника записуємо його дані
      Object.keys(fridgeColumns).forEach(fridgeNum => {
        const column = fridgeColumns[fridgeNum];
        
        if (dataByFridge[fridgeNum]?.has(productName)) {
          const quantity = dataByFridge[fridgeNum].get(productName);
          updates.push({
            range: `${sheetName}!${column}${rowIndex}`,
            values: [[quantity]]
          });
          totalForProduct += quantity;
        }
      });
      
      // Записуємо загальну суму в колонку "Залишки"
      if (totalForProduct > 0 && totalColumn) {
        updates.push({
          range: `${sheetName}!${totalColumn}${rowIndex}`,
          values: [[totalForProduct]]
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
    
    console.log(`✅ Оновлено ${updates.length} комірок у аркуші "${sheetName}"`);
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
