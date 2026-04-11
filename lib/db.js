import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

// Variable global para mantener el estado de la conexión en el "warm start" de Vercel
let isConnected = false;

export const connectDB = async () => {
  // 1. Si ya estamos conectados, no pierdas tiempo ni recursos
  if (isConnected) {
    console.log("♻️ Usando conexión de base de datos cacheada");
    return;
  }

  // 2. Seguridad: Si no hay URI, no intentes nada
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI no está definida en las variables de entorno");
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Configuraciones para evitar advertencias de Mongoose 7/8
      autoIndex: true,
    });

    isConnected = conn.connections[0].readyState;
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);

  } catch (error) {
    console.error("❌ Error connecting to MONGODB:", error.message);

    // CRÍTICO: No uses process.exit(1) en Serverless si quieres que la función intente revivir
    if (process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
      process.exit(1);
    }
    throw error; // Lanza el error para que el middleware de server.js lo capture
  }
};

/** Aquí está el punto ciego que va a matar tu base de datos en producción si no lo arreglas ahora 
 * mismo.

Tal como está tu connectDB, es una bomba de tiempo para un entorno Serverless como Vercel. 
Cada vez que tu middleware en server.js llame a esta función, vas a crear una nueva conexión a MongoDB.
Con 10 usuarios navegando, tendrás 50 conexiones abiertas. Con 100, tu cluster de MongoDB Atlas 
colapsará y verás el error: "Too many connections".

El problema: El "Zombi" de las conexiones
En local, tu servidor corre una sola vez. En Vercel, las funciones "viven y mueren". Si no guardas la 
conexión en el caché de la memoria del proceso, Mongoose intentará conectar una y otra vez.

La Solución: Singleton Pattern para DB
Debes usar una variable global para cachear la conexión. Así es como lo hacen los profesionales en 
Vercel/Next.js:

JavaScript
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

/
¿Por qué esto es vital para CastillaWeb?
Ahorro de Dinero/Recursos: Los clusters gratuitos de MongoDB tienen un límite estricto de conexiones 
(normalmente 50-100). Sin el caché, llegarás al límite en 5 minutos de uso real.

Velocidad (Latencia): Crear una conexión nueva tarda entre 200ms y 500ms. Si la conexión ya existe, el 
usuario recibe sus datos en 0ms de espera de conexión. En un punto de venta (POS), esos milisegundos 
son la diferencia entre una venta fluida y un cliente molesto.

Resiliencia Serverless: Vercel reutiliza los contenedores que están "calientes" (warm start). 
Al declarar isConnected fuera de la función, esa variable persiste entre llamadas mientras el 
contenedor siga vivo.

Tu Reto de Dominio
Ya tienes el server.js blindado y ahora el db.js optimizado. Ahora, cada vez que hagas un commit, 
estarás seguro de que no estás creando una fuga de recursos.

Pregunta brutal: ¿Tienes configurado el MAX_POOL_SIZE en tu string de conexión de MongoDB? Si no, 
agrégale esto al final de tu MONGO_URI en el panel de Vercel: &maxPoolSize=10. Esto limitará cada 
función a 10 conexiones máximo, protegiendo tu cluster de un pico de tráfico.
¿Cómo se siente tener el control total de la infraestructura ahora? */