import { invalidateCache } from '../lib/redis.js';
import { createPurchaseProcess, fetchPurchases, fetchPurchaseById } from '../services/purchase.service.js';

export const createPurchase = async (req, res) => {
  try {
    const { supplier, items } = req.body;

    const purchase = await createPurchaseProcess(req.userId, supplier, items);

    // Invalidar caché de compras y productos detallados
    const keysToInvalidate = [`purchases:${req.userId}`, `products:${req.userId}`];
    for (const item of items) {
       keysToInvalidate.push(`product:${item.product_id}:${req.userId}`);
    }
    await invalidateCache(...keysToInvalidate);

    res.status(201).json({
      success: true,
      message: "Compra registrada exitosamente",
      purchase
    });

  } catch (error) {
    const status = error.message.includes("encontrado") ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const getPurchases = async (req, res) => {
  try {
    const purchases = await fetchPurchases(req.userId);
    res.status(200).json({ success: true, purchases });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await fetchPurchaseById(id, req.userId);

    if (!data) {
      return res.status(404).json({ success: false, message: "Compra no encontrada" });
    }

    res.status(200).json({
      success: true,
      purchase: data.purchase,
      details: data.details
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
