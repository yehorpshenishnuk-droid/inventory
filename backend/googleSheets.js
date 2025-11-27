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

// Експортуємо для використання в інших модулях
export { sheets, SPREADSHEET_ID };

// === БЛОКУВАННЯ ХОЛОДИЛЬНИКІВ ===

const LOCKS_SHEET_NAME = "Блокування";

// Перевірка чи існує аркуш "Блокування", якщо ні - створити
async function ensureLocksSheetExists() {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const locksSheet = spreadsheet.data.sheets.find(
      sheet => sheet.properties.title === LOCKS_SHEET_NAME
    );
    
    if (!locksSheet) {
      // Створюємо аркуш
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: LOCKS_SHEET_NAME
              }
            }
          }]
        }
      });
      
      // Додаємо заголовки
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${LOCKS_SHEET_NAME}!A1:D1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [["Холодильник/Стелаж", "Користувач", "Час початку", "Timestamp"]]
        }
      });
      
      console.log("✅ Створено аркуш 'Блокування'");
    }
  } catch (error) {
    console.error("❌ Помилка створення аркуша блокувань:", error);
  }
}

// Заблокувати холодильник/стелаж
export async function lockLocation(locationNumber, userName) {
  try {
    await ensureLocksSheetExists();
    
    // Перевіряємо чи не заблокований вже
    const existingLock = await checkLock(locationNumber);
    if (existingLock) {
      return { 
        success: false, 
        error: `Вже заблоковано користувачем ${existingLock.userName}` 
      };
    }
    
    const now = new Date();
    const time = now.toLocaleTimeString('uk-UA');
    const timestamp = now.toISOString(); // Використовуємо ISO формат для надійного парсингу
    
    // Додаємо новий запис
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A:D`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[locationNumber, userName, time, timestamp]]
      }
    });
    
    console.log(`🔒 Заблоковано: ${locationNumber} → ${userName}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Помилка блокування:", error);
    return { success: false, error: error.message };
  }
}

// Розблокувати холодильник/стелаж
export async function unlockLocation(locationNumber) {
  try {
    await ensureLocksSheetExists();
    
    // Читаємо всі блокування
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A2:D`
    });
    
    const rows = response.data.values || [];
    let rowToDelete = -1;
    
    // Шукаємо рядок з цим холодильником
    rows.forEach((row, index) => {
      if (row[0] === String(locationNumber)) {
        rowToDelete = index + 2; // +2 бо рахуємо з заголовка
      }
    });
    
    if (rowToDelete > 0) {
      // Видаляємо рядок
      const sheetId = (await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
      })).data.sheets.find(s => s.properties.title === LOCKS_SHEET_NAME)?.properties?.sheetId;
      
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: "ROWS",
                startIndex: rowToDelete - 1,
                endIndex: rowToDelete
              }
            }
          }]
        }
      });
      
      console.log(`🔓 Розблоковано: ${locationNumber}`);
      return { success: true };
    }
    
    return { success: true, message: "Не було заблоковано" };
  } catch (error) {
    console.error("❌ Помилка розблокування:", error);
    return { success: false, error: error.message };
  }
}

// Перевірити чи заблокований
export async function checkLock(locationNumber) {
  try {
    await ensureLocksSheetExists();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A2:D`
    });
    
    const rows = response.data.values || [];
    
    for (const row of rows) {
      if (row[0] === String(locationNumber)) {
        // Перевіряємо чи не застаріло (більше 30 хвилин)
        const timestamp = row[3]; // ISO timestamp
        
        // Використовуємо ISO формат для надійного парсингу
        const lockDateTime = new Date(timestamp);
        const now = new Date();
        
        // Перевіряємо чи дата валідна
        if (isNaN(lockDateTime.getTime())) {
          console.warn(`⚠️ Невалідна дата блокування для ${locationNumber}, видаляємо`);
          await unlockLocation(locationNumber);
          return null;
        }
        
        const diffMinutes = (now - lockDateTime) / 1000 / 60;
        
        console.log(`🔍 Перевірка блокування ${locationNumber}: ${diffMinutes.toFixed(1)} хвилин тому`);
        
        if (diffMinutes > 30) {
          // Автоматично розблокувати
          await unlockLocation(locationNumber);
          console.log(`⏰ Автоматично розблоковано (таймаут): ${locationNumber}`);
          return null;
        }
        
        return {
          locationNumber: row[0],
          userName: row[1],
          time: row[2],
          timestamp: row[3]
        };
      }
    }
    
    return null; // Не заблокований
  } catch (error) {
    console.error("❌ Помилка перевірки блокування:", error);
    return null;
  }
}

