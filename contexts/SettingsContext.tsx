/**
 * Settings Context Provider
 * Manages user preferences and settings persistence
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../constants/config';
import { EnhancedAppSettings, SettingsContextType } from '../types';

// Enhanced default settings
const enhancedDefaultSettings: EnhancedAppSettings = {
  ...DEFAULT_SETTINGS,
  // Audio Settings
  audioQuality: 'medium',
  noiseReduction: true,
  autoGainControl: true,
  echoCancellation: true,
  
  // Transcription Settings
  language: 'en',
  confidenceThreshold: 0.7,
  realTimeTranscription: true,
  speakerDetection: false,
  
  // UI Settings
  theme: 'auto',
  fontSize: 'medium',
  animations: true,
  
  // Performance Settings
  maxCacheSize: 100,
  backgroundProcessing: true,
  lowPowerMode: false,
  
  // Export Settings
  defaultExportFormat: 'txt',
  autoExportLocation: 'local',
  includeMetadataByDefault: true,
};

// Create context
const SettingsContext = createContext<SettingsContextType | null>(null);

// Provider component
interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<EnhancedAppSettings>(enhancedDefaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings from storage on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Load settings from AsyncStorage
  const loadSettings = async () => {
    try {
      const storedSettings = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (storedSettings) {
        const parsedSettings = JSON.parse(storedSettings);
        // Merge with defaults to ensure all new settings are present
        setSettings({ ...enhancedDefaultSettings, ...parsedSettings });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Save settings to AsyncStorage
  const saveSettings = async (newSettings: EnhancedAppSettings) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  };

  // Update a specific setting
  const updateSetting = async <K extends keyof EnhancedAppSettings>(
    key: K,
    value: EnhancedAppSettings[K]
  ) => {
    try {
      const newSettings = { ...settings, [key]: value };
      setSettings(newSettings);
      await saveSettings(newSettings);
    } catch (error) {
      console.error('Failed to update setting:', error);
      // Revert the change if save failed
      setSettings(settings);
      throw error;
    }
  };

  // Reset all settings to defaults
  const resetSettings = async () => {
    try {
      setSettings(enhancedDefaultSettings);
      await saveSettings(enhancedDefaultSettings);
    } catch (error) {
      console.error('Failed to reset settings:', error);
      throw error;
    }
  };

  // Export settings as JSON string
  const exportSettings = (): string => {
    return JSON.stringify(settings, null, 2);
  };

  // Import settings from JSON string
  const importSettings = async (settingsJson: string) => {
    try {
      const importedSettings = JSON.parse(settingsJson);
      
      // Validate imported settings (basic validation)
      if (typeof importedSettings !== 'object' || importedSettings === null) {
        throw new Error('Invalid settings format');
      }

      // Merge with defaults to ensure all required fields are present
      const mergedSettings = { ...enhancedDefaultSettings, ...importedSettings };
      
      setSettings(mergedSettings);
      await saveSettings(mergedSettings);
    } catch (error) {
      console.error('Failed to import settings:', error);
      throw error;
    }
  };

  const contextValue: SettingsContextType = {
    settings,
    updateSetting,
    resetSettings,
    exportSettings,
    importSettings,
  };

  // Don't render children until settings are loaded
  if (isLoading) {
    return null; // Or a loading component
  }

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  );
}

// Custom hook to use the settings context
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

export default SettingsContext;