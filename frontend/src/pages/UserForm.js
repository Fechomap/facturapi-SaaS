// frontend/src/pages/UserForm.js
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';

// Simular servicio de usuarios (en una implementación real, esto vendría de una API)
const userService = {
  getUserById: async (id) => {
    // Simulación de respuesta de API
    return {
      data: {
        id: parseInt(id),
        firstName: 'Juan',
        lastName: 'Pérez',
        email: 'juan@ejemplo.com',
        role: 'admin',
        isActive: true
      }
    };
  },
  createUser: async (userData) => {
    console.log('Creando usuario:', userData);
    return { data: { ...userData, id: Date.now() } };
  },
  updateUser: async (id, userData) => {
    console.log(`Actualizando usuario ${id}:`, userData);
    return { data: { ...userData, id: parseInt(id) } };
  }
};

const UserForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'user',
    isActive: true,
    password: '',
    confirmPassword: ''
  });
  
  const [loading, setLoading] = useState(isEditing);
  const [error, setError] = useState(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  
  useEffect(() => {
    const fetchUser = async () => {
      if (isEditing) {
        try {
          const response = await userService.getUserById(id);
          const userData = response.data;
          
          // Eliminar el campo de contraseña para edición
          setFormData({
            firstName: userData.firstName,
            lastName: userData.lastName,
            email: userData.email,
            role: userData.role,
            isActive: userData.isActive,
            password: '',
            confirmPassword: ''
          });
        } catch (error) {
          console.error('Error al cargar usuario:', error);
          setError('No se pudo cargar la información del usuario. Por favor, intenta nuevamente.');
        } finally {
          setLoading(false);
        }
      }
    };
    
    fetchUser();
  }, [id, isEditing]);
  
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
  };
  
  const validateForm = () => {
    // Validación básica
    if (!formData.firstName.trim()) return 'El nombre es obligatorio';
    if (!formData.lastName.trim()) return 'El apellido es obligatorio';
    if (!formData.email.trim()) return 'El correo electrónico es obligatorio';
    if (!formData.email.includes('@')) return 'El correo electrónico no es válido';
    
    // Validar contraseña solo para nuevos usuarios o si se está cambiando
    if (!isEditing && !formData.password) return 'La contraseña es obligatoria para nuevos usuarios';
    if (formData.password && formData.password.length < 6) return 'La contraseña debe tener al menos 6 caracteres';
    if (formData.password !== formData.confirmPassword) return 'Las contraseñas no coinciden';
    
    return null;
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    
    setSubmitLoading(true);
    
    try {
      // Eliminar confirmPassword antes de enviar los datos
      const userData = { ...formData };
      delete userData.confirmPassword;
      
      // Si no se está cambiando la contraseña en edición, eliminarla
      if (isEditing && !userData.password) {
        delete userData.password;
      }
      
      if (isEditing) {
        await userService.updateUser(id, userData);
      } else {
        await userService.createUser(userData);
      }
      
      // Redirigir a la lista de usuarios
      navigate('/usuarios');
    } catch (error) {
      console.error('Error al guardar usuario:', error);
      setError('Ocurrió un error al guardar el usuario. Por favor, intenta nuevamente.');
    } finally {
      setSubmitLoading(false);
    }
  };
  
  return (
    <div>
      <Navbar />
      <div className="user-form-container">
        <h1>{isEditing ? 'Editar Usuario' : 'Crear Nuevo Usuario'}</h1>
        
        {loading ? (
          <div className="loading">Cargando información del usuario...</div>
        ) : (
          <div className="form-card">
            {error && <div className="error-alert">{error}</div>}
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="firstName">Nombre</label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="lastName">Apellido</label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="email">Correo Electrónico</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="role">Rol</label>
                <select
                  id="role"
                  name="role"
                  value={formData.role}
                  onChange={handleChange}
                >
                  <option value="user">Usuario</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              
              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    name="isActive"
                    checked={formData.isActive}
                    onChange={handleChange}
                  />
                  Usuario Activo
                </label>
              </div>
              
              <div className="form-group">
                <label htmlFor="password">
                  {isEditing ? 'Contraseña (dejar en blanco para mantener la actual)' : 'Contraseña'}
                </label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  required={!isEditing}
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="confirmPassword">Confirmar Contraseña</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required={!isEditing || formData.password !== ''}
                />
              </div>
              
              <div className="form-actions">
                <button 
                  type="button" 
                  className="cancel-btn"
                  onClick={() => navigate('/usuarios')}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="save-btn"
                  disabled={submitLoading}
                >
                  {submitLoading ? 'Guardando...' : 'Guardar Usuario'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserForm;