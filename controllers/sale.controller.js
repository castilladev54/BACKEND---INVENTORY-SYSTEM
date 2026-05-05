import { invalidateCache, getOrSetCache, getCacheVersion, bumpCacheVersion, buildPaginatedKey } from '../lib/redis.js';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { createSaleProcess, fetchSaleById } from '../services/sale.service.js';


export const createSale = async (req, res) => {
  try {
    const { items, payment_method } = req.body;

    // injectBusinessContext ya resolvió:
    //   req.userId     = ID del dueño del negocio (ownerId)
    //   req.realUserId = ID real de quien hizo login (empleado o dueño)
    const ownerId = req.userId;
    const soldBy  = req.realUserId;

    const sale = await createSaleProcess(ownerId, soldBy, items, payment_method);

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
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    // Usar contexto inyectado por injectBusinessContext (evita consulta redundante a DB)
    const isEmployee = req.userRole === 'employee';
    const ownerId    = req.userId; // Ya es el ID del dueño del negocio

    // Empleado: ve solo SUS ventas (sold_by) dentro del scope del dueño
    // Dueño:    ve todas las ventas de su negocio + filtro opcional por vendedor
    const sellerId   = (!isEmployee && req.query.seller) ? req.query.seller : null;

    // Scope de caché separado por empleado para evitar cruzar datos entre usuarios
    const cacheScope = isEmployee ? `${ownerId}:emp:${req.realUserId}` : ownerId;

    const version  = await getCacheVersion('sales', String(ownerId));
    const cacheKey = buildPaginatedKey('sales', version, page, limit, cacheScope)
      + (sellerId ? `:s${sellerId}` : '');

    const { data, fromCache } = await getOrSetCache(cacheKey, async () => {
      let filter;

      if (isEmployee) {
        // Empleado: ventas donde ÉL fue el vendedor dentro del negocio del dueño
        filter = { customer_id: ownerId, sold_by: req.realUserId };
      } else {
        // Dueño: todas las ventas de su negocio, con filtro opcional por vendedor
        filter = { customer_id: req.userId };
        if (sellerId) filter.sold_by = sellerId;
      }

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

      return { sales, total, totalPages: Math.ceil(total / limit), currentPage: page };
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

    // Usar contexto inyectado por injectBusinessContext
    const isEmployee = req.userRole === 'employee';
    const cacheKey   = `sale:${id}:${req.realUserId}`;

    // Empleado → busca por sold_by (su ID real)
    // Dueño   → busca por customer_id (ownerId)
    const lookupId = isEmployee ? req.realUserId : req.userId;

    const { data, fromCache } = await getOrSetCache(cacheKey, () =>
      fetchSaleById(id, lookupId, isEmployee),
      300);

    if (!data) {
      return res.status(404).json({ success: false, message: "Venta no encontrada" });
    }

    res.status(200).json({ success: true, sale: data, fromCache });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
