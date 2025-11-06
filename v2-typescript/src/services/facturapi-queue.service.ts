/**
 * FacturAPI Queue Service
 * Basic queue system to handle FacturAPI requests
 * Prevents overload and improves scalability
 */

import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('FacturapiQueue');

interface QueueConfig {
  maxConcurrent: number;
  maxQueueSize: number;
  processingDelay: number;
  retryDelay: number;
  maxRetries: number;
}

interface QueueMetrics {
  totalProcessed: number;
  totalFailed: number;
  currentQueueSize: number;
  currentProcessing: number;
  averageWaitTime: number;
  peakQueueSize: number;
}

interface QueueItem<T = unknown> {
  id: string;
  operation: () => Promise<T>;
  operationType: string;
  context: Record<string, unknown>;
  priority: number;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  enqueuedAt: number;
  retries: number;
  maxRetries: number;
}

interface QueueItemStatus {
  id: string;
  operationType: string;
  priority: number;
  waitTime: number;
  retries: number;
}

interface QueueStatus {
  isHealthy: boolean;
  queueItems: QueueItemStatus[];
  processingItems: string[];
  metrics: QueueMetrics & { successRate: string; config: QueueConfig };
}

/**
 * FacturAPI Queue Service Class
 */
class FacturapiQueueService {
  private queue: QueueItem[] = [];
  private processing = new Set<string>();
  private config: QueueConfig = {
    maxConcurrent: 5,
    maxQueueSize: 100,
    processingDelay: 200,
    retryDelay: 2000,
    maxRetries: 3,
  };
  private metrics: QueueMetrics = {
    totalProcessed: 0,
    totalFailed: 0,
    currentQueueSize: 0,
    currentProcessing: 0,
    averageWaitTime: 0,
    peakQueueSize: 0,
  };

  constructor() {
    this.startQueueProcessor();
  }

  /**
   * Add request to queue
   */
  async enqueue<T = unknown>(
    operation: () => Promise<T>,
    operationType = 'normal',
    context: Record<string, unknown> = {},
    priority = 1
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.config.maxQueueSize) {
        const error = new Error(`FacturAPI queue full (${this.config.maxQueueSize} requests)`);
        logger.error(
          { queueSize: this.queue.length, operationType, context },
          'Queue full, rejecting request'
        );
        reject(error);
        return;
      }

      const queueItem: QueueItem<T> = {
        id: this.generateId(),
        operation,
        operationType,
        context,
        priority,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
        retries: 0,
        maxRetries: this.config.maxRetries,
      };

      this.insertByPriority(queueItem);

      this.metrics.currentQueueSize = this.queue.length;
      this.metrics.peakQueueSize = Math.max(this.metrics.peakQueueSize, this.queue.length);

