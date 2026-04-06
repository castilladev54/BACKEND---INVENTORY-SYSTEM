import mongoose from 'mongoose';
import { Purchase } from '../models/Purchase.js';
import { PurchaseDetail } from '../models/PurchaseDetail.js';
import { Product } from '../models/Product.js';

export const createPurchaseProcess = async (userId, supplier, items, dueDate = null) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    let total_cost = 0;

    // Validación y cálculo en bloque para eficiencia
    const productIds = items.map(i => i.product_id);
    const products = await Product.find({ _id: { $in: productIds }, user: userId }).session(session);
    const productsMap = new Map(products.map(p => [p._id.toString(), p]));

    for (const item of items) {
      if (!productsMap.has(item.product_id)) {
        throw new Error(`Producto con ID ${item.product_id} no encontrado.`);
      }
      total_cost += item.quantity * item.unit_cost;
    }

    // Si no se envía fecha de vencimiento, por defecto 30 días
    const defaultDueDate = new Date();
    defaultDueDate.setDate(defaultDueDate.getDate() + 30);

    // 1. Crear Venta Principal
    const purchase = new Purchase({
      admin_id: userId,
      supplier,
      total_cost,
      due_date: dueDate || defaultDueDate
    });
    await purchase.save({ session });

    // 2. Crear Detalles y afectar stock a través del hook de Mongoose
    for (const item of items) {
      const detail = new PurchaseDetail({
        purchase_id: purchase._id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_cost: item.unit_cost
      });
      await detail.save({ session }); // Esto dispara los middlewares de stock e inventory_cost
    }

    await session.commitTransaction();
    session.endSession();
    return purchase;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

export const fetchPurchases = async (userId, filters = {}) => {
  const query = { admin_id: userId, ...filters };
  return Purchase.find(query)
    .populate('admin_id', 'name email')
    .sort({ createdAt: -1 })
    .lean();
};

export const fetchPurchaseById = async (id, userId) => {
  const purchase = await Purchase.findOne({ _id: id, admin_id: userId })
    .populate('admin_id', 'name email')
    .lean();

  if (!purchase) return null;

  const details = await PurchaseDetail.find({ purchase_id: id })
    .populate('product_id', 'name')
    .lean();

  return { purchase, details };
};

export const registerPayment = async (purchaseId, userId, amount) => {
  const purchase = await Purchase.findOne({ _id: purchaseId, admin_id: userId });
  if (!purchase) throw new Error("Compra no encontrada.");

  if (purchase.status === 'PAID') throw new Error("La compra ya se encuentra pagada completamente.");

  purchase.paid_amount = (purchase.paid_amount || 0) + amount;

  if (purchase.paid_amount >= purchase.total_cost) {
    purchase.status = 'PAID';
    purchase.paid_amount = purchase.total_cost; // Si se abona de más, nivelar.
    purchase.payment_date = new Date();
  } else {
    purchase.status = 'PARTIAL';
  }

  await purchase.save();
  return purchase;
};
