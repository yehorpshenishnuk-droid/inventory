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

// ✅ КЕШ ДЛЯ ЗМЕНШЕННЯ КІЛЬКОСТІ ЗАПИТІВ
let locksCache = null;
let locksCacheTime = 0;
const LOCKS_CACHE_TTL = 2000; // 2 секунди (було 5 - занадто довго для UI)

let sheetsListCache = null;
let sheetsListCacheTime = 0;
const SHEETS_LIST_CACHE_TTL = 30000; // 30 секунд

// === БЛОКУВАННЯ ХОЛОДИЛЬНИКІВ ===

const LOCKS_SHEET_NAME = "Блокування";

// Перевірка чи існує аркуш "Блокування", якщо ні - створити
async function ensureLocksSheetExists() {
  try {
    // ✅ КЕШУВАННЯ - використовуємо кеш якщо він свіжий
    const now = Date.now();
    if (sheetsListCache && (now - sheetsListCacheTime < SHEETS_LIST_CACHE_TTL)) {
      const locksSheet = sheetsListCache.find(
        sheet => sheet.properties.title === LOCKS_SHEET_NAME
      );
      if (locksSheet) return;
    }
    
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    // ✅ ОНОВЛЮЄМО КЕШ
    sheetsListCache = spreadsheet.data.sheets;
    sheetsListCacheTime = now;
    
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
          values: [["Холодильник/Стелаж", "Користувач", "Час початку", "Дата"]]
        }
      });
      
      // ✅ СКИДАЄМО КЕШ після створення нового аркуша
      sheetsListCache = null;
      
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
    const date = now.toLocaleDateString('uk-UA');
    
    // Додаємо новий запис
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A:D`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[locationNumber, userName, time, date]]
      }
    });
    
    // ✅ СКИДАЄМО КЕШ після зміни
    locksCache = null;
    
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
      
      // ✅ СКИДАЄМО КЕШ після зміни
      locksCache = null;
      
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
    // ✅ ВИКОРИСТОВУЄМО getAllLocks яка має кеш
    const allLocks = await getAllLocks();
    const lock = allLocks[String(locationNumber)];
    
    if (lock) {
      // Перевіряємо чи не застаріло (більше 30 хвилин)
      const lockDateTime = new Date(`${lock.date} ${lock.time}`);
      const now = new Date();
      const diffMinutes = (now - lockDateTime) / 1000 / 60;
      
      if (diffMinutes > 30) {
        // Автоматично розблокувати
        await unlockLocation(locationNumber);
        console.log(`⏰ Автоматично розблоковано (таймаут): ${locationNumber}`);
        return null;
      }
      
      return {
        locationNumber: String(locationNumber),
        userName: lock.userName,
        time: lock.time,
        date: lock.date
      };
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
    // ✅ КЕШУВАННЯ - використовуємо кеш якщо він свіжий
    const now = Date.now();
    if (locksCache && (now - locksCacheTime < LOCKS_CACHE_TTL)) {
      return locksCache;
    }
    
    await ensureLocksSheetExists();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A2:D`
    });
    
    const rows = response.data.values || [];
    const locks = {};
    
    for (const row of rows) {
      // Перевіряємо таймаут
      const lockTime = row[2];
      const lockDate = row[3];
      const lockDateTime = new Date(`${lockDate} ${lockTime}`);
      const currentTime = new Date();
      const diffMinutes = (currentTime - lockDateTime) / 1000 / 60;
      
      if (diffMinutes <= 30) {
        locks[row[0]] = {
          userName: row[1],
          time: row[2],
          date: row[3]
        };
      }
    }
    
    // ✅ ОНОВЛЮЄМО КЕШ
    locksCache = locks;
    locksCacheTime = now;
    
    return locks;
  } catch (error) {
    console.error("❌ Помилка отримання блокувань:", error);
    return {};
  }
}

// ✅ ПРИМУСОВО ОНОВИТИ КЕШ БЛОКУВАНЬ (для UI)
export async function refreshLocksCache() {
  locksCache = null; // Скидаємо кеш
  return await getAllLocks(); // Завантажуємо свіжі дані
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
    
    // Форматуємо колонки A і B як текст, щоб уникнути апострофів
    const sheetId = (await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    })).data.sheets.find(s => s.properties.title === sheetName)?.properties?.sheetId;
    
    if (sheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            repeatCell: {
              range: {
                sheetId: sheetId,
                startColumnIndex: 0, // Колонка A
                endColumnIndex: 2,   // До колонки B (не включно C)
                startRowIndex: 1     // Починаючи з рядка 2 (пропускаємо заголовок)
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: {
                    type: "TEXT"
                  }
                }
              },
              fields: "userEnteredFormat.numberFormat"
            }
          }]
        }
      });
    }
    
    const skippedCount = rows.length - filteredRows.length;
    console.log(`✅ Створено новий аркуш: ${sheetName}`);
    console.log(`   📋 Скопійовано: ${filteredRows.length - 1} продуктів (з прив'язкою)`);
    console.log(`   ⏭️ Пропущено: ${skippedCount} продуктів (без прив'язки)`);
    console.log(`   📝 Колонки A-B відформатовані як текст`);
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
      // Шукаємо колонки з холодильниками ТА стелажами
      const fridgeMatch = header?.match(/Холодильник\s+(\d+)/i);
      const shelfMatch = header?.match(/Стелаж\s+(\d+)/i);
      
      if (fridgeMatch) {
        const locationNum = fridgeMatch[1];
        fridgeColumns[locationNum] = columnLetter;
        console.log(`📋 Знайдено: Холодильник ${locationNum} → колонка ${columnLetter}`);
      } else if (shelfMatch) {
        const locationNum = shelfMatch[1];
        fridgeColumns[locationNum] = columnLetter;
        console.log(`📋 Знайдено: Стелаж ${locationNum} → колонка ${columnLetter}`);
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
      throw new Error("Не знайдено колонок холодильників");
    }
    
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
      
      // Для кожного холодильника
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
          
          console.log(`➕ ${productName} (Холод ${fridgeNum}): ${existingQuantity} + ${newQuantity} = ${finalQuantity}`);
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
