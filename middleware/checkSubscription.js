import { User } from "../models/User.js";

// ─── OPTIMIZACIÓN CRÍTICA ───────────────────────────────────────────────────
// El profiler reveló que User.findById se ejecutaba en CADA request protegido.
// 40 VUs × 4 endpoints = 160 roundtrips/segundo a MongoDB Atlas solo para
// preguntar "¿sigue siendo premium?". La suscripción no cambia cada segundo.
// Cacheamos el resultado por userId durante 5 minutos en memoria.
const subscriptionCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

export const checkSubscription = async (req, res, next) => {
  try {
    const userId = req.userId;

    // Verificar caché en memoria primero
    const cached = subscriptionCache.get(userId);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      if (cached.expired) {
        return res.status(403).json({
          success: false,
          message: "Tu suscripción de 7 días ha vencido. Por favor, contacta al administrador para renovar."
        });
      }
      return next();
    }

    const user = await User.findById(userId).select('subscriptionExpiresAt').lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }

    if (!user.subscriptionExpiresAt) {
      // In case old users don't have it, we could let them pass or give them an error.
      // We will let them pass for backward compatibility or give them a default
      subscriptionCache.set(userId, { expired: false, timestamp: Date.now() });
      return next();
    }

    // Comparamos si hoy ya superó su fecha límite
    const isExpired = new Date() > user.subscriptionExpiresAt;
    subscriptionCache.set(userId, { expired: isExpired, timestamp: Date.now() });

    if (isExpired) {
      return res.status(403).json({
        success: false,
        message: "Tu suscripción de 7 días ha vencido. Por favor, contacta al administrador para renovar."
      });
    }

    next();
  } catch (error) {
    console.log("Error in checkSubscription: ", error);
    res.status(500).json({ success: false, message: "Error verificando suscripción" });
  }
};

