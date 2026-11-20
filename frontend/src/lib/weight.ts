import { useEffect, useState } from 'react'

/** The API always speaks kilograms; the UI shows whichever unit the user picks. */
export type WeightUnit = 'kg' | 'lb'

const KG_PER_LB = 0.45359237
const STORAGE_KEY = 'lifemap.weightUnit'

/** Display value -> kg, rounded to the 4 decimals the API stores (so 225 lb reads back as 225). */
export function toKg(value: number, unit: WeightUnit): number {
  const kg = unit === 'kg' ? value : value * KG_PER_LB
  return Math.round(kg * 10_000) / 10_000
}

export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB
}

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/** "62.5 kg" / "137.79 lb"; "—" for no weight (bodyweight work). */
export function formatWeight(kg: number | null, unit: WeightUnit): string {
  return kg === null ? '—' : `${number.format(fromKg(kg, unit))} ${unit}`
}

/** The user's kg/lb choice, remembered in this browser and shared by every component. */
export function useWeightUnit(): [WeightUnit, (unit: WeightUnit) => void] {
  const [unit, setUnit] = useState<WeightUnit>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'lb' ? 'lb' : 'kg'
    } catch {
      return 'kg' // storage unavailable (private mode, blocked cookies)
    }
  })

  useEffect(() => {
    const sync = (e: Event) => setUnit((e as CustomEvent<WeightUnit>).detail)
    window.addEventListener(STORAGE_KEY, sync)
    return () => window.removeEventListener(STORAGE_KEY, sync)
  }, [])

  const update = (next: WeightUnit) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // not persisted; still applies for this page
    }
    window.dispatchEvent(new CustomEvent(STORAGE_KEY, { detail: next }))
  }
  return [unit, update]
}
