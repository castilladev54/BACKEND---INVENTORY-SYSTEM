import mongoose from 'mongoose';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';

export const createSale = async (req, res) => {
    try {
        const { customer_id, items, payment_method } = req.body;

        // Verificar si el cliente existe
        const user = await User.findById(customer_id);
        if (!user) {
            return res.status(404).json({ success: false, message: "Cliente no encontrado" });
        }

        // Validar stock y calcular total
        let total_amount = 0;
        for (const item of items) {
            const product = await Product.findById(item.product_id);
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

        // 1. Crear la Venta Principal
        const sale = new Sale({
            customer_id,
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
        const sales = await Sale.find()
            .populate('customer_id', 'name email')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, sales });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getSaleById = async (req, res) => {
    try {
        const { id } = req.params;
        const sale = await Sale.findById(id).populate('customer_id', 'name email');
        
        if (!sale) {
            return res.status(404).json({ success: false, message: "Venta no encontrada" });
        }

        const items = await SaleDetail.find({ sale_id: id }).populate('product_id', 'name price');
        
        res.status(200).json({ 
            success: true, 
            sale: { ...sale.toObject(), items }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
