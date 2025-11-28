import React, { useState } from 'react'
import { SafeAreaView, StatusBar, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { toggleNativeLog, addNativeLogListener } from '../../src'
import InboxWatcher from './InboxWatcher'
import AudioSearchScreen from './AudioSearchScreen'
import { Button } from './Button'

toggleNativeLog(true)
addNativeLogListener((level, text) => {
  console.log(['[rnwhisper]', level ? `[${level}]` : '', text].filter(Boolean).join(' '))
})

function App() {
  const [activeScreen, setActiveScreen] = useState<'watcher' | 'search'>('search')

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
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
      </SafeAreaView>
    </GestureHandlerRootView>
  )
}

export default App
