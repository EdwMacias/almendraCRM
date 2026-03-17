import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { query, withTransaction } from "./db.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDir, "../../../.env") });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const authUser = String(process.env.user || "").trim();
const authPassword = String(process.env.password || "").trim();
const jwtSecret = String(process.env.JWT_SECRET || "").trim();

if (!authUser || !authPassword) {
  throw new Error("Debes definir user y password en el archivo .env");
}

if (!jwtSecret) {
  throw new Error("Debes definir JWT_SECRET en el archivo .env");
}

const passwordSalt = crypto.createHash("sha256").update(`${authUser}:crm-auth-salt`).digest("hex");
const passwordHash = crypto.scryptSync(authPassword, passwordSalt, 64).toString("hex");
const tokenTtlSeconds = 60 * 60 * 8;

app.use(cors());
app.use(express.json());

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const inventorySchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(2),
  unit: z.string().min(1).default("unidad"),
  stock: z.number().int().min(0)
});

const inventoryUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  sku: z.string().min(2).optional(),
  unit: z.string().min(1).optional(),
  stock: z.number().int().min(0).optional()
}).refine((payload) => Object.keys(payload).length > 0, {
  message: "Debes enviar al menos un campo para actualizar"
});

const componentSchema = z.object({
  inventoryItemId: z.number().int().positive(),
  quantity: z.number().int().positive()
});

const productSchema = z.object({
  name: z.string().min(2),
  type: z.enum(["kit", "preparado"]).default("kit"),
  notes: z.string().optional().default(""),
  components: z.array(componentSchema).min(1)
});

const orderSchema = z.object({
  customerName: z.string().min(2),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive()
  })).min(1)
});

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  return Buffer.from(normalized, "base64").toString("utf8");
}

