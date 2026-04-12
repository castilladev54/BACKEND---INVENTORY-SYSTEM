// ⚠️ DEBE ser el primer import: carga .env antes que cualquier otro módulo
import "dotenv/config";

import { Redis } from "@upstash/redis";

// ─── Cliente Upstash Redis (Singleton) ───────────────────────────────────────
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// TTL por defecto: 1 hora (en segundos)
const DEFAULT_TTL = 3600;

/**
 * Obtiene datos del caché o ejecuta la función y guarda el resultado.
 * @param {string}   key        - Clave del caché (ej: "categories:userId123")
 * @param {Function} fn         - Función async que obtiene datos de MongoDB
 * @param {number}   [ttl=3600] - Tiempo de vida en segundos (default: 1 hora)
 * @returns {{ data: any, fromCache: boolean }}
 */
export const getOrSetCache = async (key, fn, ttl = DEFAULT_TTL) => {
  try {
    // 1. Intentar obtener del caché
    const cached = await redis.get(key);
    if (cached) {
      // Upstash deserializa automáticamente — no se necesita JSON.parse
      return { data: cached, fromCache: true };
    }

    // 2. Miss: ejecutar la consulta a MongoDB
    const freshData = await fn();

    // Fix — Guardar el objeto directamente, sin JSON.stringify.
    //        Upstash lo serializa internamente, evitando la doble serialización.
    await redis.set(key, freshData, { ex: ttl });

    return { data: freshData, fromCache: false };
  } catch (error) {
    // Fail-open: si Redis falla, no romper la app
    console.error("Redis cache error:", error.message);
    const freshData = await fn();
    return { data: freshData, fromCache: false };
  }
};

/**
 * Invalida (elimina) una o varias claves del caché.
 * @param {...string} keys - Claves a invalidar
 */
export const invalidateCache = async (...keys) => {
  try {
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error("Redis invalidation error:", error.message);
  }
};
