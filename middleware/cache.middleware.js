import { redis } from '../lib/redis.js';

/**
 * Middleware para servir y guardar datos en caché usando Upstash Redis.
 * Elimina la responsabilidad del caché de lectura directamente de los controladores.
 * 
 * @param {string} prefix   - Prefijo del key de caché (ej. 'products', 'categories')
 * @param {string} dataKey  - La propiedad del JSON de respuesta que contiene la data a cachear (ej. 'products', 'product')
 * @param {string} paramKey - (Opcional) Si la ruta tiene un parámetro dinámico (ej. 'id' o 'code')
 */
export const cacheMiddleware = (prefix, dataKey, paramKey = null) => {
  return async (req, res, next) => {
    try {
      // Generamos la clave dinámica
      let key = `${prefix}:`;
      if (paramKey && req.params[paramKey]) {
        key += `${req.params[paramKey]}:`;
      }
      key += req.userId;

      // 1. Verificar si existe en caché
      const cachedData = await redis.get(key);

      if (cachedData) {
        return res.status(200).json({
          success: true,
          [dataKey]: typeof cachedData === 'string' ? JSON.parse(cachedData) : cachedData,
          fromCache: true
        });
      }

      // 2. Si no existe, interceptamos res.json para atrapar los datos antes de enviarlos
      const originalJson = res.json;
      res.json = function (body) {
        // Asegurarnos de que no hubo error y de que la data que esperamos exista en la respuesta
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success && body[dataKey]) {
          // Caching asíncrono "Fire and Forget" para no bloquear la request (1 hora default)
          redis.set(key, JSON.stringify(body[dataKey]), { ex: 3600 })
            .catch(err => console.error("Redis set error:", err));
        }

        // Ejecutamos la función original para mandar respuesta al cliente
        // Le pasamos explicitly fromCache: false
        const newBody = { ...body, fromCache: false };
        return originalJson.call(this, newBody);
      };

      next();
    } catch (error) {
      console.error("Cache Middleware Error:", error);
      // Si Redis falla, no bloqueamos la API, pasa de largo hacia MongoDB
      next();
    }
  };
};
