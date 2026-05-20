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

/**
 * Servicio Transaccional para Editar una Venta.
 * Permite cambiar: ítems (cantidades/precios/productos), payment_method.
 * El total_amount se recalcula automáticamente desde los ítems.
 *
 * Estrategia de stock (dentro de una sola transacción ACID):
 *   1. Restaurar el stock de los ítems ORIGINALES (devolver lo que se había descontado).
 *   2. Validar y descontar el stock de los NUEVOS ítems (con el stock ya restaurado).
 *   3. Reemplazar los SaleDetail y actualizar la venta.
 */
export const updateSaleProcess = async (saleId, ownerId, { items, payment_method }) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Verificar que la venta existe y pertenece al negocio
        const sale = await Sale.findOne({ _id: saleId, customer_id: ownerId }).session(session);
        if (!sale) throw new Error('Venta no encontrada o no pertenece a tu negocio.');
        if (sale.status === 'cancelled') throw new Error('No se puede editar una venta anulada.');

        // ── BLOQUE DE ÍTEMS (solo si se envían en el payload) ──
        if (items && items.length > 0) {
            // 2. Leer los detalles originales para revertir su stock
            const originalDetails = await SaleDetail.find({ sale_id: saleId }).session(session);

            // 3. Restaurar stock original (devolver a inventario lo que se vendió antes)
            for (const detail of originalDetails) {
                await Product.findByIdAndUpdate(
                    detail.product_id,
                    { $inc: { stock: detail.quantity } },
                    { session }
                );
            }

            // 4. Validar y descontar stock de los NUEVOS ítems
            //    Una sola query trae todos los productos necesarios (evita N+1)
            const newProductIds = items.map(i => i.product_id);
            const products = await Product.find({ _id: { $in: newProductIds }, user: ownerId }).session(session);
            const productsMap = new Map(products.map(p => [p._id.toString(), p]));

            let newTotal = 0;
            for (const item of items) {
                const product = productsMap.get(item.product_id);
                if (!product) throw new Error(`Producto con ID ${item.product_id} no encontrado.`);
                // El stock actual ya incluye lo que devolvimos en el paso anterior
                if (product.stock < item.quantity) {
                    throw new Error(`Stock insuficiente para "${product.name}". Disponible: ${product.stock}, solicitado: ${item.quantity}`);
                }
                newTotal += item.quantity * item.unit_price;

                await Product.findByIdAndUpdate(
                    item.product_id,
                    { $inc: { stock: -item.quantity } },
                    { session }
                );
            }

            // 5. Reemplazar los SaleDetail: eliminar los viejos y crear los nuevos
            await SaleDetail.deleteMany({ sale_id: saleId }, { session });
            for (const item of items) {
                const detail = new SaleDetail({
                    sale_id: saleId,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price
                });
                await detail.save({ session });
            }

            // El total se calcula siempre desde los ítems (fuente de verdad)
            sale.total_amount = newTotal;
        }

        // ── CAMPOS SIMPLES (no afectan stock) ──
        if (payment_method !== undefined) sale.payment_method = payment_method;

        await sale.save({ session });

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
 * Servicio Transaccional para Anular Ventas
 */
export const cancelSaleProcess = async (saleId, ownerId) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Verificar la venta
        const sale = await Sale.findOne({ _id: saleId, customer_id: ownerId }).session(session);
        if (!sale) {
            throw new Error('Venta no encontrada o no pertenece a tu negocio.');
        }

        if (sale.status === 'cancelled') {
            throw new Error('La venta ya ha sido anulada anteriormente.');
        }

        // 2. Buscar los detalles
        const details = await SaleDetail.find({ sale_id: saleId }).session(session);

        // 3. Restaurar stock
        for (const detail of details) {
            await Product.findByIdAndUpdate(
                detail.product_id,
                { $inc: { stock: detail.quantity } },
                { session }
            );
        }

        // 4. Actualizar estado y establecer total en 0 para evitar sumar en reportes
        sale.status = 'cancelled';
        sale.total_amount = 0;
        await sale.save({ session });

        await session.commitTransaction();
        session.endSession();

        return sale;
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
};
