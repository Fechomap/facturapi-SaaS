// frontend/src/pages/InvoiceDetail.js
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getInvoiceById,
  downloadInvoicePdf,
  downloadInvoiceXml,
  cancelInvoice,
} from '../services/invoiceService';
import Navbar from '../components/Navbar';
import LoadingSpinner from '../components/LoadingSpinner';

const InvoiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInvoiceDetails = async () => {
      try {
        setLoading(true);
        const data = await getInvoiceById(id);
        setInvoice(data);
      } catch (error) {
        console.error('Error fetching invoice details:', error);
        alert('Error al cargar los detalles de la factura');
      } finally {
        setLoading(false);
      }
    };

    fetchInvoiceDetails();
  }, [id]);

  const handleBack = () => {
    navigate('/facturas');
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!invoice) {
    return (
      <div>
        <Navbar />
        <div className="container">
          <div className="invoice-detail-container">
            <p className="no-data">La factura no se encuentra disponible</p>
            <div className="btn-container">
              <button onClick={handleBack} className="view-btn">
                Volver a Facturas
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Formatear fechas
  const formatDate = (dateString) => {
    if (!dateString) return 'Fecha no disponible';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES');
  };

  const formattedDate = formatDate(invoice.date || invoice.created_at);
  const formattedDueDate = formatDate(invoice.dueDate || invoice.expiration_date);

  return (
    <div>
      <Navbar />
      <div className="invoice-list-container">
        <div className="header-actions">
          <h1>Detalles de Factura</h1>
          <button onClick={handleBack} className="cancel-btn">
            Volver a Facturas
          </button>
        </div>

        <div className="invoice-detail-card">
          <div className="invoice-header">
            <h2>Factura #{invoice.invoiceNumber || invoice.folio_number || id}</h2>
            <span className={`status-${invoice.status}`}>
              {invoice.status === 'valid'
                ? 'Vigente'
                : invoice.status === 'canceled'
                  ? 'Cancelada'
                  : invoice.status}
            </span>
            <div className="invoice-actions">
              <button onClick={() => downloadInvoicePdf(id)} className="btn btn-primary">
                Descargar PDF
              </button>
              <button onClick={() => downloadInvoiceXml(id)} className="btn btn-secondary">
                Descargar XML
              </button>
              {invoice.status === 'valid' && (
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        '¿Estás seguro de cancelar esta factura? Esta acción no se puede deshacer.'
                      )
                    ) {
                      const motive = prompt('Ingrese el motivo de cancelación (01, 02, 03 o 04):');
                      if (motive && ['01', '02', '03', '04'].includes(motive)) {
                        cancelInvoice(id, motive)
                          .then(() => {
                            alert('Factura cancelada correctamente');
                            // Refrescar datos
                            getInvoiceById(id).then((data) => setInvoice(data));
                          })
                          .catch((error) => {
                            alert(`Error al cancelar la factura: ${error.message}`);
                          });
                      } else if (motive) {
                        alert('Motivo inválido. Debe ser 01, 02, 03 o 04.');
                      }
                    }
                  }}
                  className="btn btn-danger"
                >
                  Cancelar Factura
                </button>
              )}
            </div>
          </div>

          <div className="invoice-content">
            <div className="invoice-section">
              <div className="invoice-info">
                <h3>Información General</h3>
                <div className="info-group">
                  <p>
                    <strong>Fecha de emisión:</strong> {formattedDate}
                  </p>
                  <p>
                    <strong>Fecha de vencimiento:</strong> {formattedDueDate}
                  </p>
                  <p>
                    <strong>Referencia:</strong> {invoice.reference || 'N/A'}
                  </p>
                </div>
              </div>

              <div className="invoice-info">
                <h3>Cliente</h3>
                <div className="info-group">
                  <p>
                    <strong>Nombre:</strong>{' '}
                    {invoice.clientName || invoice.customer?.legal_name || 'N/A'}
                  </p>
                  <p>
                    <strong>Email:</strong>{' '}
                    {invoice.clientEmail || invoice.customer?.email || 'N/A'}
                  </p>
                  <p>
                    <strong>Teléfono:</strong>{' '}
                    {invoice.clientPhone || invoice.customer?.phone || 'N/A'}
                  </p>
                </div>
              </div>
            </div>

            <div className="separator"></div>

            <h3>Productos / Servicios</h3>
            <div className="table-container">
              <table className="invoice-table">
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th>Cantidad</th>
                    <th>Precio Unitario</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoice.items || []).map((item, index) => (
                    <tr key={index}>
                      <td>{item.description}</td>
                      <td className="text-right">{item.quantity}</td>
                      <td className="text-right">${parseFloat(item.unitPrice || 0).toFixed(2)}</td>
                      <td className="text-right">
                        ${parseFloat((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="invoice-totals">
              <div className="totals-container">
                <div className="total-row">
                  <span>Subtotal:</span>
                  <span>${parseFloat(invoice.subtotal || 0).toFixed(2)}</span>
                </div>
                <div className="total-row">
                  <span>IVA ({invoice.taxRate || 16}%):</span>
                  <span>${parseFloat(invoice.taxAmount || 0).toFixed(2)}</span>
                </div>
                <div className="total-row grand-total">
                  <span>Total:</span>
                  <span>${parseFloat(invoice.total || 0).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {invoice.notes && (
              <div className="invoice-notes">
                <h3>Notas</h3>
                <p>{invoice.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceDetail;
