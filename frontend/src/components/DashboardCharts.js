// frontend/src/components/DashboardCharts.js
import React from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

const DashboardCharts = ({ invoiceData, clientData }) => {
  return (
    <div className="dashboard-charts">
      <div className="chart-container">
        <h3>Facturación Mensual</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={invoiceData.monthlyData} margin={{top: 5, right: 30, left: 20, bottom: 5}}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            {/* Añadimos un segundo eje Y con el ID yAxisId="1" */}
            <YAxis yAxisId="1" orientation="right" />
            <Tooltip 
              formatter={(value) => [`$${value.toFixed(2)} MXN`, 'Monto']}
              labelFormatter={(label) => `Mes: ${label}`}
            />
            <Legend />
            <Line type="monotone" dataKey="amount" stroke="#8884d8" activeDot={{ r: 8 }} name="Monto Facturado" />
            {/* Ahora esta línea usa el eje Y con ID 1 */}
            <Line type="monotone" dataKey="count" stroke="#82ca9d" name="Facturas Emitidas" yAxisId="1" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      <div className="charts-row">
        <div className="chart-container half-width">
          <h3>Facturas por Estado</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={invoiceData.byStatus}
                cx="50%"
                cy="50%"
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
                nameKey="name"
                label={({name, percent}) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {invoiceData.byStatus.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value, name) => [`${value} facturas`, name]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        
        <div className="chart-container half-width">
          <h3>Top Clientes</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={clientData.topClients} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={150} />
              <Tooltip formatter={(value) => [`$${value.toFixed(2)} MXN`, 'Monto']} />
              <Bar dataKey="amount" fill="#8884d8" name="Monto Facturado" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default DashboardCharts;