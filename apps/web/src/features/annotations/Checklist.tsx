import { useId, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { type ChecklistItem, LIMITS } from '@repobs/contracts'
import styles from './annotations.module.css'

// Human checklist. When every item is done, the list collapses behind a "Show completed"
// disclosure; nothing is deleted unless the user deletes an item explicitly.

export type DraftItem = Omit<ChecklistItem, 'createdAt'> & { createdAt?: string }

export function Checklist({ items, onChange }: { items: DraftItem[]; onChange: (items: DraftItem[]) => void }) {
  const [text, setText] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const inputId = useId()
  const allDone = items.length > 0 && items.every((i) => i.done)
  const ordered = [...items].sort((a, b) => a.order - b.order)

  const commit = (next: DraftItem[]) => onChange(next.map((item, order) => ({ ...item, order })))
  const add = () => {
    const value = text.trim()
    if (!value || items.length >= LIMITS.checklistItems) return
    commit([...ordered, { id: crypto.randomUUID(), text: value.slice(0, LIMITS.checklistTextChars), done: false, order: ordered.length }])
    setText('')
    setShowCompleted(false)
  }
  const move = (index: number, delta: number) => {
    const next = [...ordered]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item!)
    commit(next)
  }

  return (
    <div className={styles.checklist}>
      {allDone && !showCompleted ? (
        <div className={styles.completeSummary}>
          <span>
            ✓ All {items.length} checklist item{items.length > 1 ? 's' : ''} complete
          </span>
          <button type="button" className="btn" aria-expanded={false} onClick={() => setShowCompleted(true)}>
            Show completed
          </button>
        </div>
      ) : (
        <>
          {allDone ? (
            <button type="button" className="btn btn-quiet" aria-expanded={true} onClick={() => setShowCompleted(false)}>
              Hide completed
            </button>
          ) : null}
          <ul className={styles.items} aria-label="Checklist">
            {ordered.map((item, index) => (
              <li key={item.id} className={styles.item}>
                <label className={styles.itemLabel}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) => commit(ordered.map((i) => (i.id === item.id ? { ...i, done: e.target.checked } : i)))}
                  />
                  <span className={item.done ? styles.done : undefined}>{item.text}</span>
                </label>
                <span className={styles.itemActions}>
                  <button type="button" className="btn btn-quiet btn-icon" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move "${item.text}" up`}>
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-icon"
                    disabled={index === ordered.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move "${item.text}" down`}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-icon btn-danger"
                    onClick={() => commit(ordered.filter((i) => i.id !== item.id))}
                    aria-label={`Delete "${item.text}"`}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={styles.addRow}>
        <label htmlFor={inputId} className="visually-hidden">
          New checklist item
        </label>
        <input
          id={inputId}
          className="input"
          placeholder="Add a checklist item…"
          value={text}
          maxLength={LIMITS.checklistTextChars}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="btn" onClick={add} disabled={!text.trim()}>
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  )
}
