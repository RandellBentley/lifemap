import { useState } from 'react'
import { errorMessage } from '../api/client'
import { useCreateExercise, useExercises } from '../api/hooks'

const ADD_NEW = '__add_new__'

/** Dropdown of the user's exercises, with "+ Add new exercise…" that saves to the library. */
export function ExerciseSelect({ value, onChange }: { value: string; onChange: (exerciseId: string) => void }) {
  const { data: exercises = [] } = useExercises()
  const create = useCreateExercise()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const add = async () => {
    if (!name.trim()) return
    const exercise = await create.mutateAsync(name)
    onChange(exercise.id)
    setAdding(false)
    setName('')
  }

  if (adding) {
    return (
      <span className="exercise-add">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Snatch"
          maxLength={100}
          aria-label="New exercise name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
            if (e.key === 'Escape') setAdding(false)
          }}
        />
        <button type="button" className="btn primary small" disabled={create.isPending || !name.trim()} onClick={() => void add()}>
          Add
        </button>
        <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>
          Cancel
        </button>
        {create.isError && <span className="error small">{errorMessage(create.error)}</span>}
      </span>
    )
  }

  return (
    <select
      className="exercise-select"
      value={value}
      aria-label="Exercise"
      onChange={(e) => (e.target.value === ADD_NEW ? setAdding(true) : onChange(e.target.value))}
    >
      <option value="" disabled>
        Choose an exercise…
      </option>
      {exercises.map((ex) => (
        <option key={ex.id} value={ex.id}>
          {ex.name}
        </option>
      ))}
      <option value={ADD_NEW}>+ Add new exercise…</option>
    </select>
  )
}
