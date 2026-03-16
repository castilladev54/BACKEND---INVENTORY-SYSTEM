import express from 'express';
import {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory
} from '../controllers/category.controller.js';

const router = express.Router();

// Crear una nueva categoría
router.post('/', createCategory);

// Obtener todas las categorías
router.get('/', getCategories);

// Obtener una categoría por su ID
router.get('/:id', getCategoryById);

// Actualizar una categoría
router.put('/:id', updateCategory);

// Eliminar una categoría
router.delete('/:id', deleteCategory);

export default router;
