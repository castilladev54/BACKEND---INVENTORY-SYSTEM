import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'customer'],
    required: true,
    default: 'customer'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  av_inventory_cost: {
    type: Number,
    default: 0
  },
  lastLogin: {
    type: Date,
    default: Date.now,
  },
  resetPasswordToken: String,
  resetPasswordExpiresAt: Date,
  verificationToken: String,
  verificationTokenExpiresAt: Date
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
