================================================================================
DOCUMENTACION DETALLADA DEL BACKEND - SISTEMA DE INVENTARIO
================================================================================

Este sistema gestiona Inventarios, Usuarios, Categorias, Productos, Compras y Ventas.
Base: Node.js, Express y MongoDB.

--------------------------------------------------------------------------------
1. CONFIGURACION DEL SERVIDOR
--------------------------------------------------------------------------------
Puerto por defecto: 3000
Path base: http://localhost:3000/api

Endpoints principales:
- /api/auth       (Autenticacion y Usuarios)
- /api/categories (Gestion de grupos de productos)
- /api/products   (Inventario de articulos)
- /api/purchases  (Entradas de mercancia)
- /api/sales      (Salidas de mercancia)

--------------------------------------------------------------------------------
2. ENDPOINTS DE AUTENTICACION (/api/auth)
--------------------------------------------------------------------------------
POST /signup          -> Registro de nuevo usuario (admin o cliente).
POST /login           -> Inicio de sesion (Genera Cookie JWT).
POST /logout          -> Cierre de sesion.
POST /verify-email    -> Verifica con codigo numerico enviado.
POST /forgot-password -> Peticion de recuperacion de clave.
POST /reset-password/:token -> Cambio de clave mediante token.
GET  /check-auth      -> Devuelve datos del usuario si la sesion es valida.

--------------------------------------------------------------------------------
3. ENDPOINTS DE CATEGORIAS (/api/categories)
--------------------------------------------------------------------------------
POST /     -> Crea categoria. (Body: { "name": string, "description": string })
GET  /     -> Lista todas las categorias.
GET  /:id  -> Detalle de una categoria.
PUT  /:id  -> Actualiza categoria.
DELETE /:id -> Borra categoria (Bloqueado si tiene productos).

--------------------------------------------------------------------------------
4. ENDPOINTS DE PRODUCTOS (/api/products)
--------------------------------------------------------------------------------
POST /     -> Crea producto.
              Estructura: { "name", "description", "price", "stock", "category" }
GET  /     -> Lista todos los productos (Incluye nombre de categoria).
GET  /:id  -> Detalle del producto.
PUT  /:id  -> Actualiza datos.
DELETE /:id -> Borra producto.

--------------------------------------------------------------------------------
5. ENDPOINTS DE COMPRAS/ENTRADAS (/api/purchases)
--------------------------------------------------------------------------------
POST /     -> Registra entrada de mercancia.
              Afecta: Sube stock y recalcula costo promedio del Admin.
              Body: {
                "admin_id": "ID",
                "supplier": "Nombre",
                "items": [
                   { "product_id": "ID", "quantity": 10, "unit_cost": 50.0 }
                ]
              }
GET  /     -> Historial de compras.
GET  /:id  -> Detalle de compra con lista de articulos.

--------------------------------------------------------------------------------
6. ENDPOINTS DE VENTAS/SALIDAS (/api/sales)
--------------------------------------------------------------------------------
POST /     -> Registra salida de mercancia.
              Validacion: No permite vender si no hay stock suficiente.
              Afecta: Baja el stock del producto.
              Body: {
                "customer_id": "ID",
                "payment_method": "Efectivo",
                "items": [
                   { "product_id": "ID", "quantity": 1, "unit_price": 600.0 }
                ]
              }
GET  /     -> Historial de ventas.
GET  /:id  -> Detalle de venta efectuada.

--------------------------------------------------------------------------------
7. REGLAS DE NEGOCIO IMPLEMENTADAS
--------------------------------------------------------------------------------
- Transacciones: Compras y Ventas son atomicas. Si falla un detalle, no se 
  guarda nada para evitar descuadres en el inventario.
- Integridad: No es posible eliminar categorias que contengan productos.
- Proteccion de Datos: Las contraseñas se guardan encriptadas con Bcrypt.
- Costo de Inventario: El Administrador tiene un campo 'av_inventory_cost' que 
  se actualiza dinamicamente con cada compra para analisis financiero.
================================================================================

--------------------------------------------------------------------------------
8. Medidas de seguridad implementadas
--------------------------------------------------------------------------------

Medida	Paquete	Qué protege
Headers HTTP seguros	helmet	XSS, clickjacking, MIME sniffing, etc.
Rate limiting global	express-rate-limit	100 req/15min por IP en todas las rutas
Rate limiting auth	express-rate-limit	10 req/15min por IP en /api/auth (anti fuerza bruta)
Sanitización NoSQL	express-mongo-sanitize	Inyecciones como {"$gt":""} en queries MongoDB
Anti parameter pollution	hpp	Duplicación maliciosa de query params
Límite de body	express.json({ limit: "10kb" })	Payloads excesivamente grandes (DoS)
JWT Secret robusto	

.env
Token JWT ahora tiene un secret de 128 caracteres aleatorios