import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server'; // ! OJO: Usamos ReplSet
import app from '../server.js';
import { User } from '../models/User.js';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { Purchase } from '../models/Purchase.js';
import { PurchaseDetail } from '../models/PurchaseDetail.js';
import bcryptjs from 'bcryptjs';

// Mockeamos la librería de correos para evitar envíos reales
vi.mock('../mailtrap/emails.js', () => ({
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

// Mock Redis: evita llamadas HTTP reales a Upstash en CI/CD
vi.mock('../lib/redis.js', () => ({
  redis: {},
  getOrSetCache: vi.fn(async (_key, fn) => ({ data: await fn(), fromCache: false })),
  invalidateCache: vi.fn(async () => {}),
}));

let mongoReplSet;

beforeAll(async () => {
  // CRÍTICO: El controlador de Purchases usa Transacciones (session.startTransaction()).
  // Mongoose y MongoDB requieren de forma obligatoria que la base de datos sea un Replica Set
  // para poder ejecutar transacciones. MongoMemoryServer normal (standalone) provocaría un error.
  mongoReplSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongoReplSet.getUri();
  
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(mongoUri);
  // Pequeño delay para que el Replica Set termine de elegir el nodo PRIMARY
  // antes de intentar hacer transacciones, evitando el intermitente error 500.
  await new Promise((r) => setTimeout(r, 1500));
}, 120000); 

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoReplSet) {
    await mongoReplSet.stop();
  }
});

afterEach(async () => {
  // Limpiamos solo los documentos creados (compras y detalles)
  await Purchase.deleteMany({});
  await PurchaseDetail.deleteMany({});
  
  // Como los triggers alteran stock y costos, reseteamos esos en cascada 
  // para asegurar un ambiente limpio en caso de que alguna prueba no restaure manualmente.
  await Product.updateMany({}, { stock: 0 });
  await User.updateMany({}, { av_inventory_cost: 0 });
  
  vi.clearAllMocks();
});

describe('Purchase Controllers Integration', () => {
  let authCookie;
  let userId;
  let categoryId;
  let productId;
  
  beforeAll(async () => {
    // 1. Iniciamos usuario único para todo el bloque directamente en DB (pues quitamos signup público)
    const testEmail = `purchaser${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const hashedPassword = await bcryptjs.hash('password123', 10);
    const user = await User.create({
      email: testEmail,
      password: hashedPassword,
      name: 'Purchaser Admin',
      role: 'admin'
    });
    userId = user._id.toString();
    
    // 2. Iniciamos sesión y guardamos cookie JWT
    const loginRes = await request(app).post('/api/auth/login').send({
      email: testEmail, password: 'password123'
    });
    authCookie = loginRes.headers['set-cookie'];

    // 3. Crear Categoría en BD
    const category = new Category({ name: 'Car Parts', user: userId });
    await category.save();
    categoryId = category._id.toString();

    // 4. Crear Producto en BD (con stock inicial 0)
    const product = new Product({
      name: 'Engine X1',
      price: 1500,
      stock: 0,
      unit_type: 'kg', // Setteado a kg para soportar decimales en los test
      category: categoryId,
      user: userId
    });
    await product.save();
    productId = product._id.toString();
  });

  describe('POST /api/purchases', () => {
    it('should create a purchase with FRACTIONAL quantities (kg support), automatically INCREMENT product stock, and recalculate average costs', async () => {
      const payload = {
        admin_id: userId,
        supplier: 'Global Supplier Corp',
        items: [
          {
            product_id: productId,
            quantity: 15.5, // ¡Probando nuestra función de fracciones / kilos!
            unit_cost: 100 // total cost of this item line = 1550
          }
        ]
      };

      const response = await request(app)
        .post('/api/purchases')
        .set('Cookie', authCookie)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.purchase.supplier).toBe('Global Supplier Corp');
      expect(response.body.purchase.total_cost).toBe(1550); // 15.5 * 100
      
      const purchaseId = response.body.purchase._id;

      // 1. Verifica los Detalles Reales creados en BD
      const details = await PurchaseDetail.find({ purchase_id: purchaseId });
      expect(details).toHaveLength(1);
      expect(details[0].product_id.toString()).toBe(productId);
      expect(details[0].quantity).toBe(15.5);

      // 2. TRIGGERS MAGICOS DE MONGOOSE PRE('SAVE'):
      // El pre-save de PurchaseDetail indica que el stock del producto DEBE haber subido de 0 a 15.5
      const updatedProduct = await Product.findById(productId);
      expect(updatedProduct.stock).toBe(15.5);

      // El pre-save de PurchaseDetail también debió actualizar el "av_inventory_cost" en User.
      const updatedUser = await User.findById(userId);
      expect(updatedUser.av_inventory_cost).toBe(100); 
    });

    it('should correctly rollback transaction (abortTransaction) and return 404 if product does not exist', async () => {
      const fakeProductId = new mongoose.Types.ObjectId().toString();
      const payload = {
        admin_id: userId,
        supplier: 'Bad Supplier',
        items: [{ product_id: fakeProductId, quantity: 5.2, unit_cost: 50 }]
      };

      const response = await request(app)
        .post('/api/purchases')
        .set('Cookie', authCookie)
        .send(payload);

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('no encontrado');

      // Fundamental: Si falló, la transacción hace rollback. Ninguna compra ni detalle debió registrarse.
      const purchasesCount = await Purchase.countDocuments();
      expect(purchasesCount).toBe(0);
    });

    it('should return 400 validation error if required body payload missing (e.g. items array)', async () => {
      const response = await request(app)
        .post('/api/purchases')
        .set('Cookie', authCookie)
        .send({ admin_id: userId, supplier: 'No items supplier, will crash' });

      // Bad Request from Zod Validator
      expect(response.status).toBe(400); 
    });
  });

  describe('GET /api/purchases', () => {
    it('should return a list of purchases belonging to the logged user', async () => {
      // Creamos una de forma limpia
      await request(app).post('/api/purchases').set('Cookie', authCookie).send({
        admin_id: userId,
        supplier: 'Test Supplier 123',
        items: [{ product_id: productId, quantity: 2, unit_cost: 50 }]
      });

      const response = await request(app).get('/api/purchases').set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.purchases).toHaveLength(1);
      expect(response.body.purchases[0].supplier).toBe('Test Supplier 123');
      expect(response.body.purchases[0].admin_id).toHaveProperty('email'); // Populated relation
    });
  });

  describe('GET /api/purchases/:id', () => {
    it('should retrieve a single purchase and its mapped purchase details', async () => {
      const createRes = await request(app).post('/api/purchases').set('Cookie', authCookie).send({
        admin_id: userId,
        supplier: 'Single Detail Prov',
        items: [{ product_id: productId, quantity: 5, unit_cost: 30 }]
      });
      const purchaseId = createRes.body.purchase._id;

      const response = await request(app).get(`/api/purchases/${purchaseId}`).set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.purchase._id).toBe(purchaseId);
      
      // Verifica que traiga los items empaquetados juntos
      expect(response.body.details).toHaveLength(1);
      // Verifica populación de la tabla de detalles con la de productos (nombre)
      expect(response.body.details[0].product_id.name).toBe('Engine X1'); 
    });

    it('should return 404 for a non-existent purchase search', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const response = await request(app).get(`/api/purchases/${fakeId}`).set('Cookie', authCookie);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});
