/**
 * Cache Service
 * Provides efficient caching with LRU eviction and memory management
 */

import { EnhancedTranscriptionItem } from '../../types';
import { getCurrentMemoryUsage, isMemoryUsageHigh } from '../../utils/performance/memoryUtils';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  size: number; // Estimated size in bytes
}

interface CacheOptions {
  maxSize: number; // Maximum number of entries
  maxMemory: number; // Maximum memory usage in MB
  ttl: number; // Time to live in milliseconds
}

class CacheService {
  private transcriptionCache = new Map<string, CacheEntry<EnhancedTranscriptionItem>>();
  private audioCache = new Map<string, CacheEntry<Float32Array>>();
  private searchCache = new Map<string, CacheEntry<EnhancedTranscriptionItem[]>>();
  
  private readonly defaultOptions: CacheOptions = {
    maxSize: 100,
    maxMemory: 50, // 50MB
    ttl: 30 * 60 * 1000, // 30 minutes
  };

  /**
   * Cache a transcription item
   */
  cacheTranscription(key: string, item: EnhancedTranscriptionItem): void {
    const size = this.estimateTranscriptionSize(item);
    const entry: CacheEntry<EnhancedTranscriptionItem> = {
      data: item,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      size,
    };

    this.transcriptionCache.set(key, entry);
    this.enforceMemoryLimits();
  }

  /**
   * Get cached transcription
   */
  getCachedTranscription(key: string): EnhancedTranscriptionItem | null {
    const entry = this.transcriptionCache.get(key);
    
    if (!entry) return null;
    
    // Check if expired
    if (this.isExpired(entry)) {
      this.transcriptionCache.delete(key);
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    
    return entry.data;
  }

  /**
   * Cache audio data
   */
  cacheAudioData(key: string, audioData: Float32Array): void {
    const size = audioData.byteLength;
    const entry: CacheEntry<Float32Array> = {
      data: audioData,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      size,
    };

    this.audioCache.set(key, entry);
    this.enforceMemoryLimits();
  }

  /**
   * Get cached audio data
   */
  getCachedAudioData(key: string): Float32Array | null {
    const entry = this.audioCache.get(key);
    
    if (!entry) return null;
    
    if (this.isExpired(entry)) {
      this.audioCache.delete(key);
      return null;
    }

    entry.accessCount++;
    entry.lastAccessed = Date.now();
    
    return entry.data;
  }

  /**
   * Cache search results
   */
  cacheSearchResults(query: string, results: EnhancedTranscriptionItem[]): void {
    const size = this.estimateSearchResultsSize(results);
    const entry: CacheEntry<EnhancedTranscriptionItem[]> = {
      data: results,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      size,
    };

    this.searchCache.set(query, entry);
    this.enforceMemoryLimits();
  }

  /**
   * Get cached search results
   */
  getCachedSearchResults(query: string): EnhancedTranscriptionItem[] | null {
    const entry = this.searchCache.get(query);
    
    if (!entry) return null;
    
    if (this.isExpired(entry)) {
      this.searchCache.delete(query);
      return null;
    }

    entry.accessCount++;
    entry.lastAccessed = Date.now();
    
    return entry.data;
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.transcriptionCache.clear();
    this.audioCache.clear();
    this.searchCache.clear();
  }

  /**
   * Clear specific cache type
   */
  clearCache(type: 'transcription' | 'audio' | 'search'): void {
    switch (type) {
      case 'transcription':
        this.transcriptionCache.clear();
        break;
      case 'audio':
        this.audioCache.clear();
        break;
      case 'search':
        this.searchCache.clear();
        break;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const transcriptionStats = this.getCacheTypeStats(this.transcriptionCache);
    const audioStats = this.getCacheTypeStats(this.audioCache);
    const searchStats = this.getCacheTypeStats(this.searchCache);

    return {
      transcription: transcriptionStats,
      audio: audioStats,
      search: searchStats,
      total: {
        entries: transcriptionStats.entries + audioStats.entries + searchStats.entries,
        memoryUsage: transcriptionStats.memoryUsage + audioStats.memoryUsage + searchStats.memoryUsage,
        hitRate: (transcriptionStats.hitRate + audioStats.hitRate + searchStats.hitRate) / 3,
      },
    };
  }

  /**
   * Optimize cache based on memory pressure
   */
  optimizeCache(): void {
    const memoryUsage = getCurrentMemoryUsage();
    
    if (isMemoryUsageHigh(memoryUsage)) {
      // Aggressive cleanup
      this.evictLeastRecentlyUsed(0.5); // Remove 50% of entries
      this.clearExpiredEntries();
    } else {
      // Normal cleanup
      this.evictLeastRecentlyUsed(0.1); // Remove 10% of entries
      this.clearExpiredEntries();
    }
  }

  /**
   * Preload frequently accessed items
   */
  async preloadFrequentItems(items: EnhancedTranscriptionItem[]): Promise<void> {
    // Sort by access frequency (if we had this data)
    const frequentItems = items.slice(0, 20); // Top 20 items
    
    for (const item of frequentItems) {
      if (!this.getCachedTranscription(item.id)) {
        this.cacheTranscription(item.id, item);
      }
    }
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp > this.defaultOptions.ttl;
  }

  /**
   * Enforce memory limits using LRU eviction
   */
  private enforceMemoryLimits(): void {
    const totalMemory = this.getTotalMemoryUsage();
    
    if (totalMemory > this.defaultOptions.maxMemory) {
      this.evictLeastRecentlyUsed(0.2); // Remove 20% of entries
    }

    // Also check individual cache sizes
    this.enforceCacheSize(this.transcriptionCache, this.defaultOptions.maxSize);
    this.enforceCacheSize(this.audioCache, this.defaultOptions.maxSize);
    this.enforceCacheSize(this.searchCache, this.defaultOptions.maxSize);
  }

  /**
   * Enforce cache size limit
   */
  private enforceCacheSize<T>(cache: Map<string, CacheEntry<T>>, maxSize: number): void {
    if (cache.size <= maxSize) return;

    // Convert to array and sort by last accessed time
    const entries = Array.from(cache.entries()).sort(
      ([, a], [, b]) => a.lastAccessed - b.lastAccessed
    );

    // Remove oldest entries
    const toRemove = cache.size - maxSize;
    for (let i = 0; i < toRemove; i++) {
      cache.delete(entries[i][0]);
    }
  }

  /**
   * Evict least recently used entries
   */
  private evictLeastRecentlyUsed(percentage: number): void {
    this.evictFromCache(this.transcriptionCache, percentage);
    this.evictFromCache(this.audioCache, percentage);
    this.evictFromCache(this.searchCache, percentage);
  }

  /**
   * Evict entries from specific cache
   */
  private evictFromCache<T>(cache: Map<string, CacheEntry<T>>, percentage: number): void {
    const toRemove = Math.floor(cache.size * percentage);
    if (toRemove === 0) return;

    const entries = Array.from(cache.entries()).sort(
      ([, a], [, b]) => a.lastAccessed - b.lastAccessed
    );

    for (let i = 0; i < toRemove; i++) {
      cache.delete(entries[i][0]);
    }
  }

  /**
   * Clear expired entries
   */
  private clearExpiredEntries(): void {
    this.clearExpiredFromCache(this.transcriptionCache);
    this.clearExpiredFromCache(this.audioCache);
    this.clearExpiredFromCache(this.searchCache);
  }

  /**
   * Clear expired entries from specific cache
   */
  private clearExpiredFromCache<T>(cache: Map<string, CacheEntry<T>>): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of cache) {
      if (now - entry.timestamp > this.defaultOptions.ttl) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => cache.delete(key));
  }

