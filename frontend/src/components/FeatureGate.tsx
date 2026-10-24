import type { ReactNode } from 'react'
import { useFeature } from '../api/hooks'
import type { Feature } from '../api/types'

/** Renders children only where `feature` is switched on (e.g. a nav link or a route). */
export function FeatureGate({ feature, children, fallback = null }: { feature: Feature; children: ReactNode; fallback?: ReactNode }) {
  return <>{useFeature(feature) ? children : fallback}</>
}
