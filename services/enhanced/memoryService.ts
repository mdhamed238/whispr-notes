/**
 * Memory Management Service
 * Monitors and optimizes memory usage across the application
 */

import {
    cleanupLargeObjects,
    forceGarbageCollection,
    getCurrentMemoryUsage,
    getMemoryOptimizationRecommendations,
    isMemoryUsageCritical,
    isMemoryUsageHigh
} from '../../utils/performance/memoryUtils';
import { cacheService } from './cacheService';

interface MemoryAlert {
  level: 'warning' | 'critical';
  message: string;
  recommendations: string[];
  timestamp: Date;
}

class MemoryService {
  private isMonitoring = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private alertCallbacks: ((alert: MemoryAlert) => void)[] = [];
  private cleanupTasks: (() => void)[] = [];
  private largeObjects: WeakSet<object> = new WeakSet();

  /**
   * Start memory monitoring
   */
  startMonitoring(intervalMs: number = 5000): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, intervalMs);

    console.log('Memory monitoring started');
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    console.log('Memory monitoring stopped');
  }

  /**
   * Register callback for memory alerts
   */
  onMemoryAlert(callback: (alert: MemoryAlert) => void): () => void {
    this.alertCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.alertCallbacks.indexOf(callback);
      if (index > -1) {
        this.alertCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Register cleanup task
   */
  registerCleanupTask(task: () => void): () => void {
    this.cleanupTasks.push(task);
    
    // Return unregister function
    return () => {
      const index = this.cleanupTasks.indexOf(task);
      if (index > -1) {
        this.cleanupTasks.splice(index, 1);
      }
    };
  }

  /**
   * Track large object for cleanup
   */
  trackLargeObject(obj: object): void {
    this.largeObjects.add(obj);
  }

  /**
   * Perform immediate memory optimization
   */
  async optimizeMemory(): Promise<void> {
    console.log('Starting memory optimization...');

    // 1. Optimize caches
    cacheService.optimizeCache();

    // 2. Run registered cleanup tasks
    this.cleanupTasks.forEach(task => {
      try {
        task();
      } catch (error) {
        console.error('Cleanup task failed:', error);
      }
    });

    // 3. Force garbage collection if available
    forceGarbageCollection();

    // 4. Clear large objects (this is more of a placeholder since WeakSet doesn't allow iteration)
    // In a real implementation, you'd track objects differently
    
    console.log('Memory optimization completed');
  }

  /**
   * Get current memory status
   */
  getMemoryStatus() {
    const usage = getCurrentMemoryUsage();
    const isHigh = isMemoryUsageHigh(usage);
    const isCritical = isMemoryUsageCritical(usage);
    const recommendations = getMemoryOptimizationRecommendations(usage);

    return {
      usage,
      isHigh,
      isCritical,
      recommendations,
      cacheStats: cacheService.getCacheStats(),
    };
  }

  /**
   * Cleanup audio buffers
   */
  cleanupAudioBuffers(buffers: Float32Array[]): void {
    cleanupLargeObjects(buffers);
    
    // Clear the arrays
    buffers.forEach(buffer => {
      if (buffer && buffer.fill) {
        buffer.fill(0);
      }
    });
    
    buffers.length = 0;
  }

  /**
   * Cleanup transcription data
   */
  cleanupTranscriptionData(items: any[]): void {
    cleanupLargeObjects(items);
    items.length = 0;
  }

  /**
   * Emergency memory cleanup
   */
  async emergencyCleanup(): Promise<void> {
    console.warn('Performing emergency memory cleanup');

    // Clear all caches
    cacheService.clearAll();

    // Run all cleanup tasks
    this.cleanupTasks.forEach(task => {
      try {
        task();
      } catch (error) {
        console.error('Emergency cleanup task failed:', error);
      }
    });

    // Force multiple garbage collections
    for (let i = 0; i < 3; i++) {
      forceGarbageCollection();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.warn('Emergency cleanup completed');
  }

  /**
   * Check memory usage and trigger alerts if needed
   */
  private checkMemoryUsage(): void {
    const usage = getCurrentMemoryUsage();
    
    if (isMemoryUsageCritical(usage)) {
      this.triggerAlert('critical', 'Critical memory usage detected', usage);
      // Automatically trigger emergency cleanup
      this.emergencyCleanup();
    } else if (isMemoryUsageHigh(usage)) {
      this.triggerAlert('warning', 'High memory usage detected', usage);
      // Automatically trigger optimization
      this.optimizeMemory();
    }
  }

  /**
   * Trigger memory alert
   */
  private triggerAlert(level: 'warning' | 'critical', message: string, usage: any): void {
    const recommendations = getMemoryOptimizationRecommendations(usage);
    
    const alert: MemoryAlert = {
      level,
      message,
      recommendations,
      timestamp: new Date(),
    };

    this.alertCallbacks.forEach(callback => {
      try {
        callback(alert);
      } catch (error) {
        console.error('Memory alert callback failed:', error);
      }
    });
  }
}

// Export singleton instance
export const memoryService = new MemoryService();
export default memoryService;