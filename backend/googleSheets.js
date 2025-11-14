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
      range: `${MASTER_SHEET_NAME}!A2:E`, // Додали колонку E (Одиниці)
    });

    const rows = response.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || "";
      const name = row[1] || "";
      const category = row[2] || "";
      const type = row[3] || "";
      const unit = row[4] || "кг"; // Одиниця виміру, за замовчуванням "кг"
      const quantity = row[5] || ""; // Якщо є колонка F з кількістю
      
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
          unit,
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
    
    // Читаємо дані з аркуша (включаючи колонку E з одиницями)
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
      const unit = row[4] || "кг";
      
      // Читаємо залишки з колонок холодильників (F, G, H... залежно від кількості)
      // Поки що не маємо цих даних, тому quantity = ""
      
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
            quantity: "" // Буде заповнено пізніше
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
export async function createInventorySheet(date, fridgeNumbers) {
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
    
    // Копіюємо дані з головного аркуша (A, B, C, D, E - включаючи одиниці)
    const masterData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A1:E`,
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
    
    // Сортуємо номери холодильників
    const sortedFridges = fridgeNumbers.sort((a, b) => {
      const numA = parseInt(a) || 0;
      const numB = parseInt(b) || 0;
      return numA - numB;
    });
    
    // Формуємо перший рядок з заголовками
    const headerRow = rows[0] || ["Холодильник", "Назва", "Категорія", "Тип", "Одиниці"];
    
    // Додаємо заголовки для кожного холодильника
    sortedFridges.forEach(fridgeNum => {
      headerRow.push(`холодильник ${fridgeNum}`);
    });
    
    // Додаємо колонку "Залишки" в кінці
    headerRow.push("Залишки");
    
    // Готуємо всі рядки
    const allRows = [headerRow];
    
    // Додаємо рядки з даними (A, B, C, D, E - включаючи одиниці)
    for (let i = 1; i < rows.length; i++) {
      allRows.push(rows[i].slice(0, 5)); // Перші 5 колонок
    }
    
    // Записуємо всі дані одним запитом
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: allRows }
    });
    
    console.log(`✅ Створено новий аркуш: ${sheetName} з ${sortedFridges.length} холодильниками`);
    return sheetName;
  } catch (error) {
    console.error("❌ Помилка при створенні аркуша:", error);
    throw error;
  }
}

// 📤 ЗАПИС ЗАЛИШКІВ В НОВИЙ АРКУШ ІНВЕНТАРИЗАЦІЇ (ОКРЕМІ КОЛОНКИ)
export async function writeQuantitiesToInventorySheet(sheetName, inventoryByFridge) {
  try {
    // Читаємо всі дані з нового аркуша (включаючи колонку E з одиницями)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:E`,
    });
    
    const rows = response.data.values || [];
    
    // Визначаємо які колонки відповідають яким холодильникам
    // Сортуємо холодильники по номерах
    const allFridges = Object.keys(inventoryByFridge).sort((a, b) => {
      const numA = parseInt(a) || 0;
      const numB = parseInt(b) || 0;
      return numA - numB;
    });
    
    // Створюємо відповідність: холодильник → колонка
    // F = перший холодильник (бо E зайнята одиницями), G = другий холодильник, і т.д.
    const fridgeToColumn = {};
    allFridges.forEach((fridgeNum, index) => {
      fridgeToColumn[fridgeNum] = String.fromCharCode(70 + index); // 70 = 'F'
    });
    
    // Колонка для загальної суми - після всіх холодильників
    const totalColumn = String.fromCharCode(70 + allFridges.length);
    
    console.log("📋 Відповідність холодильників та колонок:", fridgeToColumn);
    console.log("📋 Колонка для загальної суми:", totalColumn);
    
    // Створюємо Map для швидкого пошуку по кожному холодильнику
    const dataByFridge = {};
    allFridges.forEach(fridgeNum => {
      dataByFridge[fridgeNum] = new Map();
      inventoryByFridge[fridgeNum].forEach(item => {
        dataByFridge[fridgeNum].set(item.name, item.quantity);
      });
    });
    
    // Готуємо масив для batch update
    const updates = [];
    
    rows.forEach((row, index) => {
      const productName = row[1]; // Колонка B - Назва
      const rowIndex = index + 2;
      
      let totalForProduct = 0;
      
      // Для кожного холодильника записуємо його дані
      allFridges.forEach(fridgeNum => {
        const column = fridgeToColumn[fridgeNum];
        
        if (dataByFridge[fridgeNum].has(productName)) {
          const quantity = dataByFridge[fridgeNum].get(productName);
          updates.push({
            range: `${sheetName}!${column}${rowIndex}`,
            values: [[quantity]]
          });
          totalForProduct += quantity;
        }
      });
      
      // Записуємо загальну суму
      if (totalForProduct > 0) {
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
