import mongoose from 'mongoose';

const purchaseSchema = new mongoose.Schema({
  admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  supplier: {
    type: String,
    required: true
  },
  total_cost: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

export const Purchase = mongoose.model('Purchase', purchaseSchema);
