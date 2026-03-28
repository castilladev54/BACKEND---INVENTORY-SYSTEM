import { z } from 'zod';

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    barcode: z.string().min(1, "Barcode cannot be empty").optional(),
    price: z.number().min(0, "Price must be a positive number"),
    stock: z.number().min(0, "Stock must be a non-negative number").optional(),
    unit_type: z.enum(['unidad', 'kg', 'litro', 'metro']).optional(),
    category: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Category ID format")
  })
});

export const updateProductSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Product ID format")
  }),
  body: z.object({
    name: z.string().min(1, "Name is required").optional(),
    description: z.string().optional(),
    barcode: z.string().min(1, "Barcode cannot be empty").nullable().optional(),
    price: z.number().min(0, "Price must be a positive number").optional(),
    stock: z.number().min(0, "Stock must be a non-negative number").optional(),
    unit_type: z.enum(['unidad', 'kg', 'litro', 'metro']).optional(),
    category: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Category ID format").optional()
  })
});

export const productIdSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Product ID format")
  })
});

export const barcodeParamSchema = z.object({
  params: z.object({
    code: z.string().min(1, "Barcode is required")
  })
});
