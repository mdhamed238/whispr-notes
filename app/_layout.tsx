import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
// SDK 56 dropped expo-router's react-navigation compatibility, and
// executorch 0.10 moved the timestamped transcription API (verbose segments)
// behind its `/legacy` entry point — the new root API returns plain strings
// with no word timings, which the note timeline depends on.
import { initExecutorch } from 'react-native-executorch/legacy';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher/legacy';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import { ActionSheetProvider } from '@/components/ui/ActionSheet';
import { ToastProvider } from '@/components/ui/Toast';
import Colors from '@/constants/Colors';
import { getSettings } from '@/services/settings';

initExecutorch({ resourceFetcher: ExpoResourceFetcher });

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/note/[id]` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });
  // Settings gate the first screen (onboarding) and haptics, so they load
  // before the splash screen hides.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  useEffect(() => {
    getSettings().finally(() => setSettingsLoaded(true));
  }, []);
  const loaded = fontsLoaded && settingsLoaded;

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // The react-navigation ThemeProvider this used to wrap is gone: expo-router
  // no longer supports react-navigation as of SDK 56. Every screen already
  // paints its own background from the same tokens and runs with
  // `headerShown: false`, so the only thing the navigator theme still did was
  // colour the area behind a screen during transitions — which contentStyle
  // covers directly.
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <ToastProvider>
          <ActionSheetProvider>
            <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="note/[id]" options={{ presentation: 'modal', headerShown: false }} />
            </Stack>
          </ActionSheetProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
