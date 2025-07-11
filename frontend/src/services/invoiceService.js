// services/invoiceService.js
import apiClient from './api.service';

export const getInvoiceById = async (id) => {
  try {
    const response = await apiClient.get(`/facturas/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching invoice details:', error);
    throw error;
  }
};

export const getInvoices = async (page = 1, limit = 10) => {
  try {
    const response = await apiClient.get(`/facturas?page=${page}&limit=${limit}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw error;
  }
};

export const createInvoice = async (invoiceData) => {
  try {
    const response = await apiClient.post('/facturas', invoiceData);
    return response.data;
  } catch (error) {
    console.error('Error creating invoice:', error);
    throw error;
  }
};

export const cancelInvoice = async (id, motive) => {
  try {
    const response = await apiClient.delete(`/facturas/${id}`, { data: { motive } });
    return response.data;
  } catch (error) {
    console.error('Error canceling invoice:', error);
    throw error;
  }
};

export const downloadInvoicePdf = async (id) => {
  try {
    const response = await apiClient.get(`/facturas/${id}/pdf`, {
      responseType: 'blob',
    });
    // Crear URL para descarga
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `factura-${id}.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch (error) {
    console.error('Error downloading invoice PDF:', error);
    throw error;
  }
};

export const downloadInvoiceXml = async (id) => {
  try {
    const response = await apiClient.get(`/facturas/${id}/xml`, {
      responseType: 'blob',
    });
    // Crear URL para descarga
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `factura-${id}.xml`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch (error) {
    console.error('Error downloading invoice XML:', error);
    throw error;
  }
};

export const searchInvoices = async (criteria) => {
  try {
    const params = new URLSearchParams();
    // Añadir solo criterios con valor
    Object.entries(criteria).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, value);
      }
    });

    const response = await apiClient.get(`/facturas/search?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error('Error searching invoices:', error);
    throw error;
  }
};

const invoiceService = {
  getInvoiceById,
  getInvoices,
  createInvoice,
  cancelInvoice,
  downloadInvoicePdf,
  downloadInvoiceXml,
  searchInvoices,
};

export default invoiceService;
