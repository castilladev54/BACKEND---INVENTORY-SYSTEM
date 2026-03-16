import mongoose from 'mongoose';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';

export const createSale = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { customer_id, items, payment_method } = req.body || {};

        if (!customer_id || !items || !items.length || !payment_method) {
            return res.status(400).json({ 
                success: false, 
                message: "Cliente, productos y método de pago son obligatorios" 
            });
        }

        // Verificar si el cliente existe
        const user = await User.findById(customer_id).session(session);
        if (!user) {
            return res.status(404).json({ success: false, message: "Cliente no encontrado" });
        }

        // Calcular total y validar stock preliminarmente
        let total_amount = 0;
        for (const item of items) {
            const product = await Product.findById(item.product_id).session(session);
            if (!product) {
                throw new Error(`Producto con ID ${item.product_id} no encontrado`);
            }
            if (product.stock < item.quantity) {
                throw new Error(`Stock insuficiente para ${product.name}. Stock actual: ${product.stock}`);
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
        await sale.save({ session });

        // 2. Crear los Detalles de Venta
        // El middleware pre-save de SaleDetail se encarga de descontar el stock
        for (const item of items) {
            const detail = new SaleDetail({
                sale_id: sale._id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price
            });
            await detail.save({ session });
        }

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({ 
            success: true, 
            message: "Venta registrada exitosamente", 
            sale 
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
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

        const details = await SaleDetail.find({ sale_id: id }).populate('product_id', 'name');
        
        res.status(200).json({ 
            success: true, 
            sale, 
            details 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