  /**
   * Get total memory usage across all caches
   */
  private getTotalMemoryUsage(): number {
    let total = 0;
    
    for (const entry of this.transcriptionCache.values()) {
      total += entry.size;
    }
    
    for (const entry of this.audioCache.values()) {
      total += entry.size;
    }
    
    for (const entry of this.searchCache.values()) {
      total += entry.size;
    }
    
    return total / (1024 * 1024); // Convert to MB
  }

  /**
   * Get statistics for a specific cache type
   */
  private getCacheTypeStats<T>(cache: Map<string, CacheEntry<T>>) {
    let totalSize = 0;
    let totalAccess = 0;
    
    for (const entry of cache.values()) {
      totalSize += entry.size;
      totalAccess += entry.accessCount;
    }

    return {
      entries: cache.size,
      memoryUsage: totalSize / (1024 * 1024), // MB
      hitRate: cache.size > 0 ? totalAccess / cache.size : 0,
    };
  }

  /**
   * Estimate transcription item size
   */
  private estimateTranscriptionSize(item: EnhancedTranscriptionItem): number {
    // Rough estimation in bytes
    const textSize = item.transcription.length * 2; // UTF-16
    const metadataSize = 1024; // Rough estimate for other fields
    const tagsSize = item.tags.join('').length * 2;
    
    return textSize + metadataSize + tagsSize;
  }

  /**
   * Estimate search results size
   */
  private estimateSearchResultsSize(results: EnhancedTranscriptionItem[]): number {
    return results.reduce((total, item) => total + this.estimateTranscriptionSize(item), 0);
  }
}

// Export singleton instance
export const cacheService = new CacheService();
export default cacheService;