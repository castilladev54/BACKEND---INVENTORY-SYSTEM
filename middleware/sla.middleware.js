// ─── SLA MIDDLEWARE: FAIL FAST ──────────────────────────────────────────────
// Un backend senior no deja peticiones colgadas 60 segundos.
// Si la respuesta no se completó en el SLA, cortamos de raíz con 504.
// Esto protege el Event Loop de acumular miles de handlers zombi.

const SLA_TIMEOUT_MS = Number(process.env.SLA_TIMEOUT_MS) || 1500; // 1.5 segundos

export const slaTimeout = (req, res, next) => {
  const timer = setTimeout(() => {
    // Si ya enviamos headers, no podemos enviar otro response
    if (res.headersSent) return;

    res.status(504).json({
      success: false,
      message: "Gateway Timeout — la operación excedió el SLA de respuesta."
    });
  }, SLA_TIMEOUT_MS);

  // Limpiar el timer cuando la respuesta se complete normalmente
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));

  next();
};
