import mongoose from 'mongoose';
import { Purchase } from '../models/Purchase.js';
import { PurchaseDetail } from '../models/PurchaseDetail.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';

export const createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { admin_id, supplier, items } = req.body || {};

    if (!admin_id || !supplier || !items || !items.length) {
      return res.status(400).json({
        success: false,
        message: "Admin ID, proveedor y lista de productos son obligatorios"
      });
    }

    // Verificar si el admin existe
    const admin = await User.findById(admin_id).session(session);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "El usuario no existe o no tiene permisos de administrador"
      });
    }

    // Calcular costo total
    let total_cost = 0;
    for (const item of items) {
      total_cost += item.quantity * item.unit_cost;
    }

    // 1. Crear la Compra Principal
    const purchase = new Purchase({
      admin_id,
      supplier,
      total_cost
    });
    await purchase.save({ session });

    // 2. Crear los Detalles de Compra
    // Nota: El middleware pre-save de PurchaseDetail se encargará de:
    // - Incrementar el stock del producto
    // - Recalcular el av_inventory_cost del Admin
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
    const purchases = await Purchase.find()
      .populate('admin_id', 'name email')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, purchases });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findById(id).populate('admin_id', 'name email');

    if (!purchase) {
      return res.status(404).json({ success: false, message: "Compra no encontrada" });
    }

    const details = await PurchaseDetail.find({ purchase_id: id }).populate('product_id', 'name');

    res.status(200).json({
      success: true,
      purchase,
      details
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
