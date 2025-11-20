import express from "express";
import cors from "cors";
import { 
  writeProductsToSheet, 
  readProductsFromSheet, 
  writeQuantitiesToSheet,
  createInventorySheet,
  writeQuantitiesToInventorySheet,
  readInventorySheetData,
  checkInventorySheetExists
} from "./googleSheets.js";
import { getPosterProducts, getAllPosterItems } from "./poster.js";

const app = express();
app.use(cors());
app.use(express.json());

// рџ“¦ Р’СЂРµРјРµРЅРЅС‹Рµ С‚РµСЃС‚РѕРІС‹Рµ РґР°РЅРЅС‹Рµ (РµСЃР»Рё Poster API РЅРµРґРѕСЃС‚СѓРїРµРЅ)
const testProducts = [
  { product_id: 1, product_name: "РљРѕС„Рµ", menu_category_name: "РќР°РїРёС‚РєРё" },
  { product_id: 2, product_name: "РљСЂСѓР°СЃСЃР°РЅ", menu_category_name: "Р’С‹РїРµС‡РєР°" },
  { product_id: 3, product_name: "РЎСЌРЅРґРІРёС‡", menu_category_name: "Р—Р°РєСѓСЃРєРё" },
];

// рџ“Ґ API endpoint РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ СЃРїРёСЃРєР° РїСЂРѕРґСѓРєС‚РѕРІ (РґР»СЏ С„СЂРѕРЅС‚РµРЅРґР°)
app.get("/api/products", async (req, res) => {
  try {
    const products = await getPosterProducts();
    
    if (products.length > 0) {
      console.log("РџСЂРёРјРµСЂ РїСЂРѕРґСѓРєС‚Р° РёР· Poster:", JSON.stringify(products[0], null, 2));
    }
    
    if (products.length === 0) {
      console.log("вљ пёЏ Poster API РІРµСЂРЅСѓР» РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚, РёСЃРїРѕР»СЊР·СѓРµРј С‚РµСЃС‚РѕРІС‹Рµ РґР°РЅРЅС‹Рµ");
      return res.json(testProducts);
    }
    
    res.json(products);
  } catch (error) {
    console.error("РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё РїСЂРѕРґСѓРєС‚РѕРІ:", error);
    res.status(500).json({ error: "РћС€РёР±РєР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ РґР°РЅРЅС‹С…" });
  }
});

