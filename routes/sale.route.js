import express from 'express';
import {
    createSale,
    getSales,
    getSaleById
} from '../controllers/sale.controller.js';

const router = express.Router();

// Rutas para Ventas (Sales)
router.post('/', createSale);
router.get('/', getSales);
router.get('/:id', getSaleById);

export default router;
