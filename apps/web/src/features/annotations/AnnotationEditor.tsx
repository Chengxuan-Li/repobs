import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { type AgentSession, type AnnotationInput, type AnnotationSummary, LIMITS, REVIEW_LABELS, type ReviewState, type SessionAnnotation } from '@repobs/contracts'
import { api, ApiError } from '../../app/api'
import { Dropdown } from '../../components/Dropdown'
import { InlineAlert } from '../../components/primitives'
import { Checklist, type DraftItem } from './Checklist'
import { TagInput } from './TagInput'
import styles from './annotations.module.css'

// Human-owned notes for one session. Saved automatically (debounced) to the local repobs
// database only — never to Git, transcripts, prompts or any remote service.

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'error'; message: string }

interface Draft {
  displayAlias: string
  review: ReviewState
  tags: string[]
  note: string
  checklist: DraftItem[]
}

const EMPTY: Draft = { displayAlias: '', review: 'unreviewed', tags: [], note: '', checklist: [] }

function toDraft(a: SessionAnnotation | null): Draft {
  return a ? { displayAlias: a.displayAlias ?? '', review: a.review, tags: a.tags, note: a.note, checklist: a.checklist } : EMPTY
}

export function AnnotationEditor({ session, summary, knownTags }: { session: AgentSession; summary?: AnnotationSummary; knownTags: string[] }) {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [confirmClear, setConfirmClear] = useState(false)
  const pending = useRef<Draft | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSavedAt = useRef<string | undefined>(undefined)
  const sessionId = session.id
  const ids = { alias: useId(), note: useId() }

  const flush = useCallback(
    async (id: string) => {
      const d = pending.current
      if (!d) return
      pending.current = undefined
      clearTimeout(timer.current)
      setSave({ kind: 'saving' })
      const body: AnnotationInput = {
        displayAlias: d.displayAlias.trim() || undefined,
        review: d.review,
        tags: d.tags,
        note: d.note,
        checklist: d.checklist,
      }
      try {
        const res = await api<{ annotation: SessionAnnotation }>('PUT', `/sessions/${encodeURIComponent(id)}/annotation`, body)
        lastSavedAt.current = res.annotation.updatedAt
        setSave({ kind: 'saved', at: res.annotation.updatedAt })
      } catch (err) {
        pending.current = pending.current ?? d
        setSave({ kind: 'error', message: err instanceof ApiError ? err.message : 'Save failed' })
      }
    },
    [],
  )

  // Load once per session (the inspector keys this component by session id); flush unsaved edits on unmount.
  useEffect(() => {
    let cancelled = false
    api<{ annotation: SessionAnnotation | null }>('GET', `/sessions/${encodeURIComponent(sessionId)}/annotation`)
      .then((res) => {
        if (cancelled) return
        setDraft(toDraft(res.annotation))
        lastSavedAt.current = res.annotation?.updatedAt
        setLoaded(true)
      })
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof ApiError ? err.message : 'Could not load annotations'))
    return () => {
      cancelled = true
      void flush(sessionId)
    }
  }, [sessionId, flush])

  // Another tab or an import changed this annotation: reload when we have no unsaved edits.
  useEffect(() => {
    if (!loaded || pending.current || !summary || summary.updatedAt === lastSavedAt.current) return
    api<{ annotation: SessionAnnotation | null }>('GET', `/sessions/${encodeURIComponent(sessionId)}/annotation`)
      .then((res) => {
        if (pending.current) return
        setDraft(toDraft(res.annotation))
        lastSavedAt.current = res.annotation?.updatedAt
      })
      .catch(() => undefined)
  }, [summary, loaded, sessionId])

  const update = (patch: Partial<Draft>, immediate = false) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch }
      pending.current = next
      return next
    })
    setSave({ kind: 'saving' })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(sessionId), immediate ? 0 : 700)
  }

  const chooseReview = (review: ReviewState) => update({ review }, true)

  if (loadError) return <InlineAlert tone="danger">{loadError}</InlineAlert>
  if (!loaded) return <p className="muted small">Loading annotations…</p>

  return (
    // Saving is silent unless it fails; data-save tells tests when a save has landed.
    <div className={styles.editor} data-save={save.kind}>
      <div className={styles.inline}>
        <span className="label" aria-hidden="true">
          State
        </span>
        <ReviewDropdown review={draft.review} onChange={chooseReview} />
      </div>
      <div className={styles.field}>
        <label className="label" htmlFor={ids.alias}>
          Display alias
        </label>
        <input
          id={ids.alias}
          className="input"
          value={draft.displayAlias}
          maxLength={LIMITS.aliasChars}
          placeholder={session.title}
          onChange={(e) => update({ displayAlias: e.target.value })}
        />
      </div>
      <div className={styles.field}>
        <span className="label">Tags</span>
        <TagInput value={draft.tags} known={knownTags} onChange={(tags) => update({ tags }, true)} placeholder="Type, then Tab or Enter" />
      </div>
      <div className={styles.field}>
        <label className="label" htmlFor={ids.note}>
          Notes
        </label>
        <textarea
          id={ids.note}
          className="input"
          rows={7}
          value={draft.note}
          maxLength={LIMITS.noteChars}
          placeholder="Plain text; Enter starts a new line."
          onChange={(e) => update({ note: e.target.value })}
        />
      </div>
      <div className={styles.field}>
        <div className={styles.fieldHead}>
          <span className="label">Checklist</span>
          {confirmClear ? null : (
            <button type="button" className="btn btn-quiet btn-danger" onClick={() => setConfirmClear(true)}>
              Clear annotations…
            </button>
          )}
        </div>
        {confirmClear ? (
          <span className={styles.confirm}>
            Delete all notes, tags and checklist for this session?
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setConfirmClear(false)
                pending.current = undefined
                clearTimeout(timer.current)
                void api('DELETE', `/sessions/${encodeURIComponent(sessionId)}/annotation`).then(() => {
                  setDraft(EMPTY)
                  setSave({ kind: 'idle' })
                })
              }}
            >
              Delete
            </button>
            <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
          </span>
        ) : null}
        <Checklist items={draft.checklist} onChange={(checklist) => update({ checklist }, true)} />
      </div>
      <div aria-live="polite">
        <SaveError state={save} onRetry={() => void flush(sessionId)} />
      </div>
    </div>
  )
}

/** Notes save automatically and quietly; only a failure is shown, with a retry. */
function SaveError({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind !== 'error') return null
  return (
    <span className="small" role="alert" style={{ color: 'var(--tone-danger-text)' }}>
      Not saved: {state.message}{' '}
      <button type="button" className="btn" onClick={onRetry}>
        Retry
      </button>
    </span>
  )
}

/** The review state as a dashboard dropdown showing its value; named "Review state" for assistive technology. */
function ReviewDropdown({ review, onChange }: { review: ReviewState; onChange: (review: ReviewState) => void }) {
  return (
    <Dropdown
      label="Review state"
      value={REVIEW_LABELS[review]}
      valueOnly
      sections={[
        {
          items: (Object.keys(REVIEW_LABELS) as ReviewState[]).map((r) => ({
            type: 'radio' as const,
            label: REVIEW_LABELS[r],
            checked: review === r,
            onSelect: () => onChange(r),
          })),
        },
      ]}
    />
  )
}
