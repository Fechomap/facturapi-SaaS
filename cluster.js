// cluster.js - Configuración de clustering para escalabilidad masiva
import cluster from 'cluster';
import os from 'os';
import logger from './core/utils/logger.js';

const clusterLogger = logger.child({ module: 'cluster' });

// Determinar número de workers según el entorno
const getWorkerCount = () => {
  const cpuCount = os.cpus().length;
  const isProduction = process.env.NODE_ENV === 'production';
  const isRailway = process.env.IS_RAILWAY === 'true' || Boolean(process.env.RAILWAY_ENVIRONMENT);

  // En Railway podemos usar más workers debido a su infraestructura
  if (isRailway && isProduction) {
    // Railway permite hasta 8 workers eficientemente
    return Math.min(cpuCount * 2, 8);
  } else if (isProduction) {
    // En producción general, usar todos los CPUs disponibles
    return cpuCount;
  } else {
    // En desarrollo, solo 2 workers para no saturar
    return Math.min(cpuCount, 2);
  }
};

// Configuración del cluster
const workerCount = getWorkerCount();
const WORKER_RESTART_DELAY = 1000; // 1 segundo
const MAX_RESTARTS_PER_MINUTE = 5;

const restartCounts = new Map();

if (cluster.isPrimary) {
  clusterLogger.info(`🚀 Iniciando cluster principal con ${workerCount} workers`);
  clusterLogger.info(`💻 CPUs detectados: ${os.cpus().length}`);
  clusterLogger.info(`🏭 Entorno: ${process.env.NODE_ENV}`);
  clusterLogger.info(`🚂 Railway: ${process.env.IS_RAILWAY === 'true' ? 'Sí' : 'No'}`);

  // Función para limpiar contadores de restart cada minuto
  setInterval(() => {
    restartCounts.clear();
  }, 60000);

  // Función para crear un worker
  const createWorker = () => {
    const worker = cluster.fork();

    worker.on('online', () => {
      clusterLogger.info(`👷 Worker ${worker.process.pid} iniciado correctamente`);
    });

    return worker;
  };

  // Crear workers iniciales
  for (let i = 0; i < workerCount; i++) {
    createWorker();
  }

  // Manejar workers que mueren
  cluster.on('exit', (worker, code, signal) => {
    const pid = worker.process.pid;

    if (signal) {
      clusterLogger.warn(`💀 Worker ${pid} terminado por señal ${signal}`);
    } else if (code !== 0) {
      clusterLogger.error(`💀 Worker ${pid} falló con código ${code}`);
    } else {
      clusterLogger.info(`✅ Worker ${pid} terminado correctamente`);
    }

    // Solo reiniciar automáticamente si no fue una terminación intencional
    if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
      const workerId = worker.id;
      const currentRestarts = restartCounts.get(workerId) || 0;

      if (currentRestarts < MAX_RESTARTS_PER_MINUTE) {
        clusterLogger.info(`🔄 Reiniciando worker ${workerId} en ${WORKER_RESTART_DELAY}ms`);

        setTimeout(() => {
          createWorker();
          restartCounts.set(workerId, currentRestarts + 1);
        }, WORKER_RESTART_DELAY);
      } else {
        clusterLogger.error(
          `⚠️ Worker ${workerId} ha fallado demasiadas veces, no se reiniciará automáticamente`
        );
      }
    }
  });

  // Manejar señales del sistema para cierre limpio
  const shutdown = (signal) => {
    clusterLogger.info(`📴 Recibida señal ${signal}, cerrando cluster...`);

    for (const id in cluster.workers) {
      cluster.workers[id].kill('SIGTERM');
    }

    // Forzar cierre después de 10 segundos
    setTimeout(() => {
      clusterLogger.warn('⏰ Forzando cierre del cluster');
      process.exit(0);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Estadísticas del cluster cada 5 minutos
  setInterval(
    () => {
      const workerIds = Object.keys(cluster.workers);
      clusterLogger.info(`📊 Cluster activo: ${workerIds.length}/${workerCount} workers`);

      // Información de memoria y CPU
      const memUsage = process.memoryUsage();
      clusterLogger.info(`💾 Memoria principal: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
    },
    5 * 60 * 1000
  );
} else {
  // Código del worker - importar y ejecutar el servidor
  clusterLogger.info(`👷 Worker ${process.pid} iniciando...`);

  // Importar dinámicamente el servidor para evitar problemas de clustering
  import('./server.js').catch((error) => {
    clusterLogger.error(`❌ Error al iniciar worker ${process.pid}:`, error);
    process.exit(1);
  });

  // Manejar errores no capturados en workers - GRACEFUL HANDLING
  process.on('uncaughtException', (error) => {
    clusterLogger.error(`💥 Error no capturado en worker ${process.pid}:`, {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });

    // Solo salir si es un error crítico del sistema
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES' || !error.recoverable) {
      clusterLogger.fatal('Error crítico del sistema, terminando worker');
      process.exit(1);
    } else {
      clusterLogger.warn('Error recuperable, continuando operación');
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    clusterLogger.error(`🚫 Promesa rechazada no manejada en worker ${process.pid}:`, {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise?.toString?.() || 'Promise sin información',
      timestamp: new Date().toISOString(),
    });

    // No terminar el proceso por promesas rechazadas - solo logear
    clusterLogger.warn('Continuando operación después de promesa rechazada');
  });
}

export default cluster;
