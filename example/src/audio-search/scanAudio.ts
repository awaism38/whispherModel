import { PermissionsAndroid, Platform } from 'react-native'
import RNFS from 'react-native-fs'
import { AUDIO_EXTENSIONS, type AudioFileEntry } from './types'

type ScanOptions = {
  roots?: string[]
  maxDepth?: number
  limit?: number
  log?: (message: string, ...rest: any[]) => void
}

const DEFAULT_MAX_DEPTH = 4
const DEFAULT_LIMIT = 200

export async function ensureMediaPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true
  }
  const permission =
    Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
  const hasPermission = await PermissionsAndroid.check(permission)
  if (hasPermission) {
    return true
  }
  const result = await PermissionsAndroid.request(permission, {
    title: 'Audio access required',
    message: 'Allow the app to scan local audio files for transcription.',
    buttonPositive: 'Allow',
    buttonNegative: 'Cancel',
  })
  return result === PermissionsAndroid.RESULTS.GRANTED
}

export const getDefaultScanRoots = () => {
  const roots = new Set<string>()
  if (RNFS.DocumentDirectoryPath) {
    roots.add(RNFS.DocumentDirectoryPath)
  }
  if (Platform.OS === 'android' && RNFS.ExternalStorageDirectoryPath) {
    roots.add(RNFS.ExternalStorageDirectoryPath)
  }
  return Array.from(roots)
}

export async function scanAudioFiles(options: ScanOptions = {}): Promise<AudioFileEntry[]> {
  const {
    roots = getDefaultScanRoots(),
    maxDepth = DEFAULT_MAX_DEPTH,
    limit = DEFAULT_LIMIT,
    log,
  } = options
  const results: AudioFileEntry[] = []
  const seenPaths = new Set<string>()

  const enqueue = (entry: AudioFileEntry) => {
    if (seenPaths.has(entry.path)) {
      return
    }
    seenPaths.add(entry.path)
    results.push(entry)
  }

  const walk = async (directory: string, depth: number) => {
    if (results.length >= limit) {
      return
    }
    if (depth > maxDepth) {
      return
    }
    let entries: RNFS.ReadDirItem[] = []
    try {
      entries = await RNFS.readDir(directory)
    } catch (error) {
      log?.('[Scanner] failed to read dir', directory, error)
      return
    }
    for (const entry of entries) {
      if (results.length >= limit) {
        break
      }
      const normalizedPath = entry.path.replace(/\/+$/, '')
      if (entry.isFile()) {
        const lower = entry.name.toLowerCase()
        if (AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
          enqueue({
            id: normalizedPath,
            path: normalizedPath,
            name: entry.name,
            size: Number(entry.size) || undefined,
            status: 'pending',
          })
        }
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) {
          continue
        }
        await walk(normalizedPath, depth + 1)
      }
    }
  }

  for (const root of roots) {
    await walk(root, 0)
    if (results.length >= limit) {
      break
    }
  }

  log?.(
    `[Scanner] found ${results.length} audio file${results.length === 1 ? '' : 's'} ` +
      `within ${roots.length} root${roots.length === 1 ? '' : 's'}`,
  )

  return results
}

