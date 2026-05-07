# 📋 Backend Analysis — CastillaWeb Inventory System
> Última actualización: 2026-05-07 · Versión del análisis: 3.1

---

## 📐 Arquitectura General

```
backend1.0/
├── server.js              ← Entry point (Express 5, Vercel-ready)
├── lib/
│   ├── db.js              ← Conexión MongoDB con lazy-connect
│   └── redis.js           ← Cliente Upstash Redis + utilidades de caché
├── controllers/           ← Lógica de request/response
│   ├── auth.controllers.js
│   ├── product.controller.js
│   ├── category.controller.js
│   ├── purchase.controller.js
│   ├── sale.controller.js
│   ├── adjustment.controller.js
│   ├── staff.controller.js
│   └── ai.controller.js
├── services/              ← Lógica de negocio transaccional (ACID)
│   ├── sale.service.js
│   ├── purchase.service.js
│   ├── adjustment.service.js
│   └── ai.service.js
├── models/                ← Schemas Mongoose + hooks
│   ├── User.js
│   ├── Product.js
│   ├── Category.js
│   ├── Sale.js / SaleDetail.js
│   ├── Purchase.js / PurchaseDetail.js
│   ├── InventoryAdjustment.js
│   └── SupplierPayment.js
├── middleware/            ← Pipeline de seguridad y contexto
│   ├── verifyToken.js
│   ├── checkSubscription.js
│   ├── requirePermission.js
│   ├── rateLimiter.js
│   ├── sanitize.js
│   ├── sla.middleware.js
│   ├── errorHandler.js
│   └── validate.js
├── routes/                ← Definición de endpoints
├── validations/           ← Esquemas Zod por módulo
└── utils/                 ← Helpers (JWT, etc.)
```

**Stack:** Express 5 · Mongoose 9 · Upstash Redis · @google/genai (Gemini 2.5 Flash) · Zod · JWT · bcryptjs · Vitest

---

## 🏗️ Modelo de Negocio — Multi-tenant SaaS B2B

El sistema opera como un SaaS donde **cada negocio es un tenant aislado**.

### Roles del Sistema

| Rol | Descripción | Acceso |
|-----|-------------|--------|
| `admin` | Super-administrador del SaaS | Puede crear usuarios, purgar cuentas |
| `customer` | **Dueño de negocio** — paga la suscripción | Ve todos los datos de su negocio |
| `employee` | Empleado del dueño | Ve solo sus propias ventas (`sold_by`) |

### Flujo de Identidad por Request (Middleware Chain)

```
JWT Cookie → verifyToken → checkSubscription → injectBusinessContext
                                                        ↓
                                          req.realUserId = quien hizo login
                                          req.userId     = ID del dueño (ownerId)
                                          req.userRole   = rol real
                                          req.userPermissions = permisos[]
```

**Regla clave:** `req.userId` siempre es el `ownerId` del negocio. Si el caller es un empleado, el middleware lo normaliza automáticamente. Los controladores usan `req.realUserId` cuando necesitan el ID real de quien opera.

### Visibilidad de Ventas por Rol

| Actor | Ventas que ve | Filtro MongoDB |
|-------|--------------|----------------|
| `customer` (dueño) | Todas las del negocio | `{ customer_id: req.userId }` |
| `employee` | Solo las suyas | `{ customer_id: ownerId, sold_by: req.realUserId }` |
| `customer` con filtro | Por vendedor específico | `{ customer_id: req.userId, sold_by: sellerId }` |

---

## 🔐 Pipeline de Seguridad

El orden de middlewares en `server.js` es deliberado y crítico:

