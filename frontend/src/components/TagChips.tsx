import { Link } from 'react-router'

export function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <ul className="tags">
      {tags.map((tag) => (
        <li key={tag}>
          <Link to={`/timeline?tag=${encodeURIComponent(tag)}`} className="tag">
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  )
}
