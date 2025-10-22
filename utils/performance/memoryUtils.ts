/**
 * Memory Management Utilities
 * Provides functions for monitoring and optimizing memory usage
 */

import { MemoryUsage } from '../../types';

// Memory thresholds in MB
export const MEMORY_THRESHOLDS = {
  LOW: 100,
  MEDIUM: 200,
  HIGH: 350,
  CRITICAL: 500,
} as const;

/**
 * Get current memory usage (simplified for React Native)
 * In a real implementation, this would use native modules
 */
export function getCurrentMemoryUsage(): MemoryUsage {
  // For web/development, use performance.memory if available
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    const memory = (performance as any).memory;
    return {
      current: memory.usedJSHeapSize / (1024 * 1024), // Convert to MB
      peak: memory.totalJSHeapSize / (1024 * 1024),
      average: memory.usedJSHeapSize / (1024 * 1024), // Simplified
      threshold: MEMORY_THRESHOLDS.CRITICAL,
    };
  }

  // Fallback for React Native (would use native modules in real app)
  return {
    current: 0,
    peak: 0,
    average: 0,
    threshold: MEMORY_THRESHOLDS.CRITICAL,
  };
}

/**
 * Check if memory usage is above threshold
 */
export function isMemoryUsageHigh(memoryUsage: MemoryUsage): boolean {
  return memoryUsage.current > MEMORY_THRESHOLDS.HIGH;
}

/**
 * Check if memory usage is critical
 */
export function isMemoryUsageCritical(memoryUsage: MemoryUsage): boolean {
  return memoryUsage.current > MEMORY_THRESHOLDS.CRITICAL;
}

/**
 * Get memory usage level
 */
export function getMemoryUsageLevel(memoryUsage: MemoryUsage): 'low' | 'medium' | 'high' | 'critical' {
  if (memoryUsage.current > MEMORY_THRESHOLDS.CRITICAL) return 'critical';
  if (memoryUsage.current > MEMORY_THRESHOLDS.HIGH) return 'high';
  if (memoryUsage.current > MEMORY_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Force garbage collection (if available)
 * Note: This is mainly for development/debugging
 */
export function forceGarbageCollection(): void {
  if (typeof global !== 'undefined' && 'gc' in global) {
    (global as any).gc();
  } else if (typeof window !== 'undefined' && 'gc' in window) {
    (window as any).gc();
  }
}

/**
 * Clean up large objects and arrays
 */
export function cleanupLargeObjects(objects: any[]): void {
  objects.forEach(obj => {
    if (obj && typeof obj === 'object') {
      // Clear arrays
      if (Array.isArray(obj)) {
        obj.length = 0;
      }
      // Clear object properties
      else {
        Object.keys(obj).forEach(key => {
          delete obj[key];
        });
      }
    }
  });
}

/**
 * Memory optimization recommendations based on current usage
 */
export function getMemoryOptimizationRecommendations(memoryUsage: MemoryUsage): string[] {
  const recommendations: string[] = [];
  const level = getMemoryUsageLevel(memoryUsage);

  switch (level) {
    case 'critical':
      recommendations.push(
        'Clear transcription cache immediately',
        'Stop background processing',
        'Reduce audio buffer size',
        'Close unused screens'
      );
      break;
    case 'high':
      recommendations.push(
        'Clear old transcriptions from cache',
        'Reduce real-time processing',
        'Optimize audio quality settings'
      );
      break;
    case 'medium':
      recommendations.push(
        'Consider clearing cache',
        'Monitor background tasks'
      );
      break;
    default:
      // Low usage - no recommendations needed
      break;
  }

  return recommendations;
}

/**
 * Estimate memory usage for audio buffer
 */
export function estimateAudioBufferMemory(
  sampleRate: number,
  channels: number,
  durationSeconds: number,
  bitDepth: number = 16
): number {
  // Calculate bytes per sample
  const bytesPerSample = bitDepth / 8;
  
  // Calculate total samples
  const totalSamples = sampleRate * channels * durationSeconds;
  
  // Calculate total bytes and convert to MB
  const totalBytes = totalSamples * bytesPerSample;
  return totalBytes / (1024 * 1024);
}

/**
 * Estimate memory usage for transcription data
 */
export function estimateTranscriptionMemory(transcriptionLength: number): number {
  // Rough estimate: 2 bytes per character (UTF-16) plus metadata overhead
  const textBytes = transcriptionLength * 2;
  const metadataBytes = 1024; // Rough estimate for metadata
  const totalBytes = textBytes + metadataBytes;
  
  return totalBytes / (1024 * 1024);
}