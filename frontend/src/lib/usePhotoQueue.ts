import { useCallback, useRef, useState } from 'react'
import { errorMessage } from '../api/client'
import { readCaptureDate, type CaptureSource } from './captureDate'
import { uploadToEvent, type EventPlacement } from './upload'

export interface QueuedPhoto {
  id: string
  file: File
  capturedAt: string
  source: CaptureSource
  status: 'queued' | 'uploading' | 'done' | 'error'
  progress: number
  error?: string
  placement?: EventPlacement
}

export interface UploadSummary {
  uploaded: number
  failed: number
  days: number
  createdDays: number
  outside: number
}

const PARALLEL_UPLOADS = 3

/** Files waiting to be added to an event, with their capture dates read up front. */
export function usePhotoQueue() {
  const [items, setItems] = useState<QueuedPhoto[]>([])
  const [reading, setReading] = useState(0)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const patch = (id: string, change: Partial<QueuedPhoto>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)))

  const add = useCallback(async (files: File[]) => {
    const media = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
    setReading((n) => n + media.length)
    const read = await Promise.all(
      media.map(async (file) => {
        const captured = await readCaptureDate(file)
        setReading((n) => n - 1)
        return { id: crypto.randomUUID(), file, capturedAt: captured.value, source: captured.source,
                 status: 'queued' as const, progress: 0 }
      }),
    )
    setItems((list) => [...list, ...read])
  }, [])

  const remove = (id: string) => setItems((list) => list.filter((item) => item.id !== id))
  const clearFinished = () => setItems((list) => list.filter((item) => item.status !== 'done'))

  /** Upload everything queued (or failed) to the event, a few at a time. */
  const uploadAll = async (eventId: string, tags: string[]): Promise<UploadSummary> => {
    const pending = itemsRef.current.filter((item) => item.status === 'queued' || item.status === 'error')
    const results: (EventPlacement | null)[] = []
    let next = 0
    const worker = async () => {
      while (next < pending.length) {
        const item = pending[next++]
        patch(item.id, { status: 'uploading', progress: 0, error: undefined })
        try {
          const { placement } = await uploadToEvent(eventId, item.file, item.capturedAt, tags, (progress) =>
            patch(item.id, { progress }),
          )
          patch(item.id, { status: 'done', progress: 1, placement })
          results.push(placement)
        } catch (err) {
          patch(item.id, { status: 'error', error: errorMessage(err) })
          results.push(null)
        }
      }
    }
    await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker))

    const placed = results.filter((r): r is EventPlacement => r !== null)
    return {
      uploaded: placed.length,
      failed: results.length - placed.length,
      days: new Set(placed.map((p) => p.date)).size,
      createdDays: new Set(placed.filter((p) => p.created_entry).map((p) => p.date)).size,
      outside: placed.filter((p) => p.outside).length,
    }
  }

  return { items, reading, add, remove, clearFinished, uploadAll }
}

export type PhotoQueue = ReturnType<typeof usePhotoQueue>
