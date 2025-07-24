import { jest } from '@jest/globals';
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// Mock de Prisma
const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  tenantCustomer: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $disconnect: jest.fn(),
};

// Mock de FacturAPI Service
const mockFacturapiService = {
  getFacturapiClient: jest.fn(),
  clearClientCache: jest.fn(),
};

// Mock del cliente FacturAPI
const mockFacturapiClient = {
  customers: {
    create: jest.fn(),
    del: jest.fn(),
  },
};

// Mock de los módulos
jest.unstable_mockModule('../../lib/prisma.js', () => ({
  default: mockPrisma,
}));

jest.unstable_mockModule('../../services/facturapi.service.js', () => ({
  default: mockFacturapiService,
}));

// Importar el módulo a testear
const { setupPredefinedClients } = await import('../../services/client.service.js');

describe('Client Service - setupPredefinedClients', () => {
  const mockTenantId = '519b140b-0320-4fd8-9cd3-c5d67921a405';
  const mockTenant = {
    id: mockTenantId,
    businessName: 'Asistencia vial grupo Troya',
    facturapiApiKey: 'sk_live_test_key_12345',
    facturapiOrganizationId: '6882ac5e31161708e773cb6e',
  };

  const mockExistingCustomers = [
    {
      id: 80,
      legalName: 'INFOASIST INFORMACION Y ASISTENCIA',
      facturapiCustomerId: '6882acb6432628082e88d933',
      tenantId: mockTenantId,
    },
    {
      id: 81,
      legalName: 'ARSA ASESORIA INTEGRAL PROFESIONAL',  
      facturapiCustomerId: '6882acb931161708e773d529',
      tenantId: mockTenantId,
    },
  ];

  const mockNewFacturapiCustomer = {
    id: 'new_facturapi_id_12345',
    legal_name: 'INFOASIST INFORMACION Y ASISTENCIA',
    tax_id: 'IIA951221LQA',
    email: 'info@example.com',
    phone: '',
    address: {
      street: 'ADOLFO LOPEZ MATEOS',
      exterior: '261',
      zip: '01010',
    },
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup default mocks
    mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
    mockFacturapiService.getFacturapiClient.mockResolvedValue(mockFacturapiClient);
    mockFacturapiClient.customers.create.mockResolvedValue(mockNewFacturapiCustomer);
    mockFacturapiClient.customers.del.mockResolvedValue({ deleted: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cuando forceAll = true', () => {
    test('debe recrear clientes existentes en FacturAPI', async () => {
      // Arrange
      mockPrisma.tenantCustomer.findMany.mockResolvedValue(mockExistingCustomers);
      mockPrisma.tenantCustomer.findFirst.mockResolvedValue(mockExistingCustomers[0]);
      mockPrisma.tenantCustomer.update.mockResolvedValue({ ...mockExistingCustomers[0], facturapiCustomerId: mockNewFacturapiCustomer.id });

      // Act
      const results = await setupPredefinedClients(mockTenantId, true);

      // Assert
      expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: mockTenantId },
      });

      expect(mockFacturapiService.getFacturapiClient).toHaveBeenCalledWith(mockTenantId);
      
      // Debe intentar eliminar el cliente existente de FacturAPI
      expect(mockFacturapiClient.customers.del).toHaveBeenCalledWith('6882acb6432628082e88d933');
      
      // Debe crear nuevo cliente en FacturAPI
      expect(mockFacturapiClient.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          legal_name: 'INFOASIST INFORMACION Y ASISTENCIA',
          tax_id: 'IIA951221LQA',
        })
      );

      // Debe actualizar el cliente en BD local (no crear nuevo)
      expect(mockPrisma.tenantCustomer.update).toHaveBeenCalledWith({
        where: { id: 80 },
        data: expect.objectContaining({
          facturapiCustomerId: mockNewFacturapiCustomer.id,
          legalName: mockNewFacturapiCustomer.legal_name,
        }),
      });

      // NO debe crear nuevo registro en BD local
      expect(mockPrisma.tenantCustomer.create).not.toHaveBeenCalled();

      // Debe limpiar cache
      expect(mockFacturapiService.clearClientCache).toHaveBeenCalledWith(mockTenantId);

      // Verificar resultado
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            legalName: 'INFOASIST INFORMACION Y ASISTENCIA',
            success: true,
            id: mockNewFacturapiCustomer.id,
            message: 'Cliente recreado en FacturAPI',
          }),
        ])
      );
    });

    test('debe manejar errores al eliminar cliente inexistente en FacturAPI', async () => {
      // Arrange
      mockPrisma.tenantCustomer.findMany.mockResolvedValue([mockExistingCustomers[0]]);
      mockPrisma.tenantCustomer.findFirst.mockResolvedValue(mockExistingCustomers[0]);
      mockPrisma.tenantCustomer.update.mockResolvedValue({ ...mockExistingCustomers[0], facturapiCustomerId: mockNewFacturapiCustomer.id });
      
      // Simular que el cliente no existe en FacturAPI
      mockFacturapiClient.customers.del.mockRejectedValue(new Error('Customer not found'));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Act
      const results = await setupPredefinedClients(mockTenantId, true);

      // Assert
      expect(mockFacturapiClient.customers.del).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cliente no existía en FacturAPI o error al eliminar')
      );
      
      // Debe continuar y crear el nuevo cliente
      expect(mockFacturapiClient.customers.create).toHaveBeenCalled();
      expect(results[0].success).toBe(true);

      consoleSpy.mockRestore();
    });

    test('debe crear nuevos clientes cuando no existen en BD local', async () => {
      // Arrange
      mockPrisma.tenantCustomer.findMany.mockResolvedValue([]); // No hay clientes existentes
      mockPrisma.tenantCustomer.findFirst.mockResolvedValue(null);
      mockPrisma.tenantCustomer.create.mockResolvedValue({
        id: 85,
        facturapiCustomerId: mockNewFacturapiCustomer.id,
        legalName: mockNewFacturapiCustomer.legal_name,
      });

      // Act
      const results = await setupPredefinedClients(mockTenantId, true);

      // Assert
      // NO debe intentar eliminar (no existe cliente)
      expect(mockFacturapiClient.customers.del).not.toHaveBeenCalled();
      
      // Debe crear cliente en FacturAPI
      expect(mockFacturapiClient.customers.create).toHaveBeenCalled();
      
      // Debe crear nuevo registro en BD local
      expect(mockPrisma.tenantCustomer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: mockTenantId,
          facturapiCustomerId: mockNewFacturapiCustomer.id,
          legalName: mockNewFacturapiCustomer.legal_name,
        }),
      });

      expect(results[0].message).toBe('Cliente creado');
    });
  });

  describe('cuando forceAll = false', () => {
    test('debe omitir clientes existentes', async () => {
      // Arrange
      mockPrisma.tenantCustomer.findMany.mockResolvedValue(mockExistingCustomers);
      mockPrisma.tenantCustomer.findFirst.mockResolvedValue(mockExistingCustomers[0]);

      // Act
      const results = await setupPredefinedClients(mockTenantId, false);

      // Assert
      // NO debe intentar eliminar clientes existentes
      expect(mockFacturapiClient.customers.del).not.toHaveBeenCalled();
      
      // NO debe crear clientes en FacturAPI
      expect(mockFacturapiClient.customers.create).not.toHaveBeenCalled();
      
      // NO debe limpiar cache
      expect(mockFacturapiService.clearClientCache).not.toHaveBeenCalled();

      // Los clientes existentes deben aparecer en resultados
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            legalName: 'INFOASIST INFORMACION Y ASISTENCIA',
            success: true,
            message: 'Cliente ya existente',
          }),
        ])
      );
    });
  });

  describe('manejo de errores', () => {
    test('debe lanzar error si no se encuentra el tenant', async () => {
      // Arrange
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(setupPredefinedClients('invalid-tenant-id', true))
        .rejects.toThrow('No se encontró el tenant con ID invalid-tenant-id');
    });

    test('debe lanzar error si el tenant no tiene API key', async () => {
      // Arrange
      mockPrisma.tenant.findUnique.mockResolvedValue({
        ...mockTenant,
        facturapiApiKey: null,
      });

      // Act & Assert
      await expect(setupPredefinedClients(mockTenantId, true))
        .rejects.toThrow('no tiene una API key configurada');
    });

    test('debe manejar errores al crear cliente en FacturAPI', async () => {
      // Arrange
      mockPrisma.tenantCustomer.findMany.mockResolvedValue([]);
      mockPrisma.tenantCustomer.findFirst.mockResolvedValue(null);
      mockFacturapiClient.customers.create.mockRejectedValue(new Error('FacturAPI Error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Act
      const results = await setupPredefinedClients(mockTenantId, true);

      // Assert
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('FacturAPI Error');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error al crear cliente'),
        expect.any(String)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('integración completa', () => {
    test('debe procesar todos los 5 clientes predefinidos con forceAll=true', async () => {
      // Arrange - simular que existen los 5 clientes
      const allExistingCustomers = [
        { id: 80, legalName: 'INFOASIST INFORMACION Y ASISTENCIA', facturapiCustomerId: 'old_id_1' },
        { id: 81, legalName: 'ARSA ASESORIA INTEGRAL PROFESIONAL', facturapiCustomerId: 'old_id_2' },
        { id: 82, legalName: 'PROTECCION S.O.S. JURIDICO AUTOMOVILISTICO LAS VEINTICUATRO HORAS DEL DIA', facturapiCustomerId: 'old_id_3' },
        { id: 83, legalName: 'CHUBB DIGITAL SERVICES', facturapiCustomerId: 'old_id_4' },
        { id: 84, legalName: 'AXA ASSISTANCE MEXICO', facturapiCustomerId: 'old_id_5' },
      ];

      mockPrisma.tenantCustomer.findMany.mockResolvedValue(allExistingCustomers);
      mockPrisma.tenantCustomer.findFirst.mockImplementation((query) => {
        return Promise.resolve(
          allExistingCustomers.find(c => c.legalName === query.where.legalName)
        );
      });
      mockPrisma.tenantCustomer.update.mockResolvedValue({ updated: true });

      // Act
      const results = await setupPredefinedClients(mockTenantId, true);

      // Assert
      // Los resultados incluyen clientes existentes + clientes recreados
      // Filtramos solo los clientes recreados para la verificación principal
      const recreatedClients = results.filter(r => r.message === 'Cliente recreado en FacturAPI');
      expect(recreatedClients).toHaveLength(5); // Los 5 clientes predefinidos recreados
      expect(results.every(r => r.success)).toBe(true);
      expect(mockFacturapiClient.customers.create).toHaveBeenCalledTimes(5);
      expect(mockPrisma.tenantCustomer.update).toHaveBeenCalledTimes(5);
      expect(mockFacturapiService.clearClientCache).toHaveBeenCalledWith(mockTenantId);
    });
  });
});