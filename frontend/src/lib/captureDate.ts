import exifr from 'exifr'

export type CaptureSource = 'exif' | 'filename' | 'file'

export interface CaptureDate {
  /**
   * Either a naive local wall-clock time ("2026-07-05T14:32:00", from EXIF or the filename;
   * already in the zone where the photo was taken) or an ISO instant with offset.
   */
  value: string
  source: CaptureSource
}

// IMG_20260705_143200.jpg, PXL_20260705_143200123.mp4, 2026-07-05 14.32.00.jpg, ...
const FILENAME_DATE = /(20\d{2})-?(\d{2})-?(\d{2})[ _T-]?(\d{2})[.:-]?(\d{2})[.:-]?(\d{2})/

/** When a photo/video was taken: EXIF, then a date in the filename, then the file's timestamp. */
export async function readCaptureDate(file: File): Promise<CaptureDate> {
  if (file.type.startsWith('image/')) {
    try {
      // reviveValues: false keeps "YYYY:MM:DD HH:MM:SS" as written, without shifting zones.
      const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'], reviveValues: false })
      const raw: unknown = tags?.DateTimeOriginal ?? tags?.CreateDate
      if (typeof raw === 'string' && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
        // Keep the wall-clock time and ignore any OffsetTimeOriginal: the day a photo belongs
        // to is the local date where it was taken, even if the event uses another zone.
        return { value: `${raw.slice(0, 10).replaceAll(':', '-')}T${raw.slice(11, 19)}`, source: 'exif' }
      }
    } catch {
      // unreadable/absent EXIF: fall through
    }
  }

  const m = FILENAME_DATE.exec(file.name)
  if (m && Number(m[2]) <= 12 && Number(m[3]) <= 31) {
    return { value: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, source: 'filename' }
  }
  return { value: new Date(file.lastModified).toISOString(), source: 'file' }
}

/** Calendar date of a capture time in `timeZone` (naive times already are local). */
export function captureDay(value: string, timeZone: string): string {
  const hasZone = /(Z|[+-]\d{2}:\d{2})$/.test(value)
  if (!hasZone) return value.slice(0, 10)
  // en-CA formats as yyyy-mm-dd.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(value),
  )
}