// рџ“¤ API endpoint РґР»СЏ РІС‹РіСЂСѓР·РєРё РІ Google Sheets
app.get("/api/upload-to-sheets", async (req, res) => {
  try {
    const products = await getPosterProducts();
    const dataToUpload = products.length > 0 ? products : testProducts;
    
    await writeProductsToSheet(dataToUpload);
    res.json({ 
      success: true, 
      message: "вњ… Р”Р°РЅРЅС‹Рµ СѓСЃРїРµС€РЅРѕ РІС‹РіСЂСѓР¶РµРЅС‹ РІ Google Sheets!",
      count: dataToUpload.length
    });
  } catch (error) {
    console.error("РћС€РёР±РєР° РїСЂРё РІС‹РіСЂСѓР·РєРµ РІ Google Sheets:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// рџ“¦ API endpoint РґР»СЏ РІС‹РіСЂСѓР·РєРё Р’РЎР•РҐ РїРѕР·РёС†РёР№ (РїСЂРѕРґСѓРєС‚С‹ + РёРЅРіСЂРµРґРёРµРЅС‚С‹)
app.get("/api/upload-all-to-sheets", async (req, res) => {
  try {
    const allItems = await getAllPosterItems();
    
    if (allItems.length === 0) {
      console.log("вљ пёЏ РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РґР°РЅРЅС‹Рµ РёР· Poster");
      return res.json({ 
        success: false, 
        message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РґР°РЅРЅС‹Рµ РёР· Poster" 
      });
    }
    
    await writeProductsToSheet(allItems);
    res.json({ 
      success: true, 
      message: "вњ… Р’СЃРµ РїРѕР·РёС†РёРё (РїСЂРѕРґСѓРєС‚С‹ + РёРЅРіСЂРµРґРёРµРЅС‚С‹) СѓСЃРїРµС€РЅРѕ РІС‹РіСЂСѓР¶РµРЅС‹ РІ Google Sheets!",
      count: allItems.length
    });
  } catch (error) {
    console.error("РћС€РёР±РєР° РїСЂРё РІС‹РіСЂСѓР·РєРµ РІСЃРµС… РїРѕР·РёС†РёР№ РІ Google Sheets:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// рџ†• рџ“– Р§РРўРђРќРќРЇ Р”РђРќРРҐ Р— GOOGLE SHEETS (РґР»СЏ С–РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–С—)
app.get("/api/inventory/products", async (req, res) => {
  try {
    const { date } = req.query;
    
    // РЇРєС‰Рѕ РїРµСЂРµРґР°РЅР° РґР°С‚Р°, РїРµСЂРµРІС–СЂСЏС”РјРѕ С‡Рё С” РІР¶Рµ С–РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–СЏ Р·Р° С†СЋ РґР°С‚Сѓ
    if (date) {
      const exists = await checkInventorySheetExists(date);
      
      if (exists) {
        // Р—Р°РІР°РЅС‚Р°Р¶СѓС”РјРѕ РґР°РЅС– Р· С–СЃРЅСѓСЋС‡РѕРіРѕ Р°СЂРєСѓС€Р°
        const inventoryData = await readInventorySheetData(date);
        
        if (inventoryData) {
          // Р“СЂСѓРїСѓС”РјРѕ РїРѕ С…РѕР»РѕРґРёР»СЊРЅРёРєР°С…
          const fridges = {};
          
          inventoryData.forEach(product => {
            const fridgeNum = product.fridge || "Р‘РµР· С…РѕР»РѕРґРёР»СЊРЅРёРєР°";
            
            if (!fridges[fridgeNum]) {
              fridges[fridgeNum] = [];
            }
            
            fridges[fridgeNum].push({
              name: product.name,
              category: product.category,
              type: product.type,
              unit: product.unit || "РєРі",
              currentQuantity: product.quantity || 0,
              savedQuantity: product.quantity || "", // Р—Р±РµСЂРµР¶РµРЅР° РєС–Р»СЊРєС–СЃС‚СЊ
              rowIndex: product.rowIndex
            });
          });
          
          const result = Object.keys(fridges).map(fridgeNum => ({
            fridgeNumber: fridgeNum,
            products: fridges[fridgeNum]
          }));
          
          console.log(`рџ“‹ Р’С–РґРїСЂР°РІР»РµРЅРѕ РґР°РЅС– С–СЃРЅСѓСЋС‡РѕС— С–РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–С— Р·Р° ${date}`);
          return res.json({ 
            data: result, 
            existingInventory: true,
            date 
          });
        }
      }
    }
    
    // РЇРєС‰Рѕ РЅРµРјР°С” С–СЃРЅСѓСЋС‡РѕС— С–РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–С—, Р·Р°РІР°РЅС‚Р°Р¶СѓС”РјРѕ Р· РіРѕР»РѕРІРЅРѕРіРѕ Р°СЂРєСѓС€Р°
    const products = await readProductsFromSheet();
    
    const fridges = {};
    
    products.forEach(product => {
      const fridgeNum = product.fridge || "Р‘РµР· С…РѕР»РѕРґРёР»СЊРЅРёРєР°";
      
      if (!fridges[fridgeNum]) {
        fridges[fridgeNum] = [];
      }
      
      fridges[fridgeNum].push({
        name: product.name,
        category: product.category,
        type: product.type,
        unit: product.unit || "РєРі",
        currentQuantity: product.quantity || 0,
        savedQuantity: "", // РќРµРјР°С” Р·Р±РµСЂРµР¶РµРЅРѕС— РєС–Р»СЊРєРѕСЃС‚С–
        rowIndex: product.rowIndex
      });
    });
    
    const result = Object.keys(fridges).map(fridgeNum => ({
      fridgeNumber: fridgeNum,
      products: fridges[fridgeNum]
    }));
    
    console.log(`рџ“‹ Р’С–РґРїСЂР°РІР»РµРЅРѕ РґР°РЅС– РїРѕ ${result.length} С…РѕР»РѕРґРёР»СЊРЅРёРєР°С…`);
    res.json({ 
      data: result, 
      existingInventory: false 
    });
  } catch (error) {
    console.error("вќЊ РџРѕРјРёР»РєР° РїСЂРё С‡РёС‚Р°РЅРЅС– РґР°РЅРёС… РґР»СЏ С–РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–С—:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// рџ†• рџ’ѕ Р—РђРџРРЎ Р—РђР›РРЁРљР†Р’ Р’ GOOGLE SHEETS (РќРћР’РР™ РђР РљРЈРЁ)
app.post("/api/inventory/save", async (req, res) => {
  try {
    const { inventoryData, inventoryDate } = req.body;
    
    if (!inventoryData || !Array.isArray(inventoryData)) {
      return res.status(400).json({ 
        success: false, 
        error: "РќРµРІС–СЂРЅРёР№ С„РѕСЂРјР°С‚ РґР°РЅРёС…" 
      });
    }
    
    if (!inventoryDate) {
      return res.status(400).json({ 
        success: false, 
        error: "РќРµ РІРєР°Р·Р°РЅР° РґР°С‚Р° С–РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–С—" 
      });
    }
    
    // РЎС‚РІРѕСЂСЋС”РјРѕ РЅРѕРІРёР№ Р°СЂРєСѓС€ (РІС–РЅ Р°РІС‚РѕРјР°С‚РёС‡РЅРѕ СЃРєРѕРїС–СЋС” РІСЃС– Р·Р°РіРѕР»РѕРІРєРё Р· Р›РёСЃС‚1)
    const sheetName = await createInventorySheet(inventoryDate);
    
    // Р“РѕС‚СѓС”РјРѕ РґР°РЅС– РїРѕ С…РѕР»РѕРґРёР»СЊРЅРёРєР°С… (РЅРµ СЃСѓРјСѓС”РјРѕ!)
    const inventoryByFridge = {};
    
    inventoryData.forEach(fridge => {
      inventoryByFridge[fridge.fridgeNumber] = fridge.products.map(p => ({
        name: p.name,
        quantity: p.quantity
      }));
    });
    
    // Р—Р°РїРёСЃСѓС”РјРѕ РІ РЅРѕРІРёР№ Р°СЂРєСѓС€ (СЃРёСЃС‚РµРјР° СЃР°РјР° Р·РЅР°Р№РґРµ РєРѕР»РѕРЅРєРё С…РѕР»РѕРґРёР»СЊРЅРёРєС–РІ)
    await writeQuantitiesToInventorySheet(sheetName, inventoryByFridge);
    
    res.json({ 
      success: true, 
      message: `вњ… Р†РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–СЋ СѓСЃРїС–С€РЅРѕ Р·Р±РµСЂРµР¶РµРЅРѕ РІ Р°СЂРєСѓС€ "${sheetName}"!`,
      sheetName
    });
  } catch (error) {
    console.error("вќЊ РџРѕРјРёР»РєР° РїСЂРё Р·Р±РµСЂРµР¶РµРЅРЅС– Р·Р°Р»РёС€РєС–РІ:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// рџЏ  Р“Р»Р°РІРЅР°СЏ СЃС‚СЂР°РЅРёС†Р°
app.get("/", (req, res) => {
  res.send(`
    вњ… РЎРµСЂРІРµСЂ РїСЂР°С†СЋС”!<br><br>
    Р”РѕСЃС‚СѓРїРЅС– endpoints:<br>
    - GET /api/products - РѕС‚СЂРёРјР°С‚Рё РїСЂРѕРґСѓРєС‚Рё Р· Poster<br>
    - GET /api/upload-to-sheets - Р·Р°РІР°РЅС‚Р°Р¶РёС‚Рё РїСЂРѕРґСѓРєС‚Рё РІ Sheets<br>
    - GET /api/upload-all-to-sheets - Р·Р°РІР°РЅС‚Р°Р¶РёС‚Рё РІСЃС– РїРѕР·РёС†С–С— РІ Sheets<br>
    - GET /api/inventory/products - РѕС‚СЂРёРјР°С‚Рё РїСЂРѕРґСѓРєС‚Рё РґР»СЏ С–РЅРІРµРЅС‚Р°СЂРёР·Р°С†С–С— (РїРѕ С…РѕР»РѕРґРёР»СЊРЅРёРєР°С…)<br>
    - POST /api/inventory/save - Р·Р±РµСЂРµРіС‚Рё Р·Р°Р»РёС€РєРё РІ Google Sheets
  `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`рџљЂ РЎРµСЂРІРµСЂ Р·Р°РїСѓС‰РµРЅРёР№ РЅР° РїРѕСЂС‚Сѓ ${PORT}`));
