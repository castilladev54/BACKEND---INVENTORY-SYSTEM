import { User } from '../models/User.js';
import bcryptjs from 'bcryptjs';

/**
 * Crea un nuevo empleado asociado al dueño del negocio.
 */
export const createEmployee = async (req, res) => {
  try {
    const { email, password, name, permissions } = req.body;
    
    // Validar que el creador sea un 'customer' (dueño de negocio)
    const owner = await User.findById(req.userId);
    if (!owner || owner.role !== 'customer') {
      return res.status(403).json({ success: false, message: "Solo los dueños de negocio pueden crear empleados." });
    }

    const userAlreadyExists = await User.findOne({ email });
    if (userAlreadyExists) {
      return res.status(400).json({ success: false, message: "El correo ya está registrado." });
    }

    const hashedPassword = await bcryptjs.hash(password, 10);

    const employee = new User({
      email,
      password: hashedPassword,
      name,
      role: 'employee',
      owner_id: owner._id, // Enlazamos al dueño
      permissions: permissions || []
    });

    await employee.save();

    res.status(201).json({
      success: true,
      message: "Empleado creado exitosamente.",
      employee: {
        _id: employee._id,
        email: employee.email,
        name: employee.name,
        permissions: employee.permissions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Obtiene la lista de empleados del dueño de negocio actual.
 */
export const getEmployees = async (req, res) => {
  try {
    const ownerId = req.userId; // El que pide la lista debe ser el dueño

    const employees = await User.find({ owner_id: ownerId, role: 'employee' })
      .select('-password')
      .lean();

    res.status(200).json({ success: true, employees });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Actualiza los permisos de un empleado.
 */
export const updateEmployeePermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    const employee = await User.findOne({ _id: id, owner_id: req.userId });
    
    if (!employee) {
      return res.status(404).json({ success: false, message: "Empleado no encontrado o no te pertenece." });
    }

    employee.permissions = permissions;
    await employee.save();

    res.status(200).json({ success: true, message: "Permisos actualizados.", employee });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Elimina un empleado.
 */
export const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    
    const deleted = await User.findOneAndDelete({ _id: id, owner_id: req.userId });
    
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Empleado no encontrado o no te pertenece." });
    }

    res.status(200).json({ success: true, message: "Empleado eliminado." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
