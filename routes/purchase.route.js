import express from 'express';
import {
    createPurchase,
    getPurchases,
    getPurchaseById
} from '../controllers/purchase.controller.js';
import { validate } from '../middleware/validate.js';
import { createPurchaseSchema, purchaseIdSchema } from '../validations/purchase.validation.js';

const router = express.Router();

// Rutas para Compras (Purchases)
router.post('/', validate(createPurchaseSchema), createPurchase);
router.get('/', getPurchases);
router.get('/:id', validate(purchaseIdSchema), getPurchaseById);

export default router;
