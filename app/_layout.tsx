import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter } from 'expo-router';
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
import * as enhanceQueue from '@/services/ai/enhanceQueue';
import { clearExports } from '@/services/export/exporter';
import { initPurchases } from '@/services/billing/purchases';
import '@/services/ai/summarizer';
import { getSettings, peekSettings } from '@/services/settings';

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
    getSettings().finally(() => {
      setSettingsLoaded(true);
      // Resume AI work a previous session left unfinished.
      void enhanceQueue.start();
      // Export files are only needed until shared; don't let them pile up.
      clearExports();
      // Refresh the Pro entitlement in the background (works offline from cache).
      void initPurchases();
    });
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
  const router = useRouter();
  const navigationState = useRootNavigationState();

  // First launch: show onboarding once the navigator is mounted. Settings
  // are already loaded (RootLayout waits for them before rendering this).
  useEffect(() => {
    if (!navigationState?.key) return;
    if (!peekSettings().onboardingCompleted) {
      router.replace('/onboarding');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationState?.key]);

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
              <Stack.Screen
                name="note/[id]"
                options={{ headerShown: false, gestureEnabled: true, animation: 'slide_from_right', fullScreenGestureEnabled: true }}
              />
              <Stack.Screen name="paywall" options={{ headerShown: false, presentation: 'modal' }} />
              <Stack.Screen name="import" options={{ headerShown: false, presentation: 'modal' }} />
              <Stack.Screen
                name="onboarding"
                options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }}
              />
              <Stack.Screen name="legal/[doc]" options={{ headerShown: false, animation: 'slide_from_right' }} />
              <Stack.Screen name="models" options={{ headerShown: false, animation: 'slide_from_right' }} />
            </Stack>
          </ActionSheetProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
