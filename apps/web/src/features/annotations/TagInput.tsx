import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { LIMITS } from '@repobs/contracts'
import { suggestTags } from '../dashboard/filters'
import styles from './annotations.module.css'

// Tag entry with autocomplete from tags already in use: type a few characters, then Tab or Enter
// takes the highlighted suggestion (or the typed text when nothing matches).

export function TagInput({
  value,
  onChange,
  known,
  label = 'Tags',
  placeholder = 'Add tag…',
}: {
  value: string[]
  onChange: (tags: string[]) => void
  known: string[]
  label?: string
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const id = useId()
  const suggestions = open ? suggestTags(known, text, value) : []

  const add = (tag: string) => {
    const t = tag.trim().slice(0, LIMITS.tagChars)
    if (t && !value.includes(t) && value.length < LIMITS.tags) onChange([...value, t])
    setText('')
    setActive(0)
  }

  return (
    <div className={styles.tagInput}>
      <div className={styles.tags}>
        {value.map((t) => (
          <span key={t} className={styles.tag}>
            {t}
            <button type="button" className={styles.tagRemove} onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          id={id}
          className={`input ${styles.tagField}`}
          aria-label={label}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={suggestions.length ? `${id}-opt-${active}` : undefined}
          value={text}
          placeholder={placeholder}
          maxLength={LIMITS.tagChars}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && suggestions.length) {
              e.preventDefault()
              setActive((a) => (a + 1) % suggestions.length)
            } else if (e.key === 'ArrowUp' && suggestions.length) {
              e.preventDefault()
              setActive((a) => (a - 1 + suggestions.length) % suggestions.length)
            } else if ((e.key === 'Tab' && text.trim() && suggestions.length) || e.key === 'Enter' || e.key === ',') {
              if (!text.trim() && e.key !== 'Enter') return
              e.preventDefault()
              const exact = suggestions.find((s) => s.toLowerCase() === text.trim().toLowerCase())
              add(exact ?? (suggestions.length && text.trim() ? suggestions[active]! : text))
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1))
            } else if (e.key === 'Escape' && open && suggestions.length) {
              // Close the suggestions only, not a menu or dialog the field sits in.
              e.stopPropagation()
              setOpen(false)
            }
          }}
        />
      </div>
      {suggestions.length ? (
        <ul id={`${id}-list`} role="listbox" className={styles.suggestions} aria-label="Existing tags">
          {suggestions.map((s, i) => (
            <li
              key={s}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? styles.suggestionActive : undefined}
              onMouseDown={(e) => {
                e.preventDefault()
                add(s)
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
