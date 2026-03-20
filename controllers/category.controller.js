import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';

export const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    const categoryExists = await Category.findOne({ name, user: req.userId });
    if (categoryExists) {
      return res.status(400).json({ success: false, message: "La categoría ya existe" });
    }

    const category = new Category({ name, description, user: req.userId });
    await category.save();

    res.status(201).json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ user: req.userId });
    res.status(200).json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findOne({ _id: id, user: req.userId });
    if (!category) {
      return res.status(404).json({ success: false, message: "Categoría no encontrada" });
    }
    res.status(200).json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body || {};

    const category = await Category.findOneAndUpdate(
      { _id: id, user: req.userId },
      { name, description },
      { returnDocument: 'after', runValidators: true }
    );

    if (!category) {
      return res.status(404).json({ success: false, message: "Categoría no encontrada" });
    }

    res.status(200).json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que la categoría pertenece al usuario
        const category = await Category.findOne({ _id: id, user: req.userId });
        if (!category) {
            return res.status(404).json({ success: false, message: "Categoría no encontrada" });
        }

        // Precaución: Verificar si existen productos asociados a esta categoría
        const hasProducts = await Product.findOne({ category: id, user: req.userId });
        if (hasProducts) {
            return res.status(400).json({ 
                success: false, 
                message: "No se puede eliminar la categoría porque tiene productos asociados. Elimínelos o reasígnelos primero." 
            });
        }

        await Category.findByIdAndDelete(id);

        res.status(200).json({ success: true, message: "Categoría eliminada correctamente" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
