import mongoose from 'mongoose';
import { Purchase } from '../models/Purchase.js';
import { PurchaseDetail } from '../models/PurchaseDetail.js';
import { Product } from '../models/Product.js';
import { getOrSetCache, invalidateCache } from '../lib/redis.js';

export const createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { supplier, items } = req.body;

    // Calcular costo total
    let total_cost = 0;
    for (const item of items) {
      // Verificar que el producto pertenece al usuario
      const product = await Product.findOne({ _id: item.product_id, user: req.userId }).session(session);
      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: `Producto con ID ${item.product_id} no encontrado`
        });
      }
      total_cost += item.quantity * item.unit_cost;
    }

    // 1. Crear la Compra Principal (asociada al usuario autenticado)
    const purchase = new Purchase({
      admin_id: req.userId,
      supplier,
      total_cost
    });
    await purchase.save({ session });

    // 2. Crear los Detalles de Compra
    for (const item of items) {
      const detail = new PurchaseDetail({
        purchase_id: purchase._id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_cost: item.unit_cost
      });
      await detail.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    // Invalidar caché de compras y productos (el stock cambia con las compras)
    await invalidateCache(`purchases:${req.userId}`, `products:${req.userId}`);

    res.status(201).json({
      success: true,
      message: "Compra registrada exitosamente",
      purchase
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getPurchases = async (req, res) => {
  try {
    const cacheKey = `purchases:${req.userId}`;
    const { data: purchases, fromCache } = await getOrSetCache(cacheKey, () =>
      Purchase.find({ admin_id: req.userId })
        .populate('admin_id', 'name email')
        .sort({ createdAt: -1 })
        .lean()
    );

    res.status(200).json({ success: true, purchases, fromCache });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `purchase:${id}:${req.userId}`;

    const { data, fromCache } = await getOrSetCache(cacheKey, async () => {
      const purchase = await Purchase.findOne({ _id: id, admin_id: req.userId })
        .populate('admin_id', 'name email')
        .lean();

      if (!purchase) return null;

      const details = await PurchaseDetail.find({ purchase_id: id })
        .populate('product_id', 'name')
        .lean();

      return { purchase, details };
    });

    if (!data) {
      return res.status(404).json({ success: false, message: "Compra no encontrada" });
    }

    res.status(200).json({
      success: true,
      purchase: data.purchase,
      details: data.details,
      fromCache
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
