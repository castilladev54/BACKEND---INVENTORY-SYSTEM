import { invalidateCache, getOrSetCache, getCacheVersion, bumpCacheVersion, buildPaginatedKey } from '../lib/redis.js';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { User } from '../models/User.js';
import { createSaleProcess, fetchSaleById } from '../services/sale.service.js';


export const createSale = async (req, res) => {
  try {
    const { items, payment_method } = req.body;

    // Determinar quién es el dueño del negocio (customer_id)
    // Si el que vende es un empleado, el owner es su owner_id
    // Si es el propio dueño, owner_id es null → usa su propio _id
    const caller = await User.findById(req.userId).select('role owner_id').lean();
    const ownerId = (caller?.role === 'employee' && caller?.owner_id)
      ? caller.owner_id
      : req.userId;

    const sale = await createSaleProcess(ownerId, req.userId, items, payment_method);

    // Invalidar caché paginada de ventas y productos (usando el ownerId como scope)
    const keysToInvalidate = [];
    for (const item of items) {
      keysToInvalidate.push(`product:${item.product_id}:${ownerId}`);
    }
    await Promise.all([
      bumpCacheVersion('sales', ownerId),
      bumpCacheVersion('products', ownerId),
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
    else if (error.message.includes('no encontrado')) status = 404;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const getSales = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const sellerId = req.query.seller || null; // ?seller=<employeeId>

    const version = await getCacheVersion('sales', req.userId);
    const cacheKey = buildPaginatedKey('sales', version, page, limit, req.userId) + (sellerId ? `:s${sellerId}` : '');

    const { data, fromCache } = await getOrSetCache(cacheKey, async () => {
      const filter = { customer_id: req.userId };
      if (sellerId) filter.sold_by = sellerId;

      const [sales, total] = await Promise.all([
        Sale.find(filter)
          .populate('customer_id', 'name email')
          .populate('sold_by', 'name email')
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
    const cacheKey = `sale:${id}:${req.userId}`;

    const { data, fromCache } = await getOrSetCache(cacheKey, () =>
      fetchSaleById(id, req.userId),
      300); // TTL 5 min

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
