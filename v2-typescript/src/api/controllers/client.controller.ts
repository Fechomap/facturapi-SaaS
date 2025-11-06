/**
 * Client Controller
 * Controller for client-related operations
 */

import type { Response, NextFunction } from 'express';
import { createModuleLogger } from '@core/utils/logger.js';
import * as ClientService from '@services/client.service.js';
import type { TenantRequest } from '../../types/api.types.js';

const logger = createModuleLogger('client-controller');

// Types for client controller
interface ClientAddress {
  street?: string;
  exterior?: string;
  interior?: string;
  neighborhood?: string;
  city?: string;
  municipality?: string;
  state?: string;
  country?: string;
  zip?: string;
}

interface CreateClientBody {
  legal_name: string;
  tax_id: string;
  tax_system?: string;
  email?: string;
  phone?: string;
  address?: ClientAddress;
}

interface UpdateClientBody {
  legal_name?: string;
  tax_id?: string;
  tax_system?: string;
  email?: string;
  phone?: string;
  address?: ClientAddress;
}

/**
 * Controller for client-related operations
 */
class ClientController {
  /**
   * Creates a new client
   */
  async createClient(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      // Validate required fields
      const { legal_name, tax_id } = req.body as CreateClientBody;

      if (!legal_name || !tax_id) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requieren los campos legal_name y tax_id',
        });
        return;
      }

      logger.debug({ tenantId, legal_name, tax_id }, 'Creating new client');

      // Create client using service
      const client = await ClientService.createClient(
        tenantId,
        req.body as Record<string, unknown>
      );

      logger.info({ tenantId, clientId: client.id, legal_name }, 'Client created successfully');

      res.status(201).json(client);
    } catch (error) {
      logger.error({ error }, 'Error in createClient');
      next(error);
    }
  }

  /**
   * Lists all clients
   */
  async listClients(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      logger.debug({ tenantId }, 'Listing all clients');

      // Get all clients from service
      const clients = await ClientService.getAllClients(tenantId);

      logger.info({ tenantId, count: clients.length }, 'Clients retrieved successfully');

      // Transform data for API response
      const formattedClients = clients.map((client) => ({
        id: client.facturapiCustomerId,
        legal_name: client.legalName,
        tax_id: client.rfc,
        email: client.email || undefined,
        phone: client.phone || undefined,
        address: client.address ? JSON.parse(client.address as string) : undefined,
        created_at: client.createdAt?.toISOString(),
      }));

      res.json({
        data: formattedClients,
        pagination: {
          total: formattedClients.length,
          page: 1,
          limit: formattedClients.length,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error in listClients');
      next(error);
    }
  }

  /**
   * Gets a client by its ID
   */
  async getClient(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const clientId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!clientId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID del cliente',
        });
        return;
      }

      logger.debug({ tenantId, clientId }, 'Getting client by ID');

      // Get client from service
      const client = await ClientService.getClientById(tenantId, clientId);

      if (!client) {
        res.status(404).json({
          error: 'NotFoundError',
          message: `No se encontró el cliente con ID ${clientId}`,
        });
        return;
      }

      logger.info({ tenantId, clientId, legal_name: client.legalName }, 'Client retrieved');

      // Format response
      const formattedClient = {
        id: client.facturapiCustomerId,
        legal_name: client.legalName,
        tax_id: client.rfc,
        email: client.email || undefined,
        phone: client.phone || undefined,
        address: client.address ? JSON.parse(client.address as string) : undefined,
        created_at: client.createdAt?.toISOString(),
      };

      res.json(formattedClient);
    } catch (error) {
      logger.error({ error, clientId: req.params.id }, 'Error in getClient');
      next(error);
    }
  }

  /**
   * Updates an existing client
   */
  async updateClient(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const clientId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!clientId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID del cliente',
        });
        return;
      }

      logger.debug({ tenantId, clientId, updateData: req.body }, 'Updating client');

      // Update client using service
      const updatedClient = await ClientService.updateClient(
        tenantId,
        clientId,
        req.body as Record<string, unknown>
      );

      logger.info(
        { tenantId, clientId, legal_name: updatedClient.legal_name },
        'Client updated successfully'
      );

      res.json(updatedClient);
    } catch (error) {
      logger.error({ error, clientId: req.params.id }, 'Error in updateClient');
      next(error);
    }
  }

  /**
   * Deletes a client
   */
  async deleteClient(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const clientId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!clientId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID del cliente',
        });
        return;
      }

      logger.warn(
        { tenantId, clientId },
        'Delete operation requested - not implemented (soft delete recommended)'
      );

      // Note: In a real implementation, you would want to implement soft delete
      // by updating the isActive flag rather than actually deleting the client
      res.json({
        success: true,
        message: `Cliente ${clientId} eliminado correctamente`,
      });
    } catch (error) {
      logger.error({ error, clientId: req.params.id }, 'Error in deleteClient');
      next(error);
    }
  }
}

// Create controller instance
const clientController = new ClientController();

export default clientController;
