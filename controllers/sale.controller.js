import { invalidateCache, getOrSetCache, getCacheVersion, bumpCacheVersion, buildPaginatedKey } from '../lib/redis.js';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { createSaleProcess, fetchSaleById } from '../services/sale.service.js';

export const createSale = async (req, res) => {
    try {
        const { items, payment_method } = req.body;

        const sale = await createSaleProcess(req.userId, items, payment_method);

        // Invalidar caché paginada de ventas y productos
        const keysToInvalidate = [];
        for (const item of items) {
            keysToInvalidate.push(`product:${item.product_id}:${req.userId}`);
        }
        await Promise.all([
          bumpCacheVersion('sales', req.userId),
          bumpCacheVersion('products', req.userId),
          keysToInvalidate.length > 0 ? invalidateCache(...keysToInvalidate) : Promise.resolve()
        ]);

        res.status(201).json({ 
            success: true, 
            message: "Venta registrada exitosamente", 
            sale 
        });

    } catch (error) {
        let status = 500;
        if (error.message.includes('Stock insuficiente')) status = 400;
        else if (error.message.includes('no encontrado'))  status = 404;
        res.status(status).json({ success: false, message: error.message });
    }
};

export const getSales = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const version = await getCacheVersion('sales', req.userId);
        const cacheKey = buildPaginatedKey('sales', version, page, limit, req.userId);

        const { data, fromCache } = await getOrSetCache(cacheKey, async () => {
            const filter = { customer_id: req.userId };

            const [sales, total] = await Promise.all([
                Sale.find(filter)
                    .populate('customer_id', 'name email')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Sale.countDocuments(filter)
            ]);

            return {
                sales,
                total,
                totalPages: Math.ceil(total / limit),
                currentPage: page
            };
        }, 120);

        res.status(200).json({
            success: true,
            sales: data.sales,
            total: data.total,
            totalPages: data.totalPages,
            currentPage: data.currentPage,
            fromCache
        });
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
