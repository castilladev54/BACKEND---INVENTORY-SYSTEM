import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../server.js';
import { User } from '../models/User.js';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import bcryptjs from 'bcryptjs';

// Mockeamos el envío de emails para evitar enviar correos reales
vi.mock('../mailtrap/emails.js', () => ({
  sendVerificationEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

// Mock Redis: evita llamadas HTTP reales a Upstash en CI/CD
vi.mock('../lib/redis.js', () => ({
  redis: {},
  getOrSetCache: vi.fn(async (_key, fn) => ({ data: await fn(), fromCache: false })),
  invalidateCache: vi.fn(async () => {}),
}));

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(mongoUri);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

afterEach(async () => {
  // Limpiamos las ventas de forma aislada
  await Sale.deleteMany({});
  await SaleDetail.deleteMany({});
  // Limpiamos los productos para que el stock de todas las pruebas parta del mismo base sin corromperse
  await Product.deleteMany({});
  vi.clearAllMocks();
});

describe('Sale Controllers Integration', () => {
  let authCookie;
  let userId;
  let categoryId;
  let productId;
  
  beforeAll(async () => {
    const testEmail = `seller${Date.now()}${Math.floor(Math.random()*1000)}@example.com`;
    const hashedPassword = await bcryptjs.hash('password123', 10);
    const user = await User.create({
      email: testEmail,
      password: hashedPassword,
      name: 'Sales Admin',
      role: 'admin'
    });
    userId = user._id.toString();
    
    const loginRes = await request(app).post('/api/auth/login').send({
      email: testEmail, password: 'password123'
    });
    authCookie = loginRes.headers['set-cookie'];

    const category = new Category({ name: 'Tech Store', user: userId });
    await category.save();
    categoryId = category._id.toString();
  });

  beforeEach(async () => {
    // El producto se recrea limpio en cada prueba con un stock Fijo de 20
    const product = new Product({
      name: 'Queso Mozzarella',
      price: 1000,
      stock: 20, // Simulamos 20kg
      unit_type: 'kg',
      category: categoryId,
      user: userId
    });
    await product.save();
    productId = product._id.toString();
  });

  describe('POST /api/sales', () => {
    it('should create a sale with FRACTIONAL quantities (kg support) and automatically DECREMENT product stock', async () => {
      // Zod Validator exige obligatoriamente incluir 'customer_id' en el body.
      const payload = {
        customer_id: userId,
        payment_method: 'Credit Card',
        items: [
          {
            product_id: productId,
            quantity: 5.5, // 5 kilos y medio
            unit_price: 1500 // total_amount del comprobante debería autocalcularse en 8250 (1500 * 5.5)
          }
        ]
      };

      const response = await request(app)
        .post('/api/sales')
        .set('Cookie', authCookie)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.sale.total_amount).toBe(8250); // 1500 * 5.5 = 8250
      expect(response.body.sale.payment_method).toBe('Credit Card');
      expect(response.body.sale.status).toBe('completed');
      
      const saleId = response.body.sale._id;

      // 1. Verificamos la creación detallada en la colección SaleDetail
      const details = await SaleDetail.find({ sale_id: saleId });
      expect(details).toHaveLength(1);
      expect(details[0].product_id.toString()).toBe(productId);
      expect(details[0].quantity).toBe(5.5);

      // 2. STOCK DECREMENTADO AUTOMÁTICAMENTE: 
      // Teníamos 20 de inventario, acabamos de vender 5.5 -> Quedan 14.5
      const updatedProduct = await Product.findById(productId);
      expect(updatedProduct.stock).toBe(14.5);
    });

    it('should return 400 validation error if missing required Zod fields (e.g., customer_id)', async () => {
      const payload = {
        payment_method: 'Cash', // Falla Zod xq falta customer_id
        items: [{ product_id: productId, quantity: 1, unit_price: 1 }]
      };

      const response = await request(app)
        .post('/api/sales')
        .set('Cookie', authCookie)
        .send(payload);

      expect(response.status).toBe(400); 
    });

    it('should return 400 if trying to sell MORE stock than what is currently available', async () => {
      const payload = {
        customer_id: userId,
        payment_method: 'Debit',
        items: [{ product_id: productId, quantity: 50.2, unit_price: 1000 }] // stock original es 20. Trato de vender 50.2
      };

      const response = await request(app)
        .post('/api/sales')
        .set('Cookie', authCookie)
        .send(payload);

      expect(response.status).toBe(400); 
      expect(response.body.message).toContain('Stock insuficiente para Queso Mozzarella');
      
      // El stock debió quedarse en 20 intacto porque el sistema rebotó la venta exitosamente en el controlador
      const updatedProduct = await Product.findById(productId);
      expect(updatedProduct.stock).toBe(20);
    });

    it('should return 404 if product inside the items array does not exist', async () => {
      const fakeProductId = new mongoose.Types.ObjectId().toString();
      const payload = {
        customer_id: userId,
        payment_method: 'Debit',
        items: [{ product_id: fakeProductId, quantity: 1, unit_price: 10 }]
      };

      const response = await request(app)
        .post('/api/sales')
        .set('Cookie', authCookie)
        .send(payload);

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('no encontrado');
    });
  });

  describe('GET /api/sales', () => {
    it('should list all available sales for the specific user', async () => {
      await request(app).post('/api/sales').set('Cookie', authCookie).send({
        customer_id: userId,
        payment_method: 'Cash',
        items: [{ product_id: productId, quantity: 2, unit_price: 50 }]
      });

      const response = await request(app).get('/api/sales').set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.sales).toHaveLength(1);
      expect(response.body.sales[0].payment_method).toBe('Cash');
      expect(response.body.sales[0].total_amount).toBe(100);
    });
  });

  describe('GET /api/sales/:id', () => {
    it('should fetch a single specific sale aggregating its items (details array)', async () => {
      // 1. Crear
      const createRes = await request(app).post('/api/sales').set('Cookie', authCookie).send({
             customer_id: userId,
             payment_method: 'PayPal',
             items: [{ product_id: productId, quantity: 3.5, unit_price: 100 }]
      });
      const saleId = createRes.body.sale._id;

      // 2. Levantar la data individual
      const response = await request(app).get(`/api/sales/${saleId}`).set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.sale._id).toBe(saleId);
      expect(response.body.sale.payment_method).toBe('PayPal');
      
      // 3. El Backend inyecta el listado de Detalle en un array en la raíz del json usando `items:`
      expect(response.body.sale.items).toBeDefined();
      expect(response.body.sale.items).toHaveLength(1); 
      expect(response.body.sale.items[0].product_id.name).toBe('Queso Mozzarella'); // populado automáticamente
    });

    it('should return 404 for grabbing a non-existent sale ID', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const response = await request(app).get(`/api/sales/${fakeId}`).set('Cookie', authCookie);
      
      expect(response.status).toBe(404);
    });
  });
});
