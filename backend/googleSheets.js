// ==================== GOOGLE SHEETS CONNECT ========================

import { google } from "googleapis";

// Читаем секрет из переменных окружения (Render Secret File)
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_KEY || "{}");

export const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Авторизация
const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

export const sheets = google.sheets({ version: "v4", auth });

// ===================================================================
// ==================== ЧТЕНИЕ ОСНОВНОГО ЛИСТА =======================
// ===================================================================

// Читаем весь лист (Лист1)
export async function readProductsFromSheet() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Лист1!A:X",
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const header = rows[0];
  const dataRows = rows.slice(1);

  return dataRows.map((row, index) => ({
    rowIndex: index + 2,
    fridge: row[0] || "",
    shelf: row[1] || "",
    name: row[2] || "",
    category: row[3] || "",
    type: row[4] || "",
    unit: row[5] || "",
    quantities: row.slice(6, 23),
    total: row[23] || "",
  }));
}

// ===================================================================
// =============== ДОБАВЛЕНИЕ НОВЫХ ПОЗИЦИЙ (Poster → Sheets) ========
// ===================================================================

export async function mergePosterItemsToSheet(posterItems) {
  const existing = await readProductsFromSheet();

  const existingNames = new Set(
    existing.map((item) => item.name.trim().toLowerCase())
  );

  const newRows = [];

  for (const item of posterItems) {
    const name = item.name?.trim().toLowerCase();

    if (!name || existingNames.has(name)) {
      continue; // уже есть — не добавляем
    }

    newRows.push([
      "", // A — Холодильник (пусто)
      "", // B — Стелаж (пусто)
      item.name || "", // C — Назва
      item.category || "", // D — Категорія
      item.type || "", // E — Тип
      item.unit || "", // F — Одиниці виміру
      ...Array(17).fill(""), // G–W — Холодильники 1–17
      "", // X — Залишки
    ]);
  }

  if (newRows.length === 0) {
    return { added: 0 };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Лист1!A:X",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: newRows,
    },
  });

  return { added: newRows.length };
}

// ===================================================================
// ===================== ИНВЕНТАРИЗАЦИЯ ==============================
// ===================================================================

// Проверка существования листа
export async function checkInventorySheetExists(date) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  return spreadsheet.data.sheets.some(
    (s) => s.properties.title === `Інвентаризація ${date}`
  );
}

// Создать новый лист на основе Лист1 (копия заголовков)
export async function createInventorySheet(date) {
  const title = `Інвентаризація ${date}`;

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const sheet1 = spreadsheet.data.sheets.find(
    (s) => s.properties.title === "Лист1"
  );

  const headers = (
    await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Лист1!A1:X1",
    })
  ).data.values[0];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title },
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1:X1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [headers],
    },
  });

  return title;
}

// Считать инвентаризацию
export async function readInventorySheetData(date) {
  const title = `Інвентаризація ${date}`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A2:X`,
  });

  const rows = res.data.values || [];
  return rows.map((row, index) => ({
    rowIndex: index + 2,
    fridge: row[0] || "",
    shelf: row[1] || "",
    name: row[2] || "",
    category: row[3] || "",
    type: row[4] || "",
    unit: row[5] || "",
    quantities: row.slice(6, 23),
    total: row[23] || "",
  }));
}

// Сохранить инвентаризацию
export async function writeQuantitiesToInventorySheet(sheetName, inventoryByFridge) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2:X`,
  });

  const rows = res.data.values || [];
  const updates = [];

  rows.forEach((row, i) => {
    const rowIndex = i + 2;
    const name = row[2];

    let sum = 0;
    const updatedRow = [...row];

    for (let col = 6; col <= 22; col++) {
      const fridgeNum = col - 5;
      const input = inventoryByFridge[fridgeNum]?.find((x) => x.name === name);

      updatedRow[col] = input ? input.quantity : row[col] || "";
      if (updatedRow[col] && !isNaN(updatedRow[col])) {
        sum += Number(updatedRow[col]);
      }
    }

    updatedRow[23] = sum ? sum : "";

    updates.push({ range: `${sheetName}!A${rowIndex}:X${rowIndex}`, values: [updatedRow] });
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates,
    },
  });

  return true;
}

// ===================================================================
// ======================= БЛОКИРОВКИ ================================
// ===================================================================

export async function lockLocation(locationNumber, userName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Locks!A2:C",
  });

  const rows = res.data.values || [];

  if (rows.some((r) => r[0] === String(locationNumber))) {
    return { success: false, error: "Уже заблокировано" };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Locks!A2:C",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[locationNumber, userName, new Date().toISOString()]],
    },
  });

  return { success: true };
}

export async function unlockLocation(locationNumber) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Locks!A2:C",
  });

  const rows = res.data.values || [];
  const newRows = rows.filter((r) => r[0] !== String(locationNumber));

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "Locks!A2:C",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: newRows },
  });

  return { success: true };
}

export async function checkLock(locationNumber) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Locks!A2:C",
  });

  const rows = res.data.values || [];
  return rows.find((r) => r[0] === String(locationNumber)) || null;
}

export async function getAllLocks() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Locks!A2:C",
  });

  return res.data.values || [];
}
