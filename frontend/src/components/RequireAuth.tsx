import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useMe } from '../api/hooks'

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) return <div className="center muted">Loading…</div>
  if (me.isError) return <div className="center error">Couldn’t reach the server. Try again shortly.</div>

  if (!me.data) {
    // Login is a full-page redirect: Django runs the OAuth flow and sets a session cookie.
    const next = encodeURIComponent(location.pathname + location.search)
    return (
      <div className="login">
        <h1>LifeMap</h1>
        <p className="muted">A private journal of the moments that matter.</p>
        <a className="btn primary large" href={`/api/auth/login/?next=${next}`}>
          Sign in
        </a>
      </div>
    )
  }

  return <>{children}</>
}
