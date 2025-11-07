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
const SPREADSHEET_ID = "1eiJw3ADAdq6GfQxsbJp0STDsc1MyJfPXCf2caQy8khw"; // Твой ID таблицы

export async function writeProductsToSheet(products) {
  // Проверяем есть ли поле type (значит это все позиции)
  const hasType = products.length > 0 && products[0].hasOwnProperty('type');
  
  // Заголовки таблицы
  const headers = hasType 
    ? [["Назва", "Категорія", "Тип"]]
    : [["Назва", "Категорія"]];
  
  // Данные продуктов
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
  
  // Определяем диапазон заголовков
  const headerRange = hasType ? "A1:C1" : "A1:B1";
  
  // Сначала записываем заголовки
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: headerRange,
    valueInputOption: "RAW",
    requestBody: { values: headers },
  });
  
  // Потом записываем данные продуктов
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "A2", // Данные начинаются со второй строки
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
