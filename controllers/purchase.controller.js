import { invalidateCache } from '../lib/redis.js';
import { createPurchaseProcess, fetchPurchases, fetchPurchaseById, registerPayment } from '../services/purchase.service.js';

export const createPurchase = async (req, res) => {
  try {
    const { supplier, items, dueDate } = req.body;

    const purchase = await createPurchaseProcess(req.userId, supplier, items, dueDate);

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
    const { status, filterBy } = req.query;
    const filters = {};

    if (status) filters.status = status;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Inicio del día

    if (filterBy === 'expiringSoon') {
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        
        filters.status = { $ne: 'PAID' };
        filters.due_date = { $gte: today, $lte: nextWeek };
    } else if (filterBy === 'overdue') {
        filters.status = { $ne: 'PAID' };
        filters.due_date = { $lt: today };
    }

    const purchases = await fetchPurchases(req.userId, filters);
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

export const payPurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "El monto debe ser mayor a cero." });
    }

    const purchase = await registerPayment(id, req.userId, amount);

    // Invalidar caché general de compras para asegurar que la lista refleje el pago
    await invalidateCache(`purchases:${req.userId}`);

    res.status(200).json({
      success: true,
      message: "Pago registrado exitosamente",
      purchase
    });
  } catch (error) {
    const status = error.message.includes("encontrada") ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
};
