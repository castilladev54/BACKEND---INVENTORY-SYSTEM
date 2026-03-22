import { User } from "../models/User.js";

export const checkSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }

    if (!user.subscriptionExpiresAt) {
      // In case old users don't have it, we could let them pass or give them an error.
      // We will let them pass for backward compatibility or give them a default
      return next(); 
    }

    // Comparamos si hoy ya superó su fecha límite
    if (new Date() > user.subscriptionExpiresAt) {
      return res.status(403).json({ 
        success: false, 
        message: "Tu suscripción de 7 días ha vencido. Por favor, contacta al administrador para renovar." 
      });
    }

    next();
  } catch (error) {
    console.log("Error in checkSubscription: ", error);
    res.status(500).json({ success: false, message: "Error verificando suscripción" });
  }
};
