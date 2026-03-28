import mongoose from 'mongoose';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { Product } from '../models/Product.js';
import { getOrSetCache, invalidateCache } from '../lib/redis.js';

export const createSale = async (req, res) => {
    try {
        const { items, payment_method } = req.body;

        // Validar stock y calcular total
        let total_amount = 0;
        for (const item of items) {
            const product = await Product.findOne({ _id: item.product_id, user: req.userId });
            if (!product) {
                return res.status(404).json({ success: false, message: `Producto con ID ${item.product_id} no encontrado` });
            }
            if (product.stock < item.quantity) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Stock insuficiente para ${product.name}. Stock actual: ${product.stock}, solicitado: ${item.quantity}` 
                });
            }
            total_amount += item.quantity * item.unit_price;
        }

        // 1. Crear la Venta Principal (asociada al usuario autenticado)
        const sale = new Sale({
            customer_id: req.userId,
            total_amount,
            payment_method,
            status: 'completed'
        });
        await sale.save();

        // 2. Crear los Detalles y descontar stock
        const savedDetails = [];
        for (const item of items) {
            // Descontar stock directamente
            await Product.findByIdAndUpdate(
                item.product_id,
                { $inc: { stock: -item.quantity } }
            );

            const detail = new SaleDetail({
                sale_id: sale._id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price
            });
            await detail.save();
            savedDetails.push(detail);
        }

        // Invalidar caché de ventas y productos (el stock cambia con las ventas)
        await invalidateCache(`sales:${req.userId}`, `products:${req.userId}`);

        res.status(201).json({ 
            success: true, 
            message: "Venta registrada exitosamente", 
            sale 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getSales = async (req, res) => {
    try {
        const cacheKey = `sales:${req.userId}`;
        const { data: sales, fromCache } = await getOrSetCache(cacheKey, () =>
            Sale.find({ customer_id: req.userId })
                .populate('customer_id', 'name email')
                .sort({ createdAt: -1 })
                .lean()
        );

        res.status(200).json({ success: true, sales, fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getSaleById = async (req, res) => {
    try {
        const { id } = req.params;
        const cacheKey = `sale:${id}:${req.userId}`;

        const { data, fromCache } = await getOrSetCache(cacheKey, async () => {
            const sale = await Sale.findOne({ _id: id, customer_id: req.userId })
                .populate('customer_id', 'name email')
                .lean();
            
            if (!sale) return null;

            const items = await SaleDetail.find({ sale_id: id })
                .populate('product_id', 'name price')
                .lean();
            
            return { ...sale, items };
        });

        if (!data) {
            return res.status(404).json({ success: false, message: "Venta no encontrada" });
        }

        res.status(200).json({ 
            success: true, 
            sale: data,
            fromCache
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
