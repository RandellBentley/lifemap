import { api } from '../api/client'
import type { MediaAsset, UploadTicket } from '../api/types'

/**
 * Uploads go straight from the browser to S3 with a presigned POST, so large
 * videos never pass through Django:
 *   1. ask the API for a ticket (it validates type/size and creates a pending asset)
 *   2. POST the file to S3 with the signed form fields
 *   3. tell the API the upload finished; processing (thumbnails etc.) happens async
 */
export async function uploadMedia(
  entryId: string,
  file: File,
  onProgress?: (fraction: number) => void,
  tags: string[] = [],
): Promise<MediaAsset> {
  const ticket = await api<UploadTicket>(`/entries/${entryId}/media/`, {
    method: 'POST',
    json: { filename: file.name, content_type: file.type, size: file.size, tags },
  })
  return sendToStorage(ticket, file, onProgress)
}

/** Upload the single photo/video of a goal or milestone (replaces any existing one). */
export async function uploadSingle(
  ticketPath: string,
  file: File,
  onProgress?: (fraction: number) => void,
  tags: string[] = [],
): Promise<MediaAsset> {
  const ticket = await api<UploadTicket>(ticketPath, {
    method: 'POST',
    json: { filename: file.name, content_type: file.type, size: file.size, tags },
  })
  return sendToStorage(ticket, file, onProgress)
}

export interface EventPlacement {
  entry: string
  date: string
  day: number
  outside: boolean
  created_entry: boolean
}

/** Upload to an event; the server files it under the day it was captured. */
export async function uploadToEvent(
  eventId: string,
  file: File,
  capturedAt: string,
  tags: string[] = [],
  onProgress?: (fraction: number) => void,
): Promise<{ asset: MediaAsset; placement: EventPlacement }> {
  const ticket = await api<UploadTicket & { placement: EventPlacement }>(`/events/${eventId}/media/`, {
    method: 'POST',
    json: { filename: file.name, content_type: file.type, size: file.size, tags, captured_at: capturedAt },
  })
  const asset = await sendToStorage(ticket, file, onProgress)
  return { asset, placement: ticket.placement }
}

async function sendToStorage(ticket: UploadTicket, file: File, onProgress?: (fraction: number) => void) {
  const form = new FormData()
  for (const [key, value] of Object.entries(ticket.upload.fields)) form.append(key, value)
  form.append('file', file) // must be the last field

  await postWithProgress(ticket.upload.url, form, onProgress)
  return api<MediaAsset>(`/media/${ticket.asset.id}/complete/`, { method: 'POST' })
}

function postWithProgress(url: string, form: FormData, onProgress?: (fraction: number) => void) {
  // fetch() has no upload progress events, so use XHR.
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`))
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(form)
  })
}
