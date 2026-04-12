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

const inFlightPromises = new Map();

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

    // 2. Cache Stampede Prevention: Si hay una promesa en vuelo, esperarla
    if (inFlightPromises.has(key)) {
      const freshData = await inFlightPromises.get(key);
      return { data: freshData, fromCache: false };
    }

    // 3. Miss: ejecutar la consulta a MongoDB guardando la promesa
    const promise = fn().then(async (freshData) => {
      // Guardar el objeto directamente
      await redis.set(key, freshData, { ex: ttl }).catch(err => console.error("Redis set error:", err.message));
      return freshData;
    }).finally(() => {
      inFlightPromises.delete(key);
    });

    inFlightPromises.set(key, promise);
    const freshData = await promise;

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
