import fs from "fs";
import { google } from "googleapis";

// === Google Sheets credentials ===
const CREDENTIALS_PATH = "/etc/secrets/credentials.json";

// Р§РёС‚Р°РµРј JSON СЃ СЃРµСЂРІРёСЃРЅС‹Рј Р°РєРєР°СѓРЅС‚РѕРј
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

// РђРІС‚РѕСЂРёР·Р°С†РёСЏ Google API
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// === РћСЃРЅРѕРІРЅР°СЏ Р»РѕРіРёРєР° ===
const SPREADSHEET_ID = "1eiJw3ADAdq6GfQxsbJp0STDsc1MyJfPXCf2caQy8khw";
const MASTER_SHEET_NAME = "Р›РёСЃС‚1"; // Р“РѕР»РѕРІРЅРёР№ Р°СЂРєСѓС€ Р· С€Р°Р±Р»РѕРЅРѕРј

// рџ“Ґ Р§РРўРђРќРќРЇ Р”РђРќРРҐ Р— GOOGLE SHEETS
export async function readProductsFromSheet() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A2:F`, // Р§РёС‚Р°С”РјРѕ РІРєР»СЋС‡РЅРѕ Р· F (РћРґРёРЅРёС†С– РІРёРјС–СЂСѓ)
    });

    const rows = response.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || "";
      const name = row[1] || "";
      const category = row[2] || "";
      const type = row[3] || "";
      // row[4] - С†Рµ СЃС‚Р°СЂС– Р·Р°Р»РёС€РєРё, РїСЂРѕРїСѓСЃРєР°С”РјРѕ
      const unit = row[5] || "РєРі"; // РљРѕР»РѕРЅРєР° F - РћРґРёРЅРёС†С– РІРёРјС–СЂСѓ
      
      if (fridgeValue.includes(",")) {
        const fridgeNumbers = fridgeValue.split(",").map(f => f.trim());
        
        fridgeNumbers.forEach(fridgeNum => {
          products.push({
            rowIndex: index + 2,
            fridge: fridgeNum,
            name,
            category,
            type,
            unit,
            quantity: "" // РќРµ С‡РёС‚Р°С”РјРѕ СЃС‚Р°СЂС– Р·Р°Р»РёС€РєРё
          });
        });
      } else {
        products.push({
          rowIndex: index + 2,
          fridge: fridgeValue,
          name,
          category,
          type,
          unit,
          quantity: ""
        });
      }
    });

    console.log(`рџ“‹ РџСЂРѕС‡РёС‚Р°РЅРѕ ${products.length} РїСЂРѕРґСѓРєС‚С–РІ Р· Google Sheets`);
    return products;
  } catch (error) {
    console.error("вќЊ РџРѕРјРёР»РєР° РїСЂРё С‡РёС‚Р°РЅРЅС– РґР°РЅРёС… Р· Google Sheets:", error);
    throw error;
  }
}

// рџ†• Р§РРўРђРќРќРЇ Р”РђРќРРҐ Р— РљРћРќРљР Р•РўРќРћР“Рћ РђР РљРЈРЁРђ Р†РќР’Р•РќРўРђР РР—РђР¦Р†Р‡
export async function readInventorySheetData(date) {
  try {
    const sheetName = `Р†РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–СЏ ${date}`;
    
    // РџРµСЂРµРІС–СЂСЏС”РјРѕ С‡Рё С–СЃРЅСѓС” С‚Р°РєРёР№ Р°СЂРєСѓС€
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const existingSheet = spreadsheet.data.sheets.find(
      sheet => sheet.properties.title === sheetName
    );
    
    if (!existingSheet) {
      console.log(`вљ пёЏ РђСЂРєСѓС€ "${sheetName}" РЅРµ С–СЃРЅСѓС”`);
      return null;
    }
    
    // Р§РёС‚Р°С”РјРѕ РґР°РЅС– Р· Р°СЂРєСѓС€Р° (РІРєР»СЋС‡Р°СЋС‡Рё РєРѕР»РѕРЅРєСѓ E Р· РѕРґРёРЅРёС†СЏРјРё)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:E`,
    });
    
    const rows = response.data.values || [];
    const products = [];
    
    rows.forEach((row, index) => {
      const fridgeValue = row[0] || "";
      const name = row[1] || "";
      const category = row[2] || "";
      const type = row[3] || "";
      const unit = row[4] || "РєРі";
      
      // Р§РёС‚Р°С”РјРѕ Р·Р°Р»РёС€РєРё Р· РєРѕР»РѕРЅРѕРє С…РѕР»РѕРґРёР»СЊРЅРёРєС–РІ (F, G, H... Р·Р°Р»РµР¶РЅРѕ РІС–Рґ РєС–Р»СЊРєРѕСЃС‚С–)
      // РџРѕРєРё С‰Рѕ РЅРµ РјР°С”РјРѕ С†РёС… РґР°РЅРёС…, С‚РѕРјСѓ quantity = ""
      
      if (fridgeValue.includes(",")) {
        const fridgeNumbers = fridgeValue.split(",").map(f => f.trim());
        
        fridgeNumbers.forEach(fridgeNum => {
          products.push({
            rowIndex: index + 2,
            fridge: fridgeNum,
            name,
            category,
            type,
            unit,
            quantity: "" // Р‘СѓРґРµ Р·Р°РїРѕРІРЅРµРЅРѕ РїС–Р·РЅС–С€Рµ
          });
        });
      } else {
        products.push({
          rowIndex: index + 2,
          fridge: fridgeValue,
          name,
          category,
          type,
          unit,
          quantity: ""
        });
      }
    });
    
    console.log(`рџ“‹ РџСЂРѕС‡РёС‚Р°РЅРѕ ${products.length} РїСЂРѕРґСѓРєС‚С–РІ Р· Р°СЂРєСѓС€Р° "${sheetName}"`);
    return products;
  } catch (error) {
    console.error("вќЊ РџРѕРјРёР»РєР° РїСЂРё С‡РёС‚Р°РЅРЅС– Р°СЂРєСѓС€Р° С–РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–С—:", error);
    return null;
  }
}

