import fs from "fs";
import { google } from "googleapis";

// ===================
// Google Sheets SETUP
// ===================

const CREDENTIALS_PATH = "/etc/secrets/credentials.json"; // Render secret file
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// Вставь СВОЙ spreadsheet ID
const SPREADSHEET_ID = "1eiJw3ADAdq6GfQxsbJp0STDsc1MyJfPXCf2caQy8khw";


// ===================
// Poster API
// ===================

const POSTER_TOKEN = process.env.POSTER_TOKEN;

async function getPosterPrepacks() {
  if (!POSTER_TOKEN) {
    console.error("⚠️ POSTER_TOKEN отсутствует!");
    return [];
  }

  const url = `https://joinposter.com/api/menu.getPrepacks?token=${POSTER_TOKEN}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.response) return [];

    return data.response.map(item => ({
      id: item.prepack_id,
      name: item.product_name
    }));
  } catch (err) {
    console.error("Ошибка запроса к Poster:", err);
    return [];
  }
}


// ===================
// GOOGLE SHEETS LOGIC
// ===================

// Создаёт лист, если нет
async function ensureSheetExists(sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID
  });

  const exists = spreadsheet.data.sheets.some(
    sheet => sheet.properties.title === sheetName
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: { properties: { title: sheetName } }
          }
        ]
      }
    });

    // Заголовки
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:B1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["prepack_id", "product_name"]]
      }
    });

    console.log(`🆕 Создан лист "${sheetName}"`);
  }
}

// Читаем существующие ID
async function readExistingIds(sheetName) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:A`
    });

    const rows = res.data.values || [];
    return rows.map(r => r[0]);
  } catch {
    return [];
  }
}

// Добавляем ТОЛЬКО новые
async function addNewPrepacks(sheetName, prepacks) {
  const existingIds = await readExistingIds(sheetName);

  const newRows = prepacks
    .filter(p => !existingIds.includes(p.id))
    .map(p => [p.id, p.name]);

  if (newRows.length === 0) {
    console.log("Нет новых полуфабрикатов");
    return 0;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:B`,
    valueInputOption: "RAW",
    requestBody: { values: newRows }
  });

  console.log(`Добавлено новых полуфабрикатов: ${newRows.length}`);
  return newRows.length;
}


// ==========================
// MAIN: ВЫГРУЗКА ПОЛУФАБРИКАТОВ
// ==========================

export async function uploadPrepacks() {
  const SHEET = "Півфабрикати";

  await ensureSheetExists(SHEET);

  const prepacks = await getPosterPrepacks();
  if (prepacks.length === 0) {
    console.log("Poster не вернул полуфабрикаты");
    return;
  }

  const added = await addNewPrepacks(SHEET, prepacks);

  console.log(`Готово. Добавлено: ${added}`);
}


// Запуск, если файл стартуют напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  uploadPrepacks();
}
