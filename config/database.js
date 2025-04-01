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
  // En desarrollo, loggear las consultas para depuración
  // La variable de entorno DEBUG_DATABASE=true permite activar esto en cualquier entorno
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_DATABASE === 'true') {
    dbLogger.debug({
      query: e.query,
      params: e.params,
      duration: e.duration,
    }, 'Prisma Query');
  }
});

prisma.$on('error', (e) => {
  dbLogger.error(e, 'Prisma Error');
});

prisma.$on('warn', (e) => {
  dbLogger.warn(e, 'Prisma Warning');
});

// Función para inicializar la conexión
async function connectDatabase() {
  try {
    await prisma.$connect();
    
    // Verificar la conexión intentando ejecutar una consulta simple
    await prisma.$queryRaw`SELECT 1+1 as result`;
    
    // Determinar si estamos en Heroku
    const isHeroku = process.env.IS_HEROKU === 'true' || Boolean(process.env.DYNO);
    
    // Mostrar información sobre el entorno de la base de datos
    const databaseUrl = process.env.DATABASE_URL || 'No configurada';
    // Ocultar credenciales para mostrar en logs
    const safeDbUrl = databaseUrl.replace(/\/\/([^:]+):([^@]+)@/, '//[USERNAME]:[PASSWORD]@');
    
    dbLogger.info(`Conexión a base de datos establecida correctamente`);
    dbLogger.info(`Entorno de base de datos: ${process.env.NODE_ENV}`);
    dbLogger.info(`Plataforma: ${isHeroku ? 'Heroku' : 'Local/Otro'}`);
    dbLogger.info(`URL de conexión: ${safeDbUrl}`);
    
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