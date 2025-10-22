/**
 * Transcription Detail Screen
 * Comprehensive view with editing, metadata, playback, and export options
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useRef, useState } from 'react';
import {
    Alert,
    ScrollView,
    Share,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../../contexts/SettingsContext';
import { useOptimizedCallback } from '../../hooks/useOptimizedCallback';
import storageService from '../../services/storageService';
import { EnhancedTranscriptionItem, ExportOptions } from '../../types';
import TagManager from './TagManager';
import TranscriptionEditor from './TranscriptionEditor';

interface TranscriptionDetailScreenProps {
  item: EnhancedTranscriptionItem;
  onUpdate: (updatedItem: EnhancedTranscriptionItem) => void;
  onDelete: () => void;
  onBack: () => void;
  allTags: string[];
}

export default function TranscriptionDetailScreen({
  item,
  onUpdate,
  onDelete,
  onBack,
  allTags,
}: TranscriptionDetailScreenProps) {
  const { settings } = useSettings();
  const [currentItem, setCurrentItem] = useState(item);
  const [isEditing, setIsEditing] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);

  const scrollViewRef = useRef<ScrollView>(null);

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

  // Format date for display
  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Format duration
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle transcription edit
  const handleTranscriptionEdit = useOptimizedCallback(async (newText: string) => {
    try {
      const updatedItem: EnhancedTranscriptionItem = {
        ...currentItem,
        transcription: newText,
        searchableText: newText.toLowerCase(),
        editHistory: [
          ...currentItem.editHistory,
          {
            id: Date.now().toString(),
            timestamp: new Date(),
            originalText: currentItem.transcription,
            editedText: newText,
            editType: 'manual',
          },
        ],
      };

      setCurrentItem(updatedItem);
      await storageService.updateTranscription(currentItem.id, updatedItem);
      onUpdate(updatedItem);
    } catch (error) {
      console.error('Failed to update transcription:', error);
      Alert.alert('Error', 'Failed to save changes');
    }
  }, [currentItem, onUpdate], { debounce: 1000 });

  // Handle tags update
  const handleTagsUpdate = useOptimizedCallback(async (itemId: string, tags: string[]) => {
    try {
      const updatedItem: EnhancedTranscriptionItem = {
        ...currentItem,
        tags,
      };

      setCurrentItem(updatedItem);
      await storageService.updateTranscription(itemId, updatedItem);
      onUpdate(updatedItem);
    } catch (error) {
      console.error('Failed to update tags:', error);
      Alert.alert('Error', 'Failed to update tags');
    }
  }, [currentItem, onUpdate]);

  // Handle category change
  const handleCategoryChange = useOptimizedCallback(async (category: string) => {
    try {
      const updatedItem: EnhancedTranscriptionItem = {
        ...currentItem,
        category,
      };

      setCurrentItem(updatedItem);
      await storageService.updateTranscription(currentItem.id, updatedItem);
      onUpdate(updatedItem);
    } catch (error) {
      console.error('Failed to update category:', error);
      Alert.alert('Error', 'Failed to update category');
    }
  }, [currentItem, onUpdate]);

  // Handle export
  const handleExport = useOptimizedCallback(async (format: 'txt' | 'json' | 'srt') => {
    try {
      const exportOptions: ExportOptions = {
        format,
        includeMetadata: true,
        includeTimestamps: format === 'srt',
      };

      const fileUri = await storageService.exportTranscription(currentItem.id, exportOptions);
      await storageService.shareExportedFile(fileUri);
    } catch (error) {
      console.error('Failed to export transcription:', error);
      Alert.alert('Error', 'Failed to export transcription');
    }
  }, [currentItem.id]);

  // Handle share
  const handleShare = useOptimizedCallback(async () => {
    try {
      await Share.share({
        message: currentItem.transcription,
        title: `Transcription from ${formatDate(currentItem.createdAt)}`,
      });
    } catch (error) {
      console.error('Failed to share transcription:', error);
    }
  }, [currentItem]);

  // Handle delete
  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Transcription',
      'Are you sure you want to delete this transcription? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: onDelete,
        },
      ]
    );
  }, [onDelete]);

  // Render metadata section
  const renderMetadata = () => (
    <View style={[styles.metadataContainer, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Details</Text>
      
      <View style={styles.metadataGrid}>
        <View style={styles.metadataItem}>
          <Text style={[styles.metadataLabel, { color: colors.textSecondary }]}>Created</Text>
          <Text style={[styles.metadataValue, { color: colors.text }]}>
            {formatDate(currentItem.createdAt)}
          </Text>
        </View>

        <View style={styles.metadataItem}>
          <Text style={[styles.metadataLabel, { color: colors.textSecondary }]}>Duration</Text>
          <Text style={[styles.metadataValue, { color: colors.text }]}>
            {formatDuration(currentItem.duration)}
          </Text>
        </View>

        <View style={styles.metadataItem}>
          <Text style={[styles.metadataLabel, { color: colors.textSecondary }]}>Words</Text>
          <Text style={[styles.metadataValue, { color: colors.text }]}>
            {currentItem.transcription.split(/\s+/).filter(word => word.trim()).length}
          </Text>
        </View>

        <View style={styles.metadataItem}>
          <Text style={[styles.metadataLabel, { color: colors.textSecondary }]}>Confidence</Text>
          <Text style={[styles.metadataValue, { color: colors.text }]}>
            {currentItem.confidence ? `${Math.round(currentItem.confidence * 100)}%` : 'N/A'}
          </Text>
        </View>

        <View style={styles.metadataItem}>
          <Text style={[styles.metadataLabel, { color: colors.textSecondary }]}>Category</Text>
          <TouchableOpacity onPress={() => {/* TODO: Category picker */}}>
            <Text style={[styles.metadataValue, styles.metadataLink, { color: colors.accent }]}>
              {currentItem.category}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.metadataItem}>
          <Text style={[styles.metadataLabel, { color: colors.textSecondary }]}>Processing Time</Text>
          <Text style={[styles.metadataValue, { color: colors.text }]}>
            {currentItem.processingTime ? `${currentItem.processingTime.toFixed(1)}s` : 'N/A'}
          </Text>
        </View>
      </View>
    </View>
  );

  // Render tags section
  const renderTags = () => (
    <View style={[styles.tagsContainer, { backgroundColor: colors.surface }]}>
      <View style={styles.tagsHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Tags</Text>
        <TouchableOpacity
          style={[styles.addTagButton, { backgroundColor: colors.accent }]}
          onPress={() => setShowTagManager(true)}
        >
          <Ionicons name="add" size={16} color="#ffffff" />
          <Text style={styles.addTagButtonText}>Add Tags</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tagsGrid}>
        {currentItem.tags.length > 0 ? (
          currentItem.tags.map(tag => (
            <View key={tag} style={[styles.tagChip, { backgroundColor: colors.accent }]}>
              <Text style={styles.tagChipText}>{tag}</Text>
            </View>
          ))
        ) : (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No tags added yet
          </Text>
        )}
      </View>
    </View>
  );

  // Render edit history section
  const renderEditHistory = () => {
    if (currentItem.editHistory.length === 0) return null;

    return (
      <View style={[styles.historyContainer, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Edit History</Text>
        
        {currentItem.editHistory.slice(-3).map((edit, index) => (
          <View key={edit.id} style={[styles.historyItem, { borderBottomColor: colors.border }]}>
            <View style={styles.historyHeader}>
              <Text style={[styles.historyType, { color: colors.accent }]}>
                {edit.editType.charAt(0).toUpperCase() + edit.editType.slice(1)} Edit
              </Text>
              <Text style={[styles.historyDate, { color: colors.textSecondary }]}>
                {formatDate(edit.timestamp)}
              </Text>
            </View>
            <Text style={[styles.historyText, { color: colors.textSecondary }]} numberOfLines={2}>
              {edit.editedText}
            </Text>
          </View>
        ))}
        
        {currentItem.editHistory.length > 3 && (
          <Text style={[styles.moreEditsText, { color: colors.textSecondary }]}>
            +{currentItem.editHistory.length - 3} more edits
          </Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={settings.theme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          Transcription Details
        </Text>
        
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleShare} style={styles.headerButton}>
            <Ionicons name="share-outline" size={24} color={colors.text} />
          </TouchableOpacity>
          
          <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
            <Ionicons name="trash-outline" size={24} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Transcription Editor */}
        <View style={[styles.editorContainer, { backgroundColor: colors.surface }]}>
          <View style={styles.editorHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Transcription</Text>
            <TouchableOpacity
              style={[styles.editButton, { backgroundColor: isEditing ? colors.success : colors.accent }]}
              onPress={() => setIsEditing(!isEditing)}
            >
              <Ionicons 
                name={isEditing ? 'checkmark' : 'pencil'} 
                size={16} 
                color="#ffffff" 
              />
              <Text style={styles.editButtonText}>
                {isEditing ? 'Done' : 'Edit'}
              </Text>
            </TouchableOpacity>
          </View>

          <TranscriptionEditor
            transcription={currentItem.transcription}
            confidence={[]} // TODO: Add word-level confidence if available
            timestamps={currentItem.wordTimestamps}
            onEdit={handleTranscriptionEdit}
            readOnly={!isEditing}
            showConfidence={false}
            showTimestamps={false}
          />
        </View>

        {/* Metadata */}
        {renderMetadata()}

        {/* Tags */}
        {renderTags()}

        {/* Edit History */}
        {renderEditHistory()}

        {/* Export Options */}
        <View style={[styles.exportContainer, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Export</Text>
          
          <View style={styles.exportButtons}>
            <TouchableOpacity
              style={[styles.exportButton, { backgroundColor: colors.accent }]}
              onPress={() => handleExport('txt')}
            >
              <Ionicons name="document-text-outline" size={20} color="#ffffff" />
              <Text style={styles.exportButtonText}>Text</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportButton, { backgroundColor: colors.accent }]}
              onPress={() => handleExport('json')}
            >
              <Ionicons name="code-outline" size={20} color="#ffffff" />
              <Text style={styles.exportButtonText}>JSON</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportButton, { backgroundColor: colors.accent }]}
              onPress={() => handleExport('srt')}
            >
              <Ionicons name="videocam-outline" size={20} color="#ffffff" />
              <Text style={styles.exportButtonText}>Subtitle</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Tag Manager Modal */}
      <TagManager
        selectedItems={[currentItem]}
        allTags={allTags}
        onTagsUpdate={handleTagsUpdate}
        onBulkTagsUpdate={() => {}} // Not used for single item
        visible={showTagManager}
        onClose={() => setShowTagManager(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    marginHorizontal: 16,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  editorContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  editorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  editButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  metadataContainer: {
    padding: 16,
    borderRadius: 12,
  },
  metadataGrid: {
    marginTop: 12,
    gap: 12,
  },
  metadataItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metadataLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  metadataValue: {
    fontSize: 14,
  },
  metadataLink: {
    textDecorationLine: 'underline',
  },
  tagsContainer: {
    padding: 16,
    borderRadius: 12,
  },
  tagsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addTagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  addTagButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagChipText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  historyContainer: {
    padding: 16,
    borderRadius: 12,
  },
  historyItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  historyType: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyDate: {
    fontSize: 12,
  },
  historyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  moreEditsText: {
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
    fontStyle: 'italic',
  },
  exportContainer: {
    padding: 16,
    borderRadius: 12,
  },
  exportButtons: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 12,
  },
  exportButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  exportButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
});