/**
 * Persisted user settings with a tiny subscription so every screen using
 * `useSettings` updates together.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, Settings, mergeSettings, settingsAfterDataReset } from './settingsModel';

export type { Settings } from './settingsModel';

const KEY = 'settings.v1';

let current: Settings = DEFAULT_SETTINGS;
let loaded: Promise<Settings> | null = null;
const listeners = new Set<(settings: Settings) => void>();

export function getSettings(): Promise<Settings> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY)
      .then((raw) => {
        current = mergeSettings(raw ? JSON.parse(raw) : undefined);
        listeners.forEach((listener) => listener(current));
        return current;
      })
      .catch((error) => {
        console.warn('Failed to read settings; using defaults:', error);
        current = DEFAULT_SETTINGS;
        return current;
      });
  }
  return loaded;
}

/** Last loaded settings, synchronously. Defaults until `getSettings` resolves. */
export function peekSettings(): Settings {
  return current;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  await getSettings();
  current = mergeSettings({ ...current, ...patch });
  listeners.forEach((listener) => listener(current));
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(current));
  } catch (error) {
    console.warn('Failed to save settings:', error);
  }
  return current;
}

export async function resetSettings(): Promise<void> {
  await getSettings();
  await updateSettings(settingsAfterDataReset(current));
}

export function subscribeSettings(listener: (settings: Settings) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `[settings, update, loaded]` */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void, boolean] {
  const [state, setState] = useState(current);
  const [isLoaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeSettings(setState);
    getSettings().then((settings) => {
      setState(settings);
      setLoaded(true);
    });
    return unsubscribe;
  }, []);

  return [state, (patch) => void updateSettings(patch), isLoaded];
}
