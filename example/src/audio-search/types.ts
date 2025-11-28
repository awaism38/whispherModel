import type { TranscribeResult } from '../../../src'

export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.oga',
]

export type AudioFileEntry = {
  id: string
  path: string
  name: string
  size?: number
  status: 'pending' | 'transcribing' | 'done' | 'error'
  error?: string
  transcription?: TranscriptionSummary
}

export type TranscriptionSummary = {
  text: string
  segments: TranscribeResult['segments']
  tokens: WordTimestamp[]
}

export type WordTimestamp = {
  token: string
  normalized: string
  start10ms: number
  end10ms: number
  startSeconds: number
  endSeconds: number
  label: string
}

export type SearchResultItem = {
  fileName: string
  filePath: string
  word: string
  matches: Array<{ label: string; seconds: number }>
}

