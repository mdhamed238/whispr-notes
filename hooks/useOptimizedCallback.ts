/**
 * Performance-optimized React hooks
 * Provides memoization and optimization utilities for React components
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { debounce, memoize, throttle } from '../utils/performance/performanceUtils';

/**
 * Enhanced useCallback with automatic dependency optimization
 */
export function useOptimizedCallback<T extends (...args: any[]) => any>(
  callback: T,
  deps: React.DependencyList,
  options?: {
    debounce?: number;
    throttle?: number;
  }
): T {
  const memoizedCallback = useCallback(callback, deps);

  return useMemo(() => {
    let optimizedCallback = memoizedCallback;

    if (options?.debounce) {
      optimizedCallback = debounce(optimizedCallback, options.debounce) as T;
    } else if (options?.throttle) {
      optimizedCallback = throttle(optimizedCallback, options.throttle) as T;
    }

    return optimizedCallback;
  }, [memoizedCallback, options?.debounce, options?.throttle]);
}

/**
 * Memoized computation hook with cache size limit
 */
export function useOptimizedMemo<T>(
  factory: () => T,
  deps: React.DependencyList,
  cacheSize: number = 10
): T {
  const cache = useRef(new Map<string, T>());
  
  return useMemo(() => {
    const key = JSON.stringify(deps);
    
    if (cache.current.has(key)) {
      return cache.current.get(key)!;
    }

    const result = factory();
    
    // Manage cache size
    if (cache.current.size >= cacheSize) {
      const firstKey = cache.current.keys().next().value;
      cache.current.delete(firstKey);
    }
    
    cache.current.set(key, result);
    return result;
  }, deps);
}

/**
 * Debounced value hook
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Throttled value hook
 */
export function useThrottledValue<T>(value: T, limit: number): T {
  const [throttledValue, setThrottledValue] = React.useState(value);
  const lastRan = useRef(Date.now());

  useEffect(() => {
    const handler = setTimeout(() => {
      if (Date.now() - lastRan.current >= limit) {
        setThrottledValue(value);
        lastRan.current = Date.now();
      }
    }, limit - (Date.now() - lastRan.current));

    return () => {
      clearTimeout(handler);
    };
  }, [value, limit]);

  return throttledValue;
}

/**
 * Memoized function hook with automatic cache management
 */
export function useMemoizedFunction<T extends (...args: any[]) => any>(
  fn: T,
  maxCacheSize: number = 50
): T {
  const memoizedFn = useRef<T>();

  if (!memoizedFn.current) {
    memoizedFn.current = memoize(fn, maxCacheSize);
  }

  return memoizedFn.current;
}

/**
 * Previous value hook for comparison
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  
  useEffect(() => {
    ref.current = value;
  });
  
  return ref.current;
}

/**
 * Stable reference hook - prevents unnecessary re-renders
 */
export function useStableReference<T>(value: T): T {
  const ref = useRef(value);
  
  // Only update if the value has actually changed (deep comparison for objects)
  if (JSON.stringify(ref.current) !== JSON.stringify(value)) {
    ref.current = value;
  }
  
  return ref.current;
}

/**
 * Intersection observer hook for lazy loading
 */
export function useIntersectionObserver(
  elementRef: React.RefObject<Element>,
  options?: IntersectionObserverInit
) {
  const [isIntersecting, setIsIntersecting] = React.useState(false);
  const [hasIntersected, setHasIntersected] = React.useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isElementIntersecting = entry.isIntersecting;
        setIsIntersecting(isElementIntersecting);
        
        if (isElementIntersecting && !hasIntersected) {
          setHasIntersected(true);
        }
      },
      options
    );

    observer.observe(element);

    return () => {
      observer.unobserve(element);
    };
  }, [elementRef, options, hasIntersected]);

  return { isIntersecting, hasIntersected };
}