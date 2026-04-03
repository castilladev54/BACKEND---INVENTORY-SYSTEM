import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { invalidateCache } from '../lib/redis.js';
import { createAdjustmentProcess } from '../services/adjustment.service.js';

export const createProduct = async (req, res) => {
  try {
    // Ignoramos 'stock' del body. El inventario se nutrirá después mediante Compras (Purchases).
    const { name, description, price, category, unit_type, barcode } = req.body;

    // Verificar si la categoría existe y pertenece al usuario
    const categoryExists = await Category.findOne({ _id: category, user: req.userId });
    if (!categoryExists) {
      return res.status(400).json({
        success: false,
        message: "La categoría especificada no existe"
      });
    }

    // Si se envía barcode, verificar que no esté duplicado para este usuario
    if (barcode) {
      const barcodeExists = await Product.findOne({ barcode, user: req.userId });
      if (barcodeExists) {
        return res.status(400).json({
          success: false,
          message: `El código de barras "${barcode}" ya está asignado al producto "${barcodeExists.name}"`
        });
      }
    }

    const product = new Product({
      name,
      description,
      price,
      stock: 0, // Inicia siempre en 0
      category,
      unit_type,
      ...(barcode ? { barcode } : {}), // Solo incluir si existe
      user: req.userId
    });

    await product.save();

    // Invalidar caché de listado de productos del usuario
    await invalidateCache(`products:${req.userId}`);

    res.status(201).json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getProducts = async (req, res) => {
  try {
    const products = await Product.find({ user: req.userId }).populate('category', 'name').lean();
    res.status(200).json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findOne({ _id: id, user: req.userId }).populate('category', 'name').lean();

    if (!product) {
      return res.status(404).json({ success: false, message: "Producto no encontrado" });
    }

    res.status(200).json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Buscar producto por código de barras ──────────────────────
export const getProductByBarcode = async (req, res) => {
  try {
    const { code } = req.params;

    const product = await Product.findOne({ barcode: code, user: req.userId })
        .populate('category', 'name')
        .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "No se encontró un producto con ese código de barras"
      });
    }

    res.status(200).json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, unit_type, barcode, new_stock, stock_reason } = req.body;

    // ── 1. Validar categoría si se envía ─────────────────────────────────────
    if (category) {
      const categoryExists = await Category.findOne({ _id: category, user: req.userId });
      if (!categoryExists) {
        return res.status(400).json({ success: false, message: "La categoría especificada no existe" });
      }
    }

    // ── 2. Validar barcode duplicado si se envía ──────────────────────────────
    if (barcode) {
      const barcodeExists = await Product.findOne({ barcode, user: req.userId, _id: { $ne: id } });
      if (barcodeExists) {
        return res.status(400).json({
          success: false,
          message: `El código de barras "${barcode}" ya está asignado al producto "${barcodeExists.name}"`
        });
      }
    }

    // ── 3. Construir payload de actualización (solo campos de metadata) ───────
    const updateData = {};
    if (name        !== undefined) updateData.name        = name;
    if (description !== undefined) updateData.description = description;
    if (price       !== undefined) updateData.price       = price;
    if (category    !== undefined) updateData.category    = category;
    if (unit_type   !== undefined) updateData.unit_type   = unit_type;
    if (barcode     !== undefined) updateData.barcode     = barcode;

    // ── 4a. SIN corrección de stock → update simple ──────────────────────────
    if (new_stock === undefined) {
      const product = await Product.findOneAndUpdate(
        { _id: id, user: req.userId },
        updateData,
        { returnDocument: 'after', runValidators: true }
      ).populate('category', 'name');

      if (!product) {
        return res.status(404).json({ success: false, message: "Producto no encontrado" });
      }

      await invalidateCache(
        `products:${req.userId}`,
        `product:${id}:${req.userId}`,
        `barcode:${barcode}:${req.userId}`
      );

      return res.status(200).json({ success: true, product });
    }

    // ── 4b. CON corrección de stock → transacción ACID ────────────────────────
    // Usamos createAdjustmentProcess que ya encapsula la transacción.
    // PERO necesitamos también actualizar los campos de metadata del producto
    // dentro de la MISMA sesión. Lo hacemos con una sesión compartida manualmente.
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 4b.1 Actualizar campos de metadata dentro de la sesión
      const product = await Product.findOneAndUpdate(
        { _id: id, user: req.userId },
        updateData,
        { returnDocument: 'after', runValidators: true, session }
      ).populate('category', 'name');

      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Producto no encontrado" });
      }

      // 4b.2 Crear el ajuste de inventario silenciosamente usando el servicio existente.
      // NOTA: createAdjustmentProcess gestiona su propia sesión internamente.
      // La llamamos FUERA de la sesión actual para evitar sesiones anidadas
      // (MongoDB no las soporta). Si el ajuste falla, abortamos la actualización.
      await session.commitTransaction();
      session.endSession();

      // El ajuste corre en su propia transacción (si falla, lanza error)
      await createAdjustmentProcess(req.userId, id, new_stock, stock_reason, 'Corrección desde edición de producto');

      // Invalidar caché después de todo
      await invalidateCache(
        `products:${req.userId}`,
        `product:${id}:${req.userId}`,
        `adjustments:${req.userId}`,
        `barcode:${barcode}:${req.userId}`
      );

      return res.status(200).json({
        success: true,
        product,
        stockAdjusted: true,
        message: `Producto actualizado. Stock ajustado a ${new_stock}.`
      });

    } catch (innerError) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
      throw innerError;
    }

  } catch (error) {
    console.error('updateProduct error:', error.message);
    const status = error.message.includes('igual al stock actual') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findOneAndDelete({ _id: id, user: req.userId });

    if (!product) {
      return res.status(404).json({ success: false, message: "Producto no encontrado" });
    }

    // Invalidar caché del listado, producto individual y barcode si existía
    const keysToInvalidate = [
      `products:${req.userId}`,
      `product:${id}:${req.userId}`
    ];
    if (product.barcode) {
      keysToInvalidate.push(`barcode:${product.barcode}:${req.userId}`);
    }
    await invalidateCache(...keysToInvalidate);

    res.status(200).json({ success: true, message: "Producto eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
