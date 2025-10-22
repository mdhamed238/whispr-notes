/**
 * Tag Manager Component
 * Advanced tagging system with auto-suggestions, bulk operations, and tag organization
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert,
    FlatList,
    Modal,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSettings } from '../../contexts/SettingsContext';
import { useOptimizedCallback } from '../../hooks/useOptimizedCallback';
import { EnhancedTranscriptionItem } from '../../types';

interface TagManagerProps {
  selectedItems: EnhancedTranscriptionItem[];
  allTags: string[];
  onTagsUpdate: (itemId: string, tags: string[]) => void;
  onBulkTagsUpdate: (itemIds: string[], tags: string[]) => void;
  visible: boolean;
  onClose: () => void;
}

interface TagSuggestion {
  tag: string;
  frequency: number;
  category?: string;
}

export default function TagManager({
  selectedItems,
  allTags,
  onTagsUpdate,
  onBulkTagsUpdate,
  visible,
  onClose,
}: TagManagerProps) {
  const { settings } = useSettings();
  const [newTag, setNewTag] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mode, setMode] = useState<'add' | 'remove' | 'replace'>('add');

  const inputRef = useRef<TextInput>(null);

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
      error: '#F44336',
    };
  };

  const colors = getThemeColors();

  // Initialize selected tags when modal opens
  useEffect(() => {
    if (visible && selectedItems.length > 0) {
      // Find common tags across all selected items
      const commonTags = selectedItems.reduce((common, item, index) => {
        if (index === 0) return [...item.tags];
        return common.filter(tag => item.tags.includes(tag));
      }, [] as string[]);
      
      setSelectedTags(commonTags);
      generateTagSuggestions();
    }
  }, [visible, selectedItems]);

  // Generate tag suggestions based on content and existing tags
  const generateTagSuggestions = useCallback(() => {
    const suggestions: TagSuggestion[] = [];
    const tagFrequency = new Map<string, number>();

    // Count tag frequency across all items
    allTags.forEach(tag => {
      tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
    });

    // Generate content-based suggestions
    const contentSuggestions = generateContentBasedSuggestions();
    
    // Combine and sort suggestions
    const allSuggestions = [
      ...Array.from(tagFrequency.entries()).map(([tag, frequency]) => ({
        tag,
        frequency,
      })),
      ...contentSuggestions,
    ];

    // Remove duplicates and sort by frequency
    const uniqueSuggestions = allSuggestions
      .filter((suggestion, index, array) => 
        array.findIndex(s => s.tag === suggestion.tag) === index
      )
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 20); // Limit to top 20 suggestions

    setTagSuggestions(uniqueSuggestions);
  }, [allTags, selectedItems]);

  // Generate suggestions based on transcription content
  const generateContentBasedSuggestions = (): TagSuggestion[] => {
    const suggestions: TagSuggestion[] = [];
    const keywords = new Map<string, number>();

    selectedItems.forEach(item => {
      // Extract keywords from transcription
      const words = item.transcription
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3); // Only words longer than 3 characters

      words.forEach(word => {
        keywords.set(word, (keywords.get(word) || 0) + 1);
      });

      // Category-based suggestions
      const categoryTags = getCategoryBasedTags(item.category);
      categoryTags.forEach(tag => {
        keywords.set(tag, (keywords.get(tag) || 0) + 5); // Higher weight for category tags
      });
    });

    // Convert to suggestions
    Array.from(keywords.entries())
      .filter(([word, frequency]) => frequency >= 2) // Must appear at least twice
      .forEach(([word, frequency]) => {
        suggestions.push({
          tag: word,
          frequency,
          category: 'content',
        });
      });

    return suggestions;
  };

  // Get category-based tag suggestions
  const getCategoryBasedTags = (category: string): string[] => {
    const categoryTags: Record<string, string[]> = {
      meeting: ['work', 'business', 'discussion', 'agenda', 'action-items'],
      lecture: ['education', 'learning', 'notes', 'academic', 'study'],
      interview: ['job', 'career', 'questions', 'candidate', 'hiring'],
      memo: ['personal', 'reminder', 'note', 'quick', 'thoughts'],
      other: ['misc', 'general', 'uncategorized'],
    };

    return categoryTags[category] || [];
  };

  // Handle new tag input
  const handleTagInput = useOptimizedCallback((text: string) => {
    setNewTag(text);
    
    if (text.trim().length >= 2) {
      const filteredSuggestions = tagSuggestions.filter(suggestion =>
        suggestion.tag.toLowerCase().includes(text.toLowerCase()) &&
        !selectedTags.includes(suggestion.tag)
      );
      setTagSuggestions(filteredSuggestions);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [tagSuggestions, selectedTags], { debounce: 200 });

  // Add tag to selection
  const addTag = useCallback((tag: string) => {
    const trimmedTag = tag.trim().toLowerCase();
    if (trimmedTag && !selectedTags.includes(trimmedTag)) {
      setSelectedTags(prev => [...prev, trimmedTag]);
      setNewTag('');
      setShowSuggestions(false);
    }
  }, [selectedTags]);

  // Remove tag from selection
  const removeTag = useCallback((tag: string) => {
    setSelectedTags(prev => prev.filter(t => t !== tag));
  }, []);

  // Handle tag suggestion selection
  const handleSuggestionSelect = useCallback((suggestion: TagSuggestion) => {
    addTag(suggestion.tag);
  }, [addTag]);

  // Apply tags to selected items
  const applyTags = useOptimizedCallback(async () => {
    try {
      if (selectedItems.length === 1) {
        // Single item update
        const item = selectedItems[0];
        let newTags: string[];

        switch (mode) {
          case 'add':
            newTags = [...new Set([...item.tags, ...selectedTags])];
            break;
          case 'remove':
            newTags = item.tags.filter(tag => !selectedTags.includes(tag));
            break;
          case 'replace':
            newTags = [...selectedTags];
            break;
        }

        onTagsUpdate(item.id, newTags);
      } else {
        // Bulk update
        const itemIds = selectedItems.map(item => item.id);
        onBulkTagsUpdate(itemIds, selectedTags);
      }

      onClose();
    } catch (error) {
      console.error('Failed to apply tags:', error);
      Alert.alert('Error', 'Failed to apply tags. Please try again.');
    }
  }, [selectedItems, selectedTags, mode, onTagsUpdate, onBulkTagsUpdate, onClose]);

  // Render tag chip
  const renderTagChip = useCallback((tag: string, onRemove?: () => void) => (
    <View key={tag} style={[styles.tagChip, { backgroundColor: colors.accent }]}>
      <Text style={styles.tagChipText}>{tag}</Text>
      {onRemove && (
        <TouchableOpacity onPress={onRemove} style={styles.tagChipRemove}>
          <Ionicons name="close" size={14} color="#ffffff" />
        </TouchableOpacity>
      )}
    </View>
  ), [colors.accent]);

  // Render tag suggestion
  const renderSuggestion = useCallback(({ item }: { item: TagSuggestion }) => (
    <TouchableOpacity
      style={[styles.suggestionItem, { borderBottomColor: colors.border }]}
      onPress={() => handleSuggestionSelect(item)}
    >
      <View style={styles.suggestionContent}>
        <Text style={[styles.suggestionTag, { color: colors.text }]}>{item.tag}</Text>
        <Text style={[styles.suggestionFrequency, { color: colors.textSecondary }]}>
          Used {item.frequency} times
        </Text>
      </View>
      <Ionicons name="add" size={20} color={colors.accent} />
    </TouchableOpacity>
  ), [colors, handleSuggestionSelect]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.headerButton, { color: colors.accent }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Manage Tags ({selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''})
          </Text>
          <TouchableOpacity onPress={applyTags}>
            <Text style={[styles.headerButton, { color: colors.accent }]}>Apply</Text>
          </TouchableOpacity>
        </View>

        {/* Mode Selection */}
        <View style={styles.modeContainer}>
          <Text style={[styles.modeLabel, { color: colors.text }]}>Action:</Text>
          <View style={styles.modeButtons}>
            {(['add', 'remove', 'replace'] as const).map(modeOption => (
              <TouchableOpacity
                key={modeOption}
                style={[
                  styles.modeButton,
                  {
                    backgroundColor: mode === modeOption ? colors.accent : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setMode(modeOption)}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    {
                      color: mode === modeOption ? '#ffffff' : colors.text,
                    },
                  ]}
                >
                  {modeOption.charAt(0).toUpperCase() + modeOption.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Tag Input */}
        <View style={styles.inputContainer}>
          <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              ref={inputRef}
              style={[styles.tagInput, { color: colors.text }]}
              placeholder="Add new tag..."
              placeholderTextColor={colors.textSecondary}
              value={newTag}
              onChangeText={handleTagInput}
              onSubmitEditing={() => {
                if (newTag.trim()) {
                  addTag(newTag);
                }
              }}
            />
            {newTag.trim() && (
              <TouchableOpacity onPress={() => addTag(newTag)}>
                <Ionicons name="add-circle" size={24} color={colors.accent} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Selected Tags */}
        <View style={styles.selectedTagsContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Selected Tags:</Text>
          <View style={styles.tagsGrid}>
            {selectedTags.map(tag => renderTagChip(tag, () => removeTag(tag)))}
            {selectedTags.length === 0 && (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No tags selected
              </Text>
            )}
          </View>
        </View>

        {/* Tag Suggestions */}
        <View style={styles.suggestionsContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Suggestions:</Text>
          <FlatList
            data={tagSuggestions.filter(s => !selectedTags.includes(s.tag))}
            renderItem={renderSuggestion}
            keyExtractor={(item) => item.tag}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No suggestions available
              </Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerButton: {
    fontSize: 16,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modeContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modeLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  modeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  modeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  modeButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  tagInput: {
    flex: 1,
    fontSize: 16,
  },
  selectedTagsContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  tagChipText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  tagChipRemove: {
    padding: 2,
  },
  suggestionsContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  suggestionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  suggestionContent: {
    flex: 1,
  },
  suggestionTag: {
    fontSize: 16,
    fontWeight: '500',
  },
  suggestionFrequency: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
});