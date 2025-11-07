// cluster.ts - Configuración de clustering para escalabilidad
import cluster from 'cluster';
import os from 'os';
import logger from './core/utils/logger';

const clusterLogger = logger.child({ module: 'cluster' });

/**
 * Determinar número de workers según el entorno
 */
const getWorkerCount = (): number => {
  const cpuCount = os.cpus().length;
  const isProduction = process.env.NODE_ENV === 'production';
  const isRailway = process.env.IS_RAILWAY === 'true' || Boolean(process.env.RAILWAY_ENVIRONMENT);

  if (isRailway && isProduction) {
    return Math.min(cpuCount * 2, 8);
  } else if (isProduction) {
    return cpuCount;
  } else {
    return Math.min(cpuCount, 2);
  }
};

const workerCount = getWorkerCount();
const WORKER_RESTART_DELAY = 1000;
const MAX_RESTARTS_PER_MINUTE = 5;

const restartCounts = new Map<number, number>();

if (cluster.isPrimary) {
  clusterLogger.info(`🚀 Iniciando cluster principal con ${workerCount} workers`);
  clusterLogger.info(`💻 CPUs detectados: ${os.cpus().length}`);
  clusterLogger.info(`🏭 Entorno: ${process.env.NODE_ENV}`);
  clusterLogger.info(`🚂 Railway: ${process.env.IS_RAILWAY === 'true' ? 'Sí' : 'No'}`);

  // Limpiar contadores de restart cada minuto
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

    // Solo reiniciar si no fue terminación intencional
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
  const shutdown = (signal: string) => {
    clusterLogger.info(`📴 Recibida señal ${signal}, cerrando cluster...`);

    for (const id in cluster.workers) {
      cluster.workers[id]?.kill('SIGTERM');
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
      const workerIds = Object.keys(cluster.workers || {});
      clusterLogger.info(`📊 Cluster activo: ${workerIds.length}/${workerCount} workers`);

      const memUsage = process.memoryUsage();
      clusterLogger.info(`💾 Memoria principal: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
    },
    5 * 60 * 1000
  );
} else {
  // Código del worker
  clusterLogger.info(`👷 Worker ${process.pid} iniciando...`);

  // Importar el servidor
  import('./server').catch((error) => {
    clusterLogger.error(`❌ Error al iniciar worker ${process.pid}:`, error);
    process.exit(1);
  });

  // Manejar errores no capturados
  process.on('uncaughtException', (error: any) => {
    clusterLogger.error(`💥 Error no capturado en worker ${process.pid}:`, {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });

    if (error.code === 'EADDRINUSE' || error.code === 'EACCES' || !error.recoverable) {
      clusterLogger.fatal('Error crítico del sistema, terminando worker');
      process.exit(1);
    } else {
      clusterLogger.warn('Error recuperable, continuando operación');
    }
  });

  // Contador de unhandled rejections para recovery
  let rejectionCount = 0;
  const MAX_REJECTIONS = 10; // Reiniciar después de 10 rejections

  process.on('unhandledRejection', (reason: any) => {
    rejectionCount++;

    clusterLogger.error(
      `🚫 Promesa rechazada no manejada en worker ${process.pid} (${rejectionCount}/${MAX_REJECTIONS}):`,
      {
        reason: reason?.message || reason,
        stack: reason?.stack,
        timestamp: new Date().toISOString(),
        rejectionCount,
      }
    );

    if (rejectionCount >= MAX_REJECTIONS) {
      clusterLogger.error(
        `Worker ${process.pid} alcanzó el límite de ${MAX_REJECTIONS} unhandled rejections. Reiniciando worker por seguridad...`
      );

      // Esperar 1 segundo para que se registren los logs
      setTimeout(() => {
        process.exit(1); // El cluster automáticamente creará un nuevo worker
      }, 1000);
    } else {
      clusterLogger.warn(
        `Continuando operación (${MAX_REJECTIONS - rejectionCount} rejections restantes antes de reinicio)`
      );
    }
  });

  // Resetear contador cada hora (si el worker sigue activo)
  setInterval(
    () => {
      if (rejectionCount > 0) {
        clusterLogger.info(`Reseteando contador de rejections (era: ${rejectionCount})`);
        rejectionCount = 0;
      }
    },
    60 * 60 * 1000
  ); // Cada hora
}

export default cluster;
