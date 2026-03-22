import { z } from 'zod';

const saleItemSchema = z.object({
  product_id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Product ID format"),
  quantity: z.number().min(0.01, "Quantity must be at least 0.01"),
  unit_price: z.number().min(0, "Unit price must be a positive number")
});

export const createSaleSchema = z.object({
  body: z.object({
    customer_id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Customer ID format"),
    items: z.array(saleItemSchema).min(1, "At least one product item is required"),
    payment_method: z.string().min(1, "Payment method is required")
  })
});

export const saleIdSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Sale ID format")
  })
});
