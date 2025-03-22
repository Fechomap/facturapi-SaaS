// config/database.js
import { PrismaClient } from '@prisma/client';
import logger from '../core/utils/logger.js';

// Crear una instancia de logger específica para la base de datos
const dbLogger = logger.child({ module: 'database' });

// Opciones de Prisma según el entorno
const prismaOptions = {
  log: [
    {
      emit: 'event',
      level: 'query',
    },
    {
      emit: 'event',
      level: 'error',
    },
    {
      emit: 'event',
      level: 'warn',
    },
  ],
};

// Inicializar cliente Prisma
const prisma = new PrismaClient(prismaOptions);

// Vincular eventos de log de Prisma a nuestro logger
prisma.$on('query', (e) => {
  dbLogger.debug({
    query: e.query,
    params: e.params,
    duration: e.duration,
  }, 'Prisma Query');
});

prisma.$on('error', (e) => {
  dbLogger.error(e, 'Prisma Error');
});

prisma.$on('warn', (e) => {
  dbLogger.warn(e, 'Prisma Warning');
});

// Middleware global para auditoría (opcional)
// prisma.$use(async (params, next) => {
//   // Aquí podríamos implementar auditoría automática
//   const result = await next(params);
//   return result;
// });

// Función para inicializar la conexión
async function connectDatabase() {
  try {
    await prisma.$connect();
    dbLogger.info('Conexión a base de datos establecida correctamente');
    return prisma;
  } catch (error) {
    dbLogger.error({ error }, 'Error al conectar a la base de datos');
    throw error;
  }
}

// Función para cerrar la conexión
async function disconnectDatabase() {
  try {
    await prisma.$disconnect();
    dbLogger.info('Conexión a base de datos cerrada correctamente');
  } catch (error) {
    dbLogger.error({ error }, 'Error al cerrar conexión a la base de datos');
    throw error;
  }
}

export { prisma, connectDatabase, disconnectDatabase };
export default prisma;