// рџ†• РџР•Р Р•Р’Р†Р РљРђ Р†РЎРќРЈР’РђРќРќРЇ РђР РљРЈРЁРђ Р†РќР’Р•РќРўРђР РР—РђР¦Р†Р‡
export async function checkInventorySheetExists(date) {
  try {
    const sheetName = `Р†РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–СЏ ${date}`;
    
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const existingSheet = spreadsheet.data.sheets.find(
      sheet => sheet.properties.title === sheetName
    );
    
    return !!existingSheet;
  } catch (error) {
    console.error("вќЊ РџРѕРјРёР»РєР° РїСЂРё РїРµСЂРµРІС–СЂС†С– С–СЃРЅСѓРІР°РЅРЅСЏ Р°СЂРєСѓС€Р°:", error);
    return false;
  }
}

// рџ†• РЎРўР’РћР Р•РќРќРЇ РќРћР’РћР“Рћ РђР РљРЈРЁРђ Р”Р›РЇ Р†РќР’Р•РќРўРђР РР—РђР¦Р†Р‡
export async function createInventorySheet(date) {
  try {
    const sheetName = `Р†РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–СЏ ${date}`;
    
    // РџРµСЂРµРІС–СЂСЏС”РјРѕ С‡Рё С–СЃРЅСѓС” РІР¶Рµ С‚Р°РєРёР№ Р°СЂРєСѓС€
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const existingSheet = spreadsheet.data.sheets.find(
      sheet => sheet.properties.title === sheetName
    );
    
    if (existingSheet) {
      console.log(`вљ пёЏ РђСЂРєСѓС€ "${sheetName}" РІР¶Рµ С–СЃРЅСѓС”`);
      return sheetName;
    }
    
    // Р§РёС‚Р°С”РјРѕ Р’РЎР† РґР°РЅС– Р· РіРѕР»РѕРІРЅРѕРіРѕ Р°СЂРєСѓС€Р° (РІРµСЃСЊ РїРµСЂС€РёР№ СЂСЏРґРѕРє Р· Р·Р°РіРѕР»РѕРІРєР°РјРё)
    const masterData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MASTER_SHEET_NAME}!A1:Z`, // Р§РёС‚Р°С”РјРѕ РІСЃС– РєРѕР»РѕРЅРєРё РґРѕ Z
    });
    
    // РЎС‚РІРѕСЂСЋС”РјРѕ РЅРѕРІРёР№ Р°СЂРєСѓС€
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
      throw new Error("РќРµРјР°С” РґР°РЅРёС… РІ РіРѕР»РѕРІРЅРѕРјСѓ Р°СЂРєСѓС€С–");
    }
    
    // РљРѕРїС–СЋС”РјРѕ Р’РЎР† СЂСЏРґРєРё СЏРє С” (РІРєР»СЋС‡РЅРѕ Р· Р·Р°РіРѕР»РѕРІРєР°РјРё С…РѕР»РѕРґРёР»СЊРЅРёРєС–РІ)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows }
    });
    
    console.log(`вњ… РЎС‚РІРѕСЂРµРЅРѕ РЅРѕРІРёР№ Р°СЂРєСѓС€: ${sheetName} (СЃРєРѕРїС–Р№РѕРІР°РЅРѕ ${rows.length} СЂСЏРґРєС–РІ)`);
    return sheetName;
  } catch (error) {
    console.error("вќЊ РџРѕРјРёР»РєР° РїСЂРё СЃС‚РІРѕСЂРµРЅРЅС– Р°СЂРєСѓС€Р°:", error);
    throw error;
  }
}

// рџ“¤ Р—РђРџРРЎ Р—РђР›РРЁРљР†Р’ Р’ РќРћР’РР™ РђР РљРЈРЁ Р†РќР’Р•РќРўРђР РР—РђР¦Р†Р‡ (РђР’РўРћРњРђРўРР§РќРР™ РџРћРЁРЈРљ РљРћР›РћРќРћРљ)
export async function writeQuantitiesToInventorySheet(sheetName, inventoryByFridge) {
  try {
    // Р§РёС‚Р°С”РјРѕ Р·Р°РіРѕР»РѕРІРєРё (РїРµСЂС€РёР№ СЂСЏРґРѕРє)
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1`,
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    
    // Р—РЅР°С…РѕРґРёРјРѕ СЏРєС– РєРѕР»РѕРЅРєРё РІС–РґРїРѕРІС–РґР°СЋС‚СЊ СЏРєРёРј С…РѕР»РѕРґРёР»СЊРЅРёРєР°Рј
    const fridgeColumns = {};
    let totalColumn = null;
    
    headers.forEach((header, index) => {
      const columnLetter = String.fromCharCode(65 + index); // A=65, B=66...
      
      // РЁСѓРєР°С”РјРѕ РєРѕР»РѕРЅРєРё С‚РёРїСѓ "РҐРѕР»РѕРґРёР»СЊРЅРёРє 1", "РҐРѕР»РѕРґРёР»СЊРЅРёРє 2" С– С‚.Рґ.
      const match = header?.match(/РҐРѕР»РѕРґРёР»СЊРЅРёРє\s+(\d+)/i);
      if (match) {
        const fridgeNum = match[1];
        fridgeColumns[fridgeNum] = columnLetter;
        console.log(`рџ“‹ Р—РЅР°Р№РґРµРЅРѕ: РҐРѕР»РѕРґРёР»СЊРЅРёРє ${fridgeNum} в†’ РєРѕР»РѕРЅРєР° ${columnLetter}`);
      }
      
      // РЁСѓРєР°С”РјРѕ РєРѕР»РѕРЅРєСѓ "Р—Р°Р»РёС€РєРё"
      if (header?.toLowerCase().includes('Р·Р°Р»РёС€РєРё')) {
        totalColumn = columnLetter;
        console.log(`рџ“‹ Р—РЅР°Р№РґРµРЅРѕ: Р—Р°Р»РёС€РєРё в†’ РєРѕР»РѕРЅРєР° ${columnLetter}`);
      }
    });
    
    if (Object.keys(fridgeColumns).length === 0) {
      throw new Error("РќРµ Р·РЅР°Р№РґРµРЅРѕ Р¶РѕРґРЅРѕС— РєРѕР»РѕРЅРєРё Р· С…РѕР»РѕРґРёР»СЊРЅРёРєР°РјРё");
    }
    
    // Р§РёС‚Р°С”РјРѕ РІСЃС– РґР°РЅС– РїСЂРѕРґСѓРєС‚С–РІ (Р· РґСЂСѓРіРѕРіРѕ СЂСЏРґРєР°)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:E`,
    });
    
    const rows = response.data.values || [];
    
    // РЎС‚РІРѕСЂСЋС”РјРѕ Map РґР»СЏ С€РІРёРґРєРѕРіРѕ РїРѕС€СѓРєСѓ РїРѕ РєРѕР¶РЅРѕРјСѓ С…РѕР»РѕРґРёР»СЊРЅРёРєСѓ
    const dataByFridge = {};
    Object.keys(inventoryByFridge).forEach(fridgeNum => {
      dataByFridge[fridgeNum] = new Map();
      inventoryByFridge[fridgeNum].forEach(item => {
        dataByFridge[fridgeNum].set(item.name, item.quantity);
      });
    });
    
    // Р“РѕС‚СѓС”РјРѕ РјР°СЃРёРІ РґР»СЏ batch update
    const updates = [];
    
    rows.forEach((row, index) => {
      const productName = row[1]; // РљРѕР»РѕРЅРєР° B - РќР°Р·РІР°
      const rowIndex = index + 2;
      
      let totalForProduct = 0;
      
      // Р”Р»СЏ РєРѕР¶РЅРѕРіРѕ С…РѕР»РѕРґРёР»СЊРЅРёРєР° Р·Р°РїРёСЃСѓС”РјРѕ Р№РѕРіРѕ РґР°РЅС–
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
      
      // Р—Р°РїРёСЃСѓС”РјРѕ Р·Р°РіР°Р»СЊРЅСѓ СЃСѓРјСѓ РІ РєРѕР»РѕРЅРєСѓ "Р—Р°Р»РёС€РєРё"
      if (totalForProduct > 0 && totalColumn) {
        updates.push({
          range: `${sheetName}!${totalColumn}${rowIndex}`,
          values: [[totalForProduct]]
        });
      }
    });
    
    if (updates.length === 0) {
      console.log("вљ пёЏ РќРµРјР°С” РґР°РЅРёС… РґР»СЏ Р·Р°РїРёСЃСѓ");
      return;
    }
    
    // Batch update - РѕРЅРѕРІР»СЋС”РјРѕ РІСЃС– РєРѕРјС–СЂРєРё РѕРґРЅРёРј Р·Р°РїРёС‚РѕРј
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    });
    
    console.log(`вњ… РћРЅРѕРІР»РµРЅРѕ ${updates.length} РєРѕРјС–СЂРѕРє Сѓ Р°СЂРєСѓС€С– "${sheetName}"`);
  } catch (error) {
    console.error("вќЊ РџРѕРјРёР»РєР° РїСЂРё Р·Р°РїРёСЃСѓ Р·Р°Р»РёС€РєС–РІ:", error);
    throw error;
  }
}

