import RNFS from 'react-native-fs'

export const fileDir = `${RNFS.DocumentDirectoryPath}/whisper`
export const inboxDir = `${fileDir}/inbox`
export const processedDir = `${inboxDir}/processed`
export const failedDir = `${inboxDir}/failed`

const ensureDir = async (path: string, log?: (message: string, ...rest: any[]) => void) => {
  if (await RNFS.exists(path)) return
  log?.('Create dir', path)
  await RNFS.mkdir(path)
}

export const ensureInboxDirs = async (log?: (message: string, ...rest: any[]) => void) => {
  await ensureDir(fileDir, log)
  await ensureDir(inboxDir, log)
  await ensureDir(processedDir, log)
  await ensureDir(failedDir, log)
}

const moveTo = async (
  filePath: string,
  targetDir: string,
  log?: (message: string, ...rest: any[]) => void,
) => {
  await ensureDir(targetDir, log)
  const fileName = filePath.split('/').pop()
  if (!fileName) {
    throw new Error(`Unable to determine file name for ${filePath}`)
  }
  const destPath = `${targetDir}/${fileName}`
  if (await RNFS.exists(destPath)) {
    await RNFS.unlink(destPath)
  }
  await RNFS.moveFile(filePath, destPath)
  log?.('Moved file', filePath, '→', destPath)
  return destPath
}

export const moveFileToProcessed = async (
  filePath: string,
  log?: (message: string, ...rest: any[]) => void,
) => moveTo(filePath, processedDir, log)

export const moveFileToFailed = async (
  filePath: string,
  log?: (message: string, ...rest: any[]) => void,
) => moveTo(filePath, failedDir, log)

export function toTimestamp(t: number, comma = false) {
  let msec = t * 10
  const hr = Math.floor(msec / (1000 * 60 * 60))
  msec -= hr * (1000 * 60 * 60)
  const min = Math.floor(msec / (1000 * 60))
  msec -= min * (1000 * 60)
  const sec = Math.floor(msec / 1000)
  msec -= sec * 1000

  const separator = comma ? ',' : '.'
  const timestamp = `${String(hr).padStart(2, '0')}:${String(min).padStart(
    2,
    '0',
  )}:${String(sec).padStart(2, '0')}${separator}${String(msec).padStart(
    3,
    '0',
  )}`

  return timestamp
}
