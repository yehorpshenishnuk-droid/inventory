import fs from "fs";
import { google } from "googleapis";

// =========================
//   1. Авторизация
// =========================

const CREDENTIALS_PATH = "/etc/secrets/credentials.json";

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const SPREADSHEET_ID = "1eiJw3ADAdq6GfQxsbJp0STDsc1MyJfPXCf2caQy8khw";
const MASTER_SHEET_NAME = "Лист1";

export { sheets, SPREADSHEET_ID };

// =========================
//   2. Чтение продуктов
// =========================

export async function readProductsFromSheet() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A2:F`,
    });

    const rows = response.data.values || [];
    const products = [];

    rows.forEach((row, idx) => {
      const fridge = row[0] || "";
      const shelf = row[1] || "";
      const name = row[2] || "";
      const category = row[3] || "";
      const type = row[4] || "";
      const unit = row[5] || "кг";

      const locs = [];

      if (fridge)
        fridge.includes(",")
          ? locs.push(...fridge.split(",").map(s => s.trim()))
          : locs.push(fridge);

      if (shelf)
        shelf.includes(",")
          ? locs.push(...shelf.split(",").map(s => s.trim()))
          : locs.push(shelf);

      locs.forEach(loc => {
        products.push({
          rowIndex: idx + 2,
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
  } catch (err) {
    console.error("Ошибка чтения таблицы:", err);
    return [];
  }
}

// =========================
//   3. Проверка наличия листа
// =========================

export async function checkInventorySheetExists(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    return spreadsheet.data.sheets.some(
      (s) => s.properties.title === sheetName
    );
  } catch {
    return false;
  }
}

// =========================
//   4. Создание листа инвентаризации
// =========================

export async function createInventorySheet(date) {
  const sheetName = `Інвентаризація ${date}`;

  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const exists = spreadsheet.data.sheets.some(
      (s) => s.properties.title === sheetName
    );

    if (exists) return sheetName;

    const master = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A1:Z`,
    });

    const rows = master.data.values || [];
    const filtered = [];

    rows.forEach((row, idx) => {
      if (idx === 0) {
        filtered.push(row);
        return;
      }

      const hasLoc =
        (row[0] && row[0].trim()) ||
        (row[1] && row[1].trim());

      if (hasLoc) filtered.push(row);
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: filtered },
    });

    return sheetName;
  } catch (err) {
    console.error("Ошибка создания листа:", err);
    throw err;
  }
}

// =========================
//   5. Чтение готового листа инвентаризации
// =========================

export async function readInventorySheetData(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;

    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });

    const headers = headerRes.data.values?.[0] || [];

    // поиск колонок холодильников вида "Холодильник 1"
    const locCols = {};

    headers.forEach((h, idx) => {
      const m1 = h.match(/Холодильник\s+(\d+)/i);
      const m2 = h.match(/Стелаж\s+(\d+)/i);

      if (m1) locCols[m1[1]] = idx;
      if (m2) locCols[m2[1]] = idx;
    });

    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });

    const rows = dataRes.data.values || [];
    const items = [];

    rows.forEach((row, rIdx) => {
      const fridge = row[0] || "";
      const shelf = row[1] || "";
      const name = row[2] || "";
      const category = row[3] || "";
      const type = row[4] || "";
      const unit = row[5] || "кг";

      const locs = [];

      if (fridge)
        fridge.includes(",")
          ? locs.push(...fridge.split(",").map(s => s.trim()))
          : locs.push(fridge);

      if (shelf)
        shelf.includes(",")
          ? locs.push(...shelf.split(",").map(s => s.trim()))
          : locs.push(shelf);

      locs.forEach(loc => {
        const colIndex = locCols[loc];
        const qty = colIndex !== undefined ? row[colIndex] || "" : "";

        items.push({
          rowIndex: rIdx + 2,
          fridge: loc,
          name,
          category,
          type,
          unit,
          quantity: qty
        });
      });
    });

    return items;
  } catch (err) {
    console.error("Ошибка чтения инвентаризации:", err);
    return null;
  }
}

// =========================
//   6. Запись остатков в лист
// =========================

export async function writeQuantitiesToInventorySheet(sheetName, inventoryByFridge) {
  try {
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });

    const headers = headerRes.data.values?.[0] || [];
    const locCols = {};

    headers.forEach((h, idx) => {
      const m1 = h.match(/Холодильник\s+(\d+)/i);
      const m2 = h.match(/Стелаж\s+(\d+)/i);

      if (m1) locCols[m1[1]] = String.fromCharCode(65 + idx);
      if (m2) locCols[m2[1]] = String.fromCharCode(65 + idx);
    });

    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });

    const rows = dataRes.data.values || [];

    const batch = [];

    rows.forEach((row, idx) => {
      const name = row[2];
      const rowIndex = idx + 2;

      let sum = 0;

      for (const fridgeNum of Object.keys(inventoryByFridge)) {
        const col = locCols[fridgeNum];
        if (!col) continue;

        const value = inventoryByFridge[fridgeNum].find(p => p.name === name)?.quantity;

        if (value !== undefined && value !== "") {
          batch.push({
            range: `${sheetName}!${col}${rowIndex}`,
            values: [[value]],
          });
          const x = parseFloat(value) || 0;
          sum += x;
        }
      }
    });

    if (!batch.length) return;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: batch,
      },
    });
  } catch (err) {
    console.error("Ошибка записи остатков:", err);
    throw err;
  }
}

// =========================
//   7. Старый метод (оставляем)
// =========================

export async function writeProductsToSheet(products) {
  const hasType = products.length > 0 && products[0].hasOwnProperty("type");

  const headers = hasType
    ? [["Назва", "Категорія", "Тип"]]
    : [["Назва", "Категорія"]];

  const values = products.map((p) =>
    hasType
      ? [p.name, p.category, p.type]
      : [p.name, p.category]
  );

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
