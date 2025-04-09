// frontend/src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import InvoiceList from './pages/InvoiceList';
import UserManagement from './pages/UserManagement';
import UserForm from './pages/UserForm';
import PrivateRoute from './components/PrivateRoute';
import './App.css';
import InvoiceDetail from './pages/InvoiceDetail';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/dashboard" element={
          <PrivateRoute>
            <Dashboard />
          </PrivateRoute>
        } />
        
        <Route path="/facturas" element={
          <PrivateRoute>
            <InvoiceList />
          </PrivateRoute>
        } />
        
        <Route path="/facturas/:id" element={
          <PrivateRoute>
            <InvoiceDetail />
          </PrivateRoute>
        } />
        
        <Route path="/usuarios" element={
          <PrivateRoute>
            <UserManagement />
          </PrivateRoute>
        } />
        
        <Route path="/usuarios/nuevo" element={
          <PrivateRoute>
            <UserForm />
          </PrivateRoute>
        } />
        
        <Route path="/usuarios/:id" element={
          <PrivateRoute>
            <UserForm />
          </PrivateRoute>
        } />
        
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
