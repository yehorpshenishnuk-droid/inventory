import fs from "fs";
import { google } from "googleapis";

// === Google Sheets credentials ===
// Читаем ключ из Secret File (Render → Secret Files)
const CREDENTIALS_PATH = "/etc/secrets/credentials.json";

let credentials;
try {
  credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
} catch (err) {
  console.error("❌ Ошибка чтения Google Credentials:", err);
  throw new Error("Не удалось загрузить credentials.json из /etc/secrets/");
}

// Авторизация Google API
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

export const SPREADSHEET_ID = "1eiJw3ADAdq6GfQxsbJp0STDsc1MyJfPXCf2caQy8khw";
const MASTER_SHEET_NAME = "№ Холод-ID";
const LOCKS_SHEET_NAME = "Блокування";

// ===================== БЛОКИРОВКИ ============================= //

async function ensureLocksSheetExists() {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const exists = spreadsheet.data.sheets.find(
      (s) => s.properties.title === LOCKS_SHEET_NAME
    );

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: { properties: { title: LOCKS_SHEET_NAME } },
            },
          ],
        },
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${LOCKS_SHEET_NAME}!A1:D1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [
            ["Холодильник/Стелаж", "Користувач", "Час початку", "Дата"],
          ],
        },
      });

      console.log("✔ Создан лист Блокування");
    }
  } catch (err) {
    console.error("Ошибка ensureLocksSheetExists:", err);
  }
}

export async function lockLocation(locationNumber, userName) {
  try {
    await ensureLocksSheetExists();
    const existing = await checkLock(locationNumber);

    if (existing) {
      return {
        success: false,
        error: `Вже заблоковано користувачем ${existing.userName}`,
      };
    }

    const now = new Date();
    const time = now.toLocaleTimeString("uk-UA");
    const date = now.toLocaleDateString("uk-UA");

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A:D`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[locationNumber, userName, time, date]],
      },
    });

    return { success: true };
  } catch (err) {
    console.error("Ошибка lockLocation:", err);
    return { success: false, error: err.message };
  }
}

export async function unlockLocation(locationNumber) {
  try {
    await ensureLocksSheetExists();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A2:D`,
    });

    const rows = resp.data.values || [];
    let targetRow = -1;

    rows.forEach((row, index) => {
      if (row[0] === String(locationNumber)) {
        targetRow = index + 2;
      }
    });

    if (targetRow > 0) {
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });

      const sheetId = spreadsheet.data.sheets.find(
        (s) => s.properties.title === LOCKS_SHEET_NAME
      ).properties.sheetId;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: targetRow - 1,
                  endIndex: targetRow,
                },
              },
            },
          ],
        },
      });
    }

    return { success: true };
  } catch (err) {
    console.error("Ошибка unlockLocation:", err);
    return { success: false, error: err.message };
  }
}

export async function checkLock(locationNumber) {
  try {
    await ensureLocksSheetExists();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A2:D`,
    });

    const rows = resp.data.values || [];

    for (const row of rows) {
      if (row[0] === String(locationNumber)) {
        const lockDateTime = new Date(`${row[3]} ${row[2]}`);
        const now = new Date();
        const diff = (now - lockDateTime) / 1000 / 60;

        if (diff > 30) {
          await unlockLocation(locationNumber);
          return null;
        }

        return {
          locationNumber: row[0],
          userName: row[1],
          time: row[2],
          date: row[3],
        };
      }
    }

    return null;
  } catch (err) {
    console.error("Ошибка checkLock:", err);
    return null;
  }
}

export async function getAllLocks() {
  try {
    await ensureLocksSheetExists();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOCKS_SHEET_NAME}!A2:D`,
    });

    const rows = resp.data.values || [];
    const locks = {};

    const now = new Date();

    for (const row of rows) {
      const lockDateTime = new Date(`${row[3]} ${row[2]}`);
      const diff = (now - lockDateTime) / 1000 / 60;

      if (diff <= 30) {
        locks[row[0]] = {
          userName: row[1],
          time: row[2],
          date: row[3],
        };
      }
    }

    return locks;
  } catch (err) {
    console.error("Ошибка getAllLocks:", err);
    return {};
  }
}