// Отримати всі блокування
export async function getAllLocks() {
  try {
    await ensureLocksSheetExists();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A2:D`
    });
    
    const rows = response.data.values || [];
    const locks = {};
    
    for (const row of rows) {
      // Перевіряємо таймаут
      const timestamp = row[3];
      const lockDateTime = new Date(timestamp);
      const now = new Date();
      
      // Пропускаємо невалідні дати
      if (isNaN(lockDateTime.getTime())) {
        continue;
      }
      
      const diffMinutes = (now - lockDateTime) / 1000 / 60;
      
      if (diffMinutes <= 30) {
        locks[row[0]] = {
          userName: row[1],
          time: row[2],
          timestamp: row[3]
        };
      }
    }
    
    return locks;
  } catch (error) {
    console.error("❌ Помилка отримання блокувань:", error);
    return {};
  }
}

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
          allLocations.push(...shelfValue.split(",").map(s => s.trim()));
        } else {
          allLocations.push(shelfValue);
        }
      }
      
      // Якщо продукт є в декількох локаціях - дублюємо його
      if (allLocations.length > 0) {
        allLocations.forEach(location => {
          products.push({
            name,
            category,
            type,
            unit,
            fridge: location,
            rowIndex: index + 2 // +2 бо перший рядок - заголовки
          });
        });
      } else {
        // Якщо локація не вказана
        products.push({
          name,
          category,
          type,
          unit,
          fridge: "Без холодильника",
          rowIndex: index + 2
        });
      }
    });

    console.log(`✅ Прочитано ${products.length} записів для інвентаризації`);
    return products;
  } catch (error) {
    console.error("Ошибка при чтении из Google Sheets:", error);
    return [];
  }
}

// 📖 ЧИТАННЯ ДАНИХ З ОКРЕМОГО АРКУША ІНВЕНТАРИЗАЦІЇ
export async function readInventorySheetData(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;
    
    // Спочатку читаємо заголовки
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    
    // Знаходимо колонки холодильників/стелажів та їх індекси
    const fridgeColumns = {};
    
    headers.forEach((header, index) => {
      const fridgeMatch = header?.match(/Холодильник\s+(\d+)/i);
      const shelfMatch = header?.match(/Стелаж\s+(\d+)/i);
      
      if (fridgeMatch) {
        fridgeColumns[fridgeMatch[1]] = index;
      } else if (shelfMatch) {
        fridgeColumns[shelfMatch[1]] = index;
      }
    });
    
    console.log("📋 Знайдені колонки:", fridgeColumns);
    
    // Читаємо всі дані
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });
    
    const rows = dataResponse.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const name = row[2] || "";        // Колонка C - Назва
      const category = row[3] || "";    // Колонка D - Категорія
      const type = row[4] || "";        // Колонка E - Тип
      const unit = row[5] || "кг";      // Колонка F - Одиниці виміру
      
      // Для кожного холодильника/стелажа створюємо окремий запис
      Object.keys(fridgeColumns).forEach(fridgeNum => {
        const colIndex = fridgeColumns[fridgeNum];
        const quantity = parseFloat(row[colIndex]) || 0;
        
        products.push({
          name,
          category,
          type,
          unit,
          fridge: fridgeNum,
          quantity: quantity,
          rowIndex: index + 2
        });
      });
    });
    
    console.log(`✅ Прочитано ${products.length} записів з аркуша інвентаризації ${date}`);
    return products;
  } catch (error) {
    console.error("❌ Помилка при читанні аркуша інвентаризації:", error);
    return null;
  }
}

// 🔍 ПЕРЕВІРКА ЧИ ІСНУЄ АРКУШ ІНВЕНТАРИЗАЦІЇ
export async function checkInventorySheetExists(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;
    
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const sheet = spreadsheet.data.sheets.find(
      s => s.properties.title === sheetName
    );
    
    return !!sheet;
  } catch (error) {
    console.error("❌ Помилка перевірки існування аркуша:", error);
    return false;
  }
}

// 📝 СТВОРЕННЯ НОВОГО АРКУША ДЛЯ ІНВЕНТАРИЗАЦІЇ
export async function createInventorySheet(date) {
  try {
    const newSheetName = `Інвентаризація ${date}`;
    
    // Отримуємо інформацію про головний аркуш
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const masterSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === MASTER_SHEET_NAME
    );
    
    if (!masterSheet) {
      throw new Error(`Не знайдено головний аркуш "${MASTER_SHEET_NAME}"`);
    }
    
    const masterSheetId = masterSheet.properties.sheetId;
    
    // Дублюємо головний аркуш
    const duplicateResponse = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          duplicateSheet: {
            sourceSheetId: masterSheetId,
            newSheetName: newSheetName,
            insertSheetIndex: 1 // Вставляємо після першого аркуша
          }
        }]
      }
    });
    
    console.log(`✅ Створено новий аркуш: ${newSheetName}`);
    
    return newSheetName;
  } catch (error) {
    console.error("❌ Помилка при створенні аркуша інвентаризації:", error);
    throw error;
  }
}

// 📤 ЗАПИС ЗАЛИШКІВ В ОКРЕМИЙ АРКУШ ІНВЕНТАРИЗАЦІЇ (ПЕРЕЗАПИС)
export async function writeQuantitiesToInventorySheet(sheetName, inventoryByFridge) {
  try {
    // Читаємо заголовки
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    
    // Знаходимо колонки холодильників/стелажів
    const fridgeColumns = {};
    let totalColumn = null;
    
    headers.forEach((header, index) => {
      const columnLetter = String.fromCharCode(65 + index);
      
      const fridgeMatch = header?.match(/Холодильник\s+(\d+)/i);
      const shelfMatch = header?.match(/Стелаж\s+(\d+)/i);
      
      if (fridgeMatch) {
        fridgeColumns[fridgeMatch[1]] = columnLetter;
      } else if (shelfMatch) {
        fridgeColumns[shelfMatch[1]] = columnLetter;
      }
      
      if (header?.toLowerCase().includes('залишки')) {
        totalColumn = columnLetter;
      }
    });
    
    if (Object.keys(fridgeColumns).length === 0) {
      console.error("❌ Не знайдено колонок холодильників/стелажів");
      console.log("📋 Доступні заголовки:", headers);
      throw new Error("Не знайдено колонок холодильників/стелажів");
    }
    
    console.log(`✅ Знайдено ${Object.keys(fridgeColumns).length} колонок холодильників/стелажів`);
    
    // Читаємо всі дані
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });
    
    const rows = dataResponse.data.values || [];
    
    // Створюємо Map для швидкого пошуку
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
      
      // Для кожного холодильника/стелажа записуємо його дані
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

// 📤 ДОДАВАННЯ ЗАЛИШКІВ ДО ІСНУЮЧИХ (а не перезапис)
export async function addQuantitiesToInventorySheet(sheetName, inventoryByFridge) {
  try {
    // Читаємо заголовки
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    
    // Знаходимо колонки холодильників/стелажів
    const fridgeColumns = {};
    let totalColumn = null;
    
    headers.forEach((header, index) => {
      const columnLetter = String.fromCharCode(65 + index);
      
      const fridgeMatch = header?.match(/Холодильник\s+(\d+)/i);
      const shelfMatch = header?.match(/Стелаж\s+(\d+)/i);
      
      if (fridgeMatch) {
        fridgeColumns[fridgeMatch[1]] = { column: columnLetter, index };
      } else if (shelfMatch) {
        fridgeColumns[shelfMatch[1]] = { column: columnLetter, index };
      }
      
      if (header?.toLowerCase().includes('залишки')) {
        totalColumn = { column: columnLetter, index };
      }
    });
    
    if (Object.keys(fridgeColumns).length === 0) {
      console.error("❌ Не знайдено колонок холодильників/стелажів");
      console.log("📋 Доступні заголовки:", headers);
      throw new Error("Не знайдено колонок холодильників/стелажів");
    }
    
    console.log(`✅ Знайдено ${Object.keys(fridgeColumns).length} колонок для додавання`);
    
    // Читаємо ВСІ дані включно з колонками холодильників
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });
    
    const rows = dataResponse.data.values || [];
    
    // Створюємо Map для нових даних
    const dataByFridge = {};
    Object.keys(inventoryByFridge).forEach(fridgeNum => {
      dataByFridge[fridgeNum] = new Map();
      inventoryByFridge[fridgeNum].forEach(item => {
        dataByFridge[fridgeNum].set(item.name, item.quantity);
      });
    });
    
    const updates = [];
    
    rows.forEach((row, index) => {
      const productName = row[2]; // Колонка C - Назва
      const rowIndex = index + 2;
      
      let totalForProduct = 0;
      
      // Для кожного холодильника/стелажа
      Object.keys(fridgeColumns).forEach(fridgeNum => {
        const fridgeInfo = fridgeColumns[fridgeNum];
        const column = fridgeInfo.column;
        const colIndex = fridgeInfo.index;
        
        if (dataByFridge[fridgeNum]?.has(productName)) {
          const newQuantity = dataByFridge[fridgeNum].get(productName);
          
          // ✅ ЧИТАЄМО ІСНУЮЧЕ ЗНАЧЕННЯ
          const existingValue = row[colIndex] || "";
          const existingQuantity = parseFloat(existingValue) || 0;
          
          // ✅ ДОДАЄМО до існуючого
          const finalQuantity = existingQuantity + newQuantity;
          
          updates.push({
            range: `${sheetName}!${column}${rowIndex}`,
            values: [[finalQuantity]]
          });
          
          totalForProduct += finalQuantity;
          
          console.log(`➕ ${productName} (Локація ${fridgeNum}): ${existingQuantity} + ${newQuantity} = ${finalQuantity}`);
        } else if (row[colIndex]) {
          // Якщо немає нових даних, але є старі - рахуємо для загальної суми
          const existingQuantity = parseFloat(row[colIndex]) || 0;
          totalForProduct += existingQuantity;
        }
      });
      
      // Оновлюємо загальну суму
      if (totalColumn && totalForProduct > 0) {
        updates.push({
          range: `${sheetName}!${totalColumn.column}${rowIndex}`,
          values: [[totalForProduct]]
        });
      }
    });
    
    if (updates.length === 0) {
      console.log("⚠️ Немає даних для додавання");
      return;
    }
    
    // Batch update
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    });
    
    console.log(`✅ Додано/оновлено ${updates.length} комірок у аркуші "${sheetName}"`);
  } catch (error) {
    console.error("❌ Помилка при додаванні залишків:", error);
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
