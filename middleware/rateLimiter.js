import rateLimit from 'express-rate-limit';

/** Rate limiter global — 1000 peticiones por ventana de 15 minutos por IP */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.'
  }
});

/** Rate limiter estricto para rutas de autenticación — 10 peticiones por ventana de 15 min */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again after 15 minutes.'
  }
});

/** Rate limiter para consultas a la IA — 15 peticiones por ventana de 15 min */
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 15, // Límite de 15 peticiones por IP
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Has alcanzado el límite de consultas a la IA permitidas. Por favor, espera unos minutos para proteger los costos del servidor.'
  }
});