```
1. Health Check         ← Sin rate limit ni DB
2. SLA Timeout (30s)    ← Fail fast: corta handlers zombie
3. Helmet               ← HTTP security headers
4. HPP                  ← HTTP Parameter Pollution
5. sanitizeNoSQL        ← Strips $-keys del body (NoSQL injection)
6. globalLimiter        ← 3000 req/15min por IP
7. CORS                 ← Orígenes permitidos (CLIENT_URL + localhost)
8. JSON/URL parsing     ← Límite 10kb
9. cookieParser
10. Lazy DB Connect     ← Solo si no está conectado (serverless)
11. authLimiter         ← 10 req/15min (solo en /api/auth)
12. verifyToken         ← JWT callback async (libera Event Loop)
13. checkSubscription   ← Redis TTL 5min (funciona en serverless)
14. injectBusinessContext ← Normaliza ownerId y rol
15. Controllers         ← Lógica de negocio
16. errorHandler        ← Centralizado, último middleware
```

---

## ⚡ Sistema de Caché (Redis Upstash)

### Patrón de Versionado (Cache Invalidation)

Upstash REST no soporta `SCAN/KEYS`. El sistema usa un **contador de versión** como prefijo:

```
Clave de versión:  v:products:userId123       → valor: 4
Clave de caché:    products:v4:p1:l20:userId123
```

Al crear/editar/borrar → `bumpCacheVersion` incrementa el contador.
Las claves antiguas (`v3`, `v2`...) quedan obsoletas y expiran por TTL natural.

### TTLs por Entidad

| Entidad | TTL | Razón |
|---------|-----|-------|
| Suscripción (`sub:userId`) | 5 min | Redis, funciona en serverless |
| Ventas paginadas | 2 min | Alta frecuencia de cambio |
| Productos paginados | 5 min | Cambio moderado |
| Ajustes | 5 min | Kardex histórico |
| Categorías | 10 min | Raramente cambian |
| Contexto IA base | 3 min | Balance velocidad/frescura |
| Ventas individuales | 5 min | Read-heavy |
| Compras individuales | Sin caché en filtros | No cacheable por patrón |

### Cache Stampede Prevention

`getOrSetCache` usa `inFlightPromises` (Map en memoria) para que múltiples requests simultáneos con el mismo key esperen la misma promesa en vuelo, evitando N queries a MongoDB.

---

## 🔄 Transacciones ACID

Todas las operaciones que afectan múltiples colecciones usan sesiones MongoDB:

| Operación | Colecciones afectadas | Usa sesión |
|-----------|----------------------|------------|
| `createSale` | Sale + SaleDetail + Product (stock) | ✅ |
| `createPurchase` | Purchase + PurchaseDetail + Product + User | ✅ |
| `createProduct` (con stock inicial) | Product + InventoryAdjustment | ✅ |
| `updateProduct` (con ajuste stock) | Product + InventoryAdjustment | ✅ |
| `purgeUserAndData` | User + Employee + Category + Product + Sale + SaleDetail + Purchase + PurchaseDetail | ✅ |
| `registerPayment` | Purchase + SupplierPayment | ✅ |
| `createAdjustment` | Product + InventoryAdjustment | ✅ (propio o externo) |

---

## 🤖 Módulo de Inteligencia Artificial

**Modelo:** Gemini 2.5 Flash via `@google/genai` con SSE streaming.

### Arquitectura del Servicio IA

```
userQuestion
    ↓
[1] Detección de intención (Regex local, sin IA):
    - Temporal: "últimos 7 días", "este mes", "quincena"...
    - Deudas:   "proveedor", "deuda", "abono", "factura"...
    ↓
[2] Contexto base (Redis TTL 3min):
    - Stock crítico (<5 unidades)
    - Ventas de hoy (agrupadas por producto)
    - Balance del día (ingresos - gastos)
    - Deudas pendientes (vencidas + por vencer en 7 días)
    - Top 5 productos del mes
    ↓
[3] Inyección condicional:
    - Si intent temporal → fetchTemporalContext (aggregation por día)
    - Si intent deudas   → desglose por proveedor
    ↓
[4] Zona horaria Venezuela (UTC-4) aplicada en todos los rangos de fecha
    ↓
[5] Gemini 2.5 Flash → SSE streaming al cliente
```

