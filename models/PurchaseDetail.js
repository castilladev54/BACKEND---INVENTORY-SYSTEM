import mongoose from 'mongoose';
import { Product } from './Product.js';
import { User } from './User.js';
import { Purchase } from './Purchase.js';

const purchaseDetailSchema = new mongoose.Schema({
  purchase_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase',
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
    min: 0.01
  },
  unit_cost: {
    type: Number,
    required: true,
    min: 0
  }
}, { timestamps: true });

// Middleware pre-save: Integridad de Compra y Control de Stock
purchaseDetailSchema.pre('save', async function () {
  const session = this.$session();
  // 1. Incrementar el stock del producto
  const product = await Product.findByIdAndUpdate(
    this.product_id,
    { $inc: { stock: this.quantity } },
    { returnDocument: 'after', session }
  );

  if (!product) {
    throw new Error('Producto referenciado no encontrado.');
  }

  // 2. Obtener la compra (Purchase) para localizar al Admin
  const purchase = await Purchase.findById(this.purchase_id).session(session);
  if (!purchase) {
    throw new Error('Compra asociada no encontrada.');
  }

  // 3. Recálculo del av_inventory_cost (costo promedio de inventario) para el Admin
  const resultAggr = await mongoose.model('PurchaseDetail').aggregate([
    {
      $group: {
        _id: null,
        totalCost: { $sum: { $multiply: ["$quantity", "$unit_cost"] } },
        totalItems: { $sum: "$quantity" }
      }
    }
  ]).session(session);

  let newAvgCost = 0;
  if (resultAggr.length > 0 && resultAggr[0].totalItems > 0) {
    const currentCost = resultAggr[0].totalCost + (this.quantity * this.unit_cost);
    const currentQty = resultAggr[0].totalItems + this.quantity;
    newAvgCost = currentCost / currentQty;
  } else {
    newAvgCost = this.unit_cost;
  }

  // Actualizamos el av_inventory_cost del admin
  await User.findByIdAndUpdate(
    purchase.admin_id,
    { av_inventory_cost: newAvgCost },
    { session }
  );
});

export const PurchaseDetail = mongoose.model('PurchaseDetail', purchaseDetailSchema);
