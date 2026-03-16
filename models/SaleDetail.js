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
        min: 1
    },
    unit_price: {
        type: Number,
        required: true,
        min: 0
    }
}, { timestamps: true });

// Middleware pre-save: Reglas de validación y reducción de Inventario
saleDetailSchema.pre('save', async function (next) {
    const session = this.$session();
    try {
        const product = await Product.findById(this.product_id).session(session);
        if (!product) {
            throw new Error('Producto no encontrado.');
        }

        // Validación CRÍTICA: Bloquear si no hay inventario
        if (product.stock - this.quantity < 0) {
            throw new Error(`Inventario insuficiente. Stock actual de ${product.name}: ${product.stock}. Cantidad solicitada: ${this.quantity}`);
        }

        // Descontar inventario
        await Product.findByIdAndUpdate(
            this.product_id,
            { $inc: { stock: -this.quantity } },
            { session }
        );

        next();
    } catch (error) {
        next(error);
    }
});

export const SaleDetail = mongoose.model('SaleDetail', saleDetailSchema);
