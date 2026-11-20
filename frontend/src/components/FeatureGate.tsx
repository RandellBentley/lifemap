import type { ReactNode } from 'react'
import { useAppConfig } from '../api/hooks'
import type { Feature } from '../api/types'

interface Props {
  feature: Feature
  children: ReactNode
  /** Shown where the feature is off (e.g. a "not found" page for a flagged route). */
  fallback?: ReactNode
  /** Shown while the config loads, so a flagged route doesn't flash "not found" first. */
  loading?: ReactNode
}

/** Renders children only where `feature` is switched on (a nav link, a route, a menu item). */
export function FeatureGate({ feature, children, fallback = null, loading = null }: Props) {
  const config = useAppConfig()
  if (config.isPending) return <>{loading}</>
  return <>{config.data?.features.includes(feature) ? children : fallback}</>
}
