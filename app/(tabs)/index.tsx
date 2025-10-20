/**
 * Record Screen
 * Main recording interface with audio recording, playback, and transcription
 * Updated to use react-native-executorch for on-device AI transcription
 */

import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '@/constants/config';
import audioService from '@/services/audioService';
import storageService from '@/services/storageService';
import transcriptionService, { setGlobalModelInstance } from '@/services/transcriptionService';
import { TranscriptionItem, TranscriptionProgress } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSpeechToText, WHISPER_TINY_EN } from 'react-native-executorch';
import { SafeAreaView } from 'react-native-safe-area-context';


const { width } = Dimensions.get('window');

export default function RecordScreen() {
  // Initialize the speech-to-text model
  const speechModel = useSpeechToText({
    model: WHISPER_TINY_EN,
  });

  // Set the global model instance for the transcription service
  useEffect(() => {
    setGlobalModelInstance(speechModel);
  }, [speechModel]);

  // State management
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [currentAudioUri, setCurrentAudioUri] = useState<string | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState<string>('');
  const [transcriptionProgress, setTranscriptionProgress] = useState<TranscriptionProgress | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);

  // Refs
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Update model availability when speech model changes
    setModelAvailable(speechModel.isReady);
    
    return () => {
      // Cleanup on unmount
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      audioService.cleanup();
    };
  }, [speechModel.isReady]);

  useEffect(() => {
    // Update recording duration during recording
    if (isRecording) {
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }

    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, [isRecording]);

  /**
   * Format duration in MM:SS format
   */
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  /**
   * Handle record button press
   */
  const handleRecordPress = async () => {
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (error) {
      console.error('Record button error:', error);
      Alert.alert('Error', ERROR_MESSAGES.RECORDING_FAILED);
    }
  };

  /**
   * Start audio recording
   */
  const startRecording = async () => {
    try {
      await audioService.startRecording();
      setIsRecording(true);
      setRecordingDuration(0);
      setCurrentAudioUri(null);
      setTranscriptionResult('');
      
      // Haptic feedback
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      console.log(SUCCESS_MESSAGES.RECORDING_STARTED);
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Permission Required', ERROR_MESSAGES.MICROPHONE_PERMISSION_DENIED);
    }
  };

  /**
   * Stop audio recording
   */
  const stopRecording = async () => {
    try {
      const audioUri = await audioService.stopRecording();
      setIsRecording(false);
      setCurrentAudioUri(audioUri);
      
      // Haptic feedback
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      console.log(SUCCESS_MESSAGES.RECORDING_STOPPED);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setIsRecording(false);
      Alert.alert('Error', ERROR_MESSAGES.RECORDING_FAILED);
    }
  };

  /**
   * Handle play button press
   */
  const handlePlayPress = async () => {
    try {
      if (!currentAudioUri) return;

      if (isPlaying) {
        await audioService.pauseAudio();
        setIsPlaying(false);
      } else {
        await audioService.playAudio(currentAudioUri);
        setIsPlaying(true);
        
        // Auto-stop after duration
        setTimeout(() => {
          setIsPlaying(false);
        }, 2000); // Simulated duration
      }
    } catch (error) {
      console.error('Playback error:', error);
      Alert.alert('Error', 'Failed to play audio');
    }
  };

  /**
   * Handle transcribe button press
   */
  const handleTranscribePress = async () => {
    try {
      if (!currentAudioUri) {
        Alert.alert('Error', 'No audio to transcribe');
        return;
      }

      if (!modelAvailable) {
        Alert.alert(
          'Model Not Available',
          'The AI model needs to be downloaded first. Please go to Settings to download it.',
          [{ text: 'OK' }]
        );
        return;
      }

      setIsTranscribing(true);
      setTranscriptionProgress(null);

      // Show progress updates
      const progressInterval = setInterval(() => {
        const progress = transcriptionService.getProgress();
        if (progress) {
          setTranscriptionProgress(progress);
        }
      }, 100);

      try {
        const transcription = await transcriptionService.transcribe(currentAudioUri);
        setTranscriptionResult(transcription);
        
        // Haptic feedback for completion
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        console.log(SUCCESS_MESSAGES.TRANSCRIPTION_COMPLETE);
      } catch (error) {
        console.error('Transcription failed:', error);
        Alert.alert('Transcription Failed', ERROR_MESSAGES.TRANSCRIPTION_FAILED);
      } finally {
        clearInterval(progressInterval);
        setIsTranscribing(false);
        setTranscriptionProgress(null);
      }
    } catch (error) {
      console.error('Transcribe button error:', error);
      setIsTranscribing(false);
    }
  };

  /**
   * Handle save transcription
   */
  const handleSaveTranscription = async () => {
    try {
      if (!currentAudioUri || !transcriptionResult) {
        Alert.alert('Error', 'No transcription to save');
        return;
      }

      const transcriptionItem: TranscriptionItem = {
        id: Date.now().toString(),
        audioUri: currentAudioUri,
        transcription: transcriptionResult,
        duration: recordingDuration,
        createdAt: new Date(),
        isProcessing: false,
      };

      await storageService.saveTranscription(transcriptionItem);
      
      // Haptic feedback
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      Alert.alert('Success', SUCCESS_MESSAGES.TRANSCRIPTION_SAVED);
      
      // Reset state
      setCurrentAudioUri(null);
      setTranscriptionResult('');
      setRecordingDuration(0);
      
    } catch (error) {
      console.error('Failed to save transcription:', error);
      Alert.alert('Error', 'Failed to save transcription');
    }
  };

  /**
   * Handle reset button press
   */
  const handleResetPress = async () => {
    try {
      setCurrentAudioUri(null);
      setTranscriptionResult('');
      setRecordingDuration(0);
      setIsPlaying(false);
      
      await audioService.cleanup();
    } catch (error) {
      console.error('Reset error:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Audio Transcription</Text>
          <Text style={styles.subtitle}>
            {speechModel.isReady 
              ? 'Ready to transcribe' 
              : speechModel.downloadProgress > 0 
                ? `Downloading model... ${Math.round(speechModel.downloadProgress * 100)}%`
                : 'Loading AI model...'
            }
          </Text>
        </View>

        {/* Recording Status */}
        <View style={styles.statusContainer}>
          {isRecording && (
            <View style={styles.recordingStatus}>
              <View style={styles.recordingIndicator} />
              <Text style={styles.recordingText}>Recording...</Text>
            </View>
          )}
          
          {recordingDuration > 0 && (
            <Text style={styles.durationText}>
              {formatDuration(recordingDuration)}
            </Text>
          )}
        </View>

        {/* Main Record Button */}
        <View style={styles.recordButtonContainer}>
          <TouchableOpacity
            style={[
              styles.recordButton,
              isRecording && styles.recordButtonRecording
            ]}
            onPress={handleRecordPress}
            disabled={isTranscribing}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isRecording ? 'stop' : 'mic'}
              size={60}
              color={isRecording ? '#fff' : '#ff4444'}
            />
          </TouchableOpacity>
        </View>

        {/* Controls */}
        {currentAudioUri && !isRecording && (
          <View style={styles.controlsContainer}>
            {/* Play Button */}
            <TouchableOpacity
              style={styles.controlButton}
              onPress={handlePlayPress}
              disabled={isTranscribing}
            >
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={30}
                color="#007AFF"
              />
              <Text style={styles.controlButtonText}>
                {isPlaying ? 'Pause' : 'Play'}
              </Text>
            </TouchableOpacity>

            {/* Transcribe Button */}
            <TouchableOpacity
              style={[
                styles.controlButton,
                styles.transcribeButton,
                (!modelAvailable || isTranscribing) && styles.controlButtonDisabled
              ]}
              onPress={handleTranscribePress}
              disabled={!modelAvailable || isTranscribing}
            >
              <Ionicons
                name="text"
                size={30}
                color={modelAvailable && !isTranscribing ? "#fff" : "#ccc"}
              />
              <Text style={[
                styles.controlButtonText,
                styles.transcribeButtonText,
                (!modelAvailable || isTranscribing) && styles.controlButtonTextDisabled
              ]}>
                Transcribe
              </Text>
            </TouchableOpacity>

            {/* Reset Button */}
            <TouchableOpacity
              style={styles.controlButton}
              onPress={handleResetPress}
              disabled={isTranscribing}
            >
              <Ionicons
                name="refresh"
                size={30}
                color="#666"
              />
              <Text style={styles.controlButtonText}>Reset</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Transcription Progress */}
        {isTranscribing && transcriptionProgress && (
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>
              {transcriptionProgress.message}
            </Text>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${transcriptionProgress.progress}%` }
                ]} 
              />
            </View>
            <Text style={styles.progressPercentage}>
              {Math.round(transcriptionProgress.progress)}%
            </Text>
          </View>
        )}

        {/* Transcription Result */}
        {transcriptionResult && (
          <View style={styles.transcriptionContainer}>
            <Text style={styles.transcriptionLabel}>Transcription:</Text>
            <Text style={styles.transcriptionText}>{transcriptionResult}</Text>
            
            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSaveTranscription}
            >
              <Ionicons name="save" size={20} color="#fff" />
              <Text style={styles.saveButtonText}>Save Transcription</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  recordingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  recordingIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ff4444',
    marginRight: 8,
  },
  recordingText: {
    fontSize: 16,
    color: '#ff4444',
    fontWeight: '600',
  },
  durationText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  recordButtonContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  recordButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: '#ff4444',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  recordButtonRecording: {
    backgroundColor: '#ff4444',
    borderColor: '#ff4444',
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 30,
  },
  controlButton: {
    alignItems: 'center',
    padding: 15,
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
    minWidth: 80,
  },
  transcribeButton: {
    backgroundColor: '#007AFF',
  },
  controlButtonDisabled: {
    backgroundColor: '#f0f0f0',
  },
  controlButtonText: {
    fontSize: 12,
    color: '#333',
    marginTop: 5,
    fontWeight: '600',
  },
  transcribeButtonText: {
    color: '#fff',
  },
  controlButtonTextDisabled: {
    color: '#ccc',
  },
  progressContainer: {
    backgroundColor: '#f8f9fa',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
  },
  progressText: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    marginBottom: 10,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  progressPercentage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  transcriptionContainer: {
    backgroundColor: '#f8f9fa',
    padding: 20,
    borderRadius: 12,
  },
  transcriptionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  transcriptionText: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24,
    marginBottom: 20,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#28a745',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});