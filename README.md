# DOCUMENTACIÓN DEL BACKEND - SISTEMA DE INVENTARIO

Este backend es una API REST construida con **Node.js**, **Express** y **MongoDB**, diseñada para gestionar un inventario completo, incluyendo usuarios, categorías, productos, compras (entradas) y ventas (salidas).

---

## 🛠️ TECNOLOGÍAS UTILIZADAS
- **Motor**: Node.js (ES Modules)
- **Framework**: Express.js
- **Base de Datos**: MongoDB (Mongoose ODM)
- **Seguridad**: JWT (JSON Web Tokens) & Cookie-parser
- **Pruebas**: Vitest & Supertest
- **Herramientas**: Dotenv, CORS, Bcryptjs

---

## 🚀 INSTALACIÓN Y PRODUCCIÓN

1. **Instalar dependencias**: `npm install`
2. **Configurar variables de entorno**: Crea un archivo `.env` con:
   - `PORT=3000`
   - `MONGODB_URI=`
   - `JWT_SECRET=`
   - `NODE_ENV=`
3. **Ejecutar en desarrollo**: `npm run dev`
4. **Ejecutar pruebas**: `npm test`

---

## 📡 ENDPOINTS DEL SISTEMA

### 🔐 AUTENTICACIÓN (`/api/auth`)
| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/signup` | Registra un nuevo usuario (admin/customer). |
| **POST** | `/login` | Inicia sesión y genera cookie JWT. |
| **POST** | `/logout` | Cierra sesión eliminando la cookie. |
| **POST** | `/verify-email` | Verifica la cuenta con el código enviado. |
| **POST** | `/forgot-password` | Envía correo de recuperación. |
| **POST** | `/reset-password/:token` | Cambia la contraseña usando el token. |
| **GET** | `/check-auth` | Verifica si el usuario está autenticado. |

---

### 📦 CATEGORÍAS (`/api/categories`)
| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/` | Crea una nueva categoría. |
| **GET** | `/` | Lista todas las categorías. |
| **GET** | `/:id` | Obtiene una categoría específica. |
| **PUT** | `/:id` | Actualiza nombre/descripción. |
| **DELETE** | `/:id` | Elimina categoría (si no tiene productos). |

---

### 🏷️ PRODUCTOS (`/api/products`)
| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/` | Crea un producto (requiere ID de categoría). |
| **GET** | `/` | Lista productos con sus categorías. |
| **GET** | `/:id` | Detalle de un producto específico. |
| **PUT** | `/:id` | Actualiza datos del producto. |
| **DELETE** | `/:id` | Elimina físicamente el producto. |

---

### 🛒 COMPRAS / ENTRADAS (`/api/purchases`)
*Maneja la entrada de mercancía al almacén.*

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/` | Registra una compra masiva de productos. |
| **GET** | `/` | Historial de todas las compras realizadas. |
| **GET** | `/:id` | Detalle completo de una compra y sus productos. |

**Formato de envío (POST):**
```json
{
  "admin_id": "ID_ADMIN",
  "supplier": "Nombre Proveedor",
  "items": [
    { "product_id": "ID", "quantity": 10, "unit_cost": 50.0 }
  ]
}
```

---

### 💰 VENTAS / SALIDAS (`/api/sales`)
*Maneja la salida de mercancía por ventas a clientes.*

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| **POST** | `/` | Registra una venta (valida stock). |
| **GET** | `/` | Historial de todas las ventas realizadas. |
| **GET** | `/:id` | Detalle completo de una venta efectuada. |

---



## ⚙️ LÓGICA DE NEGOCIO E INTEGRIDAD
- **Control de Stock Automático**: Las **Compras** incrementan el stock y las **Ventas** lo reducen.
- **Validación de Inventario**: El sistema bloquea ventas si la cantidad solicitada supera el stock actual.
- **Protección de Categorías**: No se puede eliminar una categoría si existen productos vinculados a ella.
- **Costo Promedio**: El sistema calcula y actualiza automáticamente el `av_inventory_cost` en el perfil del Administrador cada vez que se registra una compra.
- **Transacciones**: Las operaciones de Compra y Venta usan transacciones de base de datos para asegurar que los registros de detalles y el stock se actualicen correctamente o ninguno se guarde en caso de error.
