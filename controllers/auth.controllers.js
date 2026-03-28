import { User } from "../models/User.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { Purchase } from "../models/Purchase.js";
import { PurchaseDetail } from "../models/PurchaseDetail.js";
import { Sale } from "../models/Sale.js";
import { SaleDetail } from "../models/SaleDetail.js";
import crypto from "crypto";
import bcryptjs from "bcryptjs";
import { generateTokenAndSetCookie } from "../utils/generateTokenAndSetCookie.js";
import { sendPasswordResetEmail, sendResetSuccessEmail } from "../mailtrap/emails.js";
import { invalidateCache } from "../lib/redis.js";

export const createUser = async (req, res) => {
  const { email, password, name, role } = req.body;

  try {
    // Validar si es administrador el que hace la petición
    const adminUser = await User.findById(req.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: "Sólo los administradores pueden crear usuarios." });
    }

    const userAlreadyExists = await User.findOne({ email });

    if (userAlreadyExists) {
      return res.status(400).json({ success: false, message: "El correo ya está registrado" });
    }

    const hashedPassword = await bcryptjs.hash(password, 10);
    
    // Inicia sus 7 días de prueba en el momento en que el admin lo crea
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + 7);

    const user = new User({
      email,
      password: hashedPassword,
      name,
      role: role || 'customer',
      subscriptionExpiresAt: expireDate
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: "Usuario creado exitosamente. Ya puede iniciar sesión.",
      user: {
        ...user._doc,
        password: undefined,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    const isPasswordValid = await bcryptjs.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    generateTokenAndSetCookie(res, user._id);

    user.lastLogin = new Date();
    await user.save();

    res.status(200).json({
      success: true,
      message: "Logged in successfully",
      user: {
        ...user._doc,
        password: undefined,
      },
    });
  } catch (error) {
    console.log("Error in login ", error);
    res.status(400).json({ success: false, message: error.message });
  }
}

export const logout = async (req, res) => {
  res.clearCookie("token");
  res.status(200).json({ success: true, message: "Logged out successfully" });
}

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ success: false, message: "User not found" });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString("hex");
    const resetTokenExpiresAt = Date.now() + 1 * 60 * 60 * 1000; // 1 hour

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiresAt = resetTokenExpiresAt;

    await user.save();

    // send email
    await sendPasswordResetEmail(user.email, `${process.env.CLIENT_URL}/reset-password/${resetToken}`);

    res.status(200).json({ success: true, message: "Password reset link sent to your email" });
  } catch (error) {
    console.log("Error in forgotPassword ", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiresAt: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
    }

    // update password
    const hashedPassword = await bcryptjs.hash(password, 10);

    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiresAt = undefined;
    await user.save();

    await sendResetSuccessEmail(user.email);

    res.status(200).json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.log("Error in resetPassword ", error);
    res.status(400).json({ success: false, message: error.message });
  }
};


export const checkAuth = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) {
      return res.status(400).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.log("Error in checkAuth ", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const purgeUserAndData = async (req, res) => {
  try {
    const adminUser = await User.findById(req.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: "Sólo administradores pueden purgar cuentas." });
    }

    const { targetUserId } = req.params;
    
    // Evitar auto-eliminación por seguridad
    if (adminUser._id.toString() === targetUserId) {
       return res.status(400).json({ success: false, message: "No puedes eliminar tu propia cuenta." });
    }

    // 1. Eliminar datos transaccionales en Cascada
    const userPurchases = await Purchase.find({ admin_id: targetUserId });
    const purchaseIds = userPurchases.map(p => p._id);
    await PurchaseDetail.deleteMany({ purchase_id: { $in: purchaseIds } });
    await Purchase.deleteMany({ admin_id: targetUserId });

    const userSales = await Sale.find({ customer_id: targetUserId });
    const saleIds = userSales.map(s => s._id);
    await SaleDetail.deleteMany({ sale_id: { $in: saleIds } });
    await Sale.deleteMany({ customer_id: targetUserId });

    // 2. Eliminar Catálogo del usuario
    await Product.deleteMany({ user: targetUserId });
    await Category.deleteMany({ user: targetUserId });

    // 3. Eliminar Usuario
    const deletedUser = await User.findByIdAndDelete(targetUserId);
    if (!deletedUser) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado." });
    }

    // 4. Invalidar todo el caché del usuario purgado
    await invalidateCache(
      `categories:${targetUserId}`,
      `products:${targetUserId}`,
      `purchases:${targetUserId}`,
      `sales:${targetUserId}`
    );

    res.status(200).json({ success: true, message: "El usuario y todos sus registros han sido purgados exitosamente de la base de datos." });
  } catch (error) {
    console.log("Error in purgeUserAndData ", error);
    res.status(500).json({ success: false, message: error.message });
  }
};