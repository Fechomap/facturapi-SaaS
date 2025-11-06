import os from 'os';
import cluster from 'cluster';
import redisSessionService from './redis-session.service';
import logger from '../core/utils/logger';

const healthLogger = logger.child({ module: 'cluster-health' });

interface WorkerInfo {
  id: number | string;
  pid: number;
  uptime: number;
  startTime: number;
}

interface PerformanceMetrics {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  requestsPerSecond: number;
}

interface MemoryMetrics {
  used: number;
  total: number;
  pressure: number;
  external: number;
  rss: number;
}

interface CpuMetrics {
  user: number;
  system: number;
}

interface WorkerMetrics {
  worker: WorkerInfo;
  performance: PerformanceMetrics;
  memory: MemoryMetrics;
  cpu: CpuMetrics;
}

interface SystemMemory {
  total: number;
  free: number;
  used: number;
  usage: number;
}

interface LoadMetrics {
  '1min': number;
  '5min': number;
  '15min': number;
}

interface SystemMetrics {
  platform: string;
  arch: string;
  cpus: number;
  memory: SystemMemory;
  load: LoadMetrics;
  hostname: string;
  uptime: number;
}

interface RedisHealth {
  connected?: boolean;
  type?: string;
  activeSessions?: number;
  error?: string;
}

interface HealthCheck {
  timestamp: string;
  healthy: boolean;
  score: number;
  issues: string[];
  worker: WorkerInfo;
  performance: PerformanceMetrics;
  memory: MemoryMetrics;
  system: SystemMetrics;
  redis: RedisHealth | null;
}

interface ClusterStats {
  isMaster: boolean;
  isWorker: boolean;
  workerId: number | string;
  totalWorkers: number | string;
  environment: {
    nodeEnv: string | undefined;
    isRailway: boolean;
  };
}

class ClusterHealthService {
  private startTime: number;
  private requestCount: number;
  private errorCount: number;
  private lastHealthCheck: HealthCheck | null;

  constructor() {
    this.startTime = Date.now();
    this.requestCount = 0;
    this.errorCount = 0;
    this.lastHealthCheck = null;
  }

  incrementRequestCount(): void {
    this.requestCount++;
  }

  incrementErrorCount(): void {
    this.errorCount++;
  }

  getWorkerMetrics(): WorkerMetrics {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();

    return {
      worker: {
        id: cluster.worker?.id || 'master',
        pid: process.pid,
        uptime: uptime,
        startTime: this.startTime,
      },
      performance: {
        requestCount: this.requestCount,
        errorCount: this.errorCount,
        errorRate: this.requestCount > 0 ? this.errorCount / this.requestCount : 0,
        requestsPerSecond: uptime > 0 ? this.requestCount / uptime : 0,
      },
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        pressure: memUsage.heapUsed / memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
    };
  }

