import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { sanitizeNoSQL } from "./middleware/sanitize.js";
import hpp from "hpp";
import authRoutes from "./routes/auth.route.js";
import categoryRoutes from "./routes/category.route.js";
import productRoutes from "./routes/product.route.js";
import purchaseRoutes from "./routes/purchase.route.js";
import saleRoutes from "./routes/sale.route.js";
import adjustmentRoutes from "./routes/adjustment.route.js";
import aiRoutes from "./routes/ai.route.js";
import { verifyToken } from "./middleware/verifyToken.js";
import { checkSubscription } from "./middleware/checkSubscription.js";

import cookieParser from "cookie-parser";
import path from "path";

import { connectDB } from "./lib/db.js";
import { globalLimiter, authLimiter } from "./middleware/rateLimiter.js";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.resolve();

// ─── Security Middleware ──────────────────────────────────────
app.use(helmet());
app.use(sanitizeNoSQL);
app.use(hpp());
app.use(globalLimiter);

// ─── Body Parsing ─────────────────────────────────────────────
app.use(cors({ origin: [process.env.CLIENT_URL, "https://dasboard-react-tailwindcss.vercel.app", "http://localhost:5173"].filter(Boolean), credentials: true }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());

// Health Check Endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Root Route
app.get("/", (req, res) => {
  res.send("<h1>🚀 API del Sistema de Inventario Funcionando</h1><p>Versión 1.0.0</p>");
});

// ─── Routes ───────────────────────────────────────────────────
// Auth routes are public (login, signup, etc.)
app.use("/api/auth", authLimiter, authRoutes);

import { errorHandler } from "./middleware/errorHandler.js";

// Protected routes — require authentication
app.use("/api/categories", verifyToken, checkSubscription, categoryRoutes);
app.use("/api/products", verifyToken, checkSubscription, productRoutes);
app.use("/api/purchases", verifyToken, checkSubscription, purchaseRoutes);
app.use("/api/sales", verifyToken, checkSubscription, saleRoutes);
app.use("/api/adjustments", verifyToken, checkSubscription, adjustmentRoutes);
app.use("/api/ai", verifyToken, checkSubscription, aiRoutes);

// Manejador central de errores (siempre al final de las rutas)
app.use(errorHandler);


if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "/frontend/dist")));

  app.use((req, res) => {
    res.sendFile(path.resolve(__dirname, "frontend", "dist", "index.html"));
  });
}

// ─── Startup ───────────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  connectDB(); // Se conecta a la BD incluso en Vercel
}

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log("Server is running on port http://localhost:" + PORT);
  });
}

export default app;
