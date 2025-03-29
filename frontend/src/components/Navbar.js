// frontend/src/components/Navbar.js
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services/api.service';

const Navbar = () => {
  const navigate = useNavigate();
  const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
  
  const handleLogout = () => {
    authService.logout();
    navigate('/login');
  };
  
  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <Link to="/">FacturAPI SaaS</Link>
      </div>
      <div className="navbar-menu">
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/facturas">Facturas</Link>
        <Link to="/clientes">Clientes</Link>
        <Link to="/productos">Productos</Link>
      </div>
      <div className="navbar-end">
        <span className="user-info">{userInfo.firstName || 'Usuario'}</span>
        <button className="logout-btn" onClick={handleLogout}>Cerrar Sesión</button>
      </div>
    </nav>
  );
};

export default Navbar;