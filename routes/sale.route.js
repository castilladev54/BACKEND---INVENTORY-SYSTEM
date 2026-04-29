import express from 'express';
import {
    createSale,
    getSales,
    getSaleById
} from '../controllers/sale.controller.js';
import { validate } from '../middleware/validate.js';
import { createSaleSchema, saleIdSchema } from '../validations/sale.validation.js';

const router = express.Router();

// Rutas para Ventas (Sales)
router.post('/', validate(createSaleSchema), createSale);
router.get('/', getSales);
router.get('/:id', validate(saleIdSchema), getSaleById);

export default router;
