import mongoose from 'mongoose';
import { InventoryAdjustment } from '../models/InventoryAdjustment.js';
import { Product } from '../models/Product.js';

/**
 * Ejecuta el proceso de ajuste de inventario.
 * @param {string}   userId       - ID del usuario propietario
 * @param {string}   product_id   - ID del producto a ajustar
 * @param {number}   new_stock    - Nuevo valor de stock
 * @param {string}   reason       - Motivo del ajuste
 * @param {string}   notes        - Notas adicionales
 * @param {object}   [extSession] - Sesión de Mongoose externa (opcional).
 *                                  Si se provee, el servicio opera dentro de la
 *                                  transacción del llamador y NO la confirma.
 *                                  Si es null, crea y gestiona su propia sesión.
 */
export const createAdjustmentProcess = async (userId, product_id, new_stock, reason, notes, extSession = null) => {
  // Si el llamador ya tiene una sesión abierta, la reutilizamos (sin crear nueva transacción)
  const ownSession = !extSession;
  const session = extSession ?? await mongoose.startSession();

  if (ownSession) session.startTransaction();

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

    // 2. Registrar historial (Kardex)
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

    // Solo confirmamos si somos dueños de la sesión
    if (ownSession) {
      await session.commitTransaction();
      session.endSession();
    }

    return adjustment;
  } catch (error) {
    if (ownSession) {
      await session.abortTransaction();
      session.endSession();
    }
    throw error;
  }
};

export const fetchAdjustments = async (userId) => {
  return InventoryAdjustment.find({ user_id: userId })
    .populate('product_id', 'name barcode price')
    .sort({ createdAt: -1 })
    .lean();
};
