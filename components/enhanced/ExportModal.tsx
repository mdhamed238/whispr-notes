/**
 * Enhanced Export Modal
 * Comprehensive export interface with format selection, templates, and batch operations
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSettings } from '../../contexts/SettingsContext';
import { useOptimizedCallback } from '../../hooks/useOptimizedCallback';
import { exportService } from '../../services/enhanced/exportService';
import { templateService } from '../../services/enhanced/templateService';
import {
    EnhancedTranscriptionItem,
    ExportDestination,
    ExportFormat,
    ExportOptions,
    ExportTemplate
} from '../../types';

interface ExportModalProps {
  visible: boolean;
  onClose: () => void;
  items: EnhancedTranscriptionItem[];
  onExportComplete: (results: any[]) => void;
}

const EXPORT_FORMATS: { value: ExportFormat; label: string; icon: string; description: string }[] = [
  { value: 'txt', label: 'Text', icon: 'document-text', description: 'Plain text format' },
  { value: 'json', label: 'JSON', icon: 'code', description: 'Structured data format' },
  { value: 'srt', label: 'SRT', icon: 'videocam', description: 'Subtitle format' },
  { value: 'vtt', label: 'VTT', icon: 'tv', description: 'Web video text tracks' },
  { value: 'docx', label: 'DOCX', icon: 'document', description: 'Word document' },
  { value: 'pdf', label: 'PDF', icon: 'document-attach', description: 'Portable document' },
];

const EXPORT_DESTINATIONS: { value: ExportDestination; label: string; icon: string }[] = [
  { value: 'local', label: 'Save Locally', icon: 'phone-portrait' },
  { value: 'share', label: 'Share', icon: 'share' },
  { value: 'cloud', label: 'Cloud Storage', icon: 'cloud-upload' },
];

export default function ExportModal({
  visible,
  onClose,
  items,
  onExportComplete,
}: ExportModalProps) {
  const { settings } = useSettings();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('txt');
  const [selectedTemplate, setSelectedTemplate] = useState<ExportTemplate | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<ExportTemplate[]>([]);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeTimestamps, setIncludeTimestamps] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [destination, setDestination] = useState<ExportDestination>('share');
  const [isExporting, setIsExporting] = useState(false);
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [customVariables, setCustomVariables] = useState<Record<string, string>>({});

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

  // Load templates when format changes
  useEffect(() => {
    loadTemplatesForFormat(selectedFormat);
  }, [selectedFormat]);

  // Load templates for selected format
  const loadTemplatesForFormat = useOptimizedCallback(async (format: ExportFormat) => {
    try {
      const templates = await templateService.getTemplatesForFormat(format);
      setAvailableTemplates(templates);
      
      // Auto-select first template if available
      if (templates.length > 0 && !selectedTemplate) {
        setSelectedTemplate(templates[0]);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  }, [selectedTemplate]);

  // Handle export
  const handleExport = useOptimizedCallback(async () => {
    setIsExporting(true);
    
    try {
      const exportOptions: ExportOptions = {
        format: selectedFormat,
        includeMetadata,
        includeTimestamps,
        template: selectedTemplate || undefined,
        destination,
        batchMode,
      };

      let results;

      if (batchMode && items.length > 1) {
        // Batch export (single file with all items)
        const result = await exportService.createBatchExport(items, exportOptions);
        results = [result];
      } else {
        // Individual exports
        results = await exportService.exportMultipleTranscriptions(items, exportOptions);
      }

      // Handle sharing based on destination
      for (const result of results) {
        if (result.success && result.filePath) {
          if (destination === 'share') {
            await exportService.shareExportedFile(result.filePath);
          }
        }
      }

      onExportComplete(results);
      
      const successCount = results.filter(r => r.success).length;
      const totalCount = results.length;
      
      Alert.alert(
        'Export Complete',
        `Successfully exported ${successCount} of ${totalCount} items.`
      );
      
      onClose();
    } catch (error) {
      console.error('Export failed:', error);
      Alert.alert('Export Failed', 'An error occurred during export. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [
    selectedFormat,
    includeMetadata,
    includeTimestamps,
    selectedTemplate,
    destination,
    batchMode,
    items,
    onExportComplete,
    onClose,
  ]);

  // Handle template preview
  const handleTemplatePreview = useCallback(() => {
    if (!selectedTemplate) return;

    const preview = templateService.previewTemplate(selectedTemplate, items[0]);
    Alert.alert('Template Preview', preview, [{ text: 'OK' }]);
  }, [selectedTemplate, items]);

  // Handle custom variable change
  const handleCustomVariableChange = useCallback((key: string, value: string) => {
    setCustomVariables(prev => ({ ...prev, [key]: value }));
  }, []);

  // Render format selection
  const renderFormatSelection = () => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Export Format</Text>
      <View style={styles.formatGrid}>
        {EXPORT_FORMATS.map(format => (
          <TouchableOpacity
            key={format.value}
            style={[
              styles.formatCard,
              {
                backgroundColor: selectedFormat === format.value ? colors.accent : colors.surface,
                borderColor: colors.border,
              },
            ]}
            onPress={() => setSelectedFormat(format.value)}
          >
            <Ionicons
              name={format.icon as any}
              size={24}
              color={selectedFormat === format.value ? '#ffffff' : colors.text}
            />
            <Text
              style={[
                styles.formatLabel,
                {
                  color: selectedFormat === format.value ? '#ffffff' : colors.text,
                },
              ]}
            >
              {format.label}
            </Text>
            <Text
              style={[
                styles.formatDescription,
                {
                  color: selectedFormat === format.value ? '#ffffff' : colors.textSecondary,
                },
              ]}
            >
              {format.description}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  // Render template selection
  const renderTemplateSelection = () => {
    if (availableTemplates.length === 0) return null;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Template</Text>
          {selectedTemplate && (
            <TouchableOpacity onPress={handleTemplatePreview}>
              <Text style={[styles.previewButton, { color: colors.accent }]}>Preview</Text>
            </TouchableOpacity>
          )}
        </View>
        
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.templateScroll}>
          {availableTemplates.map(template => (
            <TouchableOpacity
              key={template.id}
              style={[
                styles.templateCard,
                {
                  backgroundColor: selectedTemplate?.id === template.id ? colors.accent : colors.surface,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => setSelectedTemplate(template)}
            >
              <Text
                style={[
                  styles.templateName,
                  {
                    color: selectedTemplate?.id === template.id ? '#ffffff' : colors.text,
                  },
                ]}
              >
                {template.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Custom variables for selected template */}
        {selectedTemplate && Object.keys(selectedTemplate.variables).length > 0 && (
          <View style={styles.customVariables}>
            <Text style={[styles.subsectionTitle, { color: colors.text }]}>Template Variables</Text>
            {Object.entries(selectedTemplate.variables).map(([key, description]) => (
              <View key={key} style={styles.variableInput}>
                <Text style={[styles.variableLabel, { color: colors.textSecondary }]}>
                  {description}
                </Text>
                <TextInput
                  style={[
                    styles.variableTextInput,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  placeholder={`Enter ${description.toLowerCase()}`}
                  placeholderTextColor={colors.textSecondary}
                  value={customVariables[key] || ''}
                  onChangeText={(value) => handleCustomVariableChange(key, value)}
                />
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  // Render export options
  const renderExportOptions = () => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Options</Text>
      
      <View style={styles.optionsGrid}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => setIncludeMetadata(!includeMetadata)}
        >
          <View style={styles.optionContent}>
            <Text style={[styles.optionLabel, { color: colors.text }]}>Include Metadata</Text>
            <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
              Date, duration, category, tags
            </Text>
          </View>
          <Ionicons
            name={includeMetadata ? 'checkbox' : 'square-outline'}
            size={24}
            color={colors.accent}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => setIncludeTimestamps(!includeTimestamps)}
        >
          <View style={styles.optionContent}>
            <Text style={[styles.optionLabel, { color: colors.text }]}>Include Timestamps</Text>
            <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
              Word-level timing information
            </Text>
          </View>
          <Ionicons
            name={includeTimestamps ? 'checkbox' : 'square-outline'}
            size={24}
            color={colors.accent}
          />
        </TouchableOpacity>

        {items.length > 1 && (
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => setBatchMode(!batchMode)}
          >
            <View style={styles.optionContent}>
              <Text style={[styles.optionLabel, { color: colors.text }]}>Batch Export</Text>
              <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
                Combine all items into single file
              </Text>
            </View>
            <Ionicons
              name={batchMode ? 'checkbox' : 'square-outline'}
              size={24}
              color={colors.accent}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // Render destination selection
  const renderDestinationSelection = () => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Destination</Text>
      <View style={styles.destinationGrid}>
        {EXPORT_DESTINATIONS.map(dest => (
          <TouchableOpacity
            key={dest.value}
            style={[
              styles.destinationCard,
              {
                backgroundColor: destination === dest.value ? colors.accent : colors.surface,
                borderColor: colors.border,
              },
            ]}
            onPress={() => setDestination(dest.value)}
          >
            <Ionicons
              name={dest.icon as any}
              size={20}
              color={destination === dest.value ? '#ffffff' : colors.text}
            />
            <Text
              style={[
                styles.destinationLabel,
                {
                  color: destination === dest.value ? '#ffffff' : colors.text,
                },
              ]}
            >
              {dest.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

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
            Export {items.length} item{items.length !== 1 ? 's' : ''}
          </Text>
          <TouchableOpacity onPress={handleExport} disabled={isExporting}>
            {isExporting ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={[styles.headerButton, { color: colors.accent }]}>Export</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {renderFormatSelection()}
          {renderTemplateSelection()}
          {renderExportOptions()}
          {renderDestinationSelection()}
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
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginVertical: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  previewButton: {
    fontSize: 14,
    fontWeight: '500',
  },
  formatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  formatCard: {
    width: '48%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  formatLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  formatDescription: {
    fontSize: 12,
    textAlign: 'center',
  },
  templateScroll: {
    marginBottom: 12,
  },
  templateCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 12,
  },
  templateName: {
    fontSize: 14,
    fontWeight: '500',
  },
  customVariables: {
    marginTop: 12,
  },
  variableInput: {
    marginBottom: 12,
  },
  variableLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  variableTextInput: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    fontSize: 14,
  },
  optionsGrid: {
    gap: 12,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  optionContent: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  optionDescription: {
    fontSize: 12,
    marginTop: 2,
  },
  destinationGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  destinationCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  destinationLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
});