// рџ“¤ Р—РђРџРРЎ Р—РђР›РРЁРљР†Р’ Р’ РљРћР›РћРќРљРЈ E
export async function writeQuantitiesToSheet(quantities) {
  try {
    // quantities - С†Рµ РјР°СЃРёРІ РѕР±'С”РєС‚С–РІ { name: "РќР°Р·РІР° РїСЂРѕРґСѓРєС‚Сѓ", totalQuantity: 1.3 }
    
    // РЎРїРѕС‡Р°С‚РєСѓ С‡РёС‚Р°С”РјРѕ РІСЃС– РґР°РЅС–
    const allProducts = await readProductsFromSheet();
    
    // РЎС‚РІРѕСЂСЋС”РјРѕ Map РґР»СЏ С€РІРёРґРєРѕРіРѕ РїРѕС€СѓРєСѓ
    const quantityMap = new Map();
    quantities.forEach(q => {
      quantityMap.set(q.name, q.totalQuantity);
    });
    
    // Р“РѕС‚СѓС”РјРѕ РјР°СЃРёРІ РґР»СЏ batch update
    const updates = [];
    
    allProducts.forEach(product => {
      if (quantityMap.has(product.name)) {
        const quantity = quantityMap.get(product.name);
        updates.push({
          range: `E${product.rowIndex}`, // Р—Р°РїРёСЃСѓС”РјРѕ РІ РєРѕР»РѕРЅРєСѓ E
          values: [[quantity]]
        });
      }
    });
    
    if (updates.length === 0) {
      console.log("вљ пёЏ РќРµРјР°С” РґР°РЅРёС… РґР»СЏ Р·Р°РїРёСЃСѓ");
      return;
    }
    
    // Batch update - РѕРЅРѕРІР»СЋС”РјРѕ РІСЃС– РєРѕРјС–СЂРєРё РѕРґРЅРёРј Р·Р°РїРёС‚РѕРј
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    });
    
    console.log(`вњ… РћРЅРѕРІР»РµРЅРѕ ${updates.length} Р·Р°РїРёСЃС–РІ Сѓ Google Sheets`);
  } catch (error) {
    console.error("вќЊ РџРѕРјРёР»РєР° РїСЂРё Р·Р°РїРёСЃСѓ Р·Р°Р»РёС€РєС–РІ:", error);
    throw error;
  }
}

// рџ“¦ Р—РђРџРРЎ РџР РћР”РЈРљРўР†Р’ (СЃС‚Р°СЂРёР№ РјРµС‚РѕРґ, Р·Р°Р»РёС€Р°С”РјРѕ РґР»СЏ СЃСѓРјС–СЃРЅРѕСЃС‚С–)
export async function writeProductsToSheet(products) {
  const hasType = products.length > 0 && products[0].hasOwnProperty('type');
  
  const headers = hasType 
    ? [["РќР°Р·РІР°", "РљР°С‚РµРіРѕСЂС–СЏ", "РўРёРї"]]
    : [["РќР°Р·РІР°", "РљР°С‚РµРіРѕСЂС–СЏ"]];
  
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
