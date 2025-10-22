/**
 * App Context Provider
 * Global state management for the Audio Transcription App
 */

import React, { createContext, ReactNode, useContext, useEffect, useReducer } from 'react';
import { DEFAULT_SETTINGS } from '../constants/config';
import { AppContextType, EnhancedAppSettings, PerformanceMetrics } from '../types';

// Initial state
const initialState: AppContextType = {
  settings: {
    ...DEFAULT_SETTINGS,
    // Enhanced settings defaults
    audioQuality: 'medium',
    noiseReduction: true,
    autoGainControl: true,
    echoCancellation: true,
    language: 'en',
    confidenceThreshold: 0.7,
    realTimeTranscription: true,
    speakerDetection: false,
    theme: 'auto',
    fontSize: 'medium',
    animations: true,
    maxCacheSize: 100,
    backgroundProcessing: true,
    lowPowerMode: false,
    defaultExportFormat: 'txt',
    autoExportLocation: 'local',
    includeMetadataByDefault: true,
  },
  updateSettings: () => {},
  performance: {
    appStartTime: 0,
    modelLoadTime: 0,
    transcriptionSpeed: 0,
    memoryUsage: {
      current: 0,
      peak: 0,
      average: 0,
      threshold: 500,
    },
    batteryImpact: {
      estimatedImpact: 0,
      optimizationLevel: 'medium',
    },
    errorRate: 0,
  },
  isLoading: false,
  error: null,
};

// Action types
type AppAction =
  | { type: 'UPDATE_SETTINGS'; payload: Partial<EnhancedAppSettings> }
  | { type: 'UPDATE_PERFORMANCE'; payload: Partial<PerformanceMetrics> }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'RESET_STATE' };

// Reducer
function appReducer(state: AppContextType, action: AppAction): AppContextType {
  switch (action.type) {
    case 'UPDATE_SETTINGS':
      return {
        ...state,
        settings: { ...state.settings, ...action.payload },
      };
    case 'UPDATE_PERFORMANCE':
      return {
        ...state,
        performance: { ...state.performance, ...action.payload },
      };
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };
    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
      };
    case 'RESET_STATE':
      return initialState;
    default:
      return state;
  }
}

// Create context
const AppContext = createContext<AppContextType>(initialState);

// Provider component
interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Update settings function
  const updateSettings = (settings: Partial<EnhancedAppSettings>) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: settings });
  };

  // Enhanced context value with all functions
  const contextValue: AppContextType = {
    ...state,
    updateSettings,
  };

  // Performance monitoring effect
  useEffect(() => {
    const startTime = Date.now();
    
    // Update app start time
    dispatch({
      type: 'UPDATE_PERFORMANCE',
      payload: { appStartTime: startTime },
    });

    // Memory monitoring (simplified for demo)
    const memoryInterval = setInterval(() => {
      // In a real app, you'd use actual memory monitoring APIs
      const mockMemoryUsage = {
        current: Math.random() * 200 + 100,
        peak: Math.random() * 300 + 200,
        average: Math.random() * 150 + 125,
        threshold: 500,
      };

      dispatch({
        type: 'UPDATE_PERFORMANCE',
        payload: { memoryUsage: mockMemoryUsage },
      });
    }, 5000);

    return () => {
      clearInterval(memoryInterval);
    };
  }, []);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

// Custom hook to use the context
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

export default AppContext;