function createToken(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac("sha256", jwtSecret)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${data}.${signature}`;
}

function verifyToken(token) {
  const [encodedHeader, encodedPayload, signature] = String(token || "").split(".");

  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Token invalido");
  }

  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac("sha256", jwtSecret)
    .update(data)
    .digest();
  const providedSignature = Buffer.from(
    signature.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(signature.length / 4) * 4, "="),
    "base64"
  );

  if (
    providedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error("Firma invalida");
  }

  const payload = JSON.parse(fromBase64Url(encodedPayload));

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expirado");
  }

  return payload;
}

function verifyPassword(candidatePassword) {
  const candidateHash = crypto.scryptSync(candidatePassword, passwordSalt, 64).toString("hex");
  const candidateBuffer = Buffer.from(candidateHash, "hex");
  const expectedBuffer = Buffer.from(passwordHash, "hex");

  return (
    candidateBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

function requireAuth(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Sesion requerida" });
    }

    const token = authorization.slice("Bearer ".length);
    req.auth = verifyToken(token);
    next();
  } catch (_error) {
    return res.status(401).json({ message: "Sesion invalida o expirada" });
  }
}

async function getProductsWithComponents(client = { query }) {
  const db = client.query ? client : { query };
  const { rows } = await db.query(`
    SELECT
      p.id,
      p.name,
      p.type,
      p.notes,
      COALESCE(
        json_agg(
          json_build_object(
            'id', pc.id,
            'inventoryItemId', i.id,
            'inventoryItemName', i.name,
            'inventoryItemSku', i.sku,
            'quantity', pc.quantity,
            'unit', i.unit
          )
        ) FILTER (WHERE pc.id IS NOT NULL),
        '[]'
      ) AS components
    FROM products p
    LEFT JOIN product_components pc ON pc.product_id = p.id
    LEFT JOIN inventory_items i ON i.id = pc.inventory_item_id
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
  `);

  return rows;
}

async function getProductionPlan(client = { query }) {
  const db = client.query ? client : { query };
  const pendingOrders = await db.query(`
    SELECT
      oi.product_id,
      p.name AS product_name,
      SUM(oi.quantity) AS total_quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.status = 'pendiente'
    GROUP BY oi.product_id, p.name
    ORDER BY p.name
  `);

  const materialNeeds = await db.query(`
    SELECT
      i.id AS inventory_item_id,
      i.name AS inventory_item_name,
      i.sku,
      i.unit,
      i.stock AS current_stock,
      SUM(oi.quantity * pc.quantity) AS required_quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN product_components pc ON pc.product_id = oi.product_id
    JOIN inventory_items i ON i.id = pc.inventory_item_id
    WHERE o.status = 'pendiente'
    GROUP BY i.id
    ORDER BY i.name
  `);

  const shortages = materialNeeds.rows
    .filter((item) => Number(item.required_quantity) > Number(item.current_stock))
    .map((item) => ({
      ...item,
      missingQuantity: Number(item.required_quantity) - Number(item.current_stock)
    }));

  return {
    products: pendingOrders.rows.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      totalQuantity: Number(item.total_quantity)
    })),
    materials: materialNeeds.rows.map((item) => ({
      inventoryItemId: item.inventory_item_id,
      inventoryItemName: item.inventory_item_name,
      sku: item.sku,
      unit: item.unit,
      currentStock: Number(item.current_stock),
      requiredQuantity: Number(item.required_quantity)
    })),
    shortages
  };
}

app.get("/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);

    if (payload.username !== authUser || !verifyPassword(payload.password)) {
      return res.status(401).json({ message: "Usuario o contrasena incorrectos" });
    }

    const token = createToken({
      sub: authUser,
      exp: Math.floor(Date.now() / 1000) + tokenTtlSeconds
    });

    res.json({
      token,
      user: authUser,
      expiresIn: tokenTtlSeconds
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/session", requireAuth, async (req, res) => {
  res.json({
    authenticated: true,
    user: req.auth.sub,
    exp: req.auth.exp
  });
});

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const [inventory, orders, production, products] = await Promise.all([
      query("SELECT COUNT(*)::int AS total_items, COALESCE(SUM(stock), 0)::int AS total_stock FROM inventory_items"),
      query("SELECT COUNT(*)::int AS total_orders, COUNT(*) FILTER (WHERE status = 'pendiente')::int AS pending_orders FROM orders"),
      getProductionPlan(),
      query("SELECT COUNT(*)::int AS total_products FROM products")
    ]);

    res.json({
      inventory: inventory.rows[0],
      orders: orders.rows[0],
      products: products.rows[0],
      production: {
        pendingProducts: production.products.length,
        pendingMaterials: production.materials.length,
        shortages: production.shortages.length
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory", async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT id, name, sku, unit, stock, created_at
      FROM inventory_items
      ORDER BY created_at DESC, id DESC
    `);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/inventory", requireAuth, async (req, res, next) => {
  try {
    const payload = inventorySchema.parse(req.body);
    const { rows } = await query(`
      INSERT INTO inventory_items (name, sku, unit, stock)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, sku, unit, stock, created_at
    `, [payload.name, payload.sku, payload.unit, payload.stock]);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/inventory/:id", requireAuth, async (req, res, next) => {
  try {
    const inventoryId = Number(req.params.id);

    if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
      return res.status(400).json({ message: "Id de inventario invalido" });
    }

    const result = await query(`
      DELETE FROM inventory_items
      WHERE id = $1
      RETURNING id
    `, [inventoryId]);

    if (!result.rows.length) {
      return res.status(404).json({ message: "Insumo no encontrado" });
    }

    res.json({ deleted: true, id: inventoryId });
  } catch (error) {
    next(error);
  }
});

