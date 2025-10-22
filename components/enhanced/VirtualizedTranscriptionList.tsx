/**
 * Virtualized Transcription List Component
 * Efficiently handles large datasets with lazy loading and infinite scrolling
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItem,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePerformance } from '../../contexts/PerformanceContext';
import { useSettings } from '../../contexts/SettingsContext';
import { EnhancedTranscriptionItem } from '../../types';
import { FLATLIST_OPTIMIZATION_PROPS } from '../../utils/performance/performanceUtils';
import TranscriptionListItem from './TranscriptionListItem';

interface VirtualizedTranscriptionListProps {
  data: EnhancedTranscriptionItem[];
  onLoadMore: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onItemPress: (item: EnhancedTranscriptionItem) => void;
  onItemDelete: (id: string) => void;
  isLoading: boolean;
  hasMore: boolean;
  searchQuery?: string;
}

const ITEM_HEIGHT = 120; // Estimated height for getItemLayout
const LOAD_MORE_THRESHOLD = 0.7; // Load more when 70% scrolled

export default function VirtualizedTranscriptionList({
  data,
  onLoadMore,
  onRefresh,
  onItemPress,
  onItemDelete,
  isLoading,
  hasMore,
  searchQuery = '',
}: VirtualizedTranscriptionListProps) {
  const { settings } = useSettings();
  const { startMeasurement, endMeasurement } = usePerformance();
  
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Memoized filtered data for search
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) {
      return data;
    }

    const measurementId = startMeasurement('search_filter');
    
    const filtered = data.filter(item =>
      item.searchableText?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.transcription.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    endMeasurement(measurementId);
    return filtered;
  }, [data, searchQuery, startMeasurement, endMeasurement]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  // Handle load more
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || isLoading) {
      return;
    }

    setLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, isLoading, onLoadMore]);

  // Optimized render item function
  const renderItem: ListRenderItem<EnhancedTranscriptionItem> = useCallback(
    ({ item, index }) => (
      <TranscriptionListItem
        item={item}
        index={index}
        onPress={() => onItemPress(item)}
        onDelete={() => onItemDelete(item.id)}
        searchQuery={searchQuery}
      />
    ),
    [onItemPress, onItemDelete, searchQuery]
  );

  // Key extractor
  const keyExtractor = useCallback(
    (item: EnhancedTranscriptionItem) => item.id,
    []
  );

  // Get item layout for performance
  const getItemLayout = useCallback(
    (data: any, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    }),
    []
  );

  // Render footer (loading indicator)
  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;

    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={settings.theme === 'dark' ? '#ffffff' : '#666666'} />
        <Text style={[styles.footerText, { color: settings.theme === 'dark' ? '#ffffff' : '#666666' }]}>
          Loading more...
        </Text>
      </View>
    );
  }, [loadingMore, settings.theme]);

  // Render empty state
  const renderEmptyComponent = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={settings.theme === 'dark' ? '#ffffff' : '#666666'} />
          <Text style={[styles.emptyText, { color: settings.theme === 'dark' ? '#ffffff' : '#666666' }]}>
            Loading transcriptions...
          </Text>
        </View>
      );
    }

    if (searchQuery.trim() && filteredData.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: settings.theme === 'dark' ? '#ffffff' : '#666666' }]}>
            No transcriptions found for "{searchQuery}"
          </Text>
          <Text style={[styles.emptySubtext, { color: settings.theme === 'dark' ? '#cccccc' : '#999999' }]}>
            Try adjusting your search terms
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: settings.theme === 'dark' ? '#ffffff' : '#666666' }]}>
          No transcriptions yet
        </Text>
        <Text style={[styles.emptySubtext, { color: settings.theme === 'dark' ? '#cccccc' : '#999999' }]}>
          Start recording to create your first transcription
        </Text>
      </View>
    );
  }, [isLoading, searchQuery, filteredData.length, settings.theme]);

  // Performance monitoring
  useEffect(() => {
    const measurementId = startMeasurement('list_render');
    
    return () => {
      endMeasurement(measurementId);
    };
  }, [filteredData.length, startMeasurement, endMeasurement]);

  return (
    <FlatList
      data={filteredData}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemLayout={getItemLayout}
      ListEmptyComponent={renderEmptyComponent}
      ListFooterComponent={renderFooter}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={settings.theme === 'dark' ? '#ffffff' : '#666666'}
        />
      }
      onEndReached={handleLoadMore}
      onEndReachedThreshold={LOAD_MORE_THRESHOLD}
      contentContainerStyle={[
        styles.container,
        { backgroundColor: settings.theme === 'dark' ? '#000000' : '#ffffff' }
      ]}
      showsVerticalScrollIndicator={false}
      // Performance optimizations
      {...FLATLIST_OPTIMIZATION_PROPS}
      // Override some props for our specific use case
      initialNumToRender={8}
      maxToRenderPerBatch={5}
      windowSize={10}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 16,
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  footerText: {
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});