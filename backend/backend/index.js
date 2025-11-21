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

// 📦 Временные тестовые данные (если Poster API недоступен)
const testProducts = [
  { product_id: 1, product_name: "Кофе", menu_category_name: "Напитки" },
  { product_id: 2, product_name: "Круассан", menu_category_name: "Выпечка" },
  { product_id: 3, product_name: "Сэндвич", menu_category_name: "Закуски" },
];

// 📥 API endpoint для получения списка продуктов (для фронтенда)
app.get("/api/products", async (req, res) => {
  try {
    const products = await getPosterProducts();
    
    if (products.length > 0) {
      console.log("Пример продукта из Poster:", JSON.stringify(products[0], null, 2));
    }
    
    if (products.length === 0) {
      console.log("⚠️ Poster API вернул пустой ответ, используем тестовые данные");
      return res.json(testProducts);
    }
    
    res.json(products);
  } catch (error) {
    console.error("Ошибка при получении продуктов:", error);
    res.status(500).json({ error: "Ошибка при загрузке данных" });
  }
});

// 📤 API endpoint для выгрузки в Google Sheets
app.get("/api/upload-to-sheets", async (req, res) => {
  try {
    const products = await getPosterProducts();
    const dataToUpload = products.length > 0 ? products : testProducts;
    
    await writeProductsToSheet(dataToUpload);
    res.json({ 
      success: true, 
      message: "✅ Данные успешно выгружены в Google Sheets!",
      count: dataToUpload.length
    });
  } catch (error) {
    console.error("Ошибка при выгрузке в Google Sheets:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 📦 API endpoint для выгрузки ВСЕХ позиций (продукты + ингредиенты)
app.get("/api/upload-all-to-sheets", async (req, res) => {
  try {
    const allItems = await getAllPosterItems();
    
    if (allItems.length === 0) {
      console.log("⚠️ Не удалось получить данные из Poster");
      return res.json({ 
        success: false, 
        message: "Не удалось получить данные из Poster" 
      });
    }
    
    await writeProductsToSheet(allItems);
    res.json({ 
      success: true, 
      message: "✅ Все позиции (продукты + ингредиенты) успешно выгружены в Google Sheets!",
      count: allItems.length
    });
  } catch (error) {
    console.error("Ошибка при выгрузке всех позиций в Google Sheets:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 🆕 📖 ЧИТАННЯ ДАНИХ З GOOGLE SHEETS (для інвентаризації)
app.get("/api/inventory/products", async (req, res) => {
  try {
    const { date } = req.query;
    
    // Якщо передана дата, перевіряємо чи є вже інвентаризація за цю дату
    if (date) {
      const exists = await checkInventorySheetExists(date);
      
      if (exists) {
        // Завантажуємо дані з існуючого аркуша
        const inventoryData = await readInventorySheetData(date);
        
        if (inventoryData) {
          // Групуємо по холодильниках
          const fridges = {};
          
          inventoryData.forEach(product => {
            const fridgeNum = product.fridge || "Без холодильника";
            
            if (!fridges[fridgeNum]) {
              fridges[fridgeNum] = [];
            }
            
            fridges[fridgeNum].push({
              name: product.name,
              category: product.category,
              type: product.type,
              unit: product.unit || "кг",
              currentQuantity: product.quantity || 0,
              savedQuantity: product.quantity || "", // Збережена кількість
              rowIndex: product.rowIndex
            });
          });
          
          const result = Object.keys(fridges).map(fridgeNum => ({
            fridgeNumber: fridgeNum,
            products: fridges[fridgeNum]
          }));
          
          console.log(`📋 Відправлено дані існуючої інвентаризації за ${date}`);
          return res.json({ 
            data: result, 
            existingInventory: true,
            date 
          });
        }
      }
    }
    
    // Якщо немає існуючої інвентаризації, завантажуємо з головного аркуша
    const products = await readProductsFromSheet();
    
    const fridges = {};
    
    products.forEach(product => {
      const fridgeNum = product.fridge || "Без холодильника";
      
      if (!fridges[fridgeNum]) {
        fridges[fridgeNum] = [];
      }
      
      fridges[fridgeNum].push({
        name: product.name,
        category: product.category,
        type: product.type,
        unit: product.unit || "кг",
        currentQuantity: product.quantity || 0,
        savedQuantity: "", // Немає збереженої кількості
        rowIndex: product.rowIndex
      });
    });
    
    const result = Object.keys(fridges).map(fridgeNum => ({
      fridgeNumber: fridgeNum,
      products: fridges[fridgeNum]
    }));
    
    console.log(`📋 Відправлено дані по ${result.length} холодильниках`);
    res.json({ 
      data: result, 
      existingInventory: false 
    });
  } catch (error) {
    console.error("❌ Помилка при читанні даних для інвентаризації:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 🆕 💾 ЗАПИС ЗАЛИШКІВ В GOOGLE SHEETS (НОВИЙ АРКУШ)
app.post("/api/inventory/save", async (req, res) => {
  try {
    const { inventoryData, inventoryDate } = req.body;
    
    if (!inventoryData || !Array.isArray(inventoryData)) {
      return res.status(400).json({ 
        success: false, 
        error: "Невірний формат даних" 
      });
    }
    
    if (!inventoryDate) {
      return res.status(400).json({ 
        success: false, 
        error: "Не вказана дата інвентаризації" 
      });
    }
    
    // Створюємо новий аркуш (він автоматично скопіює всі заголовки з Лист1)
    const sheetName = await createInventorySheet(inventoryDate);
    
    // Готуємо дані по холодильниках (не сумуємо!)
    const inventoryByFridge = {};
    
    inventoryData.forEach(fridge => {
      inventoryByFridge[fridge.fridgeNumber] = fridge.products.map(p => ({
        name: p.name,
        quantity: p.quantity
      }));
    });
    
    // Записуємо в новий аркуш (система сама знайде колонки холодильників)
    await writeQuantitiesToInventorySheet(sheetName, inventoryByFridge);
    
    res.json({ 
      success: true, 
      message: `✅ Інвентаризацію успішно збережено в аркуш "${sheetName}"!`,
      sheetName
    });
  } catch (error) {
    console.error("❌ Помилка при збереженні залишків:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 🏠 Главная страница
app.get("/", (req, res) => {
  res.send(`
    ✅ Сервер працює!<br><br>
    Доступні endpoints:<br>
    - GET /api/products - отримати продукти з Poster<br>
    - GET /api/upload-to-sheets - завантажити продукти в Sheets<br>
    - GET /api/upload-all-to-sheets - завантажити всі позиції в Sheets<br>
    - GET /api/inventory/products - отримати продукти для інвентаризації (по холодильниках)<br>
    - POST /api/inventory/save - зберегти залишки в Google Sheets
  `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер запущений на порту ${PORT}`));
