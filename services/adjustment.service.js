import mongoose from 'mongoose';
import { InventoryAdjustment } from '../models/InventoryAdjustment.js';
import { Product } from '../models/Product.js';

export const createAdjustmentProcess = async (userId, product_id, new_stock, reason, notes) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const product = await Product.findOne({ _id: product_id, user: userId }).session(session);
    
    if (!product) {
      throw new Error("Producto no encontrado o no te pertenece");
    }

    const previous_stock = product.stock;
    const difference = new_stock - previous_stock;

    if (difference === 0) {
      throw new Error("El nuevo stock es igual al stock actual. No hay nada que ajustar.");
    }

    // 1. Actualizar stock
    product.stock = new_stock;
    await product.save({ session });

    // 2. Registrar historial
    const adjustment = new InventoryAdjustment({
      product_id,
      user_id: userId,
      previous_stock,
      new_stock,
      difference,
      reason,
      notes: notes || ""
    });

    await adjustment.save({ session });

    await session.commitTransaction();
    session.endSession();

    return adjustment;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

export const fetchAdjustments = async (userId) => {
  return InventoryAdjustment.find({ user_id: userId })
    .populate('product_id', 'name barcode price')
    .sort({ createdAt: -1 })
    .lean();
};
