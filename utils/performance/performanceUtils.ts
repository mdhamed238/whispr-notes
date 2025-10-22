/**
 * Performance Monitoring Utilities
 * Provides functions for measuring and optimizing app performance
 */

// Performance measurement storage
const measurements = new Map<string, number>();

/**
 * Start a performance measurement
 */
export function startPerformanceMeasurement(name: string): void {
  measurements.set(name, performance.now());
}

/**
 * End a performance measurement and return duration
 */
export function endPerformanceMeasurement(name: string): number {
  const startTime = measurements.get(name);
  if (!startTime) {
    console.warn(`Performance measurement '${name}' not found`);
    return 0;
  }

  const duration = performance.now() - startTime;
  measurements.delete(name);
  return duration;
}

/**
 * Measure the execution time of a function
 */
export async function measureExecutionTime<T>(
  name: string,
  fn: () => Promise<T> | T
): Promise<{ result: T; duration: number }> {
  const startTime = performance.now();
  
  try {
    const result = await fn();
    const duration = performance.now() - startTime;
    
    console.log(`Performance: ${name} took ${duration.toFixed(2)}ms`);
    
    return { result, duration };
  } catch (error) {
    const duration = performance.now() - startTime;
    console.error(`Performance: ${name} failed after ${duration.toFixed(2)}ms`, error);
    throw error;
  }
}

/**
 * Debounce function to limit execution frequency
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

/**
 * Throttle function to limit execution rate
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Create a performance-optimized version of a function with caching
 */
export function memoize<T extends (...args: any[]) => any>(
  func: T,
  maxCacheSize: number = 100
): T {
  const cache = new Map();
  const cacheOrder: string[] = [];

  return ((...args: Parameters<T>) => {
    const key = JSON.stringify(args);
    
    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = func(...args);
    
    // Manage cache size
    if (cache.size >= maxCacheSize) {
      const oldestKey = cacheOrder.shift();
      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }

    cache.set(key, result);
    cacheOrder.push(key);
    
    return result;
  }) as T;
}

/**
 * Batch multiple operations to reduce overhead
 */
export function batchOperations<T>(
  operations: (() => T)[],
  batchSize: number = 10
): Promise<T[]> {
  return new Promise((resolve) => {
    const results: T[] = [];
    let currentIndex = 0;

    function processBatch() {
      const endIndex = Math.min(currentIndex + batchSize, operations.length);
      
      for (let i = currentIndex; i < endIndex; i++) {
        results.push(operations[i]());
      }

      currentIndex = endIndex;

      if (currentIndex < operations.length) {
        // Use setTimeout to yield control back to the event loop
        setTimeout(processBatch, 0);
      } else {
        resolve(results);
      }
    }

    processBatch();
  });
}

/**
 * Check if the device is running on low-end hardware
 */
export function isLowEndDevice(): boolean {
  // Simple heuristic based on available APIs and performance
  if (typeof navigator !== 'undefined') {
    // Check for hardware concurrency (number of CPU cores)
    const cores = navigator.hardwareConcurrency || 1;
    if (cores <= 2) return true;

    // Check for device memory (if available)
    if ('deviceMemory' in navigator) {
      const memory = (navigator as any).deviceMemory;
      if (memory <= 2) return true; // 2GB or less
    }
  }

  // Check performance.now() precision as an indicator
  const start = performance.now();
  const end = performance.now();
  const precision = end - start;
  
  // Lower precision might indicate older/slower device
  return precision > 1;
}

/**
 * Get performance recommendations based on device capabilities
 */
export function getPerformanceRecommendations(): {
  audioQuality: 'low' | 'medium' | 'high';
  enableAnimations: boolean;
  maxCacheSize: number;
  backgroundProcessing: boolean;
} {
  const isLowEnd = isLowEndDevice();

  return {
    audioQuality: isLowEnd ? 'low' : 'medium',
    enableAnimations: !isLowEnd,
    maxCacheSize: isLowEnd ? 50 : 100,
    backgroundProcessing: !isLowEnd,
  };
}

/**
 * Monitor frame rate (for animations and UI responsiveness)
 */
export class FrameRateMonitor {
  private frameCount = 0;
  private lastTime = performance.now();
  private fps = 60;
  private isMonitoring = false;

  start(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.measureFrame();
  }

  stop(): void {
    this.isMonitoring = false;
  }

  getFPS(): number {
    return this.fps;
  }

  private measureFrame = (): void => {
    if (!this.isMonitoring) return;

    this.frameCount++;
    const currentTime = performance.now();
    
    if (currentTime - this.lastTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastTime = currentTime;
    }

    requestAnimationFrame(this.measureFrame);
  };
}

/**
 * Optimize React Native FlatList performance
 */
export const FLATLIST_OPTIMIZATION_PROPS = {
  removeClippedSubviews: true,
  maxToRenderPerBatch: 10,
  updateCellsBatchingPeriod: 50,
  initialNumToRender: 10,
  windowSize: 10,
  getItemLayout: (data: any[], index: number) => ({
    length: 80, // Estimated item height
    offset: 80 * index,
    index,
  }),
};

/**
 * Create a performance-aware timeout that adjusts based on device performance
 */
export function createAdaptiveTimeout(
  callback: () => void,
  baseDelay: number
): NodeJS.Timeout {
  const isLowEnd = isLowEndDevice();
  const adjustedDelay = isLowEnd ? baseDelay * 1.5 : baseDelay;
  
  return setTimeout(callback, adjustedDelay);
}