app.put("/api/inventory/:id", requireAuth, async (req, res, next) => {
  try {
    const inventoryId = Number(req.params.id);

    if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
      return res.status(400).json({ message: "Id de inventario invalido" });
    }

    const payload = inventoryUpdateSchema.parse(req.body);
    const currentResult = await query(`
      SELECT id, name, sku, unit, stock, created_at
      FROM inventory_items
      WHERE id = $1
    `, [inventoryId]);

    if (!currentResult.rows.length) {
      return res.status(404).json({ message: "Insumo no encontrado" });
    }

    const currentItem = currentResult.rows[0];
    const updatedValues = {
      name: payload.name ?? currentItem.name,
      sku: payload.sku ?? currentItem.sku,
      unit: payload.unit ?? currentItem.unit,
      stock: payload.stock ?? currentItem.stock
    };

    const result = await query(`
      UPDATE inventory_items
      SET name = $1, sku = $2, unit = $3, stock = $4
      WHERE id = $5
      RETURNING id, name, sku, unit, stock, created_at
    `, [updatedValues.name, updatedValues.sku, updatedValues.unit, updatedValues.stock, inventoryId]);

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get("/api/products", async (_req, res, next) => {
  try {
    res.json(await getProductsWithComponents());
  } catch (error) {
    next(error);
  }
});

app.post("/api/products", requireAuth, async (req, res, next) => {
  try {
    const payload = productSchema.parse(req.body);
    const product = await withTransaction(async (client) => {
      const createdProduct = await client.query(`
        INSERT INTO products (name, type, notes)
        VALUES ($1, $2, $3)
        RETURNING id, name, type, notes, created_at
      `, [payload.name, payload.type, payload.notes]);

      for (const component of payload.components) {
        await client.query(`
          INSERT INTO product_components (product_id, inventory_item_id, quantity)
          VALUES ($1, $2, $3)
        `, [createdProduct.rows[0].id, component.inventoryItemId, component.quantity]);
      }

      return createdProduct.rows[0];
    });

    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders", async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        o.id,
        o.customer_name,
        o.status,
        o.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id,
              'productId', p.id,
              'productName', p.name,
              'quantity', oi.quantity
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      GROUP BY o.id
      ORDER BY o.created_at DESC, o.id DESC
    `);

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", requireAuth, async (req, res, next) => {
  try {
    const payload = orderSchema.parse(req.body);
    const createdOrder = await withTransaction(async (client) => {
      const orderResult = await client.query(`
        INSERT INTO orders (customer_name)
        VALUES ($1)
        RETURNING id, customer_name, status, created_at
      `, [payload.customerName]);

      for (const item of payload.items) {
        await client.query(`
          INSERT INTO order_items (order_id, product_id, quantity)
          VALUES ($1, $2, $3)
        `, [orderResult.rows[0].id, item.productId, item.quantity]);
      }

      return orderResult.rows[0];
    });

    res.status(201).json(createdOrder);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/orders/:id", requireAuth, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ message: "Id de pedido invalido" });
    }

    const result = await query(`
      DELETE FROM orders
      WHERE id = $1
      RETURNING id
    `, [orderId]);

    if (!result.rows.length) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    res.json({ deleted: true, id: orderId });
  } catch (error) {
    next(error);
  }
});

app.get("/api/production/plan", async (_req, res, next) => {
  try {
    res.json(await getProductionPlan());
  } catch (error) {
    next(error);
  }
});

app.post("/api/production/execute", requireAuth, async (req, res, next) => {
  try {
    const { notes = "Ejecucion manual desde la interfaz" } = req.body || {};

    const result = await withTransaction(async (client) => {
      const plan = await getProductionPlan(client);

      if (!plan.products.length) {
        return { executed: false, message: "No hay pedidos pendientes para procesar." };
      }

      if (plan.shortages.length) {
        return {
          executed: false,
          message: "No hay stock suficiente para ejecutar la produccion.",
          shortages: plan.shortages
        };
      }

      const productionRun = await client.query(`
        INSERT INTO production_runs (notes)
        VALUES ($1)
        RETURNING id, created_at
      `, [notes]);

      for (const product of plan.products) {
        await client.query(`
          INSERT INTO production_run_items (production_run_id, product_id, total_quantity)
          VALUES ($1, $2, $3)
        `, [productionRun.rows[0].id, product.productId, product.totalQuantity]);
      }

      for (const material of plan.materials) {
        await client.query(`
          UPDATE inventory_items
          SET stock = stock - $1
          WHERE id = $2
        `, [material.requiredQuantity, material.inventoryItemId]);
      }

      await client.query(`
        UPDATE orders
        SET status = 'procesado'
        WHERE status = 'pendiente'
      `);

      return {
        executed: true,
        runId: productionRun.rows[0].id,
        processedProducts: plan.products,
        consumedMaterials: plan.materials
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      message: "Payload invalido",
      issues: error.issues
    });
  }

  if (error.code === "23505") {
    return res.status(409).json({ message: "Registro duplicado" });
  }

  if (error.code === "23503") {
    return res.status(409).json({ message: "No se puede borrar porque el registro esta en uso" });
  }

  res.status(500).json({
    message: "Error interno del servidor",
    detail: error.message
  });
});

app.listen(port, () => {
  console.log(`API activa en http://localhost:${port}`);
});
