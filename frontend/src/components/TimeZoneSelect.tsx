/** Every IANA zone the browser knows (plus the current value, in case it's unusual). */
function zoneOptions(current: string): string[] {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return zones.includes(current) ? zones : [current, ...zones]
}

export function TimeZoneSelect({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {zoneOptions(value).map((zone) => (
        <option key={zone} value={zone}>
          {zone.replaceAll('_', ' ')}
        </option>
      ))}
    </select>
  )
}
