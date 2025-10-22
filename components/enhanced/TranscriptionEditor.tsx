/**
 * Transcription Editor Component
 * Advanced text editor with confidence highlighting, timestamps, and undo/redo functionality
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  TextInput,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TranscriptionEditorProps, WordTimestamp, EditHistoryItem } from '../../types';
import { useSettings } from '../../contexts/SettingsContext';
import { useOptimizedCallback } from '../../hooks/useOptimizedCallback';

interface EditAction {
  type: 'insert' | 'delete' | 'replace';
  position: number;
  oldText: string;
  newText: string;
  timestamp: Date;
}

export default function TranscriptionEditor({
  transcription,
  confidence = [],
  timestamps = [],
  onEdit,
  readOnly = false,
  showConfidence = true,
  showTimestamps = false,
}: TranscriptionEditorProps) {
  const { settings } = useSettings();
  const [currentText, setCurrentText] = useState(transcription);
  const [editHistory, setEditHistory] = useState<EditAction[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [isEditing, setIsEditing] = useState(false);

  const textInputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Update current text when transcription prop changes
  useEffect(() => {
    if (transcription !== currentText && !isEditing) {
      setCurrentText(transcription);
    }
  }, [transcription, currentText, isEditing]);

  // Get theme colors
  const getThemeColors = () => {
    const isDark = settings.theme === 'dark';
    return {
      background: isDark ? '#1e1e1e' : '#ffffff',
      surface: isDark ? '#2d2d2d' : '#f8f9fa',
      text: isDark ? '#ffffff' : '#333333',
      textSecondary: isDark ? '#b0b0b0' : '#666666',
      border: isDark ? '#404040' : '#e0e0e0',
      accent: '#2196F3',
      success: '#4CAF50',
      warning: '#FF9800',
      error: '#F44336',
      confidence: {
        high: isDark ? '#4CAF50' : '#2E7D32',
        medium: isDark ? '#FF9800' : '#F57C00',
        low: isDark ? '#F44336' : '#C62828',
      },
    };
  };

  const colors = getThemeColors();

  // Get confidence color for a word
  const getConfidenceColor = (confidenceScore: number) => {
    if (confidenceScore >= 0.8) return colors.confidence.high;
    if (confidenceScore >= 0.6) return colors.confidence.medium;
    return colors.confidence.low;
  };

  // Parse text into words with confidence and timestamps
  const parseTextWithMetadata = useMemo(() => {
    const words = currentText.split(/(\s+)/);
    let wordIndex = 0;
    
    return words.map((word, index) => {
      if (word.trim()) {
        const confidenceScore = confidence[wordIndex] || 0;
        const timestamp = timestamps[wordIndex];
        wordIndex++;
        
        return {
          text: word,
          isWord: true,
          confidence: confidenceScore,
          timestamp,
          index,
        };
      }
      
      return {
        text: word,
        isWord: false,
        confidence: 0,
        timestamp: undefined,
        index,
      };
    });
  }, [currentText, confidence, timestamps]);

  // Add edit action to history
  const addToHistory = useCallback((action: EditAction) => {
    setEditHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(action);
      
      // Limit history size
      if (newHistory.length > 50) {
        newHistory.shift();
      }
      
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex]);

  // Handle text change
  const handleTextChange = useOptimizedCallback((text: string) => {
    if (readOnly) return;

    const action: EditAction = {
      type: text.length > currentText.length ? 'insert' : 
            text.length < currentText.length ? 'delete' : 'replace',
      position: selectionStart,
      oldText: currentText,
      newText: text,
      timestamp: new Date(),
    };

    addToHistory(action);
    setCurrentText(text);
    setIsEditing(true);
    onEdit(text);
  }, [currentText, selectionStart, readOnly, onEdit, addToHistory], {
    debounce: 300,
  });

  // Undo functionality
  const handleUndo = useOptimizedCallback(() => {
    if (historyIndex >= 0) {
      const action = editHistory[historyIndex];
      setCurrentText(action.oldText);
      setHistoryIndex(prev => prev - 1);
      onEdit(action.oldText);
    }
  }, [editHistory, historyIndex, onEdit]);

  // Redo functionality
  const handleRedo = useOptimizedCallback(() => {
    if (historyIndex < editHistory.length - 1) {
      const action = editHistory[historyIndex + 1];
      setCurrentText(action.newText);
      setHistoryIndex(prev => prev + 1);
      onEdit(action.newText);
    }
  }, [editHistory, historyIndex, onEdit]);

  // Handle selection change
  const handleSelectionChange = useCallback((event: any) => {
    const { start, end } = event.nativeEvent.selection;
    setSelectionStart(start);
    setSelectionEnd(end);
  }, []);

  // Format timestamp for display
  const formatTimestamp = (timestamp?: WordTimestamp) => {
    if (!timestamp) return '';
    const minutes = Math.floor(timestamp.startTime / 60);
    const seconds = Math.floor(timestamp.startTime % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Handle word tap (for timestamp navigation)
  const handleWordTap = useCallback((timestamp?: WordTimestamp) => {
    if (timestamp && showTimestamps) {
      Alert.alert(
        'Word Timestamp',
        `Time: ${formatTimestamp(timestamp)}\nConfidence: ${Math.round((timestamp.confidence || 0) * 100)}%`,
        [{ text: 'OK' }]
      );
    }
  }, [showTimestamps]);

  // Render word with confidence highlighting
  const renderWord = useCallback((wordData: any, index: number) => {
    if (!wordData.isWord) {
      return <Text key={index} style={styles.whitespace}>{wordData.text}</Text>;
    }

    const confidenceColor = showConfidence ? getConfidenceColor(wordData.confidence) : colors.text;
    const hasTimestamp = showTimestamps && wordData.timestamp;

    return (
      <TouchableOpacity
        key={index}
        onPress={() => handleWordTap(wordData.timestamp)}
        disabled={!hasTimestamp}
        activeOpacity={hasTimestamp ? 0.7 : 1}
      >
        <Text
          style={[
            styles.word,
            {
              color: confidenceColor,
              textDecorationLine: hasTimestamp ? 'underline' : 'none',
            },
          ]}
        >
          {wordData.text}
        </Text>
      </TouchableOpacity>
    );
  }, [showConfidence, showTimestamps, colors.text, getConfidenceColor, handleWordTap]);

  // Render confidence legend
  const renderConfidenceLegend = () => {
    if (!showConfidence) return null;

    return (
      <View style={[styles.legend, { backgroundColor: colors.surface }]}>
        <Text style={[styles.legendTitle, { color: colors.text }]}>Confidence:</Text>
        <View style={styles.legendItems}>
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: colors.confidence.high }]} />
            <Text style={[styles.legendText, { color: colors.textSecondary }]}>High (80%+)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: colors.confidence.medium }]} />
            <Text style={[styles.legendText, { color: colors.textSecondary }]}>Medium (60-80%)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: colors.confidence.low }]} />
            <Text style={[styles.legendText, { color: colors.textSecondary }]}>Low (<60%)</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Toolbar */}
      <View style={[styles.toolbar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.toolbarLeft}>
          <TouchableOpacity
            style={[styles.toolbarButton, { opacity: historyIndex >= 0 ? 1 : 0.5 }]}
            onPress={handleUndo}
            disabled={historyIndex < 0 || readOnly}
          >
            <Ionicons name="arrow-undo" size={20} color={colors.text} />
            <Text style={[styles.toolbarButtonText, { color: colors.text }]}>Undo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolbarButton, { opacity: historyIndex < editHistory.length - 1 ? 1 : 0.5 }]}
            onPress={handleRedo}
            disabled={historyIndex >= editHistory.length - 1 || readOnly}
          >
            <Ionicons name="arrow-redo" size={20} color={colors.text} />
            <Text style={[styles.toolbarButtonText, { color: colors.text }]}>Redo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.toolbarRight}>
          <Text style={[styles.wordCount, { color: colors.textSecondary }]}>
            {currentText.split(/\s+/).filter(word => word.trim()).length} words
          </Text>
        </View>
      </View>

      {/* Editor Content */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {readOnly ? (
          // Read-only view with confidence highlighting
          <View style={styles.readOnlyContainer}>
            <View style={styles.textContainer}>
              {parseTextWithMetadata.map((wordData, index) => renderWord(wordData, index))}
            </View>
          </View>
        ) : (
          // Editable text input
          <TextInput
            ref={textInputRef}
            style={[
              styles.textInput,
              {
                color: colors.text,
                fontSize: settings.fontSize === 'small' ? 14 : 
                         settings.fontSize === 'large' ? 20 : 
                         settings.fontSize === 'extra-large' ? 24 : 16,
              },
            ]}
            value={currentText}
            onChangeText={handleTextChange}
            onSelectionChange={handleSelectionChange}
            multiline
            placeholder="Start typing or paste your transcription here..."
            placeholderTextColor={colors.textSecondary}
            textAlignVertical="top"
            scrollEnabled={false}
          />
        )}

        {/* Confidence Legend */}
        {renderConfidenceLegend()}
      </ScrollView>

      {/* Status Bar */}
      <View style={[styles.statusBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <Text style={[styles.statusText, { color: colors.textSecondary }]}>
          {isEditing ? 'Modified' : 'Saved'} • {editHistory.length} edits
        </Text>
        
        {showTimestamps && (
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            Tap words to see timestamps
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  toolbarButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  wordCount: {
    fontSize: 12,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  textInput: {
    minHeight: 200,
    textAlignVertical: 'top',
    lineHeight: 24,
  },
  readOnlyContainer: {
    minHeight: 200,
  },
  textContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    lineHeight: 24,
  },
  word: {
    fontSize: 16,
    lineHeight: 24,
  },
  whitespace: {
    fontSize: 16,
    lineHeight: 24,
  },
  legend: {
    marginTop: 20,
    padding: 12,
    borderRadius: 8,
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  legendItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 12,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  statusText: {
    fontSize: 12,
  },
});