// ========================= ОСНОВНОЙ ЛИСТ ============================= //

// ID продуктів які рахуються в ШТУКАХ (решта - в КГ)
const ITEMS_IN_PIECES = [318, 525, 610, 609, 607];

export async function readProductsFromSheet() {
  try {
    // Читаем из листа "№ Холод-ID"
    // Структура: A=ID, B=Назва, C=Категорія, D=Тип, E=Холодильник, F=Стелаж
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A2:F`,
    });

    const rows = resp.data.values || [];
    const result = [];

    rows.forEach((row, i) => {
      // В новом листе:
      // row[0] = ID
      // row[1] = Назва
      // row[2] = Категорія
      // row[3] = Тип
      // row[4] = Холодильник
      // row[5] = Стелаж
      
      // Пропускаємо рядки без назви продукту
      if (!row[1]) return;
      
      const productId = (row[0] && !isNaN(Number(row[0]))) ? Number(row[0]) : null;
      const fridgeValue = row[4] || ""; // Колонка E - Холодильник
      const shelfValue = row[5] || "";  // Колонка F - Стелаж
      
      // Визначаємо одиниці виміру по ID
      const unit = (productId && ITEMS_IN_PIECES.includes(productId)) ? "шт" : "кг";

      const locations = [];

      if (fridgeValue) {
        fridgeValue
          .split(",")
          .map((v) => v.trim())
          .forEach((v) => locations.push(v));
      }

      if (shelfValue) {
        shelfValue
          .split(",")
          .map((v) => v.trim())
          .forEach((v) => locations.push(v));
      }

      locations.forEach((loc) =>
        result.push({
          rowIndex: i + 2,
          fridge: loc,
          name: row[1] || "",     // Колонка B - Назва
          category: row[2] || "", // Колонка C - Категорія
          type: row[3] || "",     // Колонка D - Тип
          unit: unit,             // Визначаємо по ID
          quantity: "",
        })
      );
    });

    return result;
  } catch (err) {
    console.error("Ошибка readProductsFromSheet:", err);
    throw err;
  }
}

// Читаем ВСІ продукти з листа "Всі ID з Poster"
export async function readAllProductsFromPoster() {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Всі ID з Poster!A2:D`,
    });

    const rows = resp.data.values || [];
    const result = [];

    rows.forEach((row, i) => {
      const productId = (row[0] && !isNaN(Number(row[0]))) ? Number(row[0]) : null;
      const name = row[1] || "";
      const type = row[3] || "";
      
      // Визначаємо одиниці виміру по ID
      const unit = (productId && ITEMS_IN_PIECES.includes(productId)) ? "шт" : "кг";
      
      if (name) {
        result.push({
          rowIndex: i + 2,
          fridge: "ALL", // Специальный маркер для "Усі продукти"
          name: name,
          category: "", // Категорію не берём
          type: type,
          unit: unit,
          quantity: "",
        });
      }
    });

    return result;
  } catch (err) {
    console.error("Ошибка readAllProductsFromPoster:", err);
    throw err;
  }
}

// ====================== ИНВЕНТАРИЗАЦИОННЫЕ ЛИСТЫ ======================= //

export async function checkInventorySheetExists(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    return !!spreadsheet.data.sheets.find(
      (s) => s.properties.title === sheetName
    );
  } catch (err) {
    console.error("Ошибка checkInventorySheetExists:", err);
    return false;
  }
}

