import { GoogleGenAI } from '@google/genai';
import { Product } from '../models/Product.js';
import { Sale } from '../models/Sale.js';
import { Purchase } from '../models/Purchase.js';
import { SaleDetail } from '../models/SaleDetail.js';

export const getAIAdviceStreamService = async (userId, userQuestion) => {
    // 1. Recopilar contexto de datos (limitado para ahorrar tokens)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Stock crítico
    const criticalStock = await Product.find({ user: userId, stock: { $lt: 5 } })
        .select('_id name stock price')
        .limit(10)
        .lean();

    // Ventas de hoy (Balance Ingresos)
    const salesToday = await Sale.find({ customer_id: userId, createdAt: { $gte: today } }).lean();
    const incomeToday = salesToday.reduce((acc, sale) => acc + sale.total_amount, 0);

    // Extraer detalle de ventas de hoy para el prompt (simplificado para no saturar tokens)
    const salesTodayIds = salesToday.map(s => s._id);
    const salesDetailsRaw = await SaleDetail.find({ sale_id: { $in: salesTodayIds } })
        .populate('product_id', 'name')
        .lean();
    
    // Agrupar ventas de hoy por producto
    const ventasHoyResumen = {};
    for (const detail of salesDetailsRaw) {
        if (!detail.product_id) continue;
        const rootName = detail.product_id.name;
        if (!ventasHoyResumen[rootName]) {
            ventasHoyResumen[rootName] = 0;
        }
        ventasHoyResumen[rootName] += (detail.quantity * detail.unit_price);
    }
    const ventas_hoy = Object.keys(ventasHoyResumen).map(name => ({
        producto: name,
        monto_total: ventasHoyResumen[name]
    }));

    // Gastos de hoy (Balance Egresos)
    const purchasesToday = await Purchase.find({ admin_id: userId, createdAt: { $gte: today } }).lean();
    const expenseToday = purchasesToday.reduce((acc, purchase) => acc + purchase.total_cost, 0);

    // Top 5 Productos del Mes
    const monthlySales = await Sale.find({ customer_id: userId, createdAt: { $gte: firstDayOfMonth } }).select('_id').lean();
    const monthlySaleIds = monthlySales.map(m => m._id);

    const topProductsRaw = await SaleDetail.aggregate([
        { $match: { sale_id: { $in: monthlySaleIds } } },
        { $group: { _id: "$product_id", totalSold: { $sum: "$quantity" } } },
        { $sort: { totalSold: -1 } },
        { $limit: 5 },
        {
            $lookup: {
                from: "products",
                localField: "_id",
                foreignField: "_id",
                as: "productInfo"
            }
        },
        { $unwind: "$productInfo" },
        { $project: { _id: 0, name: "$productInfo.name", totalSold: 1 } }
    ]);

    const contextData = {
        ventas_hoy,
        stock_critico: criticalStock.map(p => ({ nombre: p.name, stock: p.stock })),
        top_productos: topProductsRaw,
        balance: { ingresos_hoy: incomeToday, gastos_hoy: expenseToday, ganancia_neta: incomeToday - expenseToday }
    };

    // 2. Definir Prompts
    const systemPrompt = `### SYSTEM_PROMPT: CastillaWeb AI Business Advisor

**ROL:**
Eres el Asesor de Negocios Inteligente integrado en "CastillaWeb", un sistema POS (Punto de Venta) premium. Tu objetivo es ayudar al dueño de un negocio (bodega, ferretería, minimarket) en Venezuela a tomar decisiones basadas en sus datos reales.

**CONTEXTO DEL NEGOCIO:**
- El usuario opera en un entorno volátil (Venezuela), por lo que la rotación de inventario y el flujo de caja son críticos.
- Tu tono debe ser profesional, directo, brutalmente honesto y motivador. No uses lenguaje robótico; habla como un socio que quiere que el negocio crezca.

**CONOCIMIENTO TÉCNICO (DATA):**
Recibirás un objeto JSON con:
1. \`ventas_hoy\`: Lista de productos vendidos y montos.
2. \`stock_critico\`: Productos con menos de 5 unidades.
3. \`top_productos\`: Los 5 más vendidos del mes.
4. \`balance\`: Total de ingresos vs gastos del día.

**REGLAS DE RESPUESTA:**
1. **Prioridad 1:** Si hay stock crítico, adviértelo de inmediato.
2. **Prioridad 2:** Identifica fugas de dinero o productos que no se mueven ("huesos").
3. **Prioridad 3:** Sugiere una acción concreta (ej. "Sube el precio un 5%" o "Haz un combo de harina con mantequilla").
4. **Formato:** Usa Markdown para negritas y listas. Mantén la respuesta breve (máximo 150 palabras).

**RESTRICCIÓN DE SEGURIDAD:**
- No inventes datos que no estén en el JSON.
- Si el usuario pregunta algo fuera del negocio (ej. "recetas de cocina"), responde: "Soy tu asesor de CastillaWeb, enfoquémonos en el dinero. ¿Qué quieres saber de tus ventas?".`;

    const userPromptText = `Aquí están los datos actuales de CastillaWeb:
${JSON.stringify(contextData, null, 2)}

Pregunta del dueño: ${userQuestion}

Analiza y responde según tu rol.`;

    // 3. Inicializar Google Gen AI
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Generar respuesta vía Streaming
    const responseStream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: [
             { role: 'user', parts: [ { text: userPromptText } ] }
        ],
        config: { systemInstruction: systemPrompt }
    });
    
    return responseStream;
};
