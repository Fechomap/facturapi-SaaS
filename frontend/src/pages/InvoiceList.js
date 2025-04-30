// frontend/src/pages/InvoiceList.js
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom'; // Import useNavigate
import { getInvoices, downloadInvoicePdf, downloadInvoiceXml, cancelInvoice, searchInvoices } from '../services/invoiceService';
import Navbar from '../components/Navbar';
import LoadingSpinner from '../components/LoadingSpinner';

const InvoiceList = () => {
  const navigate = useNavigate(); // Initialize useNavigate
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isSubscriptionActive, setIsSubscriptionActive] = useState(true); // Assume active by default
  const [subscriptionInfo, setSubscriptionInfo] = useState(null); // Store subscription details

  const [searchQuery, setSearchQuery] = useState('');
  const [searchCriteria, setSearchCriteria] = useState({});

  const fetchInvoices = async (pageNum = page) => {
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
  };
  
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
    // Check subscription status from localStorage
    const userInfoString = localStorage.getItem('user_info');
    if (userInfoString) {
      try {
        const userInfo = JSON.parse(userInfoString);
        // --- Attempt to find subscription status ---
        // Adjust the path based on the actual structure in your localStorage
        const status = userInfo?.tenant?.subscriptionStatus || userInfo?.subscription?.status || 'active'; // Default to active if not found
        const isActive = status === 'active' || status === 'trial'; // Consider 'trial' as active for button functionality
        setIsSubscriptionActive(isActive);
        
        // Store relevant subscription info for the alert message
        setSubscriptionInfo({
          planName: userInfo?.tenant?.plan?.name || 'Basic Plan', // Example path, adjust as needed
          status: status, // The raw status
          paymentLink: userInfo?.tenant?.paymentLink || 'https://mock-stripe-payment-link.com/pricemockdefault/1745906401125' // Example path or default
        });
        
      } catch (e) {
        console.error("Error parsing user_info from localStorage", e);
        // Keep default active state or handle error appropriately
      }
    } else {
      // Handle case where user_info is not in localStorage (e.g., redirect to login)
      // For now, assume active or handle as needed
    }

    // Fetch invoices if not searching
    if (Object.keys(searchCriteria).length === 0) {
      fetchInvoices(page); // Pass page here
    }
  }, [page, searchCriteria]); // Add searchCriteria dependency
  
  const handlePrevPage = () => {
    if (page > 1) setPage(page - 1);
  };
  
  const handleNextPage = () => {
    if (page < totalPages) setPage(page + 1);
  };

  const handleNewInvoiceClick = () => {
    if (isSubscriptionActive) {
      navigate('/facturas/nueva');
    } else {
      // Show the alert with dynamic info if available
      const planName = subscriptionInfo?.planName || 'Basic Plan';
      const statusText = subscriptionInfo?.status === 'pending_payment' ? 'Pago pendiente' : 'Vencida';
      const paymentLink = subscriptionInfo?.paymentLink || 'https://mock-stripe-payment-link.com/pricemockdefault/1745906401125'; // Fallback link

      alert(
        `🚨 Suscripción Vencida\n\n` +
        `Tu período de prueba o suscripción para Pego ha vencido.\n\n` +
        `Plan: ${planName}\n` +
        `Estado: ${statusText}\n\n` +
        `Para reactivar tu servicio y continuar usándolo, por favor realiza tu pago a través del siguiente enlace:\n\n` +
        `${paymentLink}\n\n` +
        `Si tienes alguna duda, contáctanos.`
      );
    }
  };
  
  return (
    <div>
      <Navbar />
      {/* Subscription Status Banner */}
      {!isSubscriptionActive && subscriptionInfo && (
        <div className="subscription-status-banner error"> {/* Use 'error' or a specific class for styling */}
          🚨 **Suscripción Inactiva:** Tu plan '{subscriptionInfo.planName}' está {subscriptionInfo.status === 'pending_payment' ? 'pendiente de pago' : 'vencido'}. 
          Para reactivar tu servicio, por favor realiza tu pago <a href={subscriptionInfo.paymentLink} target="_blank" rel="noopener noreferrer">aquí</a>.
        </div>
      )}
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
              {/* Modified Button */}
              <button 
                className={`new-invoice-btn ${!isSubscriptionActive ? 'new-invoice-btn-inactive' : ''}`} // Add class for potential styling
                onClick={handleNewInvoiceClick}
                title={!isSubscriptionActive ? 'Suscripción inactiva - Renueva para generar facturas' : 'Generar nueva factura'} // Tooltip
              >
                Nueva Factura
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
