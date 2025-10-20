/**
 * Transcription Service
 * Handles on-device transcription using react-native-executorch and Whisper model
 * Provides transcription pipeline with progress tracking and error handling
 */

import { ERROR_MESSAGES, TRANSCRIPTION_CONFIG } from '../constants/config';
import { TranscriptionError, TranscriptionProgress, TranscriptionServiceInterface } from '../types';
import { audioService } from './audioService';

// Global model instance to be managed by React component
let globalModelInstance: any = null;

export const setGlobalModelInstance = (instance: any) => {
  globalModelInstance = instance;
};

export const getGlobalModelInstance = () => {
  return globalModelInstance;
};

class TranscriptionService implements TranscriptionServiceInterface {
  private isInitialized: boolean = false;
  private isTranscribing: boolean = false;
  private currentProgress: TranscriptionProgress | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    // Initialize on first use
  }

  /**
   * Initialize the transcription service
   * Loads the model and prepares for transcription
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        return;
      }

      console.log('Initializing transcription service...');
      
      // Check if model is available
      const model = getGlobalModelInstance();
      if (!model || !model.isReady) {
        throw new Error(ERROR_MESSAGES.MODEL_NOT_FOUND);
      }

      this.isInitialized = true;
      console.log('Transcription service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize transcription service:', error);
      throw error;
    }
  }

  /**
   * Transcribe audio from URI
   * @param audioUri - URI of the audio file to transcribe
   * @returns Promise<string> - Transcribed text
   */
  async transcribe(audioUri: string): Promise<string> {
    try {
      if (this.isTranscribing) {
        throw new Error('Transcription already in progress');
      }

      this.isTranscribing = true;
      this.abortController = new AbortController();

      // Update progress: preprocessing
      this.updateProgress({
        stage: 'preprocessing',
        progress: 10,
        message: 'Preprocessing audio...',
      });

      // Preprocess audio for Whisper
      const audioData = await audioService.preprocessAudioForWhisper(audioUri);
      
      // Update progress: loading model
      this.updateProgress({
        stage: 'loading_model',
        progress: 30,
        message: 'Loading AI model...',
      });

      // Ensure service is initialized
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Update progress: inference
      this.updateProgress({
        stage: 'inference',
        progress: 50,
        message: 'Transcribing audio...',
      });

      // Run transcription inference
      const transcription = await this.runInference(audioData);

      // Update progress: decoding
      this.updateProgress({
        stage: 'decoding',
        progress: 90,
        message: 'Processing results...',
      });

      // Post-process transcription
      const processedTranscription = this.postProcessTranscription(transcription);

      // Complete
      this.updateProgress({
        stage: 'decoding',
        progress: 100,
        message: 'Transcription complete!',
      });

      console.log('Transcription completed successfully');
      return processedTranscription;

    } catch (error) {
      console.error('Transcription failed:', error);
      throw this.createTranscriptionError(error);
    } finally {
      this.isTranscribing = false;
      this.currentProgress = null;
      this.abortController = null;
    }
  }

  /**
   * Cancel current transcription
   */
  async cancel(): Promise<void> {
    try {
      if (this.abortController) {
        this.abortController.abort();
      }
      this.isTranscribing = false;
      this.currentProgress = null;
      console.log('Transcription cancelled');
    } catch (error) {
      console.error('Failed to cancel transcription:', error);
    }
  }

  /**
   * Check if model is loaded and ready
   * @returns boolean - true if model is loaded
   */
  isModelLoaded(): boolean {
    const model = getGlobalModelInstance();
    return model && model.isReady;
  }

  /**
   * Get model information
   * @returns ModelInfo | null - Model information or null if not loaded
   */
  getModelInfo(): any | null {
    if (!this.isInitialized) {
      return null;
    }

    // Return basic model info
    return {
      name: 'whisper-tiny',
      version: 'v1',
      loaded: true,
    };
  }

  /**
   * Get current transcription progress
   * @returns TranscriptionProgress | null - Current progress or null if not transcribing
   */
  getProgress(): TranscriptionProgress | null {
    return this.currentProgress;
  }

  /**
   * Check if currently transcribing
   * @returns boolean - true if transcribing
   */
  isTranscribingAudio(): boolean {
    return this.isTranscribing;
  }

  /**
   * Run inference on preprocessed audio data
   * @param audioData - Preprocessed audio data
   * @returns Promise<string> - Raw transcription result
   */
  private async runInference(audioData: Float32Array): Promise<string> {
    try {
      const model = getGlobalModelInstance();
      if (!model || !model.isReady) {
        throw new Error('Model not ready for transcription');
      }

      // Check if cancelled
      if (this.abortController?.signal.aborted) {
        throw new Error('Transcription cancelled');
      }

      // Use the real react-native-executorch model for transcription
      const transcription = await model.transcribe(audioData);

      // Check if cancelled after transcription
      if (this.abortController?.signal.aborted) {
        throw new Error('Transcription cancelled');
      }

      return transcription;

    } catch (error) {
      console.error('Inference failed:', error);
      throw error;
    }
  }

  /**
   * Post-process transcription result
   * @param rawTranscription - Raw transcription from model
   * @returns string - Processed transcription
   */
  private postProcessTranscription(rawTranscription: string): string {
    try {
      // Basic post-processing:
      // 1. Trim whitespace
      // 2. Capitalize first letter
      // 3. Add period if missing
      
      let processed = rawTranscription.trim();
      
      if (processed.length === 0) {
        return "No speech detected in the audio.";
      }

      // Capitalize first letter
      processed = processed.charAt(0).toUpperCase() + processed.slice(1);

      // Add period if missing
      if (!processed.endsWith('.') && !processed.endsWith('!') && !processed.endsWith('?')) {
        processed += '.';
      }

      return processed;
    } catch (error) {
      console.error('Post-processing failed:', error);
      return rawTranscription; // Return original if processing fails
    }
  }

  /**
   * Update transcription progress
   * @param progress - Progress information
   */
  private updateProgress(progress: TranscriptionProgress): void {
    this.currentProgress = progress;
    
    // Emit progress update (in a real app, you might use an event emitter)
    console.log(`Transcription Progress: ${progress.progress}% - ${progress.message}`);
  }

  /**
   * Create transcription error from generic error
   * @param error - Generic error
   * @returns TranscriptionError - Formatted transcription error
   */
  private createTranscriptionError(error: any): TranscriptionError {
    if (error.message?.includes('cancelled')) {
      return {
        code: 'INFERENCE_ERROR',
        message: 'Transcription was cancelled',
        details: error,
      };
    }

    if (error.message?.includes('model')) {
      return {
        code: 'MODEL_NOT_FOUND',
        message: ERROR_MESSAGES.MODEL_NOT_FOUND,
        details: error,
      };
    }

    if (error.message?.includes('memory') || error.message?.includes('Memory')) {
      return {
        code: 'MEMORY_ERROR',
        message: 'Insufficient memory for transcription. Try with a shorter audio clip.',
        details: error,
      };
    }

    if (error.message?.includes('audio') || error.message?.includes('format')) {
      return {
        code: 'AUDIO_FORMAT_ERROR',
        message: 'Audio format not supported. Please record audio again.',
        details: error,
      };
    }

    return {
      code: 'INFERENCE_ERROR',
      message: ERROR_MESSAGES.TRANSCRIPTION_FAILED,
      details: error,
    };
  }

  /**
   * Get estimated transcription time for audio duration
   * @param durationSeconds - Audio duration in seconds
   * @returns number - Estimated transcription time in seconds
   */
  getEstimatedTranscriptionTime(durationSeconds: number): number {
    // Rough estimate: 2-4x real-time for Whisper Tiny on mobile
    const multiplier = 3; // 3x real-time average
    return Math.max(5, durationSeconds * multiplier); // Minimum 5 seconds
  }

  /**
   * Check if audio duration is within limits
   * @param durationSeconds - Audio duration in seconds
   * @returns boolean - true if within limits
   */
  isAudioDurationValid(durationSeconds: number): boolean {
    const minDuration = 1; // Minimum 1 second
    const maxDuration = TRANSCRIPTION_CONFIG.MAX_AUDIO_LENGTH * 60; // Convert minutes to seconds
    
    return durationSeconds >= minDuration && durationSeconds <= maxDuration;
  }
}

// Export singleton instance
export const transcriptionService = new TranscriptionService();
export default transcriptionService;
