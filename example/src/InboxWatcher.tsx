import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, View, Text, StyleSheet } from 'react-native'
import RNFS from 'react-native-fs'
import { initWhisper } from '../../src'
import type { WhisperContext } from '../../src'
import contextOpts from './context-opts'
import { Button } from './Button'
import {
  ensureInboxDirs,
  inboxDir,
  moveFileToFailed,
  moveFileToProcessed,
  toTimestamp,
} from './util'
import { InboxWatcher } from './watchers/InboxWatcher'

type LogEntryInput =
  | { kind: 'plain'; text: string }
  | { kind: 'segment'; start: string; end: string; text: string }
  | { kind: 'token'; start: string; end: string; text: string }
  | {
      kind: 'timeline'
      segments: Array<{ start: string; end: string; text: string }>
    }
  | { kind: 'transcript'; text: string }

type LogEntry = LogEntryInput & { id: number }

type TranscriptEntry = {
  file: string
  status: 'success' | 'error'
  text?: string
  error?: string
  durationMs?: number
}

const styles = StyleSheet.create({
  scrollview: { flexGrow: 1, justifyContent: 'center' },
  container: { flex: 1, alignItems: 'center', padding: 12 },
  title: { fontSize: 20, fontWeight: 'bold', marginVertical: 8 },
  pathText: { fontSize: 12, color: '#666', textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  logContainer: {
    width: '95%',
    backgroundColor: '#eee',
    borderRadius: 8,
    padding: 8,
    marginVertical: 8,
  },
  logText: { fontSize: 11, color: '#333' },
  logTimestamp: { color: 'red' },
  logTranscript: { color: 'green' },
  transcriptItem: {
    width: '95%',
    backgroundColor: '#fafafa',
    borderRadius: 8,
    padding: 8,
    marginVertical: 4,
  },
  transcriptFile: { fontSize: 12, fontWeight: '600' },
  transcriptResult: { fontSize: 12, marginTop: 4 },
  stateText: { fontSize: 13, marginVertical: 4 },
})

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

export default function InboxWatcherScreen() {
  const logsLimit = 200
  const transcriptsLimit = 50
  const whisperContextRef = useRef<WhisperContext | null>(null)
  const watcherRef = useRef<InboxWatcher | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isWatching, setIsWatching] = useState(false)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([])
  const [processedCount, setProcessedCount] = useState(0)
  const [processedBytes, setProcessedBytes] = useState(0)
  const logIdRef = useRef(0)

  const pushLog = useCallback(
    (entry: LogEntryInput) => {
      setLogs((prev) => {
        const next: LogEntry[] = [
          ...prev,
          { id: logIdRef.current++, ...entry },
        ]
        if (next.length > logsLimit) {
          next.splice(0, next.length - logsLimit)
        }
        return next
      })
    },
    [logsLimit],
  )

  const appendLog = useCallback((...messages: any[]) => {
    pushLog({ kind: 'plain', text: messages.join(' ') })
  }, [pushLog])

  const handleFile = useCallback(
    async (filePath: string) => {
      const ctx = whisperContextRef.current
      if (!ctx) {
        appendLog('[Watcher] context not initialized, skipping', filePath)
        return
      }
      setActiveFile(filePath)
      appendLog('[Watcher] processing', filePath)
      try {
        const start = Date.now()
        const { promise } = ctx.transcribe(filePath, {
          language: 'en',
          temperature: 0,
          temperatureInc: 0,
          tokenTimestamps: true,
        })
        const { result, segments } = await promise
        if (segments?.length) {
          const timelineSegments = segments.map((segment) => ({
            start: toTimestamp(segment.t0, true),
            end: toTimestamp(segment.t1, true),
            text: segment.text?.trim() || '<empty>',
          }))
          // timelineSegments.forEach((segment) => {
          //   pushLog({
          //     kind: 'segment',
          //     start: segment.start,
          //     end: segment.end,
          //     text: segment.text,
          //   })
          // })
          segments.forEach((segment) => {
            const tokens: Array<{ start: string; end: string; text: string }> =
              (segment as any)?.tokens?.map((token: any) => ({
                start: toTimestamp(token.t0 ?? token.t ?? segment.t0, true),
                end: toTimestamp(token.t1 ?? token.tEnd ?? segment.t1, true),
                text:
                  typeof token.text === 'string' && token.text.trim().length
                    ? token.text
                    : '<blank>',
              })) ?? []
            tokens.forEach((token) => {
              pushLog({
                kind: 'token',
                start: token.start,
                end: token.end,
                text: token.text,
              })
            })
          })
          pushLog({ kind: 'timeline', segments: timelineSegments })
        }
        const combinedText =
          segments?.map((segment) => segment.text?.trim() ?? '').join(' ').trim() ||
          result ||
          ''
        const durationMs = Date.now() - start
        const entry: TranscriptEntry = {
          file: filePath,
          status: 'success',
          text: combinedText,
          durationMs,
        }
        setTranscripts((prev) => {
          const next = [entry, ...prev]
          if (next.length > transcriptsLimit) {
            next.length = transcriptsLimit
          }
          return next
        })
        appendLog('[Watcher] success', filePath)
        pushLog({ kind: 'transcript', text: combinedText || '(empty)' })
        let bytes = 0
        try {
          const info = await RNFS.stat(filePath)
          bytes = Number(info.size) || 0
        } catch (statError) {
          appendLog('[Watcher] stat failed', String(statError))
        }
        await moveFileToProcessed(filePath, appendLog)
        setProcessedCount((prev) => prev + 1)
        if (bytes > 0) {
          setProcessedBytes((prev) => prev + bytes)
        }
      } catch (error: any) {
        const message = error?.message ?? String(error)
        const entry: TranscriptEntry = {
          file: filePath,
          status: 'error',
          error: message,
        }
        appendLog('[Watcher] failed', filePath, message)
        setTranscripts((prev) => {
          const next = [entry, ...prev]
          if (next.length > transcriptsLimit) {
            next.length = transcriptsLimit
          }
          return next
        })
        await moveFileToFailed(filePath, appendLog)
      } finally {
        setActiveFile(null)
      }
    },
    [appendLog],
  )

  useEffect(() => {
    ensureInboxDirs(appendLog).catch((error) => appendLog('ensureInboxDirs', error))

    return () => {
      watcherRef.current?.stop()
      whisperContextRef.current?.release()
      watcherRef.current = null
      whisperContextRef.current = null
    }
  }, [appendLog])

  const startWatcher = useCallback(async () => {
    if (!whisperContextRef.current) {
      appendLog('Initialize Whisper before starting watcher')
      return
    }
    if (!watcherRef.current) {
      watcherRef.current = new InboxWatcher({
        onFile: handleFile,
        log: appendLog,
      })
    }
    await watcherRef.current.start()
    setIsWatching(true)
  }, [appendLog, handleFile])

  const stopWatcher = useCallback(() => {
    watcherRef.current?.stop()
    setIsWatching(false)
  }, [])

  const initializeWhisper = useCallback(async () => {
    appendLog('Initializing whisper context...')
    if (whisperContextRef.current) {
      await whisperContextRef.current.release()
      whisperContextRef.current = null
    }
    const start = Date.now()
    const ctx = await initWhisper({
      filePath: require('../assets/ggml-base.bin'),
      ...contextOpts,
    })
    const duration = Date.now() - start
    whisperContextRef.current = ctx
    appendLog('Initialized context', ctx.id, `in ${duration}ms`)
  }, [appendLog])

  return (
    <ScrollView contentContainerStyle={styles.scrollview}>
      <View style={styles.container}>
        <Text style={styles.title}>Folder Watcher</Text>
        <Text style={styles.pathText}>
          Drop .wav/.mp3/etc files into:
          {'\n'}
          {inboxDir}
        </Text>
        <Button
          title="Prepare Inbox Folder"
          onPress={async () => ensureInboxDirs(appendLog)}
        />
        <Button title="Initialize Whisper (base asset)" onPress={initializeWhisper} />
        <Button
          title={isWatching ? 'Stop Watcher' : 'Start Watcher'}
          onPress={isWatching ? stopWatcher : startWatcher}
        />
        <Text style={styles.stateText}>
          Watcher:
          {' '}
          {isWatching ? 'running' : 'stopped'}
        </Text>
        <Text style={styles.stateText}>
          Active file:
          {' '}
          {activeFile ?? 'idle'}
        </Text>
        <Text style={styles.stateText}>
          Files processed:
          {' '}
          {processedCount}
        </Text>
        <Text style={styles.stateText}>
          Data processed:
          {' '}
          {formatBytes(processedBytes)}
        </Text>

        <Text style={styles.sectionTitle}>Transcripts</Text>
        {transcripts.length === 0 && (
          <Text style={styles.pathText}>No files processed yet.</Text>
        )}
        {transcripts.map((entry, index) => (
          <View key={`${entry.file}-${index}`} style={styles.transcriptItem}>
            <Text style={styles.transcriptFile}>{entry.file}</Text>
            <Text style={styles.transcriptResult}>
              Status:
              {' '}
              {entry.status}
              {entry.durationMs ? ` (${entry.durationMs}ms)` : ''}
            </Text>
            {entry.status === 'success' && entry.text ? (
              <Text style={styles.transcriptResult}>{entry.text}</Text>
            ) : null}
            {entry.status === 'error' && entry.error ? (
              <Text style={styles.transcriptResult}>
                Error:
                {' '}
                {entry.error}
              </Text>
            ) : null}
          </View>
        ))}

        <Text style={styles.sectionTitle}>Logs</Text>
        <View style={styles.logContainer}>
          {logs.map((entry) => {
            if (entry.kind === 'plain') {
              return (
                <Text key={entry.id} style={styles.logText}>
                  {entry.text}
                </Text>
              )
            }
            if (entry.kind === 'segment') {
              return (
                <Text key={entry.id} style={styles.logText}>
                  [Watcher] segment{' '}
                  <Text style={styles.logTimestamp}>{entry.start}</Text>
                  {' '}
                  →
                  {' '}
                  <Text style={styles.logTimestamp}>{entry.end}</Text>
                  :
                  {' '}
                  <Text style={styles.logTranscript}>{entry.text}</Text>
                </Text>
              )
            }
            if (entry.kind === 'timeline') {
              return (
                <Text key={entry.id} style={styles.logText}>
                  [Watcher] timeline{' '}
                  {entry.segments.map((segment, index) => (
                    <Text key={`${entry.id}-${segment.start}-${index}`}>
                      [
                      <Text style={styles.logTimestamp}>{segment.start}</Text>
                      -
                      <Text style={styles.logTimestamp}>{segment.end}</Text>
                      ]
                      {' '}
                      <Text style={styles.logTranscript}>{segment.text}</Text>
                      {index < entry.segments.length - 1 ? ' | ' : ''}
                    </Text>
                  ))}
                </Text>
              )
            }
            if (entry.kind === 'token') {
              return (
                <Text key={entry.id} style={styles.logText}>
                  [Watcher] token{' '}
                  <Text style={styles.logTimestamp}>{entry.start}</Text>
                  {' '}
                  →
                  {' '}
                  <Text style={styles.logTimestamp}>{entry.end}</Text>
                  :
                  {' '}
                  <Text style={styles.logTranscript}>{entry.text}</Text>
                </Text>
              )
            }
            return (
              <Text key={entry.id} style={styles.logText}>
                [Watcher] transcript{' '}
                <Text style={styles.logTranscript}>{entry.text}</Text>
              </Text>
            )
          })}
        </View>
      </View>
    </ScrollView>
  )
}

