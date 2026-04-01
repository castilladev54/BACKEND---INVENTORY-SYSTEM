import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { invalidateCache } from '../lib/redis.js';

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
    const { name, description, price, category, unit_type, barcode } = req.body;

    // Si se envía una categoría, verificar que exista y pertenezca al usuario
    if (category) {
      const categoryExists = await Category.findOne({ _id: category, user: req.userId });
      if (!categoryExists) {
        return res.status(400).json({
          success: false,
          message: "La categoría especificada no existe"
        });
      }
    }

    // Si se envía barcode, verificar que no esté duplicado en otro producto del usuario
    if (barcode) {
      const barcodeExists = await Product.findOne({
        barcode,
        user: req.userId,
        _id: { $ne: id } // Excluir el producto actual
      });
      if (barcodeExists) {
        return res.status(400).json({
          success: false,
          message: `El código de barras "${barcode}" ya está asignado al producto "${barcodeExists.name}"`
        });
      }
    }

    const updateData = { name, description, price, category, unit_type };
    // Permitir establecer barcode a null (eliminar) o a un nuevo valor
    if (barcode !== undefined) {
      updateData.barcode = barcode;
    }

    const product = await Product.findOneAndUpdate(
      { _id: id, user: req.userId },
      updateData,
      { returnDocument: 'after', runValidators: true }
    ).populate('category', 'name');

    if (!product) {
      return res.status(404).json({ success: false, message: "Producto no encontrado" });
    }

    // Invalidar caché del listado, producto individual y barcode anterior
    await invalidateCache(
      `products:${req.userId}`,
      `product:${id}:${req.userId}`,
      `barcode:${barcode}:${req.userId}`
    );

    res.status(200).json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
