import mongoose from 'mongoose';
import { Product } from './Product.js';

const saleDetailSchema = new mongoose.Schema({
    sale_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Sale',
        required: true
    },
    product_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 0.01
    },
    unit_price: {
        type: Number,
        required: true,
        min: 0
    }
}, { timestamps: true });

// Middleware pre-save: Solo validación de inventario (el controlador descuenta stock)
saleDetailSchema.pre('save', async function () {
    const product = await Product.findById(this.product_id);
    if (!product) {
        throw new Error('Producto no encontrado.');
    }

    // Validación CRÍTICA: Bloquear si el controlador dejó el inventario en negativo
    if (product.stock < 0) {
        throw new Error(`Inventario insuficiente. El stock de ${product.name} quedó en negativo.`);
    }
});

export const SaleDetail = mongoose.model('SaleDetail', saleDetailSchema);
