import {
  NativeEventEmitter,
  DeviceEventEmitter,
  Platform,
  DeviceEventEmitterStatic,
  Image,
} from 'react-native'
import RNWhisper, { NativeWhisperContext } from './NativeRNWhisper'
import type {
  TranscribeOptions,
  TranscribeResult,
  CoreMLAsset,
} from './NativeRNWhisper'
import { version } from './version.json'

declare global {
  // eslint-disable-next-line no-var
  var whisperTranscribeData: (
    contextId: number,
    options: TranscribeOptions,
    data: ArrayBuffer,
  ) => Promise<TranscribeResult>
}

let jsiWhisperTranscribeData: (
  contextId: number,
  options: TranscribeOptions,
  data: ArrayBuffer,
) => Promise<TranscribeResult>

let jsiInstalled = false

const installJSIBindingsIfNeeded = async () => {
  if (jsiInstalled) return
  jsiInstalled = true
  return RNWhisper.installJSIBindings()
    .then(() => {
      jsiWhisperTranscribeData = global.whisperTranscribeData
      delete (global as any).whisperTranscribeData
    })
    .catch((e) => {
      console.warn('Failed to install JSI bindings', e)
    })
}

let EventEmitter: NativeEventEmitter | DeviceEventEmitterStatic
if (Platform.OS === 'ios') {
  // @ts-ignore
  EventEmitter = new NativeEventEmitter(RNWhisper)
}
if (Platform.OS === 'android') {
  EventEmitter = DeviceEventEmitter
}

export type {
  TranscribeOptions,
  TranscribeResult,
}

const EVENT_ON_TRANSCRIBE_PROGRESS = '@RNWhisper_onTranscribeProgress'
const EVENT_ON_TRANSCRIBE_NEW_SEGMENTS = '@RNWhisper_onTranscribeNewSegments'
const EVENT_ON_NATIVE_LOG = '@RNWhisper_onNativeLog'

const logListeners: Array<(level: string, text: string) => void> = []

// @ts-ignore
if (EventEmitter) {
  EventEmitter.addListener(
    EVENT_ON_NATIVE_LOG,
    (evt: { level: string; text: string }) => {
      logListeners.forEach((listener) => listener(evt.level, evt.text))
    },
  )
  // Trigger unset to use default log callback
  RNWhisper?.toggleNativeLog?.(false)?.catch?.(() => {})
}

export type TranscribeNewSegmentsResult = {
  nNew: number
  totalNNew: number
  result: string
  segments: TranscribeResult['segments']
}

export type TranscribeNewSegmentsNativeEvent = {
  contextId: number
  jobId: number
  result: TranscribeNewSegmentsResult
}

// Fn -> Boolean in TranscribeFileNativeOptions
export type TranscribeFileOptions = TranscribeOptions & {
  /**
   * Progress callback, the progress is between 0 and 100
   */
  onProgress?: (progress: number) => void
  /**
   * Callback when new segments are transcribed
   */
  onNewSegments?: (result: TranscribeNewSegmentsResult) => void
}

export type TranscribeProgressNativeEvent = {
  contextId: number
  jobId: number
  progress: number
}

export class WhisperContext {
  ptr: number

  id: number

  gpu: boolean = false

  reasonNoGPU: string = ''

  constructor({
    contextPtr,
    contextId,
    gpu,
    reasonNoGPU,
  }: NativeWhisperContext) {
    this.ptr = contextPtr
    this.id = contextId
    this.gpu = gpu
    this.reasonNoGPU = reasonNoGPU
  }

