import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { I18nManager, InteractionManager } from 'react-native';
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
import { applyLanguagePreference, syncLayoutDirection } from '@/i18n';
import * as enhanceQueue from '@/services/ai/enhanceQueue';
import { excludeModelsFromBackup } from '@/services/ai/modelManager';
import { prefetchSpeechModel } from '@/services/ai/modelPrefetch';
import { withoutDownloadReports } from '@/services/ai/quietResourceFetcher';
import '@/services/ai/summarizer';
import { initPurchases } from '@/services/billing/purchases';
import { sweepOrphanFiles } from '@/services/db/notesRepo';
import { clearExports } from '@/services/export/exporter';
import { getSettings, peekSettings, subscribeSettings } from '@/services/settings';

// Wrapped so the library can't report model downloads to its analytics endpoint.
initExecutorch({ resourceFetcher: withoutDownloadReports(ExpoResourceFetcher) });

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

/** Work the first screen doesn't depend on; runs once it has been drawn. */
function runAfterLaunch(): void {
  InteractionManager.runAfterInteractions(() => {
    // Resume AI work a previous session left unfinished.
    void enhanceQueue.start();
    // Export files are only needed until shared; don't let them pile up.
    clearExports();
    // Files a killed app left behind (e.g. during a delete's undo window).
    void sweepOrphanFiles(Date.now()).catch((e) => console.warn('Orphan sweep failed:', e));
    // Refresh the Pro entitlement in the background (works offline from cache).
    void initPurchases();
    void excludeModelsFromBackup();
    if (peekSettings().onboardingCompleted) prefetchSpeechModel();
  });
}

export default function RootLayout() {
  // The icon font is the only one the app draws with; loading it before the
  // splash hides avoids a first frame of empty icon boxes.
  const [fontsLoaded, error] = useFonts(Ionicons.font);
  // Settings gate the first screen (onboarding), the interface language and
  // haptics, so they load before the splash screen hides.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  useEffect(() => {
    let unsubscribe = () => {};
    getSettings().finally(() => {
      applyLanguagePreference(peekSettings().appLanguage);
      // Takes effect on the next launch; the language screen tells the user.
      syncLayoutDirection();
      unsubscribe = subscribeSettings((settings) => applyLanguagePreference(settings.appLanguage));
      setSettingsLoaded(true);
      runAfterLaunch();
    });
    return () => unsubscribe();
  }, []);
  const loaded = (fontsLoaded || Boolean(error)) && settingsLoaded;

  useEffect(() => {
    // A missing icon font is cosmetic; never keep the app behind the splash for it.
    if (error) console.warn('Icon font failed to load:', error);
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
  // Pushed screens enter from the trailing edge, which is the left in RTL.
  const push = I18nManager.isRTL ? 'slide_from_left' : 'slide_from_right';

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
                options={{ headerShown: false, gestureEnabled: true, animation: push, fullScreenGestureEnabled: true }}
              />
              <Stack.Screen name="ask/[id]" options={{ headerShown: false, presentation: 'modal' }} />
              <Stack.Screen name="paywall" options={{ headerShown: false, presentation: 'modal' }} />
              <Stack.Screen name="import" options={{ headerShown: false, presentation: 'modal' }} />
              <Stack.Screen name="language" options={{ headerShown: false, presentation: 'modal' }} />
              <Stack.Screen
                name="onboarding"
                options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }}
              />
              <Stack.Screen name="legal/[doc]" options={{ headerShown: false, animation: push }} />
              <Stack.Screen name="models" options={{ headerShown: false, animation: push }} />
            </Stack>
          </ActionSheetProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