      logger.debug(
        {
          id: queueItem.id,
          operationType,
          priority,
          queuePosition: this.queue.length,
          context,
        },
        'Request added to queue'
      );
    });
  }

  /**
   * Insert element in queue maintaining priority order
   */
  private insertByPriority<T>(item: QueueItem<T>): void {
    let inserted = false;

    for (let i = 0; i < this.queue.length; i++) {
      if (item.priority > this.queue[i].priority) {
        this.queue.splice(i, 0, item as QueueItem);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.queue.push(item as QueueItem);
    }
  }

  /**
   * Main queue processor
   */
  private async startQueueProcessor(): Promise<void> {
    logger.info(this.config, 'Starting FacturAPI queue processor');

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        if (this.processing.size < this.config.maxConcurrent && this.queue.length > 0) {
          const item = this.queue.shift();
          if (item) {
            this.metrics.currentQueueSize = this.queue.length;
            this.processItem(item);
          }
        }

        await this.delay(this.config.processingDelay);
      } catch (error) {
        logger.error({ error }, 'Error in queue processor');
        await this.delay(1000);
      }
    }
  }

  /**
   * Process queue item
   */
  private async processItem(item: QueueItem): Promise<void> {
    this.processing.add(item.id);
    this.metrics.currentProcessing = this.processing.size;

    const waitTime = Date.now() - item.enqueuedAt;
    this.updateAverageWaitTime(waitTime);

    logger.debug(
      {
        id: item.id,
        operationType: item.operationType,
        waitTime,
        retries: item.retries,
        currentProcessing: this.processing.size,
      },
      'Processing request'
    );

    try {
      // Execute operation with timeout (simplified - no adaptive timeout for now)
      const timeoutMs = 30000; // 30 seconds default
      const result = await Promise.race([
        item.operation(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
        ),
      ]);

      this.metrics.totalProcessed++;
      item.resolve(result as Awaited<ReturnType<typeof item.operation>>);

      logger.debug(
        {
          id: item.id,
          operationType: item.operationType,
          processingTime: Date.now() - (item.enqueuedAt + waitTime),
        },
        'Request completed successfully'
      );
    } catch (error) {
      if (item.retries < item.maxRetries && this.shouldRetry(error as Error)) {
        item.retries++;

        logger.warn(
          {
            id: item.id,
            operationType: item.operationType,
            error: error instanceof Error ? error.message : 'Unknown error',
            retries: item.retries,
            maxRetries: item.maxRetries,
          },
          'Request failed, retrying'
        );

        setTimeout(() => {
          item.priority = Math.max(item.priority - 1, 0);
          this.insertByPriority(item);
          this.metrics.currentQueueSize = this.queue.length;
        }, this.config.retryDelay);
      } else {
        this.metrics.totalFailed++;
        item.reject(error as Error);

        logger.error(
          {
            id: item.id,
            operationType: item.operationType,
            error: error instanceof Error ? error.message : 'Unknown error',
            retries: item.retries,
          },
          'Request failed definitively'
        );
      }
    } finally {
      this.processing.delete(item.id);
      this.metrics.currentProcessing = this.processing.size;
    }
  }

  /**
   * Determine if error should be retried
   */
  private shouldRetry(error: Error): boolean {
    const retryableErrors = [
      'timeout',
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'socket hang up',
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = (error as Error & { code?: string }).code?.toLowerCase() || '';

    return retryableErrors.some(
      (retryableError) =>
        errorMessage.includes(retryableError.toLowerCase()) ||
        errorCode.includes(retryableError.toLowerCase())
    );
  }

  /**
   * Update average wait time
   */
  private updateAverageWaitTime(waitTime: number): void {
    const totalRequests = this.metrics.totalProcessed + this.metrics.totalFailed + 1;
    this.metrics.averageWaitTime =
      (this.metrics.averageWaitTime * (totalRequests - 1) + waitTime) / totalRequests;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Helper for delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get queue metrics
   */
  getMetrics() {
    const totalRequests = this.metrics.totalProcessed + this.metrics.totalFailed;
    const successRate =
      totalRequests > 0 ? ((this.metrics.totalProcessed / totalRequests) * 100).toFixed(2) : '100';

    return {
      ...this.metrics,
      successRate: `${successRate}%`,
      averageWaitTime: Math.round(this.metrics.averageWaitTime),
      config: this.config,
    };
  }

  /**
   * Clear queue (emergency only)
   */
  clearQueue(): void {
    const rejectedCount = this.queue.length;

    this.queue.forEach((item) => {
      item.reject(new Error('Queue cleared by administrator'));
    });

    this.queue = [];
    this.metrics.currentQueueSize = 0;

    logger.warn({ rejectedCount }, 'Queue cleared by administrator');
  }

  /**
   * Get detailed queue status
   */
  getStatus(): QueueStatus {
    return {
      isHealthy: this.queue.length < this.config.maxQueueSize * 0.8,
      queueItems: this.queue.map((item) => ({
        id: item.id,
        operationType: item.operationType,
        priority: item.priority,
        waitTime: Date.now() - item.enqueuedAt,
        retries: item.retries,
      })),
      processingItems: Array.from(this.processing),
      metrics: this.getMetrics(),
    };
  }
}

// Singleton instance
const facturapiQueueService = new FacturapiQueueService();
export default facturapiQueueService;
