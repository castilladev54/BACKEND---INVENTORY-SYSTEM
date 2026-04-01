import { invalidateCache } from '../lib/redis.js';
import { createAdjustmentProcess, fetchAdjustments } from '../services/adjustment.service.js';

export const createAdjustment = async (req, res) => {
  try {
    const { product_id, new_stock, reason, notes } = req.body;

    const adjustment = await createAdjustmentProcess(req.userId, product_id, new_stock, reason, notes);

    // Invalidamos el caché listado de productos, listado de ajustes, y el producto en específico 
    await invalidateCache(
      `products:${req.userId}`, 
      `adjustments:${req.userId}`, 
      `product:${product_id}:${req.userId}`
    );

    res.status(201).json({
      success: true,
      message: "Ajuste de inventario realizado correctamente",
      adjustment
    });

  } catch (error) {
    console.error("Error in createAdjustment: ", error);
    const status = error.message.includes("encontrado") || error.message.includes("igual") ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const getAdjustments = async (req, res) => {
  try {
    const adjustments = await fetchAdjustments(req.userId);
    res.status(200).json({ success: true, adjustments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
