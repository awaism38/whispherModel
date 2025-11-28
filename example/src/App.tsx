import React from 'react'
import { SafeAreaView, StatusBar } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { toggleNativeLog, addNativeLogListener } from '../../src'
import InboxWatcher from './InboxWatcher'

toggleNativeLog(true)
addNativeLogListener((level, text) => {
  console.log(['[rnwhisper]', level ? `[${level}]` : '', text].filter(Boolean).join(' '))
})

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <InboxWatcher />
      </SafeAreaView>
    </GestureHandlerRootView>
  )
}

export default App
