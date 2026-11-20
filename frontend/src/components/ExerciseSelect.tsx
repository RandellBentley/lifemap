import { errorMessage } from '../api/client'
import { useCreateExercise, useExercises } from '../api/hooks'

const ADD_NEW = '__add_new__'

interface Props {
  value: string
  onChange: (exerciseId: string) => void
  /** Name being typed for a new exercise; undefined while the dropdown shows. The parent holds
   * it so saving the form can add a typed name the user never confirmed with "Add". */
  newName: string | undefined
  onNewNameChange: (name: string | undefined) => void
}

/** Dropdown of the user's exercises, with "+ Add new exercise…" that saves to the library. */
export function ExerciseSelect({ value, onChange, newName, onNewNameChange }: Props) {
  const { data: exercises = [] } = useExercises()
  const create = useCreateExercise()
  const name = newName ?? ''

  const add = async () => {
    if (!name.trim()) return
    const exercise = await create.mutateAsync(name)
    onChange(exercise.id)
    onNewNameChange(undefined)
  }

  if (newName !== undefined) {
    return (
      <span className="exercise-add">
        <input
          autoFocus
          value={name}
          onChange={(e) => onNewNameChange(e.target.value)}
          placeholder="e.g. Snatch"
          maxLength={100}
          aria-label="New exercise name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
            if (e.key === 'Escape') onNewNameChange(undefined)
          }}
        />
        <button type="button" className="btn primary small" disabled={create.isPending || !name.trim()} onClick={() => void add()}>
          Add
        </button>
        <button type="button" className="btn ghost small" onClick={() => onNewNameChange(undefined)}>
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
      onChange={(e) => (e.target.value === ADD_NEW ? onNewNameChange('') : onChange(e.target.value))}
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
