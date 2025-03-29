// frontend/src/pages/Dashboard.js
import React, { useState, useEffect } from 'react';
import { invoiceService, clientService } from '../services/api.service';
import Navbar from '../components/Navbar';
import DashboardCharts from '../components/DashboardCharts';

const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalInvoices: 0,
    totalAmount: 0,
    validInvoices: 0,
    canceledInvoices: 0,
    recentInvoices: []
  });
  
  const [chartData, setChartData] = useState({
    invoiceData: {
      monthlyData: [],
      byStatus: [
        { name: 'Vigentes', value: 0 },
        { name: 'Canceladas', value: 0 }
      ]
    },
    clientData: {
      topClients: []
    }
  });
  
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        // Cargar datos básicos
        const invoicesResponse = await invoiceService.getInvoices(1, 5);
        const invoices = invoicesResponse.data.data || [];
        
        // Calcular estadísticas
        const validCount = invoices.filter(inv => inv.status === 'valid').length;
        const canceledCount = invoices.filter(inv => inv.status === 'canceled').length;
        
        setStats({
          totalInvoices: invoicesResponse.data.pagination?.total || 0,
          totalAmount: invoices.reduce((sum, inv) => sum + (inv.total || 0), 0),
          validInvoices: validCount,
          canceledInvoices: canceledCount,
          recentInvoices: invoices
        });
        
        // Procesar datos para gráficos
        // Para una implementación real, podrías hacer una llamada API específica para estos datos
        
        // Procesar datos mensuales
        // Aquí puedes procesar datos reales si tu API los proporciona
        const monthlyData = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
          const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const monthName = month.toLocaleString('default', { month: 'short' });
          
          // En una implementación real, estos datos vendrían de tu API
          monthlyData.push({
            month: monthName,
            amount: 0, // Inicializa con 0, luego se rellenará con datos reales
            count: 0  // Inicializa con 0, luego se rellenará con datos reales
          });
        }
        
        // Actualizar datos por mes si los invoices tienen fecha
        invoices.forEach(invoice => {
          if (invoice.created_at) {
            const invoiceDate = new Date(invoice.created_at);
            const monthIndex = monthlyData.findIndex(
              m => new Date(new Date().getFullYear(), new Date().getMonth() - (5 - monthlyData.indexOf(m)), 1).getMonth() === invoiceDate.getMonth()
            );
            
            if (monthIndex !== -1) {
              monthlyData[monthIndex].amount += invoice.total || 0;
              monthlyData[monthIndex].count += 1;
            }
          }
        });
        
        // Cargar datos de clientes
        const clientsResponse = await clientService.getClients();
        const clients = clientsResponse.data.data || [];
        
        // Generar top clientes basado en facturas reales
        const clientInvoiceTotals = {};
        
        // Calcular totales por cliente
        invoices.forEach(invoice => {
          const clientId = invoice.customer?.id;
          if (clientId) {
            if (!clientInvoiceTotals[clientId]) {
              clientInvoiceTotals[clientId] = {
                id: clientId,
                name: invoice.customer.legal_name || 'Cliente',
                amount: 0
              };
            }
            clientInvoiceTotals[clientId].amount += invoice.total || 0;
          }
        });
        
        // Convertir a array y ordenar por monto
        const topClients = Object.values(clientInvoiceTotals)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5);
        
        // Actualizar datos de gráficos
        setChartData({
          invoiceData: {
            monthlyData,
            byStatus: [
              { name: 'Vigentes', value: validCount || 1 },
              { name: 'Canceladas', value: canceledCount || 0 }
            ]
          },
          clientData: {
            topClients
          }
        });
      } catch (error) {
        console.error('Error al cargar datos del dashboard:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchDashboardData();
  }, []);
  
  return (
    <div>
      <Navbar />
      <div className="dashboard-container">
        <h1>Panel de Control</h1>
        
        {loading ? (
          <div className="loading">Cargando datos...</div>
        ) : (
          <>
            <div className="stats-cards">
              <div className="stat-card">
                <h3>Total de Facturas</h3>
                <p className="stat-number">{stats.totalInvoices}</p>
              </div>
              <div className="stat-card">
                <h3>Facturas Vigentes</h3>
                <p className="stat-number">{stats.validInvoices}</p>
              </div>
              <div className="stat-card">
                <h3>Facturas Canceladas</h3>
                <p className="stat-number">{stats.canceledInvoices}</p>
              </div>
              <div className="stat-card">
                <h3>Monto Total</h3>
                <p className="stat-number">${stats.totalAmount.toFixed(2)}</p>
              </div>
            </div>
            
            <DashboardCharts 
              invoiceData={chartData.invoiceData} 
              clientData={chartData.clientData} 
            />
            
            <div className="recent-invoices">
              <h2>Facturas Recientes</h2>
              {stats.recentInvoices.length > 0 ? (
                <table className="invoice-table">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Cliente</th>
                      <th>Fecha</th>
                      <th>Total</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentInvoices.map(invoice => (
                      <tr key={invoice.id}>
                        <td>{invoice.series || ''}-{invoice.folio_number || ''}</td>
                        <td>{invoice.customer?.legal_name || 'N/A'}</td>
                        <td>{new Date(invoice.created_at).toLocaleDateString()}</td>
                        <td>${(invoice.total || 0).toFixed(2)}</td>
                        <td className={`status-${invoice.status}`}>
                          {invoice.status === 'valid' ? 'Vigente' : 'Cancelada'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="no-data">No hay facturas recientes</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;