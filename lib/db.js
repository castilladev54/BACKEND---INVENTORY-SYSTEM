import mongoose from "mongoose";

// ─── Singleton: Persiste la conexión entre warm-starts de Vercel ─────────────
let isConnected = false;

/**
 * Conecta a MongoDB usando Singleton Pattern.
 * Reutiliza la conexión existente en entornos Serverless (Vercel).
 */
export const connectDB = async () => {
  // 1. Reutilizar conexión cacheada → 0ms de latencia extra
  if (isConnected) {
    console.log("♻️  Usando conexión de base de datos cacheada");
    return;
  }

  // 2. Guardia: falla rápido y claro si falta la variable de entorno
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI no está definida en las variables de entorno");
  }

  const isProduction = process.env.NODE_ENV === "production";

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Fix #1 — autoIndex desactivado en producción para evitar bloqueos
      // en colecciones grandes. En desarrollo sigue activo por comodidad.
      autoIndex: !isProduction,

      // Fix #2 — Pool limitado a 10 por función.
      // Protege el cluster Atlas Free (50 conexiones máx.) ante picos de tráfico.
      maxPoolSize: 10,
    });

    // Fix #3 — Booleano explícito, nunca depender del valor numérico de readyState
    isConnected = true;
    console.log(`✅ MongoDB conectado: ${conn.connection.host}`);

    // Fix #4 — Listeners que resetean el flag si la conexión cae
    // Así la próxima llamada a connectDB intentará reconectar correctamente
    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️  MongoDB desconectado. Se reconectará en la próxima petición.");
      isConnected = false;
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ Error en la conexión de MongoDB:", err.message);
      isConnected = false;
    });

  } catch (error) {
    console.error("❌ Error al conectar con MongoDB:", error.message);

    // En Serverless no matamos el proceso: dejamos que la función muera sola
    // y que Vercel la reinicie. En local sí salimos para detectar el fallo.
    if (!isProduction && !process.env.VERCEL) {
      process.exit(1);
    }

    // Propagamos el error al middleware de server.js para responder al cliente
    throw error;
  }
};