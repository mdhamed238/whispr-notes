/**
 * Search and Filter Component
 * Advanced search interface with filters, suggestions, and sorting options
 */

import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    FlatList,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSettings } from '../../contexts/SettingsContext';
import { useDebouncedValue, useOptimizedCallback } from '../../hooks/useOptimizedCallback';
import { searchService } from '../../services/enhanced/searchService';
import { FilterOptions, SearchFilterProps, SortOption, TranscriptionCategory } from '../../types';

const CATEGORIES: TranscriptionCategory[] = ['meeting', 'lecture', 'interview', 'memo', 'other'];
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'duration', label: 'Duration' },
  { value: 'relevance', label: 'Relevance' },
  { value: 'alphabetical', label: 'Alphabetical' },
];

export default function SearchAndFilter({
  onSearch,
  onFilter,
  onSort,
  totalResults,
  isLoading,
}: SearchFilterProps) {
  const { settings } = useSettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSort, setSelectedSort] = useState<SortOption>('date');
  
  // Filter states
  const [filters, setFilters] = useState<FilterOptions>({});
  const [showDatePicker, setShowDatePicker] = useState<'start' | 'end' | null>(null);
  
  const searchInputRef = useRef<TextInput>(null);
  const debouncedQuery = useDebouncedValue(searchQuery, 300);

  // Get theme colors
  const getThemeColors = () => {
    const isDark = settings.theme === 'dark';
    return {
      background: isDark ? '#000000' : '#ffffff',
      surface: isDark ? '#1e1e1e' : '#f8f9fa',
      surfaceVariant: isDark ? '#2d2d2d' : '#e3f2fd',
      text: isDark ? '#ffffff' : '#333333',
      textSecondary: isDark ? '#b0b0b0' : '#666666',
      border: isDark ? '#404040' : '#e0e0e0',
      accent: '#2196F3',
      success: '#4CAF50',
      warning: '#FF9800',
    };
  };

  const colors = getThemeColors();

  // Handle search query changes
  useEffect(() => {
    onSearch(debouncedQuery);
    
    // Get suggestions for non-empty queries
    if (debouncedQuery.trim().length >= 2) {
      getSuggestions(debouncedQuery);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [debouncedQuery, onSearch]);

  // Get search suggestions
  const getSuggestions = useOptimizedCallback(async (query: string) => {
    try {
      const suggestions = await searchService.getSearchSuggestions(query, 5);
      setSuggestions(suggestions);
      setShowSuggestions(suggestions.length > 0);
    } catch (error) {
      console.error('Failed to get suggestions:', error);
    }
  }, [], { debounce: 200 });

  // Handle search input change
  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
  }, []);

  // Handle suggestion selection
  const handleSuggestionSelect = useCallback((suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);
    searchInputRef.current?.blur();
  }, []);

  // Handle sort change
  const handleSortChange = useCallback((sortOption: SortOption) => {
    setSelectedSort(sortOption);
    onSort(sortOption);
  }, [onSort]);

  // Handle filter changes
  const updateFilters = useCallback((newFilters: Partial<FilterOptions>) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);
    onFilter(updatedFilters);
  }, [filters, onFilter]);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setFilters({});
    onFilter({});
  }, [onFilter]);

  // Check if any filters are active
  const hasActiveFilters = Object.keys(filters).some(key => {
    const value = filters[key as keyof FilterOptions];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object' && value !== null) return true;
    return value !== undefined && value !== null;
  });

  // Render search suggestions
  const renderSuggestions = () => {
    if (!showSuggestions || suggestions.length === 0) return null;

    return (
      <View style={[styles.suggestionsContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <FlatList
          data={suggestions}
          keyExtractor={(item, index) => `${item}-${index}`}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.suggestionItem}
              onPress={() => handleSuggestionSelect(item)}
            >
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <Text style={[styles.suggestionText, { color: colors.text }]}>{item}</Text>
            </TouchableOpacity>
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>
    );
  };

  // Render filter modal
  const renderFilterModal = () => (
    <Modal
      visible={showFilters}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowFilters(false)}
    >
      <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        {/* Modal Header */}
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setShowFilters(false)}>
            <Text style={[styles.modalHeaderButton, { color: colors.accent }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Filters</Text>
          <TouchableOpacity onPress={clearFilters}>
            <Text style={[styles.modalHeaderButton, { color: colors.accent }]}>Clear All</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          {/* Categories Filter */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Categories</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map(category => (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: filters.categories?.includes(category) 
                        ? colors.accent 
                        : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => {
                    const currentCategories = filters.categories || [];
                    const newCategories = currentCategories.includes(category)
                      ? currentCategories.filter(c => c !== category)
                      : [...currentCategories, category];
                    updateFilters({ categories: newCategories });
                  }}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      {
                        color: filters.categories?.includes(category) 
                          ? '#ffffff' 
                          : colors.text,
                      },
                    ]}
                  >
                    {category}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Date Range Filter */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Date Range</Text>
            <View style={styles.dateRangeContainer}>
              <TouchableOpacity
                style={[styles.dateButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => setShowDatePicker('start')}
              >
                <Text style={[styles.dateButtonText, { color: colors.text }]}>
                  From: {filters.dateRange?.start?.toLocaleDateString() || 'Any'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dateButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => setShowDatePicker('end')}
              >
                <Text style={[styles.dateButtonText, { color: colors.text }]}>
                  To: {filters.dateRange?.end?.toLocaleDateString() || 'Any'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Duration Range Filter */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Duration</Text>
            <View style={styles.durationContainer}>
              <TextInput
                style={[styles.durationInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                placeholder="Min (seconds)"
                placeholderTextColor={colors.textSecondary}
                value={filters.durationRange?.min?.toString() || ''}
                onChangeText={(text) => {
                  const min = parseInt(text) || undefined;
                  updateFilters({
                    durationRange: { ...filters.durationRange, min } as any
                  });
                }}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.durationInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                placeholder="Max (seconds)"
                placeholderTextColor={colors.textSecondary}
                value={filters.durationRange?.max?.toString() || ''}
                onChangeText={(text) => {
                  const max = parseInt(text) || undefined;
                  updateFilters({
                    durationRange: { ...filters.durationRange, max } as any
                  });
                }}
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Confidence Threshold */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterSectionTitle, { color: colors.text }]}>
              Minimum Confidence: {filters.confidenceThreshold ? Math.round(filters.confidenceThreshold * 100) : 0}%
            </Text>
            <View style={styles.confidenceSliderContainer}>
              {/* Simple confidence buttons since we don't have a slider component */}
              <View style={styles.confidenceButtons}>
                {[0, 0.5, 0.7, 0.8, 0.9].map(threshold => (
                  <TouchableOpacity
                    key={threshold}
                    style={[
                      styles.confidenceButton,
                      {
                        backgroundColor: filters.confidenceThreshold === threshold 
                          ? colors.accent 
                          : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => updateFilters({ confidenceThreshold: threshold })}
                  >
                    <Text
                      style={[
                        styles.confidenceButtonText,
                        {
                          color: filters.confidenceThreshold === threshold 
                            ? '#ffffff' 
                            : colors.text,
                        },
                      ]}
                    >
                      {Math.round(threshold * 100)}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Date Picker */}
        {showDatePicker && (
          <DateTimePicker
            value={
              showDatePicker === 'start' 
                ? filters.dateRange?.start || new Date()
                : filters.dateRange?.end || new Date()
            }
            mode="date"
            display="default"
            onChange={(event, selectedDate) => {
              setShowDatePicker(null);
              if (selectedDate) {
                const currentRange = filters.dateRange || {};
                updateFilters({
                  dateRange: {
                    ...currentRange,
                    [showDatePicker]: selectedDate,
                  } as any,
                });
              }
            }}
          />
        )}
      </View>
    </Modal>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="search" size={20} color={colors.textSecondary} />
        <TextInput
          ref={searchInputRef}
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search transcriptions..."
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={handleSearchChange}
          onFocus={() => setShowSuggestions(suggestions.length > 0)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Search Suggestions */}
      {renderSuggestions()}

      {/* Filter and Sort Controls */}
      <View style={styles.controlsContainer}>
        <View style={styles.controlsLeft}>
          <TouchableOpacity
            style={[
              styles.filterButton,
              {
                backgroundColor: hasActiveFilters ? colors.accent : colors.surface,
                borderColor: colors.border,
              },
            ]}
            onPress={() => setShowFilters(true)}
          >
            <Ionicons
              name="filter"
              size={16}
              color={hasActiveFilters ? '#ffffff' : colors.text}
            />
            <Text
              style={[
                styles.filterButtonText,
                { color: hasActiveFilters ? '#ffffff' : colors.text },
              ]}
            >
              Filter
            </Text>
            {hasActiveFilters && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>•</Text>
              </View>
            )}
          </TouchableOpacity>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.sortContainer}
          >
            {SORT_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.sortButton,
                  {
                    backgroundColor: selectedSort === option.value ? colors.accent : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => handleSortChange(option.value)}
              >
                <Text
                  style={[
                    styles.sortButtonText,
                    {
                      color: selectedSort === option.value ? '#ffffff' : colors.text,
                    },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.controlsRight}>
          <Text style={[styles.resultsCount, { color: colors.textSecondary }]}>
            {isLoading ? 'Searching...' : `${totalResults} results`}
          </Text>
        </View>
      </View>

      {/* Filter Modal */}
      {renderFilterModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    maxHeight: 200,
    borderRadius: 8,
    borderWidth: 1,
    zIndex: 1000,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  suggestionText: {
    fontSize: 14,
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  controlsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  controlsRight: {
    marginLeft: 12,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  filterBadge: {
    marginLeft: 4,
  },
  filterBadgeText: {
    color: '#ffffff',
    fontSize: 12,
  },
  sortContainer: {
    flex: 1,
  },
  sortButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    marginRight: 8,
  },
  sortButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  resultsCount: {
    fontSize: 12,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalHeaderButton: {
    fontSize: 16,
    fontWeight: '500',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  filterSection: {
    marginVertical: 16,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  dateRangeContainer: {
    gap: 8,
  },
  dateButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  dateButtonText: {
    fontSize: 14,
  },
  durationContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  durationInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    fontSize: 14,
  },
  confidenceSliderContainer: {
    marginTop: 8,
  },
  confidenceButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  confidenceButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  confidenceButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
});