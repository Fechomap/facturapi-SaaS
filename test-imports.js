// test-imports.js
import prisma from './lib/prisma.js';
import { encrypt, decrypt } from './core/utils/encryption.js';
import factuAPIService from './services/facturapi.service.js';
import * as clientService from './services/client.service.js';

console.log('✅ Prisma importado correctamente');
console.log('✅ Módulo de encriptación importado correctamente');
console.log('✅ factuAPIService importado correctamente');
console.log('✅ clientService importado correctamente');
console.log('Test completado con éxito');