// frontend/src/services/api.service.js
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '/api';

// Instancia base de Axios
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para añadir token de autenticación si existe
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Añadir tenant-id si está guardado
    const tenantId = localStorage.getItem('tenant_id');
    if (tenantId) {
      config.headers['X-Tenant-ID'] = tenantId;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Servicios de autenticación
export const authService = {
  login: async (email, password) => {
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      if (response.data.token) {
        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('user_info', JSON.stringify(response.data.user));
        if (response.data.tenant) {
          localStorage.setItem('tenant_id', response.data.tenant.id);
        }
      }
      return response.data;
    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      throw error;
    }
  },
  
  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_info');
    localStorage.removeItem('tenant_id');
  },
  
  isAuthenticated: () => {
    return !!localStorage.getItem('auth_token');
  }
};

// Servicios de facturas
export const invoiceService = {
  getInvoices: async (page = 1, limit = 10) => {
    return apiClient.get(`/facturas?page=${page}&limit=${limit}`);
  },
  
  getInvoiceById: async (id) => {
    return apiClient.get(`/facturas/${id}`);
  },
  
  getInvoiceByFolio: async (folio) => {
    return apiClient.get(`/facturas/by-folio/${folio}`);
  },
  
  createInvoice: async (invoiceData) => {
    return apiClient.post('/facturas', invoiceData);
  },
  
  cancelInvoice: async (id, motive) => {
    return apiClient.delete(`/facturas/${id}`, { data: { motive } });
  }
};

// Servicios de clientes
export const clientService = {
  getClients: async () => {
    return apiClient.get('/clientes');
  },
  
  getClientById: async (id) => {
    return apiClient.get(`/clientes/${id}`);
  },
  
  createClient: async (clientData) => {
    return apiClient.post('/clientes', clientData);
  },
  
  updateClient: async (id, clientData) => {
    return apiClient.put(`/clientes/${id}`, clientData);
  },
  
  deleteClient: async (id) => {
    return apiClient.delete(`/clientes/${id}`);
  }
};

export default apiClient;