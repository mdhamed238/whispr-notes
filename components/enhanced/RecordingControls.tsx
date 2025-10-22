/**
 * Enhanced Recording Controls Component
 * Provides advanced recording functionality with pause/resume, quality indicators, and session management
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePerformance } from '../../contexts/PerformanceContext';
import { useSettings } from '../../contexts/SettingsContext';
import { AudioQualityMetrics, RecordingControlsProps } from '../../types';

export default function RecordingControls({
  onStart,
  onPause,
  onResume,
  onStop,
  onSave,
  isRecording,
  isPaused,
  duration,
  quality,
}: RecordingControlsProps) {
  const { settings } = useSettings();
  const { startMeasurement, endMeasurement } = usePerformance();
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [lapTimes, setLapTimes] = useState<number[]>([]);

  // Format duration for display
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get quality indicator color and text
  const getQualityIndicator = (quality: AudioQualityMetrics) => {
    const overallScore = quality.overallScore || 0;
    
    if (overallScore >= 0.8) {
      return { color: '#4CAF50', text: 'Excellent', icon: 'checkmark-circle' as const };
    } else if (overallScore >= 0.6) {
      return { color: '#FF9800', text: 'Good', icon: 'warning' as const };
    } else if (overallScore >= 0.4) {
      return { color: '#FF5722', text: 'Poor', icon: 'alert-circle' as const };
    } else {
      return { color: '#F44336', text: 'Very Poor', icon: 'close-circle' as const };
    }
  };

  // Handle start recording
  const handleStart = async () => {
    try {
      if (settings.hapticFeedback) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      
      const measurementId = startMeasurement('recording_session');
      setSessionStartTime(Date.now());
      setLapTimes([]);
      
      onStart();
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  // Handle pause recording
  const handlePause = async () => {
    try {
      if (settings.hapticFeedback) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      
      onPause();
    } catch (error) {
      console.error('Failed to pause recording:', error);
    }
  };

  // Handle resume recording
  const handleResume = async () => {
    try {
      if (settings.hapticFeedback) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      
      onResume();
    } catch (error) {
      console.error('Failed to resume recording:', error);
    }
  };

  // Handle stop recording
  const handleStop = async () => {
    try {
      if (settings.hapticFeedback) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
      
      if (sessionStartTime) {
        endMeasurement('recording_session');
      }
      
      onStop();
    } catch (error) {
      console.error('Failed to stop recording:', error);
    }
  };

  // Handle save recording
  const handleSave = async () => {
    try {
      if (settings.hapticFeedback) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      
      onSave();
    } catch (error) {
      console.error('Failed to save recording:', error);
      Alert.alert('Error', 'Failed to save recording. Please try again.');
    }
  };

  // Handle lap time (for session management)
  const handleLap = () => {
    if (isRecording && !isPaused) {
      setLapTimes(prev => [...prev, duration]);
      if (settings.hapticFeedback) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  };

  // Get theme colors
  const getThemeColors = () => {
    const isDark = settings.theme === 'dark';
    
    return {
      background: isDark ? '#1a1a1a' : '#ffffff',
      surface: isDark ? '#2d2d2d' : '#f8f9fa',
      primary: '#2196F3',
      secondary: '#FF5722',
      success: '#4CAF50',
      warning: '#FF9800',
      text: isDark ? '#ffffff' : '#333333',
      textSecondary: isDark ? '#b0b0b0' : '#666666',
      border: isDark ? '#404040' : '#e0e0e0',
    };
  };

  const colors = getThemeColors();
  const qualityIndicator = getQualityIndicator(quality);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Session Timer and Quality Indicator */}
      <View style={[styles.statusBar, { backgroundColor: colors.surface }]}>
        <View style={styles.timerContainer}>
          <Text style={[styles.timerText, { color: colors.text }]}>
            {formatDuration(duration)}
          </Text>
          {lapTimes.length > 0 && (
            <Text style={[styles.lapCount, { color: colors.textSecondary }]}>
              Laps: {lapTimes.length}
            </Text>
          )}
        </View>

        <View style={styles.qualityContainer}>
          <Ionicons
            name={qualityIndicator.icon}
            size={16}
            color={qualityIndicator.color}
          />
          <Text style={[styles.qualityText, { color: qualityIndicator.color }]}>
            {qualityIndicator.text}
          </Text>
        </View>
      </View>

      {/* Main Recording Controls */}
      <View style={styles.controlsContainer}>
        {/* Primary Record/Stop Button */}
        <TouchableOpacity
          style={[
            styles.primaryButton,
            {
              backgroundColor: isRecording ? colors.secondary : colors.primary,
              borderColor: isRecording ? colors.secondary : colors.primary,
            },
          ]}
          onPress={isRecording ? handleStop : handleStart}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isRecording ? 'stop' : 'mic'}
            size={32}
            color="#ffffff"
          />
        </TouchableOpacity>

        {/* Secondary Controls */}
        <View style={styles.secondaryControls}>
          {/* Pause/Resume Button */}
          {isRecording && (
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={isPaused ? handleResume : handlePause}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isPaused ? 'play' : 'pause'}
                size={20}
                color={colors.text}
              />
            </TouchableOpacity>
          )}

          {/* Lap Button */}
          {isRecording && !isPaused && (
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={handleLap}
              activeOpacity={0.8}
            >
              <Ionicons
                name="flag"
                size={20}
                color={colors.text}
              />
            </TouchableOpacity>
          )}

          {/* Save Button */}
          {!isRecording && duration > 0 && (
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: colors.success, borderColor: colors.success }]}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              <Ionicons
                name="save"
                size={20}
                color="#ffffff"
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Status Text */}
      <View style={styles.statusContainer}>
        <Text style={[styles.statusText, { color: colors.textSecondary }]}>
          {isRecording
            ? isPaused
              ? 'Recording paused - tap resume to continue'
              : 'Recording in progress - speak clearly'
            : duration > 0
            ? 'Recording complete - tap save to keep'
            : 'Tap the microphone to start recording'
          }
        </Text>
      </View>

      {/* Lap Times Display */}
      {lapTimes.length > 0 && (
        <View style={[styles.lapTimesContainer, { backgroundColor: colors.surface }]}>
          <Text style={[styles.lapTimesTitle, { color: colors.text }]}>Lap Times:</Text>
          <View style={styles.lapTimesList}>
            {lapTimes.map((lapTime, index) => (
              <Text key={index} style={[styles.lapTimeText, { color: colors.textSecondary }]}>
                {index + 1}: {formatDuration(lapTime)}
              </Text>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    borderRadius: 16,
    gap: 16,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
  },
  timerContainer: {
    alignItems: 'flex-start',
  },
  timerText: {
    fontSize: 24,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  lapCount: {
    fontSize: 12,
    marginTop: 2,
  },
  qualityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  qualityText: {
    fontSize: 14,
    fontWeight: '600',
  },
  controlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  primaryButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  secondaryControls: {
    flexDirection: 'column',
    gap: 12,
  },
  secondaryButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  statusContainer: {
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  lapTimesContainer: {
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  lapTimesTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  lapTimesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  lapTimeText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});