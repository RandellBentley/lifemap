import { useId, useState, type KeyboardEvent } from 'react'
import { useTags } from '../api/hooks'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  className?: string
}

/** Type a tag and press Enter or comma; suggestions come from the user's existing tags. */
export function TagInput({ value, onChange, placeholder = 'Add tags…', className = '' }: Props) {
  const [draft, setDraft] = useState('')
  const { data: existing = [] } = useTags()
  const listId = useId()

  const add = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '')
    if (tag && !value.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...value, tag])
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className={`tag-input ${className}`}>
      {value.map((tag) => (
        <span key={tag} className="tag">
          #{tag}
          <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} aria-label={`Remove ${tag}`}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft && add(draft)}
        list={listId}
        placeholder={value.length ? '' : placeholder}
      />
      <datalist id={listId}>
        {existing.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
    </div>
  )
}
