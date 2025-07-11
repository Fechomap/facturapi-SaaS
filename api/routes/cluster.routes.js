// api/routes/cluster.routes.js - Endpoints para monitoreo de cluster
import express from 'express';
import os from 'os';
import cluster from 'cluster';
import redisSessionService from '../../services/redis-session.service.js';
import clusterHealthService from '../../services/cluster-health.service.js';
import logger from '../../core/utils/logger.js';

const router = express.Router();
const clusterLogger = logger.child({ module: 'cluster-routes' });

/**
 * Información del cluster y worker actual
 */
router.get('/info', (req, res) => {
  try {
    const workerInfo = {
      workerId: cluster.worker?.id || 'master',
      workerPid: process.pid,
      isMaster: cluster.isPrimary,
      isWorker: cluster.isWorker,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      cpuCount: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      loadAverage: os.loadavg(),
      environment: process.env.NODE_ENV,
      isRailway: process.env.IS_RAILWAY === 'true'
    };

    res.json({
      success: true,
      worker: workerInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    clusterLogger.error('Error al obtener información del cluster:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener información del cluster',
      message: error.message
    });
  }
});

/**
 * Estadísticas de sesiones Redis
 */
router.get('/sessions', async (req, res) => {
  try {
    const sessionStats = await redisSessionService.getStats();
    
    res.json({
      success: true,
      sessions: sessionStats,
      worker: {
        id: cluster.worker?.id || 'master',
        pid: process.pid
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    clusterLogger.error('Error al obtener estadísticas de sesiones:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas de sesiones',
      message: error.message
    });
  }
});

/**
 * Health check avanzado para load balancing
 */
router.get('/health', async (req, res) => {
  try {
    // Incrementar contador de requests
    clusterHealthService.incrementRequestCount();
    
    // Realizar health check completo
    const healthCheck = await clusterHealthService.checkHealth();
    
    const statusCode = healthCheck.healthy ? 200 : 503;
    res.status(statusCode).json(healthCheck);
  } catch (error) {
    clusterLogger.error('Error en health check:', error);
    clusterHealthService.incrementErrorCount();
    
    res.status(503).json({
      healthy: false,
      error: 'Error en health check',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Health check simple para load balancers básicos
 */
router.get('/health/simple', (req, res) => {
  const memUsage = process.memoryUsage();
  const memoryPressure = memUsage.heapUsed / memUsage.heapTotal;
  const isHealthy = memoryPressure < 0.9;
  
  if (isHealthy) {
    res.status(200).json({ status: 'healthy' });
  } else {
    res.status(503).json({ status: 'unhealthy' });
  }
});

/**
 * Recomendaciones de optimización
 */
router.get('/recommendations', async (req, res) => {
  try {
    // Asegurar que tenemos health check reciente
    await clusterHealthService.checkHealth();
    
    const recommendations = clusterHealthService.getRecommendations();
    const clusterStats = clusterHealthService.getClusterStats();
    
    res.json({
      success: true,
      cluster: clusterStats,
      recommendations,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    clusterLogger.error('Error al obtener recomendaciones:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener recomendaciones',
      message: error.message
    });
  }
});

/**
 * Endpoint para simular carga (solo en desarrollo)
 */
router.post('/stress-test', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Stress test no disponible en producción'
    });
  }

  try {
    const { duration = 5000, intensity = 'medium' } = req.body;
    
    clusterLogger.info(`Iniciando stress test: ${intensity} por ${duration}ms en worker ${process.pid}`);
    
    const startTime = Date.now();
    const endTime = startTime + duration;
    
    // Simular carga según intensidad
    const stressLoop = () => {
      const now = Date.now();
      if (now < endTime) {
        // CPU intensivo
        if (intensity === 'high') {
          for (let i = 0; i < 100000; i++) {
            Math.random() * Math.random();
          }
        } else if (intensity === 'medium') {
          for (let i = 0; i < 50000; i++) {
            Math.random() * Math.random();
          }
        } else {
          for (let i = 0; i < 10000; i++) {
            Math.random() * Math.random();
          }
        }
        
        setImmediate(stressLoop);
      }
    };
    
    stressLoop();
    
    res.json({
      success: true,
      message: `Stress test iniciado en worker ${process.pid}`,
      duration,
      intensity,
      worker: {
        id: cluster.worker?.id || 'master',
        pid: process.pid
      }
    });
  } catch (error) {
    clusterLogger.error('Error en stress test:', error);
    res.status(500).json({
      success: false,
      error: 'Error en stress test',
      message: error.message
    });
  }
});

/**
 * Métricas detalladas del worker
 */
router.get('/metrics', (req, res) => {
  try {
    const metrics = {
      worker: {
        id: cluster.worker?.id || 'master',
        pid: process.pid,
        ppid: process.ppid,
        uptime: process.uptime(),
        title: process.title
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        loadAverage: os.loadavg(),
        hostname: os.hostname(),
        networkInterfaces: Object.keys(os.networkInterfaces()).length
      },
      process: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        versions: process.versions,
        execPath: process.execPath,
        argv: process.argv.slice(0, 3) // Solo mostrar los primeros argumentos
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        isRailway: process.env.IS_RAILWAY === 'true',
        port: process.env.PORT
      },
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      metrics,
      generatedBy: `worker-${process.pid}`
    });
  } catch (error) {
    clusterLogger.error('Error al obtener métricas:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener métricas',
      message: error.message
    });
  }
});

export default router;