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

const SPREADSHEET_ID = "1eiJw3ADAdq6GfQxsbJp0STDsc1MyJfPXCf2caQy8khw";
const MASTER_SHEET_NAME = "Лист1";
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

export async function readProductsFromSheet() {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A2:F`,
    });

    const rows = resp.data.values || [];
    const result = [];

    rows.forEach((row, i) => {
      const fridgeValue = row[0] || "";
      const shelfValue = row[1] || "";

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
          name: row[2] || "",
          category: row[3] || "",
          type: row[4] || "",
          unit: row[5] || "кг",
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

    const master = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A1:Z`,
    });

    const rows = master.data.values || [];
    const filtered = [];

    rows.forEach((r, i) => {
      if (i === 0) return filtered.push(r);

      const hasLoc =
        (r[0] && r[0].trim()) || (r[1] && r[1].trim());

      if (hasLoc) filtered.push(r);
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
    console.error("Ошибка createInventorySheet:", err);
    throw err;
  }
}

export async function readInventorySheetData(date) {
  try {
    const sheetName = `Інвентаризація ${date}`;

    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });

    const headers = headerResp.data.values?.[0] || [];

    const columns = {};

    headers.forEach((h, i) => {
      const col = String.fromCharCode(65 + i);

      let m1 = h?.match(/Холодильник\s+(\d+)/i);
      let m2 = h?.match(/Стелаж\s+(\d+)/i);

      if (m1) columns[m1[1]] = { col, index: i };
      if (m2) columns[m2[1]] = { col, index: i };
    });

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });

    const rows = resp.data.values || [];
    const result = [];

    rows.forEach((row, i) => {
      const fridge = row[0] || "";
      const shelf = row[1] || "";

      const locs = [];

      if (fridge)
        fridge.split(",").map((v) => v.trim()).forEach((v) => locs.push(v));

      if (shelf)
        shelf.split(",").map((v) => v.trim()).forEach((v) => locs.push(v));

      locs.forEach((loc) => {
        const info = columns[loc];
        const qty = info ? row[info.index] || "" : "";

        result.push({
          rowIndex: i + 2,
          fridge: loc,
          name: row[2] || "",
          category: row[3] || "",
          type: row[4] || "",
          unit: row[5] || "кг",
          quantity: qty,
        });
      });
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
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });

    const headers = headerResp.data.values?.[0] || [];

    const columns = {};
    let totalColumn = null;

    headers.forEach((h, i) => {
      const col = String.fromCharCode(65 + i);

      let m1 = h?.match(/Холодильник\s+(\d+)/i);
      let m2 = h?.match(/Стелаж\s+(\d+)/i);

      if (m1) columns[m1[1]] = { col, index: i };
      if (m2) columns[m2[1]] = { col, index: i };

      if (h?.toLowerCase() === "залишки") {
        totalColumn = { col, index: i };
      }
    });

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:Z`,
    });

    const rows = resp.data.values || [];
    const updates = [];

    rows.forEach((row, rowIndex) => {
      const productName = row[2];
      if (!productName) return;

      let sum = 0;
      let hasValue = false;

      Object.keys(columns).forEach((loc) => {
        const newValue =
          inventoryByFridge[loc]?.find((p) => p.name === productName)
            ?.quantity ?? "";

        const col = columns[loc].col;

        if (newValue !== "" && !isNaN(newValue)) {
          hasValue = true;
          sum += Number(newValue);

          updates.push({
            range: `${sheetName}!${col}${rowIndex + 2}`,
            values: [[newValue]],
          });
        } else {
          updates.push({
            range: `${sheetName}!${col}${rowIndex + 2}`,
            values: [[""]],
          });
        }
      });

      if (totalColumn) {
        updates.push({
          range: `${sheetName}!${totalColumn.col}${rowIndex + 2}`,
          values: [[hasValue ? sum : ""]],
        });
      }
    });

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: updates,
        },
      });
    }

    return true;
  } catch (err) {
    console.error("Ошибка writeQuantitiesToInventorySheet:", err);
    throw err;
  }
}

export { sheets, SPREADSHEET_ID };
