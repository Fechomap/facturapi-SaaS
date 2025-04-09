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

// Interceptor para añadir headers comunes
apiClient.interceptors.request.use(
  (config) => {
    // Token de autenticación
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Tenant ID - requerido para todas las peticiones API
    const tenantId = localStorage.getItem('tenant_id') || 
                     JSON.parse(localStorage.getItem('user_info'))?.tenant?.id;
    if (!tenantId && process.env.NODE_ENV !== 'production') {
      console.warn('Tenant ID no encontrado - usando valor por defecto para desarrollo');
      config.headers['X-Tenant-ID'] = 'default-tenant-id';
    } else {
      config.headers['X-Tenant-ID'] = tenantId;
    }
    
    // Asegurar que Accept es application/json para todas las peticiones
    config.headers['Accept'] = 'application/json';
    
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
      console.log('Iniciando sesión');
      const response = await apiClient.post('auth/login', { 
        email: email || 'dev@tenant.com', 
        password: password || '123456' 
      });
      if (response.data.token) {
        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('user_info', JSON.stringify(response.data.user));
        // Guardar tenant ID fijo para desarrollo
        const tenantId = process.env.NODE_ENV === 'development' 
          ? '56838cf6-6073-4118-92fb-0cf2abbd9b59'
          : response.data.tenant?.id;
        localStorage.setItem('tenant_id', tenantId);
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
    console.log('Obteniendo facturas:', `facturas?page=${page}&limit=${limit}`);
    return apiClient.get(`facturas?page=${page}&limit=${limit}`);
  },
  
  getInvoiceById: async (id) => {
    return apiClient.get(`facturas/${id}`);
  },
  
  getInvoiceByFolio: async (folio) => {
    return apiClient.get(`facturas/by-folio/${folio}`);
  },
  
  createInvoice: async (invoiceData) => {
    return apiClient.post('facturas', invoiceData);
  },
  
  cancelInvoice: async (id, motive) => {
    return apiClient.delete(`facturas/${id}`, { data: { motive } });
  }
};

// Servicios de clientes
export const clientService = {
  getClients: async () => {
    console.log('Obteniendo clientes');
    return apiClient.get('clientes');
  },
  
  getClientById: async (id) => {
    return apiClient.get(`clientes/${id}`);
  },
  
  createClient: async (clientData) => {
    return apiClient.post('clientes', clientData);
  },
  
  updateClient: async (id, clientData) => {
    return apiClient.put(`clientes/${id}`, clientData);
  },
  
  deleteClient: async (id) => {
    return apiClient.delete(`clientes/${id}`);
  }
};

export default apiClient;