export async function createInventorySheet(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const exists = spreadsheet.data.sheets.find(
      (s) => s.properties.title === sheetName
    );

    if (exists) return sheetName;

    // Створюємо новий лист
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });

    // Додаємо заголовки РОБОЧОГО формату: Назва | Категорія | Одиниці виміру | Холодильник | Кількість
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:E1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Назва", "Категорія", "Одиниці виміру", "Холодильник", "Кількість"]],
      },
    });

    return sheetName;
  } catch (err) {
    console.error("Ошибка createInventorySheet:", err);
    throw err;
  }
}

export async function readInventorySheetData(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:E`,
    });

    const rows = resp.data.values || [];
    const result = [];

    rows.forEach((row, i) => {
      // РОБОЧИЙ ФОРМАТ: Назва | Категорія | Одиниці | Холодильник | Кількість
      const name = row[0] || "";
      const category = row[1] || "";
      const unit = row[2] || "кг";
      const fridgeNum = row[3] || "";
      const quantity = row[4] || "";

      if (name && fridgeNum) {
        result.push({
          rowIndex: i + 2,
          fridge: fridgeNum,
          name: name,
          category: category,
          type: "", // Тип не зберігається в робочому форматі
          unit: unit,
          quantity: quantity,
        });
      }
    });

    return result;
  } catch (err) {
    console.error("Ошибка readInventorySheetData:", err);
    return null;
  }
}

// ================= ЗАПИС ЗНАЧЕНИЙ В ИНВЕНТАРИЗАЦИЮ ==================== //

export async function writeQuantitiesToInventorySheet(
  sheetName,
  inventoryByFridge
) {
  try {
    // РОБОЧИЙ ФОРМАТ: Назва | Категорія | Одиниці | Холодильник | Кількість
    const data = [
      ["Назва", "Категорія", "Одиниці виміру", "Холодильник", "Кількість"] // Заголовки
    ];
    
    // Збираємо всі продукти з усіх холодильників
    Object.keys(inventoryByFridge).forEach((fridgeNum) => {
      inventoryByFridge[fridgeNum].forEach((product) => {
        const qty = Number(product.quantity) || 0;
        
        // Записуємо тільки продукти з кількістю > 0
        if (qty > 0) {
          data.push([
            product.name,
            product.category || "",
            product.unit || "кг",
            fridgeNum, // Номер холодильника/стелажа
            qty
          ]);
        }
      });
    });
    
    // Записуємо все одним запитом
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:E${data.length}`,
      valueInputOption: "RAW",
      requestBody: {
        values: data,
      },
    });

    return true;
  } catch (err) {
    console.error("Ошибка writeQuantitiesToInventorySheet:", err);
    throw err;
  }
}

// ================= ФІНАЛЬНИЙ ЗВІТ (при "Провести інвентаризацію") ==================== //

export async function writeFinalInventoryReport(sheetName) {
  try {
    // Читаємо робочі дані (детальні з холодильниками)
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:E`,
    });

    const rows = resp.data.values || [];
    const productMap = new Map();
    
    // Групуємо по продуктах і сумуємо
    rows.forEach((row) => {
      const name = row[0];
      const category = row[1] || "";
      const unit = row[2] || "кг";
      const qty = Number(row[4]) || 0;
      
      if (name && qty > 0) {
        if (!productMap.has(name)) {
          productMap.set(name, {
            name: name,
            category: category,
            unit: unit,
            total: 0
          });
        }
        productMap.get(name).total += qty;
      }
    });
    
    // Готуємо фінальний звіт: Назва | Категорія | Одиниці виміру | Залишки
    const data = [
      ["Назва", "Категорія", "Одиниці виміру", "Залишки"] // Заголовки
    ];
    
    productMap.forEach((product) => {
      data.push([
        product.name,
        product.category,
        product.unit,
        product.total
      ]);
    });
    
    // ПЕРЕЗАПИСУЄМО лист фінальним звітом
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:E`,
    });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:D${data.length}`,
      valueInputOption: "RAW",
      requestBody: {
        values: data,
      },
    });

    return true;
  } catch (err) {
    console.error("Ошибка writeFinalInventoryReport:", err);
    throw err;
  }
}

export { sheets };