  getSystemMetrics(): SystemMetrics {
    const loadAvg = os.loadavg();

    return {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usage: (os.totalmem() - os.freemem()) / os.totalmem(),
      },
      load: {
        '1min': loadAvg[0],
        '5min': loadAvg[1],
        '15min': loadAvg[2],
      },
      hostname: os.hostname(),
      uptime: os.uptime(),
    };
  }

  async checkHealth(): Promise<HealthCheck> {
    const metrics = this.getWorkerMetrics();
    const systemMetrics = this.getSystemMetrics();

    const memoryPressure = metrics.memory.pressure;
    const errorRate = metrics.performance.errorRate;
    const systemMemoryUsage = systemMetrics.memory.usage;
    const cpuLoad = systemMetrics.load['1min'] / systemMetrics.cpus;

    const issues: string[] = [];
    let healthScore = 100;

    if (memoryPressure > 0.9) {
      issues.push('Memory pressure alta en worker (>90%)');
      healthScore -= 30;
    } else if (memoryPressure > 0.8) {
      issues.push('Memory pressure elevada en worker (>80%)');
      healthScore -= 15;
    }

    if (systemMemoryUsage > 0.9) {
      issues.push('Memoria del sistema alta (>90%)');
      healthScore -= 25;
    } else if (systemMemoryUsage > 0.8) {
      issues.push('Memoria del sistema elevada (>80%)');
      healthScore -= 10;
    }

    if (errorRate > 0.1) {
      issues.push('Tasa de errores alta (>10%)');
      healthScore -= 40;
    } else if (errorRate > 0.05) {
      issues.push('Tasa de errores elevada (>5%)');
      healthScore -= 20;
    }

    if (cpuLoad > 2.0) {
      issues.push('Carga de CPU muy alta (>200%)');
      healthScore -= 30;
    } else if (cpuLoad > 1.5) {
      issues.push('Carga de CPU alta (>150%)');
      healthScore -= 15;
    }

    let redisHealth: RedisHealth | null = null;
    try {
      const redisStats = await redisSessionService.getStats();
      redisHealth = {
        connected: redisStats.connected,
        type: redisStats.type,
        activeSessions: redisStats.activeSessions,
      };

      if (redisStats.type === 'memory' && !redisStats.connected) {
        issues.push('Redis no configurado - sesiones en memoria');
        healthScore -= 20;
      }
    } catch (error) {
      issues.push('Error al verificar Redis');
      healthScore -= 15;
      redisHealth = { error: (error as Error).message };
    }

    const isHealthy = healthScore >= 70;

    this.lastHealthCheck = {
      timestamp: new Date().toISOString(),
      healthy: isHealthy,
      score: Math.max(0, healthScore),
      issues,
      worker: metrics.worker,
      performance: metrics.performance,
      memory: metrics.memory,
      system: systemMetrics,
      redis: redisHealth,
    };

    if (!isHealthy) {
      healthLogger.warn(
        `Worker ${metrics.worker.pid} con problemas de salud (score: ${healthScore}):`,
        issues
      );
    }

    return this.lastHealthCheck;
  }

  getRecommendations(): string[] {
    if (!this.lastHealthCheck) {
      return ['Ejecutar health check primero'];
    }

    const recommendations: string[] = [];
    const { memory, performance, system, redis } = this.lastHealthCheck;

    if (memory.pressure > 0.8) {
      recommendations.push('Considerar aumentar memoria disponible');
      recommendations.push('Revisar posibles memory leaks');
    }

    if (performance.errorRate > 0.05) {
      recommendations.push('Investigar causas de errores frecuentes');
      recommendations.push('Revisar logs de errores');
    }

    if (performance.requestsPerSecond < 10) {
      recommendations.push('Performance baja - revisar optimizaciones');
    }

    if (system.memory.usage > 0.8) {
      recommendations.push('Memoria del sistema alta - considerar escalado');
    }

    const cpuLoad = system.load['1min'] / system.cpus;
    if (cpuLoad > 1.5) {
      recommendations.push('Carga de CPU alta - considerar más workers o escalado');
    }

    if (redis?.type === 'memory') {
      recommendations.push('CRÍTICO: Configurar Redis para clustering real');
      recommendations.push('Sesiones en memoria limitan escalabilidad');
    }

    if (redis?.error) {
      recommendations.push('Resolver problemas de conexión con Redis');
    }

    return recommendations;
  }

  getClusterStats(): ClusterStats {
    return {
      isMaster: cluster.isPrimary,
      isWorker: cluster.isWorker,
      workerId: cluster.worker?.id || 'master',
      totalWorkers: cluster.isPrimary ? Object.keys(cluster.workers || {}).length : 'unknown',
      environment: {
        nodeEnv: process.env.NODE_ENV,
        isRailway: process.env.IS_RAILWAY === 'true',
      },
    };
  }
}

const clusterHealthService = new ClusterHealthService();
export default clusterHealthService;
