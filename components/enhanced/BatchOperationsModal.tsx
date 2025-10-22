/**
 * Batch Operations Modal
 * Comprehensive batch operations for multiple transcriptions
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSettings } from '../../contexts/SettingsContext';
import { useOptimizedCallback } from '../../hooks/useOptimizedCallback';
import { cloudService } from '../../services/enhanced/cloudService';
import { exportService } from '../../services/enhanced/exportService';
import storageService from '../../services/storageService';
import { EnhancedTranscriptionItem, ExportFormat } from '../../types';

interface BatchOperationsModalProps {
  visible: boolean;
  onClose: () => void;
  selectedItems: EnhancedTranscriptionItem[];
  onItemsUpdated: (items: EnhancedTranscriptionItem[]) => void;
  allTags: string[];
}

interface BatchOperation {
  id: string;
  name: string;
  icon: string;
  description: string;
  action: () => Promise<void>;
  destructive?: boolean;
}

export default function BatchOperationsModal({
  visible,
  onClose,
  selectedItems,
  onItemsUpdated,
  allTags,
}: BatchOperationsModalProps) {
  const { settings } = useSettings();
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentOperation, setCurrentOperation] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // Get theme colors
  const getThemeColors = () => {
    const isDark = settings.theme === 'dark';
    return {
      background: isDark ? '#000000' : '#ffffff',
      surface: isDark ? '#1e1e1e' : '#f8f9fa',
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

  // Batch export operation
  const handleBatchExport = useOptimizedCallback(async (format: ExportFormat) => {
    setIsProcessing(true);
    setCurrentOperation(`Exporting ${selectedItems.length} items as ${format.toUpperCase()}`);
    
    try {
      const results = await exportService.exportMultipleTranscriptions(selectedItems, {
        format,
        includeMetadata: true,
        includeTimestamps: false,
      });

      const successCount = results.filter(r => r.success).length;
      const failedCount = results.length - successCount;

      Alert.alert(
        'Export Complete',
        `Successfully exported ${successCount} items.${failedCount > 0 ? ` ${failedCount} failed.` : ''}`,
        [{ text: 'OK', onPress: onClose }]
      );
    } catch (error) {
      Alert.alert('Export Failed', 'An error occurred during batch export.');
    } finally {
      setIsProcessing(false);
      setCurrentOperation(null);
    }
  }, [selectedItems, onClose]);

  // Batch delete operation
  const handleBatchDelete = useOptimizedCallback(async () => {
    Alert.alert(
      'Delete Transcriptions',
      `Are you sure you want to delete ${selectedItems.length} transcriptions? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsProcessing(true);
            setCurrentOperation(`Deleting ${selectedItems.length} items`);
            
            try {
              let deleted = 0;
              setProgress({ current: 0, total: selectedItems.length });

              for (const item of selectedItems) {
                try {
                  await storageService.deleteTranscription(item.id);
                  deleted++;
                  setProgress({ current: deleted, total: selectedItems.length });
                } catch (error) {
                  console.error(`Failed to delete ${item.id}:`, error);
                }
              }

              Alert.alert(
                'Delete Complete',
                `Successfully deleted ${deleted} of ${selectedItems.length} transcriptions.`,
                [{ text: 'OK', onPress: onClose }]
              );
              
              // Update parent component
              onItemsUpdated([]);
            } catch (error) {
              Alert.alert('Delete Failed', 'An error occurred during batch delete.');
            } finally {
              setIsProcessing(false);
              setCurrentOperation(null);
              setProgress({ current: 0, total: 0 });
            }
          },
        },
      ]
    );
  }, [selectedItems, onClose, onItemsUpdated]);

  // Batch category update
  const handleBatchCategoryUpdate = useOptimizedCallback(async (category: string) => {
    setIsProcessing(true);
    setCurrentOperation(`Updating category for ${selectedItems.length} items`);
    
    try {
      let updated = 0;
      setProgress({ current: 0, total: selectedItems.length });
      const updatedItems: EnhancedTranscriptionItem[] = [];

      for (const item of selectedItems) {
        try {
          const updatedItem = { ...item, category };
          await storageService.updateTranscription(item.id, updatedItem);
          updatedItems.push(updatedItem);
          updated++;
          setProgress({ current: updated, total: selectedItems.length });
        } catch (error) {
          console.error(`Failed to update ${item.id}:`, error);
          updatedItems.push(item); // Keep original if update failed
        }
      }

      Alert.alert(
        'Update Complete',
        `Successfully updated ${updated} of ${selectedItems.length} transcriptions.`,
        [{ text: 'OK', onPress: onClose }]
      );
      
      onItemsUpdated(updatedItems);
    } catch (error) {
      Alert.alert('Update Failed', 'An error occurred during batch update.');
    } finally {
      setIsProcessing(false);
      setCurrentOperation(null);
      setProgress({ current: 0, total: 0 });
    }
  }, [selectedItems, onClose, onItemsUpdated]);

  // Batch cloud sync
  const handleBatchCloudSync = useOptimizedCallback(async (providerId: string) => {
    setIsProcessing(true);
    setCurrentOperation(`Syncing ${selectedItems.length} items to ${providerId}`);
    
    try {
      const result = await cloudService.syncTranscriptions(selectedItems, providerId, {
        format: 'json',
        folder: 'transcriptions',
      });

      Alert.alert(
        'Sync Complete',
        `Successfully synced ${result.uploaded} items. ${result.failed} failed.${result.errors.length > 0 ? '\n\nErrors:\n' + result.errors.slice(0, 3).join('\n') : ''}`,
        [{ text: 'OK', onPress: onClose }]
      );
    } catch (error) {
      Alert.alert('Sync Failed', 'An error occurred during cloud sync.');
    } finally {
      setIsProcessing(false);
      setCurrentOperation(null);
    }
  }, [selectedItems, onClose]);

  // Define batch operations
  const batchOperations: BatchOperation[] = [
    {
      id: 'export-txt',
      name: 'Export as Text',
      icon: 'document-text',
      description: 'Export all selected items as text files',
      action: () => handleBatchExport('txt'),
    },
    {
      id: 'export-json',
      name: 'Export as JSON',
      icon: 'code',
      description: 'Export all selected items as JSON files',
      action: () => handleBatchExport('json'),
    },
    {
      id: 'export-srt',
      name: 'Export as Subtitles',
      icon: 'videocam',
      description: 'Export all selected items as SRT subtitle files',
      action: () => handleBatchExport('srt'),
    },
    {
      id: 'category-meeting',
      name: 'Mark as Meeting',
      icon: 'people',
      description: 'Set category to "meeting" for all selected items',
      action: () => handleBatchCategoryUpdate('meeting'),
    },
    {
      id: 'category-lecture',
      name: 'Mark as Lecture',
      icon: 'school',
      description: 'Set category to "lecture" for all selected items',
      action: () => handleBatchCategoryUpdate('lecture'),
    },
    {
      id: 'category-interview',
      name: 'Mark as Interview',
      icon: 'mic',
      description: 'Set category to "interview" for all selected items',
      action: () => handleBatchCategoryUpdate('interview'),
    },
    {
      id: 'sync-cloud',
      name: 'Sync to Cloud',
      icon: 'cloud-upload',
      description: 'Upload all selected items to cloud storage',
      action: () => {
        // Show cloud provider selection
        Alert.alert(
          'Select Cloud Provider',
          'Choose where to sync your transcriptions:',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Google Drive', onPress: () => handleBatchCloudSync('google-drive') },
            { text: 'Dropbox', onPress: () => handleBatchCloudSync('dropbox') },
          ]
        );
      },
    },
    {
      id: 'delete',
      name: 'Delete All',
      icon: 'trash',
      description: 'Permanently delete all selected transcriptions',
      action: handleBatchDelete,
      destructive: true,
    },
  ];

  // Render operation card
  const renderOperationCard = useCallback((operation: BatchOperation) => (
    <TouchableOpacity
      key={operation.id}
      style={[
        styles.operationCard,
        {
          backgroundColor: colors.surface,
          borderColor: operation.destructive ? colors.error : colors.border,
        },
      ]}
      onPress={operation.action}
      disabled={isProcessing}
    >
      <View style={styles.operationIcon}>
        <Ionicons
          name={operation.icon as any}
          size={24}
          color={operation.destructive ? colors.error : colors.accent}
        />
      </View>
      <View style={styles.operationContent}>
        <Text
          style={[
            styles.operationName,
            {
              color: operation.destructive ? colors.error : colors.text,
            },
          ]}
        >
          {operation.name}
        </Text>
        <Text style={[styles.operationDescription, { color: colors.textSecondary }]}>
          {operation.description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  ), [colors, isProcessing]);

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
          <TouchableOpacity onPress={onClose} disabled={isProcessing}>
            <Text style={[styles.headerButton, { color: colors.accent }]}>
              {isProcessing ? 'Processing...' : 'Cancel'}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Batch Operations
          </Text>
          <View style={styles.headerRight}>
            <Text style={[styles.itemCount, { color: colors.textSecondary }]}>
              {selectedItems.length} items
            </Text>
          </View>
        </View>

        {/* Processing Overlay */}
        {isProcessing && (
          <View style={[styles.processingOverlay, { backgroundColor: colors.surface }]}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.processingText, { color: colors.text }]}>
              {currentOperation}
            </Text>
            {progress.total > 0 && (
              <View style={styles.progressContainer}>
                <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.accent,
                        width: `${(progress.current / progress.total) * 100}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.progressText, { color: colors.textSecondary }]}>
                  {progress.current} of {progress.total}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Operations List */}
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Export Operations</Text>
            {batchOperations
              .filter(op => op.id.startsWith('export'))
              .map(renderOperationCard)}
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Category Operations</Text>
            {batchOperations
              .filter(op => op.id.startsWith('category'))
              .map(renderOperationCard)}
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Cloud Operations</Text>
            {batchOperations
              .filter(op => op.id.startsWith('sync'))
              .map(renderOperationCard)}
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.error }]}>Destructive Operations</Text>
            {batchOperations
              .filter(op => op.destructive)
              .map(renderOperationCard)}
          </View>
        </ScrollView>
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
  headerRight: {
    alignItems: 'flex-end',
  },
  itemCount: {
    fontSize: 14,
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: 20,
  },
  processingText: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 16,
    textAlign: 'center',
  },
  progressContainer: {
    width: '100%',
    marginTop: 20,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  operationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  operationIcon: {
    marginRight: 12,
  },
  operationContent: {
    flex: 1,
  },
  operationName: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 2,
  },
  operationDescription: {
    fontSize: 14,
    lineHeight: 18,
  },
});