### Corrección de Timezone

El backend corre en UTC (Vercel). Venezuela es UTC-4. Sin corrección, una venta a las 9pm VE (1am UTC del día siguiente) se contaría en el día incorrecto. El servicio calcula la medianoche en hora Venezuela y la convierte a UTC para los filtros de MongoDB.

---

## 📊 Mapa de Endpoints

### Autenticación (Pública)
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/health` | ❌ | Health check |
| POST | `/api/auth/login` | ❌ | Login |
| POST | `/api/auth/logout` | ❌ | Logout |
| POST | `/api/auth/forgot-password` | ❌ | Solicitar reset |
| POST | `/api/auth/reset-password/:token` | ❌ | Confirmar reset |
| GET | `/api/auth/check-auth` | 🔑 JWT | Verificar sesión activa |
| POST | `/api/auth/create-user` | 🔑 Admin | Crear nuevo cliente/dueño |
| DELETE | `/api/auth/purge/:targetUserId` | 🔑 Admin | Purga en cascada |

### Rutas Protegidas (verifyToken + checkSubscription + injectBusinessContext)
| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| GET/POST | `/api/categories` | customer/employee | CRUD categorías |
| GET/PUT/DELETE | `/api/categories/:id` | customer/employee | Gestión categoría |
| GET/POST | `/api/products` | customer/employee | CRUD productos |
| GET/PUT/DELETE | `/api/products/:id` | customer/employee | Gestión producto |
| GET | `/api/products/barcode/:code` | customer/employee | Búsqueda por código |
| GET/POST | `/api/purchases` | customer | CRUD compras |
| GET | `/api/purchases/:id` | customer | Detalle compra |
| POST | `/api/purchases/:id/pay` | customer | Registrar abono |
| GET | `/api/purchases/payments` | customer | Historial de pagos |
| GET/POST | `/api/sales` | customer/employee | Ventas (filtradas por rol) |
| GET | `/api/sales/:id` | customer/employee | Detalle venta (scoped) |
| GET/POST | `/api/adjustments` | customer/employee | Kardex de inventario |
| POST | `/api/ai/ask` | customer (15/15min) | Consulta IA (SSE streaming) |
| GET | `/api/staff` | `staff_management` | Lista empleados |
| POST | `/api/staff` | `staff_management` | Crear empleado |
| PUT | `/api/staff/:id` | `staff_management` | Actualizar permisos |
| DELETE | `/api/staff/:id` | `staff_management` | Eliminar empleado |

---

## 🐛 Bugs Corregidos (2026-05-05)

### 🔴 Críticos
| ID | Archivo | Problema | Fix |
|----|---------|----------|-----|
| BUG-01 | `sale.validation.js` | `customer_id` exigido en body pero nunca usado → HTTP 400 | Eliminado del schema |
| BUG-02 | `purchase.validation.js` | `admin_id` exigido en body pero nunca usado → HTTP 400 | Eliminado; `dueDate` opcional agregado |
| BUG-03 | `checkSubscription.js` | `new Map()` en memoria no persiste entre invocaciones Vercel serverless | Migrado a Redis (`sub:userId`, TTL 5min) |
| BUG-04 | `ai.service.js` | `withTimeout` definida dentro de un closure → `ReferenceError` en preguntas temporales | Movida al scope del módulo |

### 🟠 Altos
| ID | Archivo | Problema | Fix |
|----|---------|----------|-----|
| BUG-05 | `auth.controllers.js` | `purgeUserAndData` no eliminaba empleados huérfanos | `User.deleteMany({ owner_id: targetUserId })` en cascada |
| BUG-06 | `auth.controllers.js` | Cache invalidation con claves simples (formato incorrecto) | `bumpCacheVersion` en lugar de `invalidateCache` |
| BUG-07 | `verifyToken.js` | Token manipulado → HTTP 500 en lugar de 401 | `JsonWebTokenError` → 401 |
| BUG-08 | `staff.controller.js` | `createEmployee` hacía `User.findById` redundante | Usa `req.userRole` del middleware |
| BUG-ROLES | `sale.controller.js` | `injectBusinessContext` sobrescribía `req.userId` → `isEmployee` siempre `false` | Controlador usa `req.realUserId` y `req.userRole` |

### 🟡 Medios
| ID | Archivo | Problema | Fix |
|----|---------|----------|-----|
| BUG-09 | `auth.controllers.js` | `checkAuth` retornaba HTTP 400 para usuario no encontrado | Corregido a 401 |
| BUG-10 | `SaleDetail.js` | Pre-save hook leía producto sin sesión → datos stale en concurrencia | Usa `this.$session()` + `try/catch` |
| BUG-11 | `purchase.service.js` | `fetchPayments` ordenaba por `date` (inconsistente) | Cambiado a `createdAt` |
| BUG-EXTRA | `PurchaseDetail.js` | Aggregate de costo promedio sin filtro `admin_id` → calculaba el promedio de **todos los tenants** | Pipeline con `$lookup + $match` por `admin_id` |
| BUG-TZ | `sale.controller.js` | Filtros de fecha rápidos (`today`, `ayer`, `7days`, `30days`, `month`) calculaban medianoche con `setHours(0,0,0,0)` en UTC (servidor). Venezuela = UTC-4, lo que causaba un desfase de 4h: "Ayer" mostraba ventas del día anterior al esperado. | Helper `dayRangeVE(offsetDays)` que calcula la medianoche en hora Venezuela restando `VE_OFFSET_MS = 4h` y convierte el rango correcto a UTC para MongoDB. |

---

## ✅ Fortalezas del Sistema

### Seguridad
- JWT via cookie `HttpOnly` + `SameSite` según entorno.
- Rate limiting diferenciado: global (3000/15min), auth (10/15min), AI (15/15min).
- `verifyToken` usa callback async de `jwt.verify` para liberar el Event Loop.
- NoSQL injection sanitizer propio (compatible con Express 5, donde `req.query` es read-only).
- `helmet`, `hpp` aplicados antes del parsing.

### Rendimiento
- Cache versionada Redis → invalidación en bloque sin SCAN.
- `Promise.all` para queries paralelas en todos los endpoints de listado.
- `.lean()` en todas las queries de lectura.
- Cache Stampede Prevention via `inFlightPromises`.
- Fail-open en Redis: si falla, el request sigue a MongoDB.
- Lazy DB Connection para compatibilidad serverless.

### Datos
- Transacciones ACID en todas las operaciones multi-colección.
- `abortTransaction()` con guard `inTransaction()` en todos los catch.
- Índices compuestos estratégicos: `{ barcode, user }` sparse, `{ customer_id, createdAt }`, etc.
- Costo promedio ponderado de inventario (`av_inventory_cost`) calculado automáticamente al registrar compras.

---

## 🟢 Calificación General (Post-fixes)

| Área | Score | Notas |
|------|-------|-------|
| Seguridad | 9.5/10 | JWT correcto, rate limits, sanitización, tokens inválidos → 401 |
| Rendimiento | 9.5/10 | Cache Redis serverless-compatible, stampede prevention |
| Consistencia de datos | 9.5/10 | ACID completo, bug costo promedio multi-tenant corregido |
| Arquitectura Multi-tenant | 9/10 | Rol/contexto bien resuelto por middleware chain |
| Mantenibilidad | 9/10 | Capa service/controller clara, validaciones Zod centralizadas |
| **Total** | **9.3/10** | |

> **Estado actual:** Backend production-ready. Todos los bugs críticos y altos identificados han sido corregidos. El sistema soporta correctamente el modelo multi-tenant SaaS con aislamiento de datos por negocio, empleados con visibilidad restringida, y caché Redis funcional en entornos serverless.
