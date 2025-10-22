/**
 * Search Service
 * Advanced search functionality with indexing, filtering, and relevance scoring
 */

import { EnhancedTranscriptionItem, FilterOptions, SearchServiceInterface } from '../../types';
import { cacheService } from './cacheService';

interface SearchIndex {
  [word: string]: {
    items: Set<string>; // Item IDs containing this word
    frequency: number;
  };
}

interface SearchResult {
  item: EnhancedTranscriptionItem;
  relevanceScore: number;
  matchedTerms: string[];
  highlights: { start: number; end: number; term: string }[];
}

class SearchService implements SearchServiceInterface {
  private searchIndex: SearchIndex = {};
  private isIndexBuilt = false;
  private stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their'
  ]);

  /**
   * Index a transcription for search
   */
  async indexTranscription(transcription: EnhancedTranscriptionItem): Promise<void> {
    const words = this.extractWords(transcription);
    
    for (const word of words) {
      if (this.stopWords.has(word.toLowerCase())) continue;
      
      const normalizedWord = word.toLowerCase();
      
      if (!this.searchIndex[normalizedWord]) {
        this.searchIndex[normalizedWord] = {
          items: new Set(),
          frequency: 0,
        };
      }
      
      this.searchIndex[normalizedWord].items.add(transcription.id);
      this.searchIndex[normalizedWord].frequency++;
    }
  }

  /**
   * Search transcriptions with advanced filtering and ranking
   */
  async search(
    query: string,
    allItems: EnhancedTranscriptionItem[],
    filters?: FilterOptions
  ): Promise<EnhancedTranscriptionItem[]> {
    if (!query.trim()) {
      return this.applyFilters(allItems, filters);
    }

    // Check cache first
    const cacheKey = this.generateCacheKey(query, filters);
    const cachedResults = cacheService.getCachedSearchResults(cacheKey);
    if (cachedResults) {
      return cachedResults;
    }

    // Ensure index is built
    if (!this.isIndexBuilt) {
      await this.buildIndex(allItems);
    }

    // Parse search query
    const searchTerms = this.parseSearchQuery(query);
    
    // Find matching items
    const searchResults = this.findMatchingItems(searchTerms, allItems);
    
    // Apply filters
    const filteredResults = this.applyFilters(searchResults.map(r => r.item), filters);
    
    // Re-score filtered results
    const finalResults = searchResults
      .filter(result => filteredResults.some(item => item.id === result.item.id))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .map(result => result.item);

    // Cache results
    cacheService.cacheSearchResults(cacheKey, finalResults);

    return finalResults;
  }

  /**
   * Get search suggestions based on partial query
   */
  async getSearchSuggestions(partialQuery: string, limit: number = 10): Promise<string[]> {
    const normalizedQuery = partialQuery.toLowerCase().trim();
    if (normalizedQuery.length < 2) return [];

    const suggestions = new Set<string>();
    
    // Find words that start with the query
    for (const word in this.searchIndex) {
      if (word.startsWith(normalizedQuery) && suggestions.size < limit) {
        suggestions.add(word);
      }
    }

    // Find words that contain the query
    if (suggestions.size < limit) {
      for (const word in this.searchIndex) {
        if (word.includes(normalizedQuery) && !word.startsWith(normalizedQuery) && suggestions.size < limit) {
          suggestions.add(word);
        }
      }
    }

    return Array.from(suggestions).slice(0, limit);
  }

  /**
   * Update search index for modified transcription
   */
  async updateIndex(): Promise<void> {
    // This would typically be called when transcriptions are modified
    // For now, we'll just mark the index as needing rebuild
    this.isIndexBuilt = false;
  }

  /**
   * Clear search index
   */
  async clearIndex(): Promise<void> {
    this.searchIndex = {};
    this.isIndexBuilt = false;
  }

  /**
   * Get search statistics
   */
  getSearchStats() {
    const totalWords = Object.keys(this.searchIndex).length;
    const totalFrequency = Object.values(this.searchIndex).reduce(
      (sum, entry) => sum + entry.frequency,
      0
    );

    return {
      totalWords,
      totalFrequency,
      averageFrequency: totalWords > 0 ? totalFrequency / totalWords : 0,
      isIndexBuilt: this.isIndexBuilt,
    };
  }

  /**
   * Build search index from all transcriptions
   */
  private async buildIndex(items: EnhancedTranscriptionItem[]): Promise<void> {
    this.searchIndex = {};
    
    for (const item of items) {
      await this.indexTranscription(item);
    }
    
    this.isIndexBuilt = true;
  }

  /**
   * Extract searchable words from transcription
   */
  private extractWords(transcription: EnhancedTranscriptionItem): string[] {
    const allText = [
      transcription.transcription,
      transcription.searchableText || '',
      transcription.category,
      ...transcription.tags,
    ].join(' ');

    return allText
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(word => word.length > 1); // Filter out single characters
  }

  /**
   * Parse search query into terms and operators
   */
  private parseSearchQuery(query: string): {
    required: string[];
    optional: string[];
    excluded: string[];
    phrases: string[];
  } {
    const terms = {
      required: [] as string[],
      optional: [] as string[],
      excluded: [] as string[],
      phrases: [] as string[],
    };

    // Extract phrases (quoted text)
    const phraseRegex = /"([^"]+)"/g;
    let match;
    while ((match = phraseRegex.exec(query)) !== null) {
      terms.phrases.push(match[1].toLowerCase());
      query = query.replace(match[0], '');
    }

    // Split remaining query into words
    const words = query.split(/\s+/).filter(word => word.trim());

    for (const word of words) {
      const cleanWord = word.toLowerCase().trim();
      if (!cleanWord) continue;

      if (cleanWord.startsWith('+')) {
        // Required term
        terms.required.push(cleanWord.substring(1));
      } else if (cleanWord.startsWith('-')) {
        // Excluded term
        terms.excluded.push(cleanWord.substring(1));
      } else {
        // Optional term
        terms.optional.push(cleanWord);
      }
    }

    return terms;
  }

  /**
   * Find items matching search terms
   */
  private findMatchingItems(
    searchTerms: ReturnType<typeof this.parseSearchQuery>,
    allItems: EnhancedTranscriptionItem[]
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const item of allItems) {
      const matchResult = this.calculateRelevanceScore(item, searchTerms);
      
      if (matchResult.relevanceScore > 0) {
        results.push({
          item,
          relevanceScore: matchResult.relevanceScore,
          matchedTerms: matchResult.matchedTerms,
          highlights: matchResult.highlights,
        });
      }
    }

    return results;
  }

  /**
   * Calculate relevance score for an item
   */
  private calculateRelevanceScore(
    item: EnhancedTranscriptionItem,
    searchTerms: ReturnType<typeof this.parseSearchQuery>
  ): {
    relevanceScore: number;
    matchedTerms: string[];
    highlights: { start: number; end: number; term: string }[];
  } {
    const itemText = this.extractWords(item).join(' ');
    let score = 0;
    const matchedTerms: string[] = [];
    const highlights: { start: number; end: number; term: string }[] = [];

    // Check required terms (must all be present)
    for (const term of searchTerms.required) {
      if (!itemText.includes(term)) {
        return { relevanceScore: 0, matchedTerms: [], highlights: [] };
      }
      matchedTerms.push(term);
      score += 10; // High score for required terms
    }

    // Check excluded terms (must not be present)
    for (const term of searchTerms.excluded) {
      if (itemText.includes(term)) {
        return { relevanceScore: 0, matchedTerms: [], highlights: [] };
      }
    }

    // Check phrases (exact matches)
    for (const phrase of searchTerms.phrases) {
      if (itemText.includes(phrase)) {
        matchedTerms.push(phrase);
        score += 15; // Higher score for phrase matches
        
        // Find phrase positions for highlighting
        let index = itemText.indexOf(phrase);
        while (index !== -1) {
          highlights.push({
            start: index,
            end: index + phrase.length,
            term: phrase,
          });
          index = itemText.indexOf(phrase, index + 1);
        }
      }
    }

    // Check optional terms
    for (const term of searchTerms.optional) {
      const termCount = (itemText.match(new RegExp(term, 'g')) || []).length;
      if (termCount > 0) {
        matchedTerms.push(term);
        score += termCount * 5; // Score based on frequency
        
        // Find term positions for highlighting
        let index = itemText.indexOf(term);
        while (index !== -1) {
          highlights.push({
            start: index,
            end: index + term.length,
            term,
          });
          index = itemText.indexOf(term, index + 1);
        }
      }
    }

    // Boost score based on item properties
    if (item.confidence && item.confidence > 0.8) {
      score *= 1.2; // Boost high-confidence transcriptions
    }

    // Boost recent items
    const daysSinceCreation = (Date.now() - item.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation < 7) {
      score *= 1.1; // Boost items from last week
    }

    return {
      relevanceScore: score,
      matchedTerms,
      highlights,
    };
  }

  /**
   * Apply filters to search results
   */
  private applyFilters(
    items: EnhancedTranscriptionItem[],
    filters?: FilterOptions
  ): EnhancedTranscriptionItem[] {
    if (!filters) return items;

    return items.filter(item => {
      // Date range filter
      if (filters.dateRange) {
        const itemDate = new Date(item.createdAt);
        if (itemDate < filters.dateRange.start || itemDate > filters.dateRange.end) {
          return false;
        }
      }

      // Duration range filter
      if (filters.durationRange) {
        if (item.duration < filters.durationRange.min || item.duration > filters.durationRange.max) {
          return false;
        }
      }

      // Categories filter
      if (filters.categories && filters.categories.length > 0) {
        if (!filters.categories.includes(item.category)) {
          return false;
        }
      }

      // Tags filter
      if (filters.tags && filters.tags.length > 0) {
        const hasMatchingTag = filters.tags.some(filterTag =>
          item.tags.some(itemTag => 
            itemTag.toLowerCase().includes(filterTag.toLowerCase())
          )
        );
        if (!hasMatchingTag) return false;
      }

      // Confidence threshold filter
      if (filters.confidenceThreshold !== undefined) {
        if (!item.confidence || item.confidence < filters.confidenceThreshold) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Generate cache key for search results
   */
  private generateCacheKey(query: string, filters?: FilterOptions): string {
    return JSON.stringify({ query, filters });
  }
}

// Export singleton instance
export const searchService = new SearchService();
export default searchService;