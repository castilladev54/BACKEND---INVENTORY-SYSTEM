import mongoose from 'mongoose';
import { InventoryAdjustment } from '../models/InventoryAdjustment.js';
import { Product } from '../models/Product.js';
import { getOrSetCache, invalidateCache } from '../lib/redis.js';

export const createAdjustment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { product_id, new_stock, reason, notes } = req.body;
    const user_id = req.userId;

    // Verificamos que el producto exista y pertenezca al usuario
    const product = await Product.findOne({ _id: product_id, user: user_id }).session(session);
    
    if (!product) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Producto no encontrado" });
    }

    const previous_stock = product.stock;
    const difference = new_stock - previous_stock;

    // Si no hay cambio matemáticamente, rebotar por seguridad
    if (difference === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "El nuevo stock es igual al stock actual. No hay nada que ajustar." });
    }

    // 1. Actualizamos el stock en el producto
    product.stock = new_stock;
    await product.save({ session });

    // 2. Registramos el historial inmutable del ajuste
    const adjustment = new InventoryAdjustment({
      product_id,
      user_id,
      previous_stock,
      new_stock,
      difference,
      reason,
      notes: notes || ""
    });

    await adjustment.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Invalidamos el caché tanto del dashboard de productos como de los ajustes
    await invalidateCache(`products:${user_id}`, `adjustments:${user_id}`);

    res.status(201).json({
      success: true,
      message: "Ajuste de inventario realizado correctamente",
      adjustment
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error in createAdjustment: ", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdjustments = async (req, res) => {
  try {
    const user_id = req.userId;
    const cacheKey = `adjustments:${user_id}`;

    // Retorna historial ordenado para una tabla ("Kárdex" básico)
    const { data: adjustments, fromCache } = await getOrSetCache(cacheKey, () => 
      InventoryAdjustment.find({ user_id })
        .populate('product_id', 'name barcode price')
        .sort({ createdAt: -1 })
        .lean()
    );

    res.status(200).json({ success: true, adjustments, fromCache });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
