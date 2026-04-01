import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema({
  customer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  total_amount: {
    type: Number,
    required: true
  },
  payment_method: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'completed'
  }
}, { timestamps: true });

saleSchema.index({ customer_id: 1, createdAt: -1 });

export const Sale = mongoose.model('Sale', saleSchema);
