import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import hpp from "hpp";
import cookieParser from "cookie-parser";
import path from "path";
import mongoose from "mongoose";

// Configuraciones y Libs
import { connectDB } from "./lib/db.js";
import { sanitizeNoSQL } from "./middleware/sanitize.js";
import { globalLimiter, authLimiter } from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { verifyToken } from "./middleware/verifyToken.js";
import { checkSubscription } from "./middleware/checkSubscription.js";

// Rutas
import authRoutes from "./routes/auth.route.js";
import categoryRoutes from "./routes/category.route.js";
import productRoutes from "./routes/product.route.js";
import purchaseRoutes from "./routes/purchase.route.js";
import saleRoutes from "./routes/sale.route.js";
import adjustmentRoutes from "./routes/adjustment.route.js";
import aiRoutes from "./routes/ai.route.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.resolve();

// Confiar en el proxy de Vercel para rate limiting correcto
app.set('trust proxy', 1);

// 1. SEGURIDAD (Filtros de entrada)
app.use(helmet());
app.use(hpp());
app.use(sanitizeNoSQL);
app.use(globalLimiter);

// 2. CONFIGURACIÓN Y PARSING
app.use(cors({
  origin: [process.env.CLIENT_URL, "https://dashboard-react-tailwindcss.vercel.app", "http://localhost:5173"].filter(Boolean),
  credentials: true
}));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());

// 3. LAZY DB CONNECTION (para Vercel serverless: conectar antes de cada request si no está conectado)
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState === 0) {
    try {
      await connectDB();
    } catch (err) {
      return res.status(503).json({ success: false, message: "Service temporarily unavailable" });
    }
  }
  next();
});

// 4. RUTAS PÚBLICAS Y MONITOREO
app.get("/api/health", (req, res) => res.status(200).json({ status: "ok", uptime: process.uptime() }));

// Auth: Rate limit específico para evitar fuerza bruta
app.use("/api/auth", authLimiter, authRoutes);

// 4. RUTAS PROTEGIDAS (Middleware de flujo)
// Aplicamos el middleware a nivel de prefijo para no repetirlo en cada línea
const protectedRouter = express.Router();
protectedRouter.use(verifyToken, checkSubscription);

app.use("/api/categories", protectedRouter, categoryRoutes);
app.use("/api/products", protectedRouter, productRoutes);
app.use("/api/purchases", protectedRouter, purchaseRoutes);
app.use("/api/sales", protectedRouter, saleRoutes);
app.use("/api/adjustments", protectedRouter, adjustmentRoutes);
app.use("/api/ai", protectedRouter, aiRoutes);

// 5. FRONTEND (Producción local únicamente — en Vercel el frontend es una app separada)
if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, "/frontend/dist")));
  app.get(/(.*)/, (req, res) => {
    res.sendFile(path.resolve(__dirname, "frontend", "dist", "index.html"));
  });
}

// 6. MANEJO DE ERRORES (Debe ser el último)
app.use(errorHandler);
// 7. ARRANQUE CONTROLADO (Optimizado para Vercel)
const startApp = async () => {
  try {
    // En Vercel, es mejor que la conexión se gestione dentro de los handlers
    // pero para mantener tu estructura, solo llamamos a listen si NO es Vercel
    if (process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
      await connectDB();
      app.listen(PORT, () => {
        console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
      });
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("❌ Error fatal al iniciar:", error.message);
      process.exit(1);
    }
  }
};

startApp();

// IMPORTANTE: Exportar para Vercel
export default app; 

/** Testing de rutina los commit son adictivos */