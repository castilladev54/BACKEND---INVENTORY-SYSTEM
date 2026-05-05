import mongoose from 'mongoose';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { Product } from '../models/Product.js';

/**
 * Servicio transaccional para crear ventas. 
 * Garantiza Atomicidad: O se creaan Venta y Detalles descontando todos los stocks, o se revierte todo.
 */
export const createSaleProcess = async (userId, soldBy, items, payment_method) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        let total_amount = 0;
        
        // OPTIMIZACIÓN: Hacer una única consulta a DB para traer todos los productos (evita N+1 query problem)
        const productIds = items.map(i => i.product_id);
        const products = await Product.find({ _id: { $in: productIds }, user: userId }).session(session);
        const productsMap = new Map(products.map(p => [p._id.toString(), p]));

        // Computar montos y descontar stocks verificando disponibilidades
        for (const item of items) {
            const product = productsMap.get(item.product_id);
            if (!product) {
                throw new Error(`Producto con ID ${item.product_id} no encontrado.`);
            }
            if (product.stock < item.quantity) {
                throw new Error(`Stock insuficiente para ${product.name}. Stock actual: ${product.stock}, solicitado: ${item.quantity}`);
            }
            total_amount += item.quantity * item.unit_price;
            
            // Actualizar stock directamente dentro la sesión
            await Product.findByIdAndUpdate(
                item.product_id,
                { $inc: { stock: -item.quantity } },
                { session }
            );
        }

        // 1. Crear la Venta General
        const sale = new Sale({
            customer_id: userId,
            sold_by: soldBy,
            total_amount,
            payment_method,
            status: 'completed'
        });
        await sale.save({ session });

        // 2. Crear los Detalles
        for (const item of items) {
            const detail = new SaleDetail({
                sale_id: sale._id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price
            });
            await detail.save({ session });
        }

        // Si todo va bien, grabar los cambios a Disco.
        await session.commitTransaction();
        session.endSession();

        return sale;
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
};

/**
 * Servicio Limpio de Lectura para Listado de Ventas
 */
export const fetchSales = async (userId, sellerId = null) => {
    const filter = { customer_id: userId };
    if (sellerId) filter.sold_by = sellerId;

    return Sale.find(filter)
        .populate('customer_id', 'name email')
        .populate('sold_by', 'name email')
        .sort({ createdAt: -1 })
        .lean();
};

/**
 * Servicio Limpio de Lectura Detalles de una Venta Específica
 */
export const fetchSaleById = async (id, userId, isEmployee = false) => {
    // Empleado: solo puede ver ventas donde él fue el vendedor
    // Dueño:    puede ver cualquier venta de su negocio
    const filter = isEmployee
        ? { _id: id, sold_by: userId }
        : { _id: id, customer_id: userId };

    const sale = await Sale.findOne(filter)
        .populate('customer_id', 'name email')
        .populate('sold_by', 'name email')
        .lean();
    
    if (!sale) return null;

    const items = await SaleDetail.find({ sale_id: id })
        .populate('product_id', 'name price')
        .lean();
    
    return { ...sale, items };
};
