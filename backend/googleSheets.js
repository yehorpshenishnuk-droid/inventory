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
const MASTER_SHEET_NAME = "Master"; // Головний аркуш з шаблоном - ПЕРЕЙМЕНУЙ "Лист1" на "Master" в Google Sheets!

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
      const fridgeValue = row[0] || "";
      const name = row[1] || "";
      const category = row[2] || "";
      const type = row[3] || "";
      // row[4] - це старі залишки, пропускаємо
      const unit = row[5] || "кг"; // Колонка F - Одиниці виміру
      
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
            quantity: "" // Не читаємо старі залишки
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
    
    // Читаємо заголовки (перший рядок)
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    
    // Знаходимо які колонки відповідають яким холодильникам
    const fridgeColumns = {};
    
    headers.forEach((header, index) => {
      const columnLetter = String.fromCharCode(65 + index); // A=65, B=66...
      
      // Шукаємо колонки типу "Холодильник 1", "Холодильник 2" і т.д.
      const match = header?.match(/Холодильник\s+(\d+)/i);
      if (match) {
        const fridgeNum = match[1];
        fridgeColumns[fridgeNum] = columnLetter;
      }
    });
    
    console.log(`📋 Знайдено холодильників: ${Object.keys(fridgeColumns).length}`);
    
    // Читаємо всі дані включаючи колонки холодильників
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });
    
    const rows = dataResponse.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || "";
      const name = row[1] || "";
      const category = row[2] || "";
      const type = row[3] || "";
      const unit = row[5] || "кг"; // Колонка F
      
      // Парсимо холодильники з колонки A
      if (fridgeValue.includes(",")) {
        const fridgeNumbers = fridgeValue.split(",").map(f => f.trim());
        
        fridgeNumbers.forEach(fridgeNum => {
          // Знаходимо збережену кількість для цього холодильника
          let savedQuantity = "";
          
          if (fridgeColumns[fridgeNum]) {
            const columnIndex = fridgeColumns[fridgeNum].charCodeAt(0) - 65; // A=0, B=1...
            const cellValue = row[columnIndex];
            
            // Якщо є значення і воно не порожнє і не 0
            if (cellValue !== undefined && cellValue !== null && cellValue !== "" && cellValue !== "0") {
              savedQuantity = cellValue.toString();
            }
          }
          
          products.push({
            rowIndex: index + 2,
            fridge: fridgeNum,
            name,
            category,
            type,
            unit,
            quantity: savedQuantity // Збережена кількість з аркуша
          });
        });
      } else if (fridgeValue) {
        // Знаходимо збережену кількість для цього холодильника
        let savedQuantity = "";
        
        if (fridgeColumns[fridgeValue]) {
          const columnIndex = fridgeColumns[fridgeValue].charCodeAt(0) - 65;
          const cellValue = row[columnIndex];
          
          if (cellValue !== undefined && cellValue !== null && cellValue !== "" && cellValue !== "0") {
            savedQuantity = cellValue.toString();
          }
        }
        
        products.push({
          rowIndex: index + 2,
          fridge: fridgeValue,
          name,
          category,
          type,
          unit,
          quantity: savedQuantity
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
    
    // Читаємо дані з головного аркуша
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
    
    // 🔥 КРИТИЧНО: Копіюємо тільки структуру БЕЗ старих залишків
    const cleanRows = rows.map((row, index) => {
      if (index === 0) {
        // Перший рядок (заголовки) копіюємо як є
        return row;
      } else {
        // Для всіх інших рядків копіюємо тільки перші 6 колонок (A-F)
        // A: Холодильник, B: Назва, C: Категорія, D: Тип, E: (порожньо), F: Одиниці
        // Колонки G, H, I... (холодильники) та останню колонку (Залишки) НЕ копіюємо
        const cleanRow = row.slice(0, 6); // Беремо тільки A-F
        // Очищаємо колонку E (старі залишки)
        if (cleanRow.length > 4) {
          cleanRow[4] = ""; // Колонка E - порожня
        }
        return cleanRow;
      }
    });
    
    // Копіюємо очищені дані
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: cleanRows }
    });
    
    // Тепер додаємо заголовки холодильників з головного аркуша
    const headerRow = rows[0];
    const fridgeHeaders = [];
    
    // Знаходимо всі колонки холодильників (починаючи з колонки G)
    for (let i = 6; i < headerRow.length; i++) {
      const header = headerRow[i];
      if (header && (header.includes("Холодильник") || header.toLowerCase().includes("залишки"))) {
        fridgeHeaders.push({
          column: String.fromCharCode(65 + i), // A=65, B=66...
          value: header
        });
      }
    }
    
    // Записуємо заголовки холодильників
    if (fridgeHeaders.length > 0) {
      const headerUpdates = fridgeHeaders.map(h => ({
        range: `${sheetName}!${h.column}1`,
        values: [[h.value]]
      }));
      
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: headerUpdates
        }
      });
    }
    
    console.log(`✅ Створено новий аркуш: ${sheetName} (структура без старих залишків)`);
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
      range: `${sheetName}!A2:F`,
    });
    
    const rows = response.data.values || [];
    
    // 🔥 КРОК 1: СПОЧАТКУ ОЧИЩАЄМО ВСІ КОЛОНКИ ХОЛОДИЛЬНИКІВ
    console.log("🧹 Очищення старих залишків...");
    const clearRequests = [];
    
    Object.values(fridgeColumns).forEach(column => {
      // Очищаємо колонку від рядка 2 до кінця даних
      clearRequests.push({
        range: `${sheetName}!${column}2:${column}${rows.length + 1}`,
        values: Array(rows.length).fill([""])
      });
    });
    
    // Очищаємо колонку "Залишки"
    if (totalColumn) {
      clearRequests.push({
        range: `${sheetName}!${totalColumn}2:${totalColumn}${rows.length + 1}`,
        values: Array(rows.length).fill([""])
      });
    }
    
    // Виконуємо очищення
    if (clearRequests.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: clearRequests
        }
      });
      console.log("✅ Очищено");
    }
    
    // 🔥 КРОК 2: ЗАПИСУЄМО ТІЛЬКИ ЗАПОВНЕНІ ЗНАЧЕННЯ
    // Створюємо Map для швидкого пошуку по кожному холодильнику
    const dataByFridge = {};
    Object.keys(inventoryByFridge).forEach(fridgeNum => {
      dataByFridge[fridgeNum] = new Map();
      inventoryByFridge[fridgeNum].forEach(item => {
        // Записуємо тільки якщо quantity не порожня
        if (item.quantity && item.quantity !== "" && item.quantity !== "0") {
          dataByFridge[fridgeNum].set(item.name, item.quantity);
        }
      });
    });
    
    // Готуємо масив для batch update
    const updates = [];
    
    rows.forEach((row, index) => {
      const productName = row[1]; // Колонка B - Назва
      const rowIndex = index + 2;
      
      let totalForProduct = 0;
      
      // Для кожного холодильника записуємо його дані (ТІЛЬКИ якщо є значення)
      Object.keys(fridgeColumns).forEach(fridgeNum => {
        const column = fridgeColumns[fridgeNum];
        
        if (dataByFridge[fridgeNum]?.has(productName)) {
          const quantity = dataByFridge[fridgeNum].get(productName);
          const numQuantity = parseFloat(quantity);
          
          if (!isNaN(numQuantity) && numQuantity > 0) {
            updates.push({
              range: `${sheetName}!${column}${rowIndex}`,
              values: [[numQuantity]]
            });
            totalForProduct += numQuantity;
          }
        }
      });
      
      // Записуємо загальну суму в колонку "Залишки" (ТІЛЬКИ якщо > 0)
      if (totalForProduct > 0 && totalColumn) {
        updates.push({
          range: `${sheetName}!${totalColumn}${rowIndex}`,
          values: [[totalForProduct]]
        });
      }
    });
    
    if (updates.length === 0) {
      console.log("⚠️ Немає даних для запису (всі значення порожні або нульові)");
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
