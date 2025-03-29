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

export default {
  getInvoiceById
};