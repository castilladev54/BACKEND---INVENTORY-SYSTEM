# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar dependencias primero (mejor cache de capas)
COPY package*.json ./

# Instalar TODAS las dependencias (incluyendo dev para build si se necesitara)
RUN npm ci --omit=dev

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Crear usuario no-root por seguridad
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copiar dependencias del stage anterior
COPY --from=builder /app/node_modules ./node_modules

# Copiar el código fuente
COPY --chown=appuser:appgroup . .

# Eliminar archivos innecesarios en producción
RUN rm -rf tests/ .github/ .agents/ *.md

# Usar usuario no-root
USER appuser

# Exponer el puerto
EXPOSE 3000

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Comando de inicio
CMD ["node", "server.js"]
