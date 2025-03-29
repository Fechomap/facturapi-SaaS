// frontend/src/pages/UserManagement.js
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';

// Simular servicio de usuarios (en una implementación real, esto vendría de una API)
const userService = {
  getUsers: async () => {
    // Simulación de respuesta de API
    return {
      data: [
        { id: 1, firstName: 'Juan', lastName: 'Pérez', email: 'juan@ejemplo.com', role: 'admin', isActive: true },
        { id: 2, firstName: 'Ana', lastName: 'García', email: 'ana@ejemplo.com', role: 'user', isActive: true },
        { id: 3, firstName: 'Carlos', lastName: 'López', email: 'carlos@ejemplo.com', role: 'user', isActive: false }
      ]
    };
  },
  deleteUser: async (id) => {
    console.log(`Eliminando usuario con ID: ${id}`);
    return { success: true };
  },
  updateUserStatus: async (id, isActive) => {
    console.log(`Cambiando estado de usuario ${id} a ${isActive ? 'activo' : 'inactivo'}`);
    return { success: true };
  }
};

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await userService.getUsers();
        setUsers(response.data);
      } catch (error) {
        console.error('Error al cargar usuarios:', error);
        setError('No se pudieron cargar los usuarios. Por favor, intenta nuevamente.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchUsers();
  }, []);
  
  const handleDeleteUser = async (id) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar este usuario?')) {
      try {
        await userService.deleteUser(id);
        setUsers(users.filter(user => user.id !== id));
      } catch (error) {
        console.error('Error al eliminar usuario:', error);
        setError('No se pudo eliminar el usuario. Por favor, intenta nuevamente.');
      }
    }
  };
  
  const handleToggleStatus = async (id, currentStatus) => {
    try {
      await userService.updateUserStatus(id, !currentStatus);
      setUsers(users.map(user => 
        user.id === id ? { ...user, isActive: !user.isActive } : user
      ));
    } catch (error) {
      console.error('Error al cambiar estado de usuario:', error);
      setError('No se pudo actualizar el estado del usuario. Por favor, intenta nuevamente.');
    }
  };
  
  return (
    <div>
      <Navbar />
      <div className="user-management-container">
        <div className="header-actions">
          <h1>Gestión de Usuarios</h1>
          <button className="add-user-btn">
            <Link to="/usuarios/nuevo">Añadir Usuario</Link>
          </button>
        </div>
        
        {error && <div className="error-alert">{error}</div>}
        
        {loading ? (
          <div className="loading">Cargando usuarios...</div>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className={!user.isActive ? 'inactive-row' : ''}>
                  <td>{user.firstName} {user.lastName}</td>
                  <td>{user.email}</td>
                  <td>
                    <span className={`role-badge ${user.role}`}>
                      {user.role === 'admin' ? 'Administrador' : 'Usuario'}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${user.isActive ? 'active' : 'inactive'}`}>
                      {user.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <Link to={`/usuarios/${user.id}`} className="edit-btn">Editar</Link>
                    <button
                      className={`status-toggle-btn ${user.isActive ? 'deactivate' : 'activate'}`}
                      onClick={() => handleToggleStatus(user.id, user.isActive)}
                    >
                      {user.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      className="delete-btn"
                      onClick={() => handleDeleteUser(user.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default UserManagement;