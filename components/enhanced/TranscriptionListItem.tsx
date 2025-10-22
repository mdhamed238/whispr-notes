/**
 * Transcription List Item Component
 * Optimized list item with memoization and efficient rendering
 */

import { Ionicons } from '@expo/vector-icons';
import React, { memo } from 'react';
import {
    Alert,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSettings } from '../../contexts/SettingsContext';
import { EnhancedTranscriptionItem } from '../../types';

interface TranscriptionListItemProps {
  item: EnhancedTranscriptionItem;
  index: number;
  onPress: () => void;
  onDelete: () => void;
  searchQuery?: string;
}

function TranscriptionListItem({
  item,
  index,
  onPress,
  onDelete,
  searchQuery = '',
}: TranscriptionListItemProps) {
  const { settings } = useSettings();

  // Format date for display
  const formatDate = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    }
  };

  // Format duration
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get category icon
  const getCategoryIcon = (category: string): keyof typeof Ionicons.glyphMap => {
    switch (category.toLowerCase()) {
      case 'meeting':
        return 'people';
      case 'lecture':
        return 'school';
      case 'interview':
        return 'mic';
      case 'memo':
        return 'document-text';
      default:
        return 'recording';
    }
  };

  // Highlight search terms in text
  const highlightSearchTerms = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) {
      return text;
    }

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) => {
      if (regex.test(part)) {
        return (
          <Text key={index} style={styles.highlightedText}>
            {part}
          </Text>
        );
      }
      return part;
    });
  };

  // Handle delete with confirmation
  const handleDelete = () => {
    Alert.alert(
      'Delete Transcription',
      'Are you sure you want to delete this transcription? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]
    );
  };

  // Get theme colors
  const getThemeColors = () => {
    const isDark = settings.theme === 'dark';
    
    return {
      background: isDark ? '#1e1e1e' : '#ffffff',
      surface: isDark ? '#2d2d2d' : '#f8f9fa',
      text: isDark ? '#ffffff' : '#333333',
      textSecondary: isDark ? '#b0b0b0' : '#666666',
      textTertiary: isDark ? '#808080' : '#999999',
      border: isDark ? '#404040' : '#e0e0e0',
      accent: '#2196F3',
      danger: '#FF5722',
    };
  };

  const colors = getThemeColors();

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        {/* Header with category and date */}
        <View style={styles.header}>
          <View style={styles.categoryContainer}>
            <Ionicons
              name={getCategoryIcon(item.category)}
              size={16}
              color={colors.accent}
            />
            <Text style={[styles.categoryText, { color: colors.accent }]}>
              {item.category}
            </Text>
          </View>
          
          <Text style={[styles.dateText, { color: colors.textTertiary }]}>
            {formatDate(item.createdAt)}
          </Text>
        </View>

        {/* Transcription preview */}
        <Text
          style={[styles.transcriptionText, { color: colors.text }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {highlightSearchTerms(item.transcription, searchQuery)}
        </Text>

        {/* Footer with metadata */}
        <View style={styles.footer}>
          <View style={styles.metadataContainer}>
            <Text style={[styles.durationText, { color: colors.textSecondary }]}>
              {formatDuration(item.duration)}
            </Text>
            
            {item.confidence && (
              <>
                <Text style={[styles.separator, { color: colors.textTertiary }]}>•</Text>
                <Text style={[styles.confidenceText, { color: colors.textSecondary }]}>
                  {Math.round(item.confidence * 100)}% confidence
                </Text>
              </>
            )}

            {item.tags.length > 0 && (
              <>
                <Text style={[styles.separator, { color: colors.textTertiary }]}>•</Text>
                <Text style={[styles.tagsText, { color: colors.textSecondary }]}>
                  {item.tags.slice(0, 2).join(', ')}
                  {item.tags.length > 2 && ` +${item.tags.length - 2}`}
                </Text>
              </>
            )}
          </View>

          {/* Action buttons */}
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={colors.danger}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Processing indicator */}
        {item.isProcessing && (
          <View style={[styles.processingIndicator, { backgroundColor: colors.surface }]}>
            <Text style={[styles.processingText, { color: colors.textSecondary }]}>
              Processing...
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// Memoize the component to prevent unnecessary re-renders
export default memo(TranscriptionListItem, (prevProps, nextProps) => {
  // Custom comparison function for better performance
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.transcription === nextProps.item.transcription &&
    prevProps.item.isProcessing === nextProps.item.isProcessing &&
    prevProps.searchQuery === nextProps.searchQuery &&
    prevProps.index === nextProps.index
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    minHeight: 120,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  dateText: {
    fontSize: 12,
  },
  transcriptionText: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 12,
  },
  highlightedText: {
    backgroundColor: '#FFE082',
    color: '#333333',
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metadataContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  durationText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  separator: {
    fontSize: 12,
    marginHorizontal: 6,
  },
  confidenceText: {
    fontSize: 12,
  },
  tagsText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionButton: {
    padding: 4,
  },
  processingIndicator: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  processingText: {
    fontSize: 10,
    fontWeight: '600',
  },
});