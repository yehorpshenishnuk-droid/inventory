import express from "express";
import cors from "cors";
import { 
  readProductsFromSheet, 
  createInventorySheet,
  writeQuantitiesToInventorySheet,
  readInventorySheetData,
  checkInventorySheetExists
} from "./googleSheets.js";
import { getPosterProducts } from "./poster.js";

const app = express();
app.use(cors());
app.use(express.json());

// 🆕 ЧИТАННЯ ДАНИХ (ВИПРАВЛЕНО)
app.get("/api/inventory/products", async (req, res) => {
  try {
    const { date } = req.query;
    let rawProducts = [];
    let isExisting = false;

    if (date) {
      const exists = await checkInventorySheetExists(date);
      if (exists) {
        rawProducts = await readInventorySheetData(date);
        if (rawProducts) isExisting = true;
      }
    }
    
    // Якщо немає інвентаризації, беремо шаблон
    if (!rawProducts || rawProducts.length === 0) {
      rawProducts = await readProductsFromSheet();
      isExisting = false;
    }
    
    // Групування
    const fridges = {};
    
    rawProducts.forEach(product => {
      const fridgeNum = product.fridge || "Без холодильника";
      if (!fridges[fridgeNum]) fridges[fridgeNum] = [];
      
      fridges[fridgeNum].push({
        name: product.name,
        category: product.category,
        type: product.type,
        unit: product.unit || "кг",
        // ВАЖЛИВО: якщо quantity пусте або null, передаємо "", а не 0
        savedQuantity: (product.quantity === undefined || product.quantity === null) ? "" : product.quantity,
        rowIndex: product.rowIndex
      });
    });
    
    const result = Object.keys(fridges).map(fridgeNum => ({
      fridgeNumber: fridgeNum,
      products: fridges[fridgeNum]
    }));
    
    console.log(`📋 Відправлено дані (${isExisting ? 'з збереженої копії' : 'новий шаблон'})`);
    res.json({ 
      data: result, 
      existingInventory: isExisting,
      date 
    });
    
  } catch (error) {
    console.error("❌ Помилка:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🆕 ЗБЕРЕЖЕННЯ
app.post("/api/inventory/save", async (req, res) => {
  try {
    const { inventoryData, inventoryDate } = req.body;
    
    if (!inventoryDate) return res.status(400).json({ error: "Не вказана дата" });
    
    // Створюємо (або отримуємо існуючий) аркуш. Тепер він буде чистим від "фантомів"
    const sheetName = await createInventorySheet(inventoryDate);
    
    // Готуємо дані
    const inventoryByFridge = {};
    inventoryData.forEach(fridge => {
      inventoryByFridge[fridge.fridgeNumber] = fridge.products.map(p => ({
        name: p.name,
        quantity: p.quantity // Передаємо як є (навіть якщо це рядок)
      }));
    });
    
    await writeQuantitiesToInventorySheet(sheetName, inventoryByFridge);
    
    res.json({ 
      success: true, 
      message: `✅ Збережено!`, 
      sheetName 
    });
  } catch (error) {
    console.error("❌ Помилка збереження:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ... (Інші роути залишаємо без змін: api/products, upload-to-sheets і т.д.)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер запущений на порту ${PORT}`));
