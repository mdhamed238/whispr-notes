import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * React Native 0.86 widened `ColorSchemeName` to include `'unspecified'`
 * alongside `'light' | 'dark' | null`. Every caller here indexes the `Colors`
 * palette with the result, so the extra state is collapsed to `'light'` in
 * one place rather than forcing a `?? 'light'` fallback (and a type error) at
 * a dozen call sites.
 */
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
