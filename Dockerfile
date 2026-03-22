# ─── Stage 1: Install dependencies ─────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Copy only dependency manifests first for better layer caching
COPY package.json package-lock.json ./

# Install production dependencies only (no devDependencies)
RUN npm ci --omit=dev

# ─── Stage 2: Production image ─────────────────────────────────
FROM node:22-alpine AS production

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source code
COPY package.json ./
COPY server.js ./
COPY controllers ./controllers
COPY lib ./lib
COPY mailtrap ./mailtrap
COPY middleware ./middleware
COPY models ./models
COPY routes ./routes
COPY utils ./utils
COPY validations ./validations

# Set production environment
ENV NODE_ENV=production

# Expose the application port
EXPOSE 5000

# Switch to non-root user
USER appuser

# Health check to verify the container is running
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/auth || exit 1

# Start the application
CMD ["node", "server.js"]
