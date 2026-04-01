import express from 'express';
import {
    createSale,
    getSales,
    getSaleById
} from '../controllers/sale.controller.js';
import { validate } from '../middleware/validate.js';
import { createSaleSchema, saleIdSchema } from '../validations/sale.validation.js';
import { cacheMiddleware } from '../middleware/cache.middleware.js';

const router = express.Router();

// Rutas para Ventas (Sales)
router.post('/', validate(createSaleSchema), createSale);
router.get('/', cacheMiddleware('sales', 'sales'), getSales);
router.get('/:id', validate(saleIdSchema), cacheMiddleware('sale', 'sale', 'id'), getSaleById);

export default router;
