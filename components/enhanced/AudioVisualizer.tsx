/**
 * AudioVisualizer Component
 * Real-time waveform visualization and audio level meters
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import { useSettings } from '../../contexts/SettingsContext';
import { AudioVisualizerProps } from '../../types';

const { width: screenWidth } = Dimensions.get('window');

export default function AudioVisualizer({
  audioData,
  isRecording,
  sensitivity = 1.0,
  theme = 'auto',
  showLevels = true,
  height = 120,
  width = screenWidth - 40,
}: AudioVisualizerProps) {
  const { settings } = useSettings();
  const animatedValues = useRef<Animated.Value[]>([]);
  const [audioLevels, setAudioLevels] = useState<number[]>([]);
  const [peakLevel, setPeakLevel] = useState(0);
  const [averageLevel, setAverageLevel] = useState(0);

  // Number of bars for visualization
  const barCount = Math.floor(width / 8); // 8px per bar including spacing

  // Initialize animated values
  useEffect(() => {
    animatedValues.current = Array.from({ length: barCount }, () => new Animated.Value(0));
  }, [barCount]);

  // Process audio data and update visualization
  useEffect(() => {
    if (!audioData || audioData.length === 0) {
      // Reset visualization when no audio data
      animatedValues.current.forEach(animValue => {
        Animated.timing(animValue, {
          toValue: 0,
          duration: 100,
          useNativeDriver: false,
        }).start();
      });
      setAudioLevels([]);
      setPeakLevel(0);
      setAverageLevel(0);
      return;
    }

    // Process audio data into frequency bins
    const processedLevels = processAudioData(audioData, barCount, sensitivity);
    setAudioLevels(processedLevels);

    // Calculate peak and average levels
    const peak = Math.max(...processedLevels);
    const average = processedLevels.reduce((sum, level) => sum + level, 0) / processedLevels.length;
    
    setPeakLevel(peak);
    setAverageLevel(average);

    // Animate bars
    processedLevels.forEach((level, index) => {
      if (animatedValues.current[index]) {
        Animated.timing(animatedValues.current[index], {
          toValue: level * height * 0.8, // Scale to 80% of container height
          duration: isRecording ? 50 : 200, // Faster animation when recording
          useNativeDriver: false,
        }).start();
      }
    });
  }, [audioData, barCount, sensitivity, height, isRecording]);

  // Get theme colors
  const getThemeColors = () => {
    const isDark = theme === 'dark' || (theme === 'auto' && settings.theme === 'dark');
    
    return {
      background: isDark ? '#1a1a1a' : '#f8f9fa',
      barColor: isDark ? '#4CAF50' : '#2196F3',
      barColorActive: isDark ? '#66BB6A' : '#1976D2',
      peakColor: '#FF5722',
      textColor: isDark ? '#ffffff' : '#333333',
      levelMeterBg: isDark ? '#333333' : '#e0e0e0',
    };
  };

  const colors = getThemeColors();

  return (
    <View style={[styles.container, { height, backgroundColor: colors.background }]}>
      {/* Waveform Visualization */}
      <View style={[styles.waveformContainer, { width }]}>
        <View style={styles.barsContainer}>
          {animatedValues.current.map((animValue, index) => (
            <Animated.View
              key={index}
              style={[
                styles.bar,
                {
                  height: animValue,
                  backgroundColor: audioLevels[index] > 0.7 ? colors.peakColor : 
                                 audioLevels[index] > 0.4 ? colors.barColorActive : 
                                 colors.barColor,
                },
              ]}
            />
          ))}
        </View>

        {/* Center line for reference */}
        <View style={[styles.centerLine, { backgroundColor: colors.textColor + '30' }]} />
      </View>

      {/* Audio Level Meters */}
      {showLevels && (
        <View style={styles.levelsContainer}>
          {/* Peak Level Meter */}
          <View style={styles.levelMeter}>
            <View style={[styles.levelMeterBg, { backgroundColor: colors.levelMeterBg }]}>
              <Animated.View
                style={[
                  styles.levelMeterFill,
                  {
                    width: `${peakLevel * 100}%`,
                    backgroundColor: peakLevel > 0.8 ? colors.peakColor : colors.barColor,
                  },
                ]}
              />
            </View>
          </View>

          {/* Average Level Meter */}
          <View style={styles.levelMeter}>
            <View style={[styles.levelMeterBg, { backgroundColor: colors.levelMeterBg }]}>
              <Animated.View
                style={[
                  styles.levelMeterFill,
                  {
                    width: `${averageLevel * 100}%`,
                    backgroundColor: colors.barColorActive,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      )}

      {/* Recording Indicator */}
      {isRecording && (
        <View style={styles.recordingIndicator}>
          <PulsingDot color={colors.peakColor} />
        </View>
      )}
    </View>
  );
}

/**
 * Process raw audio data into visualization levels
 */
function processAudioData(audioData: Float32Array, barCount: number, sensitivity: number): number[] {
  const levels: number[] = [];
  const samplesPerBar = Math.floor(audioData.length / barCount);

  for (let i = 0; i < barCount; i++) {
    const startIndex = i * samplesPerBar;
    const endIndex = Math.min(startIndex + samplesPerBar, audioData.length);
    
    // Calculate RMS (Root Mean Square) for this segment
    let sum = 0;
    for (let j = startIndex; j < endIndex; j++) {
      sum += audioData[j] * audioData[j];
    }
    
    const rms = Math.sqrt(sum / (endIndex - startIndex));
    
    // Apply sensitivity and normalize to 0-1 range
    const level = Math.min(rms * sensitivity * 10, 1.0);
    levels.push(level);
  }

  return levels;
}

/**
 * Pulsing dot component for recording indicator
 */
function PulsingDot({ color }: { color: string }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = () => {
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.3,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start(() => pulse());
    };

    pulse();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.pulsingDot,
        {
          backgroundColor: color,
          transform: [{ scale: pulseAnim }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  waveformContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  bar: {
    width: 4,
    marginHorizontal: 2,
    borderRadius: 2,
    minHeight: 2,
  },
  centerLine: {
    position: 'absolute',
    width: '100%',
    height: 1,
    top: '50%',
  },
  levelsContainer: {
    marginTop: 12,
    gap: 6,
  },
  levelMeter: {
    height: 4,
    width: '100%',
  },
  levelMeterBg: {
    height: '100%',
    borderRadius: 2,
    overflow: 'hidden',
  },
  levelMeterFill: {
    height: '100%',
    borderRadius: 2,
  },
  recordingIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  pulsingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});