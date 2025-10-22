/**
 * Pagination Service
 * Handles efficient data loading with pagination and caching
 */

import { EnhancedTranscriptionItem } from '../../types';

interface PaginationOptions {
  pageSize: number;
  sortBy: 'date' | 'duration' | 'relevance' | 'alphabetical';
  sortOrder: 'asc' | 'desc';
  filters?: {
    category?: string;
    tags?: string[];
    dateRange?: {
      start: Date;
      end: Date;
    };
  };
}

interface PaginationResult {
  items: EnhancedTranscriptionItem[];
  hasMore: boolean;
  totalCount: number;
  currentPage: number;
}

class PaginationService {
  private cache = new Map<string, PaginationResult>();
  private readonly maxCacheSize = 50;

  /**
   * Get paginated transcriptions
   */
  async getPaginatedTranscriptions(
    allItems: EnhancedTranscriptionItem[],
    page: number,
    options: PaginationOptions
  ): Promise<PaginationResult> {
    const cacheKey = this.generateCacheKey(page, options);
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Filter items
    let filteredItems = this.applyFilters(allItems, options.filters);

    // Sort items
    filteredItems = this.sortItems(filteredItems, options.sortBy, options.sortOrder);

    // Calculate pagination
    const startIndex = page * options.pageSize;
    const endIndex = startIndex + options.pageSize;
    const paginatedItems = filteredItems.slice(startIndex, endIndex);
    const hasMore = endIndex < filteredItems.length;

    const result: PaginationResult = {
      items: paginatedItems,
      hasMore,
      totalCount: filteredItems.length,
      currentPage: page,
    };

    // Cache the result
    this.cacheResult(cacheKey, result);

    return result;
  }

  /**
   * Load more items (append to existing)
   */
  async loadMoreItems(
    allItems: EnhancedTranscriptionItem[],
    currentItems: EnhancedTranscriptionItem[],
    currentPage: number,
    options: PaginationOptions
  ): Promise<PaginationResult> {
    const nextPage = currentPage + 1;
    const nextPageResult = await this.getPaginatedTranscriptions(allItems, nextPage, options);

    return {
      items: [...currentItems, ...nextPageResult.items],
      hasMore: nextPageResult.hasMore,
      totalCount: nextPageResult.totalCount,
      currentPage: nextPage,
    };
  }

  /**
   * Search transcriptions with pagination
   */
  async searchTranscriptions(
    allItems: EnhancedTranscriptionItem[],
    query: string,
    page: number,
    options: PaginationOptions
  ): Promise<PaginationResult> {
    const searchResults = this.performSearch(allItems, query);
    return this.getPaginatedTranscriptions(searchResults, page, options);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clear cache for specific filters
   */
  clearCacheForFilters(options: Partial<PaginationOptions>): void {
    const keysToDelete: string[] = [];
    
    for (const [key] of this.cache) {
      if (this.cacheKeyMatchesFilters(key, options)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Apply filters to items
   */
  private applyFilters(
    items: EnhancedTranscriptionItem[],
    filters?: PaginationOptions['filters']
  ): EnhancedTranscriptionItem[] {
    if (!filters) return items;

    return items.filter(item => {
      // Category filter
      if (filters.category && item.category !== filters.category) {
        return false;
      }

      // Tags filter
      if (filters.tags && filters.tags.length > 0) {
        const hasMatchingTag = filters.tags.some(tag =>
          item.tags.some(itemTag => itemTag.toLowerCase().includes(tag.toLowerCase()))
        );
        if (!hasMatchingTag) return false;
      }

      // Date range filter
      if (filters.dateRange) {
        const itemDate = new Date(item.createdAt);
        if (itemDate < filters.dateRange.start || itemDate > filters.dateRange.end) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Sort items based on criteria
   */
  private sortItems(
    items: EnhancedTranscriptionItem[],
    sortBy: PaginationOptions['sortBy'],
    sortOrder: PaginationOptions['sortOrder']
  ): EnhancedTranscriptionItem[] {
    const sortedItems = [...items];

    sortedItems.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'date':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'duration':
          comparison = a.duration - b.duration;
          break;
        case 'alphabetical':
          comparison = a.transcription.localeCompare(b.transcription);
          break;
        case 'relevance':
          // For relevance, we could use confidence score or other metrics
          comparison = (b.confidence || 0) - (a.confidence || 0);
          break;
        default:
          comparison = 0;
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return sortedItems;
  }

  /**
   * Perform search on items
   */
  private performSearch(
    items: EnhancedTranscriptionItem[],
    query: string
  ): EnhancedTranscriptionItem[] {
    if (!query.trim()) return items;

    const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 0);

    return items.filter(item => {
      const searchableContent = [
        item.transcription,
        item.searchableText || '',
        item.category,
        ...item.tags,
      ].join(' ').toLowerCase();

      return searchTerms.every(term => searchableContent.includes(term));
    }).sort((a, b) => {
      // Sort by relevance (number of matching terms)
      const aMatches = this.countMatches(a, searchTerms);
      const bMatches = this.countMatches(b, searchTerms);
      return bMatches - aMatches;
    });
  }

  /**
   * Count search term matches in an item
   */
  private countMatches(item: EnhancedTranscriptionItem, searchTerms: string[]): number {
    const content = [
      item.transcription,
      item.searchableText || '',
      item.category,
      ...item.tags,
    ].join(' ').toLowerCase();

    return searchTerms.reduce((count, term) => {
      const matches = (content.match(new RegExp(term, 'g')) || []).length;
      return count + matches;
    }, 0);
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(page: number, options: PaginationOptions): string {
    return JSON.stringify({
      page,
      pageSize: options.pageSize,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
      filters: options.filters,
    });
  }

  /**
   * Cache result with size management
   */
  private cacheResult(key: string, result: PaginationResult): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, result);
  }

  /**
   * Check if cache key matches filters
   */
  private cacheKeyMatchesFilters(key: string, filters: Partial<PaginationOptions>): boolean {
    try {
      const parsedKey = JSON.parse(key);
      
      if (filters.sortBy && parsedKey.sortBy !== filters.sortBy) return true;
      if (filters.sortOrder && parsedKey.sortOrder !== filters.sortOrder) return true;
      if (filters.filters) return true; // Clear all filter-related cache
      
      return false;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const paginationService = new PaginationService();
export default paginationService;