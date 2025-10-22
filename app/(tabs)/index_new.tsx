/**
 * Record Screen
 * Simplified streaming transcription using react-native-executorch
 */

import storageService from '@/services/storageService';
import { TranscriptionItem } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import {
    Alert,
    Dimensions,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';
import { useSpeechToText, WHISPER_TINY_EN } from 'react-native-executorch';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

export default function RecordScreen() {
  // Initialize audio recorder
  const [recorder] = useState(
    () =>
      new AudioRecorder({
        sampleRate: 16000,        // Whisper's expected sample rate
        bufferLengthInSamples: 1600,  // 100ms chunks for real-time processing
      })
  );

  // Initialize speech model
  const model = useSpeechToText({
    model: WHISPER_TINY_EN,
  });

  useEffect(() => {
    // Configure audio session for optimal speech recording
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'spokenAudio',     // Optimized for speech
      iosOptions: ['allowBluetooth', 'defaultToSpeaker'],
    });
    
    // Request recording permissions at runtime
    AudioManager.requestRecordingPermissions();
  }, []);

  const handleStartStreaming = async () => {
    try {
      // Set up audio buffer processing
      recorder.onAudioReady(async ({ buffer }) => {
        try {
          // Convert Float32Array to regular array for model processing
          const bufferArray = Array.from(buffer.getChannelData(0));
          model.streamInsert(bufferArray);
        } catch (error) {
          console.error('Audio buffer processing error:', error);
        }
      });

      // Begin recording
      recorder.start();

      try {
        // Start streaming transcription with overlapping chunks
        await model.stream();
      } catch (error) {
        console.error('Transcription error:', error);
        // Handle model errors gracefully
        handleStopStreaming();
        
        if (error instanceof Error && error.message?.includes('BLANK')) {
          Alert.alert('No Speech Detected', 'Please speak clearly into the microphone.');
        } else {
          Alert.alert('Transcription Error', 'Failed to transcribe audio. Please try again.');
        }
      }

      // Haptic feedback
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.error('Failed to start streaming:', error);
      Alert.alert('Error', 'Failed to start recording. Please check microphone permissions.');
    }
  };

  const handleStopStreaming = async () => {
    try {
      recorder.stop();
      model.streamStop();
      
      // Haptic feedback
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.error('Failed to stop streaming:', error);
    }
  };

  const handleSaveTranscription = async () => {
    try {
      if (!model.committedTranscription) {
        Alert.alert('No Transcription', 'Nothing to save. Try recording some speech first.');
        return;
      }

      const transcriptionItem: TranscriptionItem = {
        id: Date.now().toString(),
        audioUri: 'streaming_recording',
        transcription: model.committedTranscription,
        duration: 0, // Streaming doesn't track duration
        createdAt: new Date(),
        isProcessing: false,
      };

      await storageService.saveTranscription(transcriptionItem);
      
      // Haptic feedback
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      Alert.alert('Saved!', 'Transcription saved successfully.');
    } catch (error) {
      console.error('Failed to save transcription:', error);
      Alert.alert('Error', 'Failed to save transcription');
    }
  };

  const handleReset = () => {
    // Clear the transcription by stopping and restarting the model if needed
    if (model.isGenerating) {
      handleStopStreaming();
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
            <Text style={styles.loadingText}>Loading Whisper model...</Text>
            <Text style={styles.progressText}>{Math.round(model.downloadProgress * 100)}%</Text>
            <View style={styles.progressBar}>
              <View 
                style={[styles.progressFill, { width: `${model.downloadProgress * 100}%` }]} 
              />
            </View>
          </View>
        ) : (
          <>
            {/* Main Record Button */}
            <View style={styles.recordButtonContainer}>
              <TouchableOpacity
                style={[
                  styles.recordButton,
                  model.isGenerating && styles.recordButtonRecording
                ]}
                onPress={model.isGenerating ? handleStopStreaming : handleStartStreaming}
                disabled={!model.isReady}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={model.isGenerating ? 'stop' : 'mic'}
                  size={60}
                  color={model.isGenerating ? '#fff' : '#ff4444'}
                />
              </TouchableOpacity>
              
              <Text style={styles.recordButtonText}>
                {model.isGenerating ? 'Stop Recording' : 'Start Recording'}
              </Text>
            </View>

            {/* Real-time Transcription Display */}
            <View style={styles.transcriptionContainer}>
              <Text style={styles.transcriptionLabel}>
                {model.isGenerating ? 'Listening...' : 'Transcription:'}
              </Text>
              
              <View style={styles.transcriptionTextContainer}>
                {model.committedTranscription || model.nonCommittedTranscription ? (
                  <Text style={styles.transcriptionText}>
                    <Text style={styles.committedText}>
                      {model.committedTranscription}
                    </Text>
                    {model.nonCommittedTranscription && (
                      <Text style={styles.nonCommittedText}>
                        {' '}{model.nonCommittedTranscription}
                      </Text>
                    )}
                  </Text>
                ) : (
                  <Text style={styles.waitingText}>
                    {model.isGenerating 
                      ? 'Speak now...' 
                      : 'Tap the microphone to start recording'
                    }
                  </Text>
                )}
              </View>

              {/* Action Buttons */}
              {(model.committedTranscription || model.nonCommittedTranscription) && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={handleSaveTranscription}
                  >
                    <Ionicons name="save" size={20} color="#fff" />
                    <Text style={styles.saveButtonText}>Save</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.resetButton}
                    onPress={handleReset}
                  >
                    <Ionicons name="refresh" size={20} color="#666" />
                    <Text style={styles.resetButtonText}>Reset</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
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
    color: '#333',
    marginBottom: 20,
  },
  progressText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
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
    marginBottom: 16,
  },
  recordButtonRecording: {
    backgroundColor: '#ff4444',
    borderColor: '#ff4444',
  },
  recordButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  transcriptionContainer: {
    backgroundColor: '#f8f9fa',
    padding: 20,
    borderRadius: 12,
    flex: 1,
  },
  transcriptionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
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
    color: '#333',
    fontWeight: '600',
  },
  nonCommittedText: {
    color: '#666',
    fontStyle: 'italic',
  },
  waitingText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 20,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#28a745',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    marginRight: 10,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    marginLeft: 10,
  },
  resetButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
