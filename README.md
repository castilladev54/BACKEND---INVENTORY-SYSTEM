# DOCUMENTACIÓN DEL BACKEND - SISTEMA DE INVENTARIO v2.0

Este backend es una API REST robusta construida con **Node.js**, **Express** y **MongoDB**, diseñada para gestionar un inventario y facturación modelo SaaS, incluyendo administración centralizada de cuentas, control de suscripciones y soporte para productos a granel/fracciones.

---

## 🛠️ TECNOLOGÍAS UTILIZADAS
- **Motor**: Node.js (ES Modules)
- **Framework**: Express.js
- **Base de Datos**: MongoDB (Mongoose ODM)
- **Seguridad**: JWT (Cookies HttpOnly), Helmet, Mongo-Sanitize, Express-Rate-Limit, HPP
- **Pruebas**: Vitest, Supertest, MongoDB Memory Server / ReplSet
- **Validaciones**: Zod Schema Validator
- **Otras Herramientas**: Dotenv, CORS, Bcryptjs

---

## 🚀 INSTALACIÓN Y PRODUCCIÓN

1. **Instalar dependencias**: `npm install`
2. **Configurar variables de entorno**: Crea un archivo `.env` con:
   - `PORT=5000`
   - `MONGO_URI=`
   - `JWT_SECRET=`
   - `CLIENT_URL=`
   - `NODE_ENV=`
27. **Ejecutar en desarrollo**: `npm run dev`
28. **Ejecutar pruebas**: `npm run test` (Nota: El test de `purchases` exige MongoMemoryReplSet y puede tardar en Windows si se corre en paralelo).

---

## 🐳 DOCKER (OPCIONAL)

El sistema incluye soporte para **Docker** mediante un multi-stage build optimizado para producción.

1. **Construir la imagen**:
   ```bash
   docker build -t inventory-backend .
   ```
2. **Ejecutar el contenedor**:
   ```bash
   docker run -p 3000:3000 --env-file .env inventory-backend
   ```

*La imagen corre como usuario no-root e incluye un Healthcheck interno.*

---

## 📡 ENDPOINTS DEL SISTEMA

### 🔐 AUTENTICACIÓN (`/api/auth`)
*El registro público fue eliminado por seguridad. Todas las cuentas son provisionadas.*

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/create-user` | **(Admin Solo)** Crea un usuario verificado y le regala 7 días de suscripción. |
| **POST** | `/login` | Inicia sesión y genera cookie JWT segura. |
| **POST** | `/logout` | Cierra sesión eliminando la cookie. |
| **POST** | `/forgot-password` | Envía correo de recuperación. |
| **POST** | `/reset-password/:token` | Cambia la contraseña usando el token. |
| **GET** | `/check-auth` | Verifica si el usuario está autenticado y su rol. |

---

### 📦 CATEGORÍAS (`/api/categories`)
*Protegidas por autenticación y suscripción activa.*

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/` | Crea una nueva categoría. |
| **GET** | `/` | Lista todas las categorías del usuario. |
| **GET** | `/:id` | Obtiene una categoría específica. |
| **PUT** | `/:id` | Actualiza nombre/descripción. |
| **DELETE** | `/:id` | Elimina categoría (si no tiene productos vinculados). |

---

### 🏷️ PRODUCTOS (`/api/products`)
*Protegidos. Soportan decimales y tipos de unidades (kg, litro, metro, unidad).*

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/` | Crea un producto. Requiere `unit_type`. |
| **GET** | `/` | Lista productos con sus categorías pobladas. |
| **GET** | `/:id` | Detalle de un producto específico. |
| **PUT** | `/:id` | Actualiza datos del producto y su tipo de unidad. |
| **DELETE** | `/:id` | Elimina físicamente el producto. |

---

### 🛒 COMPRAS / ENTRADAS (`/api/purchases`)
*Protegidas. Maneja ingresos de mercancía sumando Stock (soporta fracciones).*

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/` | Registra una compra masiva y autocalcula el costo promedio. |
| **GET** | `/` | Historial de todas las compras. |
| **GET** | `/:id` | Detalle completo de una compra y sus ítems. |

