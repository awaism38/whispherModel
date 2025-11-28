import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import RNFS from 'react-native-fs'
import { initWhisper } from '../../src'
import type { WhisperContext } from '../../src'
import { Button } from './Button'
import { ensureMediaPermissions, scanAudioFiles } from './audio-search/scanAudio'
import {
  buildWordTimestamps,
  combineSegmentsText,
  searchWordInSegments,
  searchWordInTokens,
} from './audio-search/transcription'
import type { AudioFileEntry, SearchResultItem } from './audio-search/types'
import { useAudioPlayer } from './audio-search/useAudioPlayer'



const formatBytes = (value?: number) => {
  if (!value) return 'unknown size'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let result = value
  let unitIndex = 0
  while (result >= 1024 && unitIndex < units.length - 1) {
    result /= 1024
    unitIndex += 1
  }
  return `${result.toFixed(result >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

const withFilePrefix = (path: string) =>
  path.startsWith('file://') ? path : `file://${path}`

export default function AudioSearchScreen() {
  const [audioFiles, setAudioFiles] = useState<AudioFileEntry[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('cursor')
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([])
  const [lastExportPath, setLastExportPath] = useState<string | null>(null)
  const whisperRef = useRef<WhisperContext | null>(null)
  const { play } = useAudioPlayer()

  const updateEntry = useCallback((id: string, updater: (entry: AudioFileEntry) => AudioFileEntry) => {
    setAudioFiles((prev) =>
      prev.map((entry) => {
        if (entry.id !== id) return entry
        return updater(entry)
      }),
    )
  }, [])

  const initializeWhisper = useCallback(async () => {
    if (isInitializing) return
    setIsInitializing(true)
    try {
      if (whisperRef.current) {
        await whisperRef.current.release()
        whisperRef.current = null
      }
      const context = await initWhisper({
        filePath: require('../assets/ggml-base.bin'),
        useGpu: true,
      })
      whisperRef.current = context
      Alert.alert('Whisper ready', `Context #${context.id} initialized.`)
    } catch (error: any) {
      Alert.alert('Failed to initialize whisper', error?.message ?? String(error))
    } finally {
      setIsInitializing(false)
    }
  }, [isInitializing])

  const scanAudio = useCallback(async () => {
    setIsScanning(true)
    try {
      const granted = await ensureMediaPermissions()
      if (!granted) {
        Alert.alert('Permission required', 'Cannot scan audio without storage permission.')
        return
      }
      const files = await scanAudioFiles({ log: console.log })
      setAudioFiles(files)
      if (!files.length) {
        Alert.alert('No audio found', 'Try adding audio files to your device storage.')
      }
    } catch (error: any) {
      Alert.alert('Scan failed', error?.message ?? String(error))
    } finally {
      setIsScanning(false)
    }
  }, [])

  const transcribeFile = useCallback(
    async (file: AudioFileEntry) => {
      const ctx = whisperRef.current
      if (!ctx) {
        throw new Error('Whisper context not initialized')
      }
      updateEntry(file.id, (entry) => ({
        ...entry,
        status: 'transcribing',
        error: undefined,
      }))
      try {
        const { promise } = ctx.transcribe(withFilePrefix(file.path), {
          language: 'en',
          temperature: 0,
          temperatureInc: 0,
          tokenTimestamps: true,
          wordThold: 0.4,
        })
        const { segments, result } = await promise
        const tokens = buildWordTimestamps(segments)
        const combinedText = combineSegmentsText(segments) || result || ''
        updateEntry(file.id, (entry) => ({
          ...entry,
          status: 'done',
          transcription: {
            text: combinedText,
            segments,
            tokens,
          },
        }))
      } catch (error: any) {
        updateEntry(file.id, (entry) => ({
          ...entry,
          status: 'error',
          error: error?.message ?? String(error),
        }))
      }
    },
    [updateEntry],
  )

  const transcribeAll = useCallback(async () => {
    if (!whisperRef.current) {
      Alert.alert('Initialize Whisper', 'Please initialize Whisper before transcribing.')
      return
    }
    if (!audioFiles.length) {
      Alert.alert('No audio files', 'Scan for audio files before transcribing.')
      return
    }
    setIsTranscribing(true)
    try {
      for (const file of audioFiles) {
        if (file.status === 'done') continue
        await transcribeFile(file)
      }
      Alert.alert('Transcription complete', 'Finished processing available audio files.')
    } finally {
      setIsTranscribing(false)
    }
  }, [audioFiles, transcribeFile])

  const search = useCallback(() => {
    const word = searchTerm.trim()
    if (!word) {
      Alert.alert('Enter a search term', 'Type the word you want to search for.')
      return
    }
    const results: SearchResultItem[] = []
    audioFiles.forEach((file) => {
      const tokens = file.transcription?.tokens ?? []
      if (!tokens.length) {
        const fallbackMatches = searchWordInSegments(word, file.transcription?.segments ?? [])
        if (fallbackMatches.length) {
          results.push({
            fileName: file.name,
            filePath: file.path,
            word,
            matches: fallbackMatches,
          })
        }
        return
      }
      const matches = searchWordInTokens(word, tokens)
      if (matches.length) {
        results.push({
          fileName: file.name,
          filePath: file.path,
          word,
          matches,
        })
        return
      }
      const fallbackMatches = searchWordInSegments(word, file.transcription?.segments ?? [])
      if (fallbackMatches.length) {
        results.push({
          fileName: file.name,
          filePath: file.path,
          word,
          matches: fallbackMatches,
        })
      }
    })
    setSearchResults(results)
    if (!results.length) {
      Alert.alert('No matches', `Could not find "${word}" in processed audio.`)
    }
  }, [audioFiles, searchTerm])

  const clearAudioData = useCallback(() => {
    setAudioFiles([])
    setSearchResults([])
    setLastExportPath(null)
  }, [])

  const exportResults = useCallback(async () => {
    if (!searchResults.length) {
      Alert.alert('No results to export', 'Run a search before exporting.')
      return
    }
    const payload = searchResults.map((result) => ({
      fileName: result.fileName,
      word: result.word,
      timestamps: result.matches.map((match) => match.label),
    }))
    const filename = `audio-search-${Date.now()}.json`
    const destination = `${RNFS.DocumentDirectoryPath}/${filename}`
    await RNFS.writeFile(destination, JSON.stringify(payload, null, 2), 'utf8')
    setLastExportPath(destination)
    Alert.alert('Export complete', `Results saved to ${destination}`)
  }, [searchResults])

  const playTimestamp = useCallback(
    async (filePath: string, seconds: number) => {
      try {
        await play(filePath, seconds)
      } catch (error: any) {
        Alert.alert('Playback failed', error?.message ?? String(error))
      }
    },
    [play],
  )

  useEffect(() => {
    void scanAudio()
    return () => {
      whisperRef.current?.release()
      whisperRef.current = null
    }
  }, [scanAudio])

  return (
    <ScrollView contentContainerStyle={styles.container} >
      <Text style={styles.title}>Search Audio Transcriptions</Text>
      <Button
        title={isInitializing ? 'Initializing...' : 'Initialize Whisper (base model)'}
        onPress={initializeWhisper}
        disabled={isInitializing}
      />
      <Button
        title={isScanning ? 'Scanning...' : 'Rescan Audio Files'}
        onPress={scanAudio}
        disabled={isScanning}
      />
      <Button
        title="Clear audio list"
        onPress={clearAudioData}
        disabled={!audioFiles.length && !searchResults.length && !lastExportPath}
      />
      <Button
        title={isTranscribing ? 'Transcribing...' : 'Transcribe All Audio'}
        onPress={transcribeAll}
        disabled={isTranscribing || !audioFiles.length}
      />

      <Text style={styles.sectionTitle}>1. Search word</Text>
      <TextInput
        placeholder="Enter word to search"
        placeholderTextColor="#888"
        style={styles.input}
        value={searchTerm}
        onChangeText={setSearchTerm}
        autoCapitalize="none"
      />
      <Button title="Search word" onPress={search} disabled={!audioFiles.length} />
      <Button
        title="Export search results"
        onPress={exportResults}
        disabled={!searchResults.length}
      />
      {lastExportPath ? (
        <Text style={styles.exportPath}>Last export → {lastExportPath}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>
        2. Audio files ({audioFiles.length})
      </Text>
      {audioFiles.map((file) => (
        <View key={file.id} style={styles.fileItem}>
          <Text style={styles.fileName}>{file.name}</Text>
          <Text style={styles.fileMeta}>
            {withFilePrefix(file.path)}
            {' • '}
            {formatBytes(file.size)}
          </Text>
          <Text style={styles.statusText}>{`Status: ${file.status}`}</Text>
          {file.error ? <Text style={styles.statusText}>Error: {file.error}</Text> : null}
          <Button
            title="Transcribe this file"
            onPress={() => transcribeFile(file)}
            disabled={isTranscribing || file.status === 'transcribing'}
          />
        </View>
      ))}

      <Text style={styles.sectionTitle}>
        3. Search results ({searchResults.length})
      </Text>
      {searchResults.map((result) => (
        <View key={result.fileName + result.word} style={styles.resultItem}>
          <Text style={styles.fileName}>{result.fileName}</Text>
          <Text style={styles.fileMeta}>
            {`Matches for "${result.word}" (${result.matches.length})`}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {result.matches.map((match) => (
              <TouchableOpacity
                key={`${result.fileName}-${match.label}-${match.seconds}`}
                style={styles.timestampButton}
                onPress={() => playTimestamp(result.filePath, match.seconds)}
              >
                <Text style={styles.timestampText}>{match.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginBottom: 500,

  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 18,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 8,
    borderRadius: 6,
    marginVertical: 8,
    color: '#111',
  },
  fileItem: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 10,
    backgroundColor: '#fafafa',
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
  },
  fileMeta: {
    fontSize: 12,
    color: '#555',
    marginTop: 4,
  },
  statusText: {
    fontSize: 12,
    marginTop: 6,
  },
  resultItem: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 10,
    backgroundColor: '#f5f5f5',
  },
  timestampButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: '#333',
    marginRight: 6,
    marginTop: 6,
  },
  timestampText: {
    color: '#fff',
    fontSize: 12,
  },
  exportPath: {
    fontSize: 11,
    color: '#444',
    marginTop: 4,
  },
})