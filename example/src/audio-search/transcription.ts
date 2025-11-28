import type { TranscribeResult } from '../../../src'
import { toTimestamp } from '../util'
import type { WordTimestamp } from './types'

const normalizeToken = (value: string) =>
  value
    ?.normalize?.('NFKD')
    ?.replace(/[\u0300-\u036f]/g, '')
    ?.replace(/[^a-zA-Z0-9]/g, '')
    ?.toLowerCase() ?? ''

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const resolveTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value
  }
  return fallback
}

export const buildWordTimestamps = (
  segments: TranscribeResult['segments'],
): WordTimestamp[] => {
  if (!segments?.length) {
    return []
  }
  const tokens: WordTimestamp[] = []
  segments.forEach((segment) => {
    const segmentStart = resolveTimestamp(segment.t0, 0)
    const segmentEnd = resolveTimestamp(segment.t1, segmentStart)
    const rawTokens: any[] = (segment as any)?.tokens ?? []
    if (!rawTokens.length) {
      const fallbackToken = segment.text?.trim() ?? ''
      if (fallbackToken.length === 0) {
        return
      }
      const normalized = normalizeToken(fallbackToken)
      tokens.push({
        token: fallbackToken,
        normalized,
        start10ms: segmentStart,
        end10ms: segmentEnd,
        startSeconds: segmentStart / 100,
        endSeconds: segmentEnd / 100,
        label: toTimestamp(segmentStart, true),
      })
      return
    }
    rawTokens.forEach((token) => {
      const tokenText =
        typeof token.text === 'string' && token.text.trim().length > 0
          ? token.text.trim()
          : segment.text?.trim() ?? ''
      if (!tokenText) {
        return
      }
      const normalized = normalizeToken(tokenText)
      if (!normalized) {
        return
      }
      const start = resolveTimestamp(token.t0 ?? token.t, segmentStart)
      const end = resolveTimestamp(token.t1 ?? token.tEnd, start)
      tokens.push({
        token: tokenText,
        normalized,
        start10ms: start,
        end10ms: end,
        startSeconds: start / 100,
        endSeconds: end / 100,
        label: toTimestamp(start, true),
      })
    })
  })
  return tokens
}

export const searchWordInTokens = (
  word: string,
  tokens: WordTimestamp[],
): Array<{ label: string; seconds: number }> => {
  const normalizedWord = normalizeToken(word)
  if (!normalizedWord) {
    return []
  }
  return tokens
    .filter((token) => token.normalized === normalizedWord)
    .map((token) => ({
      label: token.label,
      seconds: token.startSeconds,
    }))
}

export const searchWordInSegments = (
  word: string,
  segments: TranscribeResult['segments'],
): Array<{ label: string; seconds: number }> => {
  if (!word || !segments?.length) {
    return []
  }
  const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi')
  const matches: Array<{ label: string; seconds: number }> = []
  segments.forEach((segment) => {
    if (!segment.text) {
      return
    }
    const segmentStart = resolveTimestamp(segment.t0, 0)
    const occurrences = segment.text.match(regex)
    if (!occurrences?.length) {
      return
    }
    for (let index = 0; index < occurrences.length; index += 1) {
      matches.push({
        label: toTimestamp(segmentStart, true),
        seconds: segmentStart / 100,
      })
    }
  })
  return matches
}

export const combineSegmentsText = (segments: TranscribeResult['segments']) =>
  segments
    ?.map((segment) => segment.text?.trim() ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() ?? ''