**Ejemplo de Payload (Acepta decimales):**
```json
{
  "admin_id": "ID_ADMIN",
  "supplier": "Distribuidora XYZ",
  "items": [
    { "product_id": "ID", "quantity": 15.5, "unit_cost": 100 }
  ]
}
```

---

### 💰 VENTAS / SALIDAS (`/api/sales`)
*Protegidas. Resta Stock validando inventario mínimo (soporta gramos/fracciones).*

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/` | Registra una venta descontando stock fraccionario. |
| **GET** | `/` | Historial de todas las ventas. |
| **GET** | `/:id` | Detalle de una venta con los productos populados. |

---

## ⚡ ARQUITECTURA Y ALTO RENDIMIENTO (v2.0+)

El backend cuenta con una infraestructura optimizada nivel Enterprise:
1. **Arquitectura Controller-Service:** La lógica compleja y transaccional (Ventas, Compras, Ajustes) reside de forma aislada en la capa `/services`, dejando los controladores puros, escalables y orientados a la gestión web.
2. **Caché Distribuido (Upstash Redis):**
   - **`cacheMiddleware`:** Interceptor dinámico que sirve respuestas desde RAM y cachea nuevos resultados de forma asíncrona ("Fire-and-Forget") sin bloquear el hilo principal.
   - **Invalidación Granular e Inteligente:** Las operaciones de escritura limpian específicamente el caché de listas afectadas y de *cada ítem* involucrado, evitando des-sincronizaciones en las vistas de detalle del front-end.
3. **Manejo Central de Errores:** Aprovechando Express 5.x, el middleware global `errorHandler.js` captura promesas huérfanas, fallos de Zod y violaciones nativas de Mongoose (Duplicate Keys, CastErrors), transformándolas en respuestas HTTP predecibles.
4. **Validaciones No Bloqueantes:** Usando `z.parseAsync()`, la validación de payloads masivos es enviada al fondo del Event Loop, previniendo micro-congelamientos del servidor.
5. **Bases de Datos Velozy y Eficiente:**
   - Índices compuestos meticulosamente configurados (ej. `{ customer_id: 1, createdAt: -1 }`) para acelerar listados cronológicos.
   - Todo el motor de lectura opera con `.lean()` de Mongoose, retornando POJOs estructurados reduciendo drásticamente el uso de memoria RAM e inflado de objetos.

---

## ⚙️ REGLAS DE NEGOCIO, INTEGRIDAD Y SEGURIDAD

1. **Gestión de Suscripciones Lock:** 
   - Un `middleware` intercepta cada petición a las rutas de categorías, productos, ventas y compras.
   - Si la fecha `subscriptionExpiresAt` del usuario ya transcurrió (por defecto 7 días tras su creación), la API devolverá un `403 Forbidden` forzando al cliente a renovar/pagar.
2. **Sistema de Kilogramos y Fracciones (Venta a Granel):**
   - El sistema ya no se restringe a números enteros (`parseInt`). 
   - Usa campos modificables (`unit_type: 'kg' | 'litro' | 'metro' | 'unidad'`) y la bd admite valores matemáticos como `1.5` o `0.25` en Cantidades de Compra, Venta y Stock usando `parseFloat`. Límite mínimo: `0.01`.
3. **Control de Inventario Transaccional Seguro:**
   - La entrada (Compras) aumenta el inventario y autocalcula el *Costo Promedio del Inventario* (`av_inventory_cost`).
   - La salida (Ventas) decrementa el inventario validando estrictamente que exista el stock solicitado.
   - Todo se ejecuta bajo **Transacciones Nativas de MongoDB (ACID)**. Si un producto falla a medio registrar, toda la compra/venta hace Rollback total, erradicando los "fantasmas de stock".
4. **Restricción de Eliminación Relacional:**
   - Una Categoría no puede ser borrada si tiene "Hijos" (Productos) asociados a ella.
5. **Mitigación de Vulnerabilidades:** 
   - Rate Limiter dinámico configurado a 1000/15min de forma global para no asfixiar aplicaciones SPA, manteniendo candados fuertes (10/15min) en endpoints de Auth.
   - Todas las entradas tipo body, query y params son parseadas asíncronamente fuertemente usando `Zod`.
   - Limpiado y sanitización contra inyecciones NoSQL usando `express-mongo-sanitize`.
   - Prevención de contaminación de parámetros HTTP con `hpp`.

