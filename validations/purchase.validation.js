import { z } from 'zod';

const purchaseItemSchema = z.object({
  product_id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Product ID format"),
  quantity: z.number().min(0.01, "Quantity must be at least 0.01"),
  unit_cost: z.number().min(0, "Unit cost must be a positive number")
});

export const createPurchaseSchema = z.object({
  body: z.object({
    admin_id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Admin ID format"),
    supplier: z.string().min(1, "Supplier is required"),
    items: z.array(purchaseItemSchema).min(1, "At least one product item is required")
  })
});

export const purchaseIdSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Purchase ID format")
  })
});
