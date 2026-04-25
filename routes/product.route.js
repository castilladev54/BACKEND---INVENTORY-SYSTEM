import express from 'express';
import {
    createProduct,
    getProducts,
    getProductById,
    getProductByBarcode,
    updateProduct,
    deleteProduct
} from '../controllers/product.controller.js';
import { validate } from '../middleware/validate.js';
import { createProductSchema, updateProductSchema, productIdSchema, barcodeParamSchema } from '../validations/product.validation.js';
import { cacheMiddleware } from '../middleware/cache.middleware.js';

const router = express.Router();

// Rutas para Productos
router.post('/', validate(createProductSchema), createProduct);
router.get('/', getProducts); // Caché manejada internamente con versionado
router.get('/barcode/:code', validate(barcodeParamSchema), cacheMiddleware('barcode', 'product', 'code'), getProductByBarcode);
router.get('/:id', validate(productIdSchema), cacheMiddleware('product', 'product', 'id'), getProductById);
router.put('/:id', validate(updateProductSchema), updateProduct);
router.delete('/:id', validate(productIdSchema), deleteProduct);

export default router;
