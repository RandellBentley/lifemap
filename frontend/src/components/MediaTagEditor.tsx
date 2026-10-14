import { useEffect, useState } from 'react'
import { useUpdateMediaTags } from '../api/hooks'
import type { MediaAsset } from '../api/types'
import { TagInput } from './TagInput'

/** Tags for one photo/video, saved as you add or remove them. */
export function MediaTagEditor({ asset, className }: { asset: MediaAsset; className?: string }) {
  const update = useUpdateMediaTags()
  const [tags, setTags] = useState(asset.tags)

  // Follow the asset when the viewer moves to another item or fresh data arrives.
  const serverTags = asset.tags.join('\u0000')
  useEffect(() => setTags(asset.tags), [asset.id, serverTags])

  const onChange = (next: string[]) => {
    setTags(next) // optimistic; the refetch after saving confirms
    update.mutate({ id: asset.id, tags: next }, { onError: () => setTags(asset.tags) })
  }

  return (
    <div className="media-tag-editor">
      <TagInput value={tags} onChange={onChange} placeholder="Tag this photo…" className={className} />
      {update.isError && <span className="error small">Couldn’t save tags</span>}
    </div>
  )
}
