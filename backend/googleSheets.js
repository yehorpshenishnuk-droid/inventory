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

export const sheets = google.sheets({ version: "v4", auth });

// === Основная логика ===
export const SPREADSHEET_ID = "1eiJw3ADAdq6GfQxsbJp0STDsc1MyJfPXCf2caQy8khw";
const MASTER_SHEET_NAME = "Лист1";

// -----------------------------------------------------
// УТИЛИТЫ
// -----------------------------------------------------

/** Конвертация индекса в букву (0=A, 1=B...) */
function indexToColumn(index) {
  let column = "";
  while (index >= 0) {
    column = String.fromCharCode((index % 26) + 65) + column;
    index = Math.floor(index / 26) - 1;
  }
  return column;
}

/** Чтение листа */
async function readRange(sheetName, range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${range}`,
  });
  return res.data.values || [];
}

/** Проверка наличия листа */
export async function checkInventorySheetExists(date) {
  const sheetName = `Інвентаризація ${date}`;

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID
  });

  return spreadsheet.data.sheets.some(
    sheet => sheet.properties.title === sheetName
  );
}

// -----------------------------------------------------
// ЧТЕНИЕ ШАБЛОНА (главный лист)
// -----------------------------------------------------

export async function readProductsFromSheet() {
  try {
    const rows = await readRange(MASTER_SHEET_NAME, "A2:F");

    const products = [];

    rows.forEach((row, i) => {
      const fridgeRaw = row[0] || "";
      const shelfRaw = row[1] || "";
      const name = row[2] || "";
      const category = row[3] || "";
      const type = row[4] || "";
      const unit = row[5] || "кг";

      const locations = [];

      if (fridgeRaw)
        fridgeRaw.split(",").map(s => s.trim()).forEach(v => locations.push(v));

      if (shelfRaw)
        shelfRaw.split(",").map(s => s.trim()).forEach(v => locations.push(v));

      locations.forEach(loc => {
        products.push({
          rowIndex: i + 2,
          fridge: loc,
          name,
          category,
          type,
          unit,
          quantity: ""
        });
      });
    });

    return products;
  } catch (error) {
    console.error("Ошибка чтения данных из шаблона:", error);
    throw error;
  }
}

// -----------------------------------------------------
// СОЗДАНИЕ ЛИСТА ИНВЕНТАРИЗАЦИИ
// -----------------------------------------------------

export async function createInventorySheet(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;

    // Проверка на наличие
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });

    if (spreadsheet.data.sheets.some(s => s.properties.title === sheetName)) {
      console.log(`Лист ${sheetName} уже существует`);
      return sheetName;
    }

    // Чтение шаблона
    const template = await readRange(MASTER_SHEET_NAME, "A1:F");

    // Создаём новый лист
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: { properties: { title: sheetName } }
        }]
      }
    });

    // Пишем шаблон
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: template }
    });

    // Форматируем колонки A и B как текст
    const sheetMeta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });

    const sheetId = sheetMeta.data.sheets.find(
      s => s.properties.title === sheetName
    ).properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 2
            },
            cell: {
              userEnteredFormat: { numberFormat: { type: "TEXT" } }
            },
            fields: "userEnteredFormat.numberFormat"
          }
        }]
      }
    });

    console.log(`Создан новый лист: ${sheetName}`);
    return sheetName;

  } catch (error) {
    console.error("Ошибка создания листа:", error);
    throw error;
  }
}

// -----------------------------------------------------
// ЧТЕНИЕ КОНКРЕТНОГО ЛИСТА ИНВЕНТАРИЗАЦИИ
// -----------------------------------------------------

export async function readInventorySheetData(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;

    // Заголовки
    const headers = await readRange(sheetName, "A1:Z1");
    const headerRow = headers[0] || [];

    const locations = {};

    headerRow.forEach((title, index) => {
      if (!title) return;
      const col = indexToColumn(index);

      const fridgeMatch = title.match(/Холодильник\s+(\d+)/i);
      const shelfMatch = title.match(/Стелаж\s+(\d+)/i);

      if (fridgeMatch) locations[fridgeMatch[1]] = index;
      if (shelfMatch) locations[shelfMatch[1]] = index;
    });

    const rows = await readRange(sheetName, "A2:Z");
    const products = [];

    rows.forEach((row, i) => {
      const name = row[2] || "";
      const category = row[3] || "";
      const type = row[4] || "";
      const unit = row[5] || "кг";

      const locA = row[0] || "";
      const locB = row[1] || "";

      const locs = [];
      if (locA) locA.split(",").map(s => s.trim()).forEach(v => locs.push(v));
      if (locB) locB.split(",").map(s => s.trim()).forEach(v => locs.push(v));

      locs.forEach(loc => {
        const colIndex = locations[loc];
        const qty = colIndex !== undefined ? (row[colIndex] || "") : "";

        products.push({
          rowIndex: i + 2,
          fridge: loc,
          name,
          category,
          type,
          unit,
          quantity: qty
        });
      });
    });

    return products;

  } catch (err) {
    console.error("Ошибка чтения листа инвентаризации:", err);
    return null;
  }
}

// -----------------------------------------------------
// ЗАПИС КОЛИЧЕСТВ ПО ХОЛОДИЛЬНИКАМ (ПЕРЕЗАПИС)
// -----------------------------------------------------

export async function writeQuantitiesToInventorySheet(sheetName, inventoryByFridge) {
  try {
    // Заголовки
    const headerRow = (await readRange(sheetName, "A1:Z1"))[0] || [];

    const columns = {};
    headerRow.forEach((title, index) => {
      const fridgeMatch = title?.match(/Холодильник\s+(\d+)/i);
      const shelfMatch = title?.match(/Стелаж\s+(\d+)/i);

      if (fridgeMatch) columns[fridgeMatch[1]] = index;
      if (shelfMatch) columns[shelfMatch[1]] = index;
    });

    const rows = await readRange(sheetName, "A2:Z");

    const updates = [];

    rows.forEach((row, i) => {
      const productName = row[2];
      if (!productName) return;

      Object.keys(inventoryByFridge).forEach(fridgeNum => {
        const colIndex = columns[fridgeNum];
        if (colIndex === undefined) return;

        const entry = inventoryByFridge[fridgeNum].find(
          p => p.name === productName
        );

        if (!entry) return;

        const colLetter = indexToColumn(colIndex);

        updates.push({
          range: `${sheetName}!${colLetter}${i + 2}`,
          values: [[entry.quantity]]
        });
      });
    });

    if (updates.length === 0) return;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data: updates }
    });

    console.log(`Обновлено ${updates.length} ячеек в ${sheetName}`);

  } catch (err) {
    console.error("Ошибка записи остатков:", err);
    throw err;
  }
}

// -----------------------------------------------------
// ЗАПИС ПРОДУКТОВ (старый метод, оставлен для совместимости)
// -----------------------------------------------------

export async function writeProductsToSheet(products) {
  const headers = [["Назва", "Категорія", "Тип"]];
  const values = products.map(p => [
    p.name || p.product_name,
    p.category || p.menu_category_name || "-",
    p.type || "-"
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "A1:C1",
    valueInputOption: "RAW",
    requestBody: { values: headers }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "A2",
    valueInputOption: "RAW",
    requestBody: { values }
  });
}