  private transcribeWithNativeMethod(
    method: 'transcribeFile' | 'transcribeData',
    data: string,
    options: TranscribeFileOptions = {},
  ): {
    stop: () => Promise<void>
    promise: Promise<TranscribeResult>
  } {
    const jobId: number = Math.floor(Math.random() * 10000)

    const { onProgress, onNewSegments, ...rest } = options

    let progressListener: any
    let lastProgress: number = 0
    if (onProgress) {
      progressListener = EventEmitter.addListener(
        EVENT_ON_TRANSCRIBE_PROGRESS,
        (evt: TranscribeProgressNativeEvent) => {
          const { contextId, progress } = evt
          if (contextId !== this.id || evt.jobId !== jobId) return
          lastProgress = progress > 100 ? 100 : progress
          onProgress(lastProgress)
        },
      )
    }
    const removeProgressListener = () => {
      if (progressListener) {
        progressListener.remove()
        progressListener = null
      }
    }

    let newSegmentsListener: any
    if (onNewSegments) {
      newSegmentsListener = EventEmitter.addListener(
        EVENT_ON_TRANSCRIBE_NEW_SEGMENTS,
        (evt: TranscribeNewSegmentsNativeEvent) => {
          const { contextId, result } = evt
          if (contextId !== this.id || evt.jobId !== jobId) return
          onNewSegments(result)
        },
      )
    }
    const removeNewSegmenetsListener = () => {
      if (newSegmentsListener) {
        newSegmentsListener.remove()
        newSegmentsListener = null
      }
    }

    return {
      stop: async () => {
        await RNWhisper.abortTranscribe(this.id, jobId)
        removeProgressListener()
        removeNewSegmenetsListener()
      },
      promise: RNWhisper[method](this.id, jobId, data, {
        ...rest,
        onProgress: !!onProgress,
        onNewSegments: !!onNewSegments,
      })
        .then((result) => {
          removeProgressListener()
          removeNewSegmenetsListener()
          if (!result.isAborted && lastProgress !== 100) {
            // Handle the case that the last progress event is not triggered
            onProgress?.(100)
          }
          return result
        })
        .catch((e) => {
          removeProgressListener()
          removeNewSegmenetsListener()
          throw e
        }),
    }
  }

  /**
   * Transcribe audio file (path or base64 encoded wav file)
   * base64: need add `data:audio/wav;base64,` prefix
   */
  transcribe(
    filePathOrBase64: string | number,
    options: TranscribeFileOptions = {},
  ): {
    /** Stop the transcribe */
    stop: () => Promise<void>
    /** Transcribe result promise */
    promise: Promise<TranscribeResult>
  } {
    let path = ''
    if (typeof filePathOrBase64 === 'number') {
      try {
        const source = Image.resolveAssetSource(filePathOrBase64)
        if (source) path = source.uri
      } catch (e) {
        throw new Error(`Invalid asset: ${filePathOrBase64}`)
      }
    } else {
      if (filePathOrBase64.startsWith('http'))
        throw new Error(
          'Transcribe remote file is not supported, please download it first',
        )
      path = filePathOrBase64
    }
    if (path.startsWith('file://')) path = path.slice(7)
    return this.transcribeWithNativeMethod('transcribeFile', path, options)
  }

  /**
   * Transcribe audio data (base64 encoded float32 PCM data or ArrayBuffer)
   */
  transcribeData(
    data: string | ArrayBuffer,
    options: TranscribeFileOptions = {},
  ): {
    stop: () => Promise<void>
    promise: Promise<TranscribeResult>
  } {
    if (data instanceof ArrayBuffer) {
      // Use JSI function for ArrayBuffer
      if (!jsiWhisperTranscribeData) {
        throw new Error('JSI binding `whisperTranscribeData` not installed')
      }
      return this.transcribeDataArrayBuffer(data, options)
    }
    return this.transcribeWithNativeMethod('transcribeData', data, options)
  }

  /**
   * Transcribe audio data from ArrayBuffer (16-bit PCM, mono, 16kHz)
   */
  private transcribeDataArrayBuffer(
    data: ArrayBuffer,
    options: TranscribeFileOptions = {},
  ): {
    stop: () => Promise<void>
    promise: Promise<TranscribeResult>
  } {
    const { onProgress, onNewSegments, ...rest } = options

    // Generate a unique jobId for this transcription
    const jobId = Math.floor(Math.random() * 10000)

    const jsiOptions = {
      ...rest,
      onProgress: onProgress || undefined,
      onNewSegments: onNewSegments || undefined,
      jobId, // Pass jobId to native implementation
    }

    let isAborted = false
    const promise = jsiWhisperTranscribeData(this.id, jsiOptions, data)
      .then((result: any) => {
        if (isAborted) {
          return { ...result, isAborted: true }
        }
        return result
      })
      .catch((error: any) => {
        if (isAborted) {
          return { isAborted: true, error: 'Transcription aborted' }
        }
        throw error
      })

    return {
      stop: async () => {
        isAborted = true
        try {
          // Use the existing native abort method
          await RNWhisper.abortTranscribe(this.id, jobId)
        } catch (error) {
          // Ignore errors if context is already released or job doesn't exist
        }
      },
      promise,
    }
  }

