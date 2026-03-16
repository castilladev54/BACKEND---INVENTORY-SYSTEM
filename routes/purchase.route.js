import express from 'express';
import {
    createPurchase,
    getPurchases,
    getPurchaseById
} from '../controllers/purchase.controller.js';

const router = express.Router();

// Rutas para Compras (Purchases)
router.post('/', createPurchase);
router.get('/', getPurchases);
router.get('/:id', getPurchaseById);

export default router;
