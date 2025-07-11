// frontend/src/pages/Login.js
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/api.service';

const Login = () => {
  const [email, setEmail] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Redirigir al dashboard si ya está autenticado
  useEffect(() => {
    if (authService.isAuthenticated()) {
      navigate('/dashboard');
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      await authService.login(email, tenantId);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Error al iniciar sesión');
    }
  };

  return (
    <div className="login-container">
      <div className="login-form-container">
        <h2>Iniciar Sesión</h2>
        <p style={{ textAlign: 'center', marginBottom: '1rem', color: '#6c757d' }}>
          Ingrese su correo electrónico y Tenant ID para acceder al sistema
        </p>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Correo Electrónico</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="tenantId">Tenant ID (Identificador único)</label>
            <input
              type="password"
              id="tenantId"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="Ingrese su Tenant ID"
              required
            />
          </div>
          <button type="submit" className="login-button">
            Ingresar
          </button>
          <div
            style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#6c757d', textAlign: 'center' }}
          >
            <p>El Tenant ID es el identificador único de su cuenta</p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Login;
