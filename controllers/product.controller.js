import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';

export const createProduct = async (req, res) => {
  try {
    // Ignoramos 'stock' del body. El inventario se nutrirá después mediante Compras (Purchases).
    const { name, description, price, category } = req.body;

    // Verificar si la categoría existe y pertenece al usuario
    const categoryExists = await Category.findOne({ _id: category, user: req.userId });
    if (!categoryExists) {
      return res.status(400).json({
        success: false,
        message: "La categoría especificada no existe"
      });
    }

    const product = new Product({
      name,
      description,
      price,
      stock: 0, // Inicia siempre en 0
      category,
      user: req.userId
    });

    await product.save();
    res.status(201).json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getProducts = async (req, res) => {
  try {
    const products = await Product.find({ user: req.userId }).populate('category', 'name');
    res.status(200).json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findOne({ _id: id, user: req.userId }).populate('category', 'name');

    if (!product) {
      return res.status(404).json({ success: false, message: "Producto no encontrado" });
    }

    res.status(200).json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, category } = req.body; // Se ignora 'stock'

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

    const product = await Product.findOneAndUpdate(
      { _id: id, user: req.userId },
      { name, description, price, category }, // Se quita 'stock' para evitar sobreescritura manual

      { returnDocument: 'after', runValidators: true }
    ).populate('category', 'name');

    if (!product) {
      return res.status(404).json({ success: false, message: "Producto no encontrado" });
    }

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

    res.status(200).json({ success: true, message: "Producto eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
