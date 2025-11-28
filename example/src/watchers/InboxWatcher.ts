import RNFS from 'react-native-fs'
import { ensureInboxDirs, inboxDir, processedDir, failedDir } from '../util'

type InboxWatcherOptions = {
  onFile: (filePath: string) => Promise<void> | void
  pollIntervalMs?: number
  extensions?: string[]
  log?: (message: string, ...rest: any[]) => void
}

const DEFAULT_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.flac', '.ogg']

export class InboxWatcher {
  private readonly onFile: InboxWatcherOptions['onFile']

  private readonly pollIntervalMs: number

  private readonly extensions: string[]

  private readonly log?: InboxWatcherOptions['log']

  private timer: ReturnType<typeof setInterval> | null = null

  private isScanning = false

  private readonly seen = new Set<string>()

  private readonly queue: string[] = []

  private isProcessingQueue = false

  constructor(options: InboxWatcherOptions) {
    this.onFile = options.onFile
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000
    this.extensions = options.extensions ?? DEFAULT_EXTENSIONS
    this.log = options.log
  }

  async start() {
    if (this.timer) return
    await ensureInboxDirs(this.log)
    await this.scanAndQueue()
    this.timer = setInterval(() => {
      this.scanAndQueue().catch((error) => {
        this.log?.('[InboxWatcher] scan failed', error)
      })
    }, this.pollIntervalMs)
    this.log?.('[InboxWatcher] started', inboxDir)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.queue.length = 0
    this.isProcessingQueue = false
    this.isScanning = false
    this.log?.('[InboxWatcher] stopped')
  }

  isRunning() {
    return Boolean(this.timer)
  }

  private async scanAndQueue() {
    if (this.isScanning) return
    this.isScanning = true
    try {
      const entries = await RNFS.readDir(inboxDir)
      const files = entries.filter((entry) => {
        const normalizedPath = entry.path.replace(/\/+$/, '')
        if (normalizedPath === processedDir || normalizedPath === failedDir) {
          return false
        }
        if (entry.isDirectory()) return false
        return this.extensions.some((ext) =>
          entry.name.toLowerCase().endsWith(ext.toLowerCase()),
        )
      })

      files.forEach((file) => this.enqueue(file.path))
    } finally {
      this.isScanning = false
    }
  }

  private enqueue(path: string) {
    if (this.seen.has(path)) return
    this.seen.add(path)
    this.queue.push(path)
    void this.processQueue()
  }

  private async processQueue() {
    if (this.isProcessingQueue) return
    this.isProcessingQueue = true
    try {
      await this.drainQueue()
    } finally {
      this.isProcessingQueue = false
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.queue.length === 0) {
      return
    }
    const filePath = this.queue.shift()
    if (!filePath) {
      await this.drainQueue()
      return
    }
    try {
      await this.onFile(filePath)
    } catch (error) {
      this.log?.('[InboxWatcher] onFile handler failed', filePath, error)
    } finally {
      this.seen.delete(filePath)
    }
    await this.drainQueue()
  }
}

