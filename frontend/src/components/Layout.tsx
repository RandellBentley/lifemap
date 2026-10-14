import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { logout, useMe } from '../api/hooks'

export function Layout({ children }: { children: ReactNode }) {
  const { data: user } = useMe()

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            LifeMap
          </Link>
          <nav className="nav">
            <NavLink to="/timeline">Timeline</NavLink>
            <NavLink to="/calendar">Calendar</NavLink>
            <NavLink to="/photos">Photos</NavLink>
            <NavLink to="/goals">Goals</NavLink>
          </nav>
          <div className="spacer" />
          <NewMenu />
          {user && (
            <button className="btn ghost" onClick={logout} title={user.email}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  )
}

/** "+ New" offers a single-day entry or a multi-day event. */
function NewMenu() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="new-menu" ref={root}>
      <button className="btn primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden>+</span>
        <span className="hide-narrow">New</span>
        <span aria-hidden className="caret">▾</span>
      </button>
      {open && (
        <div className="new-menu-items" role="menu">
          <Link role="menuitem" to="/entries/new">
            <strong>Day entry</strong>
            <span className="muted small">Something that happened on one day</span>
          </Link>
          <Link role="menuitem" to="/events/new">
            <strong>Event</strong>
            <span className="muted small">A trip or occasion spanning several days</span>
          </Link>
          <Link role="menuitem" to="/goals/new">
            <strong>Goal</strong>
            <span className="muted small">Something you’re working toward, with milestones</span>
          </Link>
        </div>
      )}
    </div>
  )
}
