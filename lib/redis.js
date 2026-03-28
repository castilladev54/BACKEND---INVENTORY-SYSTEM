import { Redis } from "@upstash/redis";
import dotenv from "dotenv";

dotenv.config();

// ─── Cliente Upstash Redis ────────────────────────────────────
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// TTL por defecto: 1 hora (en segundos)
const DEFAULT_TTL = 3600;

/**
 * Obtiene datos del caché o ejecuta la función y guarda el resultado.
 * @param {string} key   - Clave del caché (ej: "categories:userId123")
 * @param {Function} fn  - Función async que obtiene datos de MongoDB
 * @param {number} ttl   - Tiempo de vida en segundos (default: 1 hora)
 * @returns {Object}     - { data, fromCache }
 */
export const getOrSetCache = async (key, fn, ttl = DEFAULT_TTL) => {
  try {
    // 1. Intentar obtener del caché
    const cached = await redis.get(key);
    if (cached) {
      return { data: cached, fromCache: true };
    }

    // 2. Si no existe, ejecutar la función (consulta a MongoDB)
    const freshData = await fn();

    // 3. Guardar en caché con TTL
    await redis.set(key, JSON.stringify(freshData), { ex: ttl });

    return { data: freshData, fromCache: false };
  } catch (error) {
    // Si Redis falla, no romper la app — simplemente consultar MongoDB
    console.error("Redis cache error:", error.message);
    const freshData = await fn();
    return { data: freshData, fromCache: false };
  }
};

/**
 * Invalida (elimina) una o varias claves del caché.
 * @param {string[]} keys - Claves a invalidar
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
