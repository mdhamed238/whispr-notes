/**
 * Optimized Recording Screen
 * Enhanced version of the main recording interface with performance optimizations
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Dimensions,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';
import { useSpeechToText, WHISPER_TINY_EN } from 'react-native-executorch';
import { SafeAreaView } from 'react-native-safe-area-context';

// Enhanced components
import AudioVisualizer from './AudioVisualizer';
import RecordingControls from './RecordingControls';

// Hooks and services
import { usePerformance } from '../../contexts/PerformanceContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useOptimizedCallback } from '../../hooks/useOptimizedCallback';
import { usePerformanceOptimization } from '../../hooks/usePerformanceOptimization';
import { enhancedAudioService } from '../../services/enhanced/audioService';
import { cacheService } from '../../services/enhanced/cacheService';
import { memoryService } from '../../services/enhanced/memoryService';

// Types
import storageService from '../../services/storageService';
import { AudioQualityMetrics, EnhancedTranscriptionItem } from '../../types';

const { width } = Dimensions.get('window');

// Memoized components for better performance
const MemoizedAudioVisualizer = React.memo(AudioVisualizer);
const MemoizedRecordingControls = React.memo(RecordingControls);

export default function OptimizedRecordingScreen() {
  // Performance monitoring
  const { metrics, forceOptimization } = usePerformanceOptimization({
    componentName: 'OptimizedRecordingScreen',
    measureRender: true,
    trackMemory: true,
    autoOptimize: true,
  });

  // Contexts
  const { settings } = useSettings();
  const { startMeasurement, endMeasurement } = usePerformance();

  // Audio recorder state
  const [recorder] = useState(() => new AudioRecorder({
    sampleRate: 16000,
    bufferLengthInSamples: 1600,
  }));

  // Speech model
  const model = useSpeechToText({
    model: WHISPER_TINY_EN,
  });

  // Component state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioData, setAudioData] = useState<Float32Array>(new Float32Array());
  const [audioQuality, setAudioQuality] = useState<AudioQualityMetrics>({
    signalToNoiseRatio: 0,
    clarity: 0,
    volume: 0,
    backgroundNoise: 0,
    overallScore: 0,
  });

  // Timer for duration tracking
  const [startTime, setStartTime] = useState<number | null>(null);

  // Initialize audio service
  useEffect(() => {
    const initializeAudio = async () => {
      try {
        await enhancedAudioService.initialize();
        await AudioManager.setAudioSessionOptions({
          iosCategory: 'playAndRecord',
          iosMode: 'spokenAudio',
          iosOptions: ['allowBluetooth', 'defaultToSpeaker'],
        });
        await AudioManager.requestRecordingPermissions();
      } catch (error) {
        console.error('Failed to initialize audio:', error);
      }
    };

    initializeAudio();
  }, []);

  // Duration timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isRecording && !isPaused && startTime) {
      interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isPaused, startTime]);

  // Audio buffer processing
  useEffect(() => {
    if (!recorder) return;

    const handleAudioReady = ({ buffer }: { buffer: AudioBuffer }) => {
      try {
        const bufferArray = Array.from(buffer.getChannelData(0));
        const float32Array = new Float32Array(bufferArray);
        
        // Cache audio data for visualization
        setAudioData(float32Array);
        
        // Process for transcription if recording
        if (isRecording && !isPaused) {
          model.streamInsert(bufferArray);
        }
      } catch (error) {
        console.error('Audio buffer processing error:', error);
      }
    };

    recorder.onAudioReady(handleAudioReady);
  }, [recorder, model, isRecording, isPaused]);

  // Memory cleanup effect
  useEffect(() => {
    const cleanup = () => {
      // Clean up audio buffers
      memoryService.cleanupAudioBuffers([audioData]);
    };

    // Register cleanup task
    const unregisterCleanup = memoryService.registerCleanupTask(cleanup);

    return () => {
      unregisterCleanup();
      cleanup();
    };
  }, [audioData]);

  // Optimized event handlers
  const handleStartRecording = useOptimizedCallback(async () => {
    const measurementId = startMeasurement('start_recording');
    
    try {
      // Set up audio buffer processing
      recorder.onAudioReady(async ({ buffer }) => {
        try {
          const bufferArray = Array.from(buffer.getChannelData(0));
          model.streamInsert(bufferArray);
          
          // Update audio visualization data
          setAudioData(new Float32Array(bufferArray));
        } catch (error) {
          console.error('Audio buffer processing error:', error);
        }
      });

      // Start recording
      recorder.start();
      
      // Start streaming transcription
      await model.stream();
      
      // Update state
      setIsRecording(true);
      setIsPaused(false);
      setStartTime(Date.now());
      setDuration(0);

    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    } finally {
      endMeasurement(measurementId);
    }
  }, [recorder, model, startMeasurement, endMeasurement], {
    debounce: 300, // Prevent rapid taps
  });

  const handlePauseRecording = useOptimizedCallback(async () => {
    try {
      await enhancedAudioService.pauseRecording();
      setIsPaused(true);
    } catch (error) {
      console.error('Failed to pause recording:', error);
    }
  }, []);

  const handleResumeRecording = useOptimizedCallback(async () => {
    try {
      await enhancedAudioService.resumeRecording();
      setIsPaused(false);
      setStartTime(Date.now() - duration * 1000); // Adjust start time
    } catch (error) {
      console.error('Failed to resume recording:', error);
    }
  }, [duration]);

  const handleStopRecording = useOptimizedCallback(async () => {
    const measurementId = startMeasurement('stop_recording');
    
    try {
      recorder.stop();
      model.streamStop();
      
      setIsRecording(false);
      setIsPaused(false);
      setStartTime(null);
      
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      endMeasurement(measurementId);
    }
  }, [recorder, model, startMeasurement, endMeasurement]);

  const handleSaveTranscription = useOptimizedCallback(async () => {
    const measurementId = startMeasurement('save_transcription');
    
    try {
      if (!model.committedTranscription) {
        Alert.alert('No Transcription', 'Nothing to save. Try recording some speech first.');
        return;
      }

      const transcriptionItem: EnhancedTranscriptionItem = {
        id: Date.now().toString(),
        audioUri: 'streaming_recording',
        transcription: model.committedTranscription,
        duration,
        createdAt: new Date(),
        isProcessing: false,
        confidence: 0.85, // Mock confidence
        tags: [],
        category: 'memo',
        editHistory: [],
        audioQuality,
        processingTime: 0,
        wordTimestamps: [],
        speakerSegments: [],
        customMetadata: {},
        exportHistory: [],
        searchableText: model.committedTranscription.toLowerCase(),
      };

      // Cache the transcription
      cacheService.cacheTranscription(transcriptionItem.id, transcriptionItem);
      
      // Save to storage
      await storageService.saveTranscription(transcriptionItem);
      
      Alert.alert('Saved!', 'Transcription saved successfully.');
      
      // Reset state
      setDuration(0);
      
    } catch (error) {
      console.error('Failed to save transcription:', error);
      Alert.alert('Error', 'Failed to save transcription');
    } finally {
      endMeasurement(measurementId);
    }
  }, [model.committedTranscription, duration, audioQuality, startMeasurement, endMeasurement]);

  // Memoized theme colors
  const themeColors = useMemo(() => {
    const isDark = settings.theme === 'dark';
    return {
      background: isDark ? '#000000' : '#ffffff',
      text: isDark ? '#ffffff' : '#333333',
      textSecondary: isDark ? '#b0b0b0' : '#666666',
    };
  }, [settings.theme]);

  // Memoized transcription display
  const transcriptionDisplay = useMemo(() => {
    if (model.committedTranscription || model.nonCommittedTranscription) {
      return (
        <Text style={[styles.transcriptionText, { color: themeColors.text }]}>
          <Text style={styles.committedText}>
            {model.committedTranscription}
          </Text>
          {model.nonCommittedTranscription && (
            <Text style={styles.nonCommittedText}>
              {' '}{model.nonCommittedTranscription}
            </Text>
          )}
        </Text>
      );
    }

    return (
      <Text style={[styles.waitingText, { color: themeColors.textSecondary }]}>
        {isRecording 
          ? 'Speak now...' 
          : 'Tap the microphone to start recording'
        }
      </Text>
    );
  }, [
    model.committedTranscription,
    model.nonCommittedTranscription,
    isRecording,
    themeColors.text,
    themeColors.textSecondary
  ]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar barStyle={settings.theme === 'dark' ? 'light-content' : 'dark-content'} />
      
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: themeColors.text }]}>
            Audio Transcription
          </Text>
          <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
            {model.isReady 
              ? 'Ready to transcribe' 
              : model.downloadProgress > 0 
                ? `Downloading model... ${Math.round(model.downloadProgress * 100)}%`
                : 'Loading AI model...'
            }
          </Text>
        </View>

        {/* Model Loading State */}
        {!model.isReady ? (
          <View style={styles.loadingContainer}>
            <Text style={[styles.loadingText, { color: themeColors.text }]}>
              Loading Whisper model...
            </Text>
            <Text style={[styles.progressText, { color: '#007AFF' }]}>
              {Math.round(model.downloadProgress * 100)}%
            </Text>
            <View style={styles.progressBar}>
              <View 
                style={[styles.progressFill, { width: `${model.downloadProgress * 100}%` }]} 
              />
            </View>
          </View>
        ) : (
          <>
            {/* Audio Visualizer */}
            <MemoizedAudioVisualizer
              audioData={audioData}
              isRecording={isRecording}
              sensitivity={1.0}
              theme={settings.theme}
              showLevels={true}
              height={120}
              width={width - 40}
            />

            {/* Recording Controls */}
            <MemoizedRecordingControls
              onStart={handleStartRecording}
              onPause={handlePauseRecording}
              onResume={handleResumeRecording}
              onStop={handleStopRecording}
              onSave={handleSaveTranscription}
              isRecording={isRecording}
              isPaused={isPaused}
              duration={duration}
              quality={audioQuality}
            />

            {/* Transcription Display */}
            <View style={styles.transcriptionContainer}>
              <Text style={[styles.transcriptionLabel, { color: themeColors.text }]}>
                {isRecording ? 'Listening...' : 'Transcription:'}
              </Text>
              
              <View style={styles.transcriptionTextContainer}>
                {transcriptionDisplay}
              </View>
            </View>

            {/* Performance Metrics (Development only) */}
            {__DEV__ && (
              <View style={styles.debugContainer}>
                <Text style={[styles.debugText, { color: themeColors.textSecondary }]}>
                  Render: {metrics.renderTime.toFixed(1)}ms | 
                  Memory: {metrics.memoryUsage.toFixed(1)}MB | 
                  FPS: {metrics.frameRate}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },
  progressText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  progressBar: {
    width: width * 0.8,
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  transcriptionContainer: {
    backgroundColor: 'transparent',
    padding: 20,
    borderRadius: 12,
    flex: 1,
    marginTop: 20,
  },
  transcriptionLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 15,
    textAlign: 'center',
  },
  transcriptionTextContainer: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 100,
  },
  transcriptionText: {
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
  },
  committedText: {
    fontWeight: '600',
  },
  nonCommittedText: {
    fontStyle: 'italic',
    opacity: 0.7,
  },
  waitingText: {
    fontSize: 16,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  debugContainer: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.1)',
    padding: 8,
    borderRadius: 4,
  },
  debugText: {
    fontSize: 10,
    textAlign: 'center',
  },
});