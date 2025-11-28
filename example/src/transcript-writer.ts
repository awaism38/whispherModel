import RNFS from 'react-native-fs'
import { ensureInboxDirs, processedDir, toTimestamp } from './util'

type WhisperToken = {
  text?: string
  t0?: number
  t1?: number
  t?: number
  tEnd?: number
  p?: number
}

type WhisperSegmentLike = {
  text?: string
  t0?: number
  t1?: number
  tokens?: WhisperToken[]
}

export type TranscriptJsonToken = {
  text: string
  startSamples: number
  endSamples: number
  startTimestamp: string
  endTimestamp: string
  probability: number | null
}

export type TranscriptJsonSegment = {
  index: number
  text: string
  startSamples: number
  endSamples: number
  startTimestamp: string
  endTimestamp: string
  tokens: TranscriptJsonToken[]
}

export type TranscriptJson = {
  originalFilePath: string
  processedFilePath: string | null
  processedAt: string
  text: string
  segments: TranscriptJsonSegment[]
}

type WriteTranscriptJsonOptions = {
  originalFilePath: string
  processedFilePath?: string | null
  combinedText: string
  segments?: WhisperSegmentLike[]
  log?: (message: string, ...rest: any[]) => void
}

const sanitizeFileName = (path: string) => {
  const fileName = path.split('/').pop() || 'transcript'
  return fileName.replace(/\.[^./]+$/, '')
}

const normalizeTimestamp = (value: number | undefined, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return fallback
}

export async function writeTranscriptJson({
  originalFilePath,
  processedFilePath = null,
  combinedText,
  segments = [],
  log,
}: WriteTranscriptJsonOptions) {
  await ensureInboxDirs(log)
  const baseName = sanitizeFileName(processedFilePath ?? originalFilePath)
  const jsonPath = `${processedDir}/${baseName}.json`

  const formattedSegments: TranscriptJsonSegment[] = segments.map((segment, index) => {
    const startSamples = normalizeTimestamp(segment.t0, 0)
    const endSamples = normalizeTimestamp(segment.t1, startSamples)
    const tokens: TranscriptJsonToken[] =
      segment.tokens?.map((token) => {
        const tokenStart = normalizeTimestamp(token.t0 ?? token.t, startSamples)
        const tokenEnd = normalizeTimestamp(token.t1 ?? token.tEnd, tokenStart)
        const trimmedText =
          typeof token.text === 'string' && token.text.trim().length > 0
            ? token.text
            : '<blank>'
        return {
          text: trimmedText,
          startSamples: tokenStart,
          endSamples: tokenEnd,
          startTimestamp: toTimestamp(tokenStart, true),
          endTimestamp: toTimestamp(tokenEnd, true),
          probability: typeof token.p === 'number' ? token.p : null,
        }
      }) ?? []

    return {
      index,
      text: segment.text?.trim() || '',
      startSamples,
      endSamples,
      startTimestamp: toTimestamp(startSamples, true),
      endTimestamp: toTimestamp(endSamples, true),
      tokens,
    }
  })

  const payload: TranscriptJson = {
    originalFilePath,
    processedFilePath,
    processedAt: new Date().toISOString(),
    text: combinedText,
    segments: formattedSegments,
  }

  await RNFS.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8')
  log?.('[TranscriptWriter] saved JSON', jsonPath)

  return { jsonPath, payload }
}

