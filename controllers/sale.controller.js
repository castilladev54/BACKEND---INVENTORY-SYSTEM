import { invalidateCache } from '../lib/redis.js';
import { createSaleProcess, fetchSales, fetchSaleById } from '../services/sale.service.js';

export const createSale = async (req, res) => {
    try {
        const { items, payment_method } = req.body;

        const sale = await createSaleProcess(req.userId, items, payment_method);

        // Invalidar caché de ventas y listado listado de cada producto vendido
        const keysToInvalidate = [`sales:${req.userId}`, `products:${req.userId}`];
        for (const item of items) {
            keysToInvalidate.push(`product:${item.product_id}:${req.userId}`);
        }
        await invalidateCache(...keysToInvalidate);

        res.status(201).json({ 
            success: true, 
            message: "Venta registrada exitosamente", 
            sale 
        });

    } catch (error) {
        // Enviar 400 si el error lo detono una aserción de negocio (ej. falta stock).
        const status = error.message.includes("Stock") || error.message.includes("encontrado") ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

export const getSales = async (req, res) => {
    try {
        const sales = await fetchSales(req.userId);
        res.status(200).json({ success: true, sales });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getSaleById = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await fetchSaleById(id, req.userId);

        if (!data) {
            return res.status(404).json({ success: false, message: "Venta no encontrada" });
        }

        res.status(200).json({ 
            success: true, 
            sale: data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
