import { google } from "googleapis";

// ===== AUTH =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_KEY || "{}"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

export const sheets = google.sheets({ version: "v4", auth });
export const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ===== СОЗДАТЬ ЛИСТ, ЕСЛИ НЕТ =====
export async function ensureSheetExists(title) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID
  });

  const exists = spreadsheet.data.sheets.some(
    (s) => s.properties.title === title
  );

  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title,
            },
          },
        },
      ],
    },
  });

  // Записываем заголовки
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1:B1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["prepack_id", "product_name"]],
    },
  });
}

// ===== ЧТЕНИЕ ИМЕЮЩИХСЯ ПОЛУФАБРИКАТОВ =====
export async function readPrepacksSheet() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Півфабрикати!A2:B10000",
    });

    const rows = res.data.values || [];

    return rows.map((row) => ({
      id: row[0],
      name: row[1] || ""
    }));
  } catch {
    return [];
  }
}

// ===== ДОБАВЛЕНИЕ ТОЛЬКО НОВЫХ ПОЛУФАБРИКАТОВ =====
export async function addNewPrepacksToSheet(prepacks) {
  await ensureSheetExists("Півфабрикати");

  const existing = await readPrepacksSheet();
  const existingIDs = new Set(existing.map((p) => p.id));

  const newRows = prepacks.filter((p) => !existingIDs.has(p.id));

  if (newRows.length === 0) {
    return { added: 0 };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Півфабрикати!A:B",
    valueInputOption: "RAW",
    requestBody: {
      values: newRows.map((r) => [r.id, r.name]),
    },
  });

  return { added: newRows.length };
}

// ===== Остальной твой код (инвентаризация, товары, блокировки) НЕ трогаем =====
