/**
 * Performance Context Provider
 * Monitors app performance metrics and provides optimization utilities
 */

import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { PerformanceContextType, PerformanceMetrics } from '../types';

// Initial performance metrics
const initialMetrics: PerformanceMetrics = {
  appStartTime: Date.now(),
  modelLoadTime: 0,
  transcriptionSpeed: 0,
  memoryUsage: {
    current: 0,
    peak: 0,
    average: 0,
    threshold: 500, // 500MB threshold
  },
  batteryImpact: {
    estimatedImpact: 0,
    optimizationLevel: 'medium',
  },
  errorRate: 0,
};

// Create context
const PerformanceContext = createContext<PerformanceContextType | null>(null);

// Active measurements storage
interface ActiveMeasurement {
  id: string;
  operation: string;
  startTime: number;
}

// Provider component
interface PerformanceProviderProps {
  children: ReactNode;
}

export function PerformanceProvider({ children }: PerformanceProviderProps) {
  const [metrics, setMetrics] = useState<PerformanceMetrics>(initialMetrics);
  const [activeMeasurements, setActiveMeasurements] = useState<Map<string, ActiveMeasurement>>(new Map());
  const [errorCount, setErrorCount] = useState(0);
  const [totalOperations, setTotalOperations] = useState(0);

  // Start a performance measurement
  const startMeasurement = (operation: string): string => {
    const measurementId = `${operation}_${Date.now()}_${Math.random()}`;
    const measurement: ActiveMeasurement = {
      id: measurementId,
      operation,
      startTime: performance.now(),
    };

    setActiveMeasurements(prev => new Map(prev).set(measurementId, measurement));
    return measurementId;
  };

  // End a performance measurement and return duration
  const endMeasurement = (measurementId: string): number => {
    const measurement = activeMeasurements.get(measurementId);
    if (!measurement) {
      console.warn(`Measurement ${measurementId} not found`);
      return 0;
    }

    const endTime = performance.now();
    const duration = endTime - measurement.startTime;

    // Remove from active measurements
    setActiveMeasurements(prev => {
      const newMap = new Map(prev);
      newMap.delete(measurementId);
      return newMap;
    });

    // Update metrics based on operation type
    updateMetricsForOperation(measurement.operation, duration);

    setTotalOperations(prev => prev + 1);
    return duration;
  };

  // Update metrics based on operation type
  const updateMetricsForOperation = (operation: string, duration: number) => {
    setMetrics(prev => {
      const updated = { ...prev };

      switch (operation) {
        case 'model_load':
          updated.modelLoadTime = duration;
          break;
        case 'transcription':
          // Calculate words per second (assuming average 5 characters per word)
          const estimatedWords = 100; // This would be calculated from actual transcription
          updated.transcriptionSpeed = estimatedWords / (duration / 1000);
          break;
        default:
          // Generic operation tracking
          break;
      }

      return updated;
    });
  };

  // Report an error
  const reportError = (error: Error, context?: string) => {
    console.error('Performance Context - Error reported:', error, context);
    
    setErrorCount(prev => prev + 1);
    
    // Update error rate
    setMetrics(prev => ({
      ...prev,
      errorRate: totalOperations > 0 ? errorCount / totalOperations : 0,
    }));

    // In a real app, you might send this to an analytics service
    // Analytics.reportError(error, context);
  };

  // Memory monitoring effect
  useEffect(() => {
    const monitorMemory = () => {
      // In React Native, we'd use native modules to get actual memory usage
      // For now, we'll simulate memory monitoring
      if (typeof performance !== 'undefined' && 'memory' in performance) {
        const memory = (performance as any).memory;
        const currentMemory = memory.usedJSHeapSize / (1024 * 1024); // Convert to MB
        const peakMemory = memory.totalJSHeapSize / (1024 * 1024);

        setMetrics(prev => ({
          ...prev,
          memoryUsage: {
            ...prev.memoryUsage,
            current: currentMemory,
            peak: Math.max(prev.memoryUsage.peak, peakMemory),
            average: (prev.memoryUsage.average + currentMemory) / 2,
          },
        }));
      }
    };

    // Monitor memory every 5 seconds
    const memoryInterval = setInterval(monitorMemory, 5000);

    // Initial memory check
    monitorMemory();

    return () => {
      clearInterval(memoryInterval);
    };
  }, []);

  // Battery impact monitoring effect
  useEffect(() => {
    const monitorBattery = () => {
      // In a real app, you'd use native modules to get battery info
      // For now, we'll estimate based on active operations
      const activeOperationsCount = activeMeasurements.size;
      let estimatedImpact = 0;

      if (activeOperationsCount > 0) {
        estimatedImpact = Math.min(activeOperationsCount * 2, 10); // Max 10% per hour
      }

      setMetrics(prev => ({
        ...prev,
        batteryImpact: {
          ...prev.batteryImpact,
          estimatedImpact,
        },
      }));
    };

    const batteryInterval = setInterval(monitorBattery, 10000); // Every 10 seconds

    return () => {
      clearInterval(batteryInterval);
    };
  }, [activeMeasurements.size]);

  const contextValue: PerformanceContextType = {
    metrics,
    startMeasurement,
    endMeasurement,
    reportError,
  };

  return (
    <PerformanceContext.Provider value={contextValue}>
      {children}
    </PerformanceContext.Provider>
  );
}

// Custom hook to use the performance context
export function usePerformance() {
  const context = useContext(PerformanceContext);
  if (!context) {
    throw new Error('usePerformance must be used within a PerformanceProvider');
  }
  return context;
}

export default PerformanceContext;