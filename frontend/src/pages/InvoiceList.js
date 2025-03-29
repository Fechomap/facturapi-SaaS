// frontend/src/pages/InvoiceList.js
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { invoiceService } from '../services/api.service';
import Navbar from '../components/Navbar';

const InvoiceList = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  useEffect(() => {
    const fetchInvoices = async () => {
      try {
        const response = await invoiceService.getInvoices(page, 10);
        setInvoices(response.data.data || []);
        const total = response.data.pagination?.total || 0;
        setTotalPages(Math.ceil(total / 10));
      } catch (error) {
        console.error('Error al cargar facturas:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchInvoices();
  }, [page]);
  
  const handlePrevPage = () => {
    if (page > 1) setPage(page - 1);
  };
  
  const handleNextPage = () => {
    if (page < totalPages) setPage(page + 1);
  };
  
  return (
    <div>
      <Navbar />
      <div className="invoice-list-container">
        <h1>Facturas</h1>
        
        {loading ? (
          <div className="loading">Cargando facturas...</div>
        ) : (
          <>
            <div className="filters">
              <input 
                type="text" 
                placeholder="Buscar por folio o cliente" 
                className="search-input"
              />
              <button className="new-invoice-btn">
                <Link to="/facturas/nueva">Nueva Factura</Link>
              </button>
            </div>
            
            {invoices.length > 0 ? (
              <>
                <table className="invoice-table">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Cliente</th>
                      <th>Fecha</th>
                      <th>Total</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map(invoice => (
                      <tr key={invoice.id}>
                        <td>{invoice.series}-{invoice.folio_number}</td>
                        <td>{invoice.customer?.legal_name || 'N/A'}</td>
                        <td>{new Date(invoice.created_at).toLocaleDateString()}</td>
                        <td>${invoice.total.toFixed(2)}</td>
                        <td className={`status-${invoice.status}`}>
                          {invoice.status === 'valid' ? 'Vigente' : 'Cancelada'}
                        </td>
                        <td>
                          <Link to={`/facturas/${invoice.id}`} className="view-btn">Ver</Link>
                          {invoice.status === 'valid' && (
                            <button className="cancel-btn">Cancelar</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                <div className="pagination">
                  <button 
                    onClick={handlePrevPage} 
                    disabled={page === 1}
                  >
                    Anterior
                  </button>
                  <span>Página {page} de {totalPages}</span>
                  <button 
                    onClick={handleNextPage} 
                    disabled={page === totalPages}
                  >
                    Siguiente
                  </button>
                </div>
              </>
            ) : (
              <div className="no-data">No hay facturas disponibles</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default InvoiceList;