const express = require("express");
const sql = require("mssql");
const app = express();

// Configuración desde variables de ambiente
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: true
  }
};

// Endpoint para leer tblReleasedBOMs
app.get("/tblReleasedBOMs", async (req, res) => {
  try {
    const pool = await sql.connect(config);

    const result = await pool.request().query(`
      SELECT *
      FROM tblReleasedBOMs
    `);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// Listar todos los productos únicos (para el dropdown en Lovable)
app.get("/products", async (req, res) => {
  try {
    const pool = await sql.connect(config);

    const result = await pool.request().query(`
      SELECT DISTINCT LTRIM(RTRIM(szProductGlobalName)) AS product
      FROM tblReleasedBOMs
    `);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// Obtener detalle del producto (BOM + MM60 + costos)
app.get("/recipe/:product", async (req, res) => {
  const productParam = req.params.product.trim();

  try {
    const pool = await sql.connect(config);

    // 1. Buscar materiales del producto
    const bomQuery = await pool.request()
      .input("product", sql.VarChar, productParam)
      .query(`
        SELECT 
          szProductGlobalName,
          szMaterialGlobalName,
          szMaterialName,
          nSetpoint,
          szUnit
        FROM tblReleasedBOMs
        WHERE LTRIM(RTRIM(szProductGlobalName)) = @product
      `);

    const bomItems = bomQuery.recordset;

    if (bomItems.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado en BOMs" });
    }

    // 2. Buscar precios por material en MM60
    let materials = [];

    for (let item of bomItems) {
      const materialCode = item.szMaterialName.trim();

      const mm60 = await pool.request()
        .input("code", sql.VarChar, materialCode)
        .query(`
          SELECT PREIS, MAKTX, MEINS 
          FROM MM60
          WHERE MATNR LIKE '%' + @code
        `);

      const mm = mm60.recordset[0];

      const unitPrice = mm ? mm.PREIS : 0;
      const totalCost = unitPrice * item.nSetpoint;

      materials.push({
        material: item.szMaterialGlobalName.trim(),
        materialCode: materialCode,
        setpoint: item.nSetpoint,
        unit: item.szUnit.trim(),
        unitPrice: unitPrice,
        totalCost: Number(totalCost.toFixed(4))
      });
    }

    // 3. Costo total de la receta
    const recipeTotalCost = materials.reduce((sum, m) => sum + m.totalCost, 0);

    res.json({
      product: productParam,
      materials,
      recipeTotalCost
    });

  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});


app.listen(3000, () => {
  console.log("API Costeo-Panovo MM60 corriendo en puerto 3000");
});
