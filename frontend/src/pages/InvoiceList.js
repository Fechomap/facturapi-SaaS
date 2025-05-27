// frontend/src/pages/InvoiceList.js
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getInvoices, downloadInvoicePdf, downloadInvoiceXml, cancelInvoice, searchInvoices } from '../services/invoiceService';
import Navbar from '../components/Navbar';
import LoadingSpinner from '../components/LoadingSpinner';

const InvoiceList = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCriteria, setSearchCriteria] = useState({});

  const fetchInvoices = useCallback(async (pageNum = page) => {
    try {
      setLoading(true);
      const data = await getInvoices(pageNum, 10);
      setInvoices(data.data || []);
      const total = data.pagination?.total || 0;
      setTotalPages(Math.ceil(total / 10));
    } catch (error) {
      console.error('Error al cargar facturas:', error);
      alert('Error al cargar las facturas');
    } finally {
      setLoading(false);
    }
  }, [page]);
  
  const handleSearch = async () => {
    try {
      setLoading(true);
      // Determinar si es búsqueda por folio o por fecha
      let criteria = {};
      
      if (searchQuery) {
        // Verificar si es un número (folio)
        if (!isNaN(searchQuery.trim())) {
          criteria.folio = searchQuery.trim();
        } else {
          // Intentar como nombre de cliente
          criteria.customerName = searchQuery.trim();
        }
      }
      
      setSearchCriteria(criteria);
      
      if (Object.keys(criteria).length > 0) {
        const results = await searchInvoices(criteria);
        setInvoices(results.data || []);
        setTotalPages(1); // Búsqueda no paginada
      } else {
        fetchInvoices(1);
      }
    } catch (error) {
      console.error('Error en la búsqueda:', error);
      alert('Error al realizar la búsqueda');
    } finally {
      setLoading(false);
    }
  };
  
  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchCriteria({});
    fetchInvoices(1);
    setPage(1);
  };

  useEffect(() => {
    if (Object.keys(searchCriteria).length === 0) {
      fetchInvoices();
    }
  }, [fetchInvoices, searchCriteria]);
  
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
          <LoadingSpinner />
        ) : (
          <>
            <div className="filters">
              <div className="search-container">
                <input 
                  type="text" 
                  placeholder="Buscar por folio o cliente" 
                  className="search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button 
                  onClick={handleSearch}
                  className="search-btn"
                >
                  Buscar
                </button>
                {searchQuery && (
                  <button 
                    onClick={handleClearSearch}
                    className="clear-search-btn"
                  >
                    Limpiar
                  </button>
                )}
              </div>
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
                        <td className="actions-cell">
                          <Link to={`/facturas/${invoice.id}`} className="view-btn">Ver</Link>
                          <button 
                            onClick={() => downloadInvoicePdf(invoice.id)} 
                            className="download-btn"
                          >
                            PDF
                          </button>
                          <button 
                            onClick={() => downloadInvoiceXml(invoice.id)} 
                            className="download-btn"
                          >
                            XML
                          </button>
                          {invoice.status === 'valid' && (
                            <button 
                              className="cancel-btn"
                              onClick={() => {
                                if (window.confirm('¿Estás seguro de cancelar esta factura? Esta acción no se puede deshacer.')) {
                                  const motive = prompt('Ingrese el motivo de cancelación (01, 02, 03 o 04):');
                                  if (motive && ['01', '02', '03', '04'].includes(motive)) {
                                    cancelInvoice(invoice.id, motive)
                                      .then(() => {
                                        alert('Factura cancelada correctamente');
                                        // Refrescar la lista
                                        fetchInvoices(page);
                                      })
                                      .catch(error => {
                                        alert(`Error al cancelar la factura: ${error.message}`);
                                      });
                                  } else if (motive) {
                                    alert('Motivo inválido. Debe ser 01, 02, 03 o 04.');
                                  }
                                }
                              }}
                            >
                              Cancelar
                            </button>
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