/**
 * Performance Optimization Hook
 * Provides comprehensive performance monitoring and optimization for React components
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePerformance } from '../contexts/PerformanceContext';
import { memoryService } from '../services/enhanced/memoryService';
import { FrameRateMonitor } from '../utils/performance/performanceUtils';

interface PerformanceOptimizationOptions {
  measureRender?: boolean;
  trackMemory?: boolean;
  monitorFrameRate?: boolean;
  autoOptimize?: boolean;
  componentName?: string;
}

interface PerformanceMetrics {
  renderTime: number;
  memoryUsage: number;
  frameRate: number;
  renderCount: number;
}

export function usePerformanceOptimization(
  options: PerformanceOptimizationOptions = {}
) {
  const {
    measureRender = true,
    trackMemory = true,
    monitorFrameRate = false,
    autoOptimize = true,
    componentName = 'UnknownComponent',
  } = options;

  const { startMeasurement, endMeasurement, reportError } = usePerformance();
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    renderTime: 0,
    memoryUsage: 0,
    frameRate: 60,
    renderCount: 0,
  });

  const renderCountRef = useRef(0);
  const frameRateMonitorRef = useRef<FrameRateMonitor | null>(null);
  const measurementIdRef = useRef<string | null>(null);

  // Start render measurement
  const startRenderMeasurement = useCallback(() => {
    if (measureRender) {
      measurementIdRef.current = startMeasurement(`${componentName}_render`);
    }
  }, [measureRender, componentName, startMeasurement]);

  // End render measurement
  const endRenderMeasurement = useCallback(() => {
    if (measureRender && measurementIdRef.current) {
      const renderTime = endMeasurement(measurementIdRef.current);
      renderCountRef.current++;
      
      setMetrics(prev => ({
        ...prev,
        renderTime,
        renderCount: renderCountRef.current,
      }));

      measurementIdRef.current = null;
    }
  }, [measureRender, endMeasurement]);

  // Memory tracking effect
  useEffect(() => {
    if (!trackMemory) return;

    const updateMemoryUsage = () => {
      const memoryStatus = memoryService.getMemoryStatus();
      setMetrics(prev => ({
        ...prev,
        memoryUsage: memoryStatus.usage.current,
      }));
    };

    updateMemoryUsage();
    const interval = setInterval(updateMemoryUsage, 2000);

    return () => clearInterval(interval);
  }, [trackMemory]);

  // Frame rate monitoring effect
  useEffect(() => {
    if (!monitorFrameRate) return;

    frameRateMonitorRef.current = new FrameRateMonitor();
    frameRateMonitorRef.current.start();

    const interval = setInterval(() => {
      if (frameRateMonitorRef.current) {
        const fps = frameRateMonitorRef.current.getFPS();
        setMetrics(prev => ({
          ...prev,
          frameRate: fps,
        }));
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (frameRateMonitorRef.current) {
        frameRateMonitorRef.current.stop();
      }
    };
  }, [monitorFrameRate]);

  // Auto-optimization effect
  useEffect(() => {
    if (!autoOptimize) return;

    const { renderTime, memoryUsage, frameRate } = metrics;

    // Check for performance issues
    const hasSlowRender = renderTime > 16; // More than one frame at 60fps
    const hasHighMemory = memoryUsage > 200; // More than 200MB
    const hasLowFrameRate = frameRate < 30; // Less than 30fps

    if (hasSlowRender || hasHighMemory || hasLowFrameRate) {
      console.warn(`Performance issue detected in ${componentName}:`, {
        renderTime,
        memoryUsage,
        frameRate,
      });

      // Trigger optimization
      if (hasHighMemory) {
        memoryService.optimizeMemory();
      }
    }
  }, [metrics, autoOptimize, componentName]);

  // Component lifecycle tracking
  useEffect(() => {
    startRenderMeasurement();
    
    return () => {
      endRenderMeasurement();
    };
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (frameRateMonitorRef.current) {
        frameRateMonitorRef.current.stop();
      }
    };
  }, []);

  // Performance optimization recommendations
  const getOptimizationRecommendations = useCallback(() => {
    const recommendations: string[] = [];
    const { renderTime, memoryUsage, frameRate, renderCount } = metrics;

    if (renderTime > 16) {
      recommendations.push('Consider using React.memo or useMemo for expensive computations');
    }

    if (renderCount > 100) {
      recommendations.push('High render count detected - check for unnecessary re-renders');
    }

    if (memoryUsage > 200) {
      recommendations.push('High memory usage - consider implementing virtualization or lazy loading');
    }

    if (frameRate < 30) {
      recommendations.push('Low frame rate - reduce animation complexity or use native animations');
    }

    return recommendations;
  }, [metrics]);

  // Force optimization
  const forceOptimization = useCallback(async () => {
    try {
      await memoryService.optimizeMemory();
      console.log(`Forced optimization completed for ${componentName}`);
    } catch (error) {
      reportError(error as Error, `Force optimization failed for ${componentName}`);
    }
  }, [componentName, reportError]);

  return {
    metrics,
    recommendations: getOptimizationRecommendations(),
    forceOptimization,
    startRenderMeasurement,
    endRenderMeasurement,
  };
}

/**
 * Hook for tracking component re-renders
 */
export function useRenderTracker(componentName: string) {
  const renderCount = useRef(0);
  const lastRenderTime = useRef(Date.now());

  useEffect(() => {
    renderCount.current++;
    const now = Date.now();
    const timeSinceLastRender = now - lastRenderTime.current;
    lastRenderTime.current = now;

    if (process.env.NODE_ENV === 'development') {
      console.log(`${componentName} rendered ${renderCount.current} times. Time since last render: ${timeSinceLastRender}ms`);
    }
  });

  return {
    renderCount: renderCount.current,
    lastRenderTime: lastRenderTime.current,
  };
}

/**
 * Hook for lazy component loading
 */
export function useLazyComponent<T>(
  importFn: () => Promise<{ default: T }>,
  fallback?: React.ComponentType
) {
  const [Component, setComponent] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadComponent = useCallback(async () => {
    if (Component || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const module = await importFn();
      setComponent(module.default);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [Component, isLoading, importFn]);

  return {
    Component,
    isLoading,
    error,
    loadComponent,
  };
}