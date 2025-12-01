import React, { useState, useEffect } from 'react';
import { StatusBar, View, useColorScheme, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { toggleNativeLog, addNativeLogListener } from '../../src';
import InboxWatcher from './InboxWatcher';
import AudioSearchScreen from './AudioSearchScreen';
import { Button } from './Button';

// Enable native logs
toggleNativeLog(true);
addNativeLogListener((level, text) => {
  console.log(['[rnwhisper]', level ? `[${level}]` : '', text].filter(Boolean).join(' '));
});

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <AppContent />
        </SafeAreaView>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const [activeScreen, setActiveScreen] = useState<'watcher' | 'search'>('search');

  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
      <View style={styles.buttonRow}>
        <Button
          title="Audio search"
          onPress={() => setActiveScreen('search')}
          style={{ backgroundColor: activeScreen === 'search' ? '#555' : '#333' }}
        />
        <Button
          title="Folder watcher"
          onPress={() => setActiveScreen('watcher')}
          style={{ backgroundColor: activeScreen === 'watcher' ? '#555' : '#333' }}
        />
      </View>

      {activeScreen === 'search' ? <AudioSearchScreen /> : <InboxWatcher />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
});

export default App;
