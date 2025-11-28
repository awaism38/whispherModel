import { useCallback, useEffect, useRef } from 'react'
import Sound from 'react-native-sound'

Sound.setCategory('Playback')

export function useAudioPlayer() {
  const soundRef = useRef<Sound | null>(null)

  const stop = useCallback(() => {
    const current = soundRef.current
    if (current) {
      current.stop(() => {
        current.release()
      })
      soundRef.current = null
    }
  }, [])

  const play = useCallback(
    (filePath: string, startSeconds: number) => {
      stop()
      const normalizedPath = filePath.startsWith('file://')
        ? filePath.replace('file://', '')
        : filePath
      return new Promise<void>((resolve, reject) => {
        const sound = new Sound(normalizedPath, '', (error) => {
          if (error) {
            reject(error)
            return
          }
          soundRef.current = sound
          if (startSeconds > 0) {
            sound.setCurrentTime(startSeconds)
          }
          sound.play((success) => {
            if (!success) {
              reject(new Error('Playback failed'))
            } else {
              resolve()
            }
            sound.release()
            if (soundRef.current === sound) {
              soundRef.current = null
            }
          })
        })
      })
    },
    [stop],
  )

  useEffect(
    () => () => {
      stop()
    },
    [stop],
  )

  return { play, stop }
}