  async release(): Promise<void> {
    return RNWhisper.releaseContext(this.id)
  }
}

export type ContextOptions = {
  filePath: string | number
  /**
   * CoreML model assets, if you're using `require` on filePath,
   * use this option is required if you want to enable Core ML,
   * you will need bundle weights/weight.bin, model.mil, coremldata.bin into app by `require`
   */
  coreMLModelAsset?: {
    filename: string
    assets: string[] | number[]
  }
  /** Is the file path a bundle asset for pure string filePath */
  isBundleAsset?: boolean
  /** Prefer to use Core ML model if exists. If set to false, even if the Core ML model exists, it will not be used. */
  useCoreMLIos?: boolean
  /** Use GPU if available. Currently iOS only, if it's enabled, Core ML option will be ignored. */
  useGpu?: boolean
  /** Use Flash Attention, only recommended if GPU available */
  useFlashAttn?: boolean
}

const coreMLModelAssetPaths = [
  'analytics/coremldata.bin',
  'weights/weight.bin',
  'model.mil',
  'coremldata.bin',
]

export async function initWhisper({
  filePath,
  coreMLModelAsset,
  isBundleAsset,
  useGpu = true,
  useCoreMLIos = true,
  useFlashAttn = false,
}: ContextOptions): Promise<WhisperContext> {
  await installJSIBindingsIfNeeded()

  let path = ''
  let coreMLAssets: CoreMLAsset[] | undefined
  if (coreMLModelAsset) {
    const { filename, assets } = coreMLModelAsset
    if (filename && assets) {
      coreMLAssets = assets
        ?.map((asset) => {
          if (typeof asset === 'number') {
            const { uri } = Image.resolveAssetSource(asset)
            const filepath = coreMLModelAssetPaths.find((p) => uri.includes(p))
            if (filepath) {
              return {
                uri,
                filepath: `${filename}/${filepath}`,
              }
            }
          } else if (typeof asset === 'string') {
            return {
              uri: asset,
              filepath: `${filename}/${asset}`,
            }
          }
          return undefined
        })
        .filter((asset): asset is CoreMLAsset => asset !== undefined)
    }
  }
  if (typeof filePath === 'number') {
    try {
      const source = Image.resolveAssetSource(filePath)
      if (source) {
        path = source.uri
      }
    } catch (e) {
      throw new Error(`Invalid asset: ${filePath}`)
    }
  } else {
    if (!isBundleAsset && filePath.startsWith('http'))
      throw new Error(
        'Transcribe remote file is not supported, please download it first',
      )
    path = filePath
  }
  if (path.startsWith('file://')) path = path.slice(7)
  const { contextPtr, contextId, gpu, reasonNoGPU } =
    await RNWhisper.initContext({
      filePath: path,
      isBundleAsset: !!isBundleAsset,
      useFlashAttn,
      useGpu,
      useCoreMLIos,
      // Only development mode need download Core ML model assets (from packager server)
      downloadCoreMLAssets: __DEV__ && !!coreMLAssets,
      coreMLAssets,
    })
  return new WhisperContext({ contextPtr, contextId, gpu, reasonNoGPU })
}

export async function releaseAllWhisper(): Promise<void> {
  await installJSIBindingsIfNeeded()

  return RNWhisper.releaseAllContexts()
}

/** Current version of whisper.cpp */
export const libVersion: string = version

const { useCoreML, coreMLAllowFallback } = RNWhisper.getConstants?.() || {}

/** Is use CoreML models on iOS */
export const isUseCoreML: boolean = !!useCoreML

/** Is allow fallback to CPU if load CoreML model failed */
export const isCoreMLAllowFallback: boolean = !!coreMLAllowFallback

let logInitialized = false

export async function toggleNativeLog(enabled: boolean): Promise<void> {
  if (!enabled && !logInitialized) return // If first call is false, skip

  logInitialized = true
  await installJSIBindingsIfNeeded()

  return RNWhisper.toggleNativeLog(enabled)
}

export function addNativeLogListener(
  listener: (level: string, text: string) => void,
): { remove: () => void } {
  logListeners.push(listener)
  return {
    remove: () => {
      logListeners.splice(logListeners.indexOf(listener), 1)
    },
  }
}
