import { google } from "googleapis";

// ------------------------------
// Google Auth
// ------------------------------
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_KEY),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

export const sheets = google.sheets({ version: "v4", auth });
export const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// -----------------------------------------------------------
// 1. Запись всех продуктов / позиций в шаблон Лист1
// -----------------------------------------------------------
export async function writeProductsToSheet(products) {
  try {
    const header = [
      "Холодильник",
      "Стелаж",
      "Назва",
      "Категорія",
      "Тип",
      "Одиниці виміру",
    ];

    const rows = products.map((p) => [
      "", // fridge
      "", // shelf
      p.name || p.product_name || "",
      p.category || p.category_name || "",
      p.type || "",
      p.unit || "кг",
    ]);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Лист1!A1:F1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Лист1!A2:F`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });

    return true;
  } catch (err) {
    console.error("Ошибка записи продуктов:", err);
    throw err;
  }
}

// -----------------------------------------------------------
// 2. Чтение Лист1 для загрузки данных в инвентаризацию
// -----------------------------------------------------------
export async function readProductsFromSheet() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Лист1!A2:F`,
    });

    const rows = res.data.values || [];

    return rows.map((row, idx) => ({
      fridge: row[0] || "",
      shelf: row[1] || "",
      name: row[2] || "",
      category: row[3] || "",
      type: row[4] || "",
      unit: row[5] || "",
      quantity: "",
      rowIndex: idx + 2,
    }));
  } catch (err) {
    console.error("Ошибка чтения Лист1:", err);
    throw err;
  }
}

// -----------------------------------------------------------
// 3. Проверка существования листа "Інвентаризація YYYY-MM-DD"
// -----------------------------------------------------------
export async function checkInventorySheetExists(date) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const name = `Інвентаризація ${date}`;

    return spreadsheet.data.sheets.some(
      (s) => s.properties.title === name
    );
  } catch (err) {
    console.error("Ошибка проверки листа:", err);
    return false;
  }
}

// -----------------------------------------------------------
// 4. Создание нового листа инвентаризации
// -----------------------------------------------------------
export async function createInventorySheet(date) {
  const sheetName = `Інвентаризація ${date}`;

  const templateRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Лист1!A1:F`,
  });

  const header = templateRes.data.values?.[0] || [];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        { addSheet: { properties: { title: sheetName } } },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:F1`,
    valueInputOption: "RAW",
    requestBody: { values: [header] },
  });

  return sheetName;
}

// -----------------------------------------------------------
// 5. Чтение листа инвентаризации
// -----------------------------------------------------------
export async function readInventorySheetData(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });

    const rows = res.data.values || [];

    return rows.map((row, idx) => ({
      fridge: row[0] || "",
      shelf: row[1] || "",
      name: row[2] || "",
      category: row[3] || "",
      type: row[4] || "",
      unit: row[5] || "",
      quantity: row[row.length - 1] || "",
      rowIndex: idx + 2,
    }));
  } catch (err) {
    console.error("Ошибка чтения инвентаризации:", err);
    throw err;
  }
}

// -----------------------------------------------------------
// 6. Запись остатков в холодильники + сумма "Залишки"
// -----------------------------------------------------------
export async function writeQuantitiesToInventorySheet(
  sheetName,
  inventoryByFridge
) {
  try {
    // --- 1. Получаем заголовки ---
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });

    const headers = headerRes.data.values?.[0] || [];

    const locCols = {}; // { "1": 6, "2": 7, ... }
    let totalColumnIndex = null;

    // Парсим заголовки
    headers.forEach((h, idx) => {
      const match = h.match(/(Холодильник|Стелаж)\s+(\d+)/i);
      if (match) {
        const num = match[2];
        locCols[num] = idx;
      }

      if (h.toLowerCase().includes("залишки")) {
        totalColumnIndex = idx;
      }
    });

    // Если нет колонки “Залишки”, создаём
    if (totalColumnIndex === null) {
      totalColumnIndex = headers.length;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!${String.fromCharCode(65 + totalColumnIndex)}1`,
        valueInputOption: "RAW",
        requestBody: { values: [["Залишки"]] },
      });
    }

    // --- 2. Получаем строки с данными ---
    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });

    const rows = dataRes.data.values || [];

    const batch = [];

    // --- 3. Запись значений ---
    rows.forEach((row, idx) => {
      const productName = row[2];
      const rowIndex = idx + 2;

      let total = 0;
      let hasAnyValue = false;

      // Перебор всех холодильников/стеллажей, существующих в таблице
      for (const fridgeNum of Object.keys(locCols)) {
        const colIndex = locCols[fridgeNum];

        const quantity =
          inventoryByFridge[fridgeNum]?.find(
            (p) => p.name === productName
          )?.quantity ?? "";

        // Если фронт прислал значение — пишем его
        if (quantity !== "") {
          batch.push({
            range: `${sheetName}!${String.fromCharCode(
              65 + colIndex
            )}${rowIndex}`,
            values: [[quantity]],
          });

          const num = parseFloat(quantity);
          if (!isNaN(num)) {
            total += num;
            hasAnyValue = true;
          }
        }
      }

      // Записываем сумму — только если есть хоть одно число
      batch.push({
        range: `${sheetName}!${String.fromCharCode(
          65 + totalColumnIndex
        )}${rowIndex}`,
        values: [[hasAnyValue ? total : ""]],
      });
    });

    // --- 4. batch update ---
    if (batch.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: batch,
        },
      });
    }

    return true;
  } catch (err) {
    console.error("Ошибка записи остатков:", err);
    throw err;